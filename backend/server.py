"""Same-origin application server. Standard library only; see README.md."""
import argparse
import hashlib
import hmac
import json
import math
import mimetypes
import os
from pathlib import Path
import re
import secrets
import smtplib
import sqlite3
import ssl
import time
from contextlib import contextmanager, closing
from email.message import EmailMessage
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
CAMPUSES = json.loads((FRONTEND / "data/campuses.json").read_text())
ACTIVE_SECONDS = 1200
COOLDOWN = 120
SESSION_SECONDS = 14 * 86400
CODE_SECONDS = 600
EMAIL_RE = re.compile(r"[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@(ucf\.edu|knights\.ucf\.edu)", re.ASCII)


class APIError(Exception):
    def __init__(self, status, message, retry_after=None):
        self.status, self.message, self.retry_after = status, message, retry_after


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def campus_for(lat, lng):
    return next((c for c in CAMPUSES if c["bounds"]["minLat"] <= lat <= c["bounds"]["maxLat"]
                 and c["bounds"]["minLng"] <= lng <= c["bounds"]["maxLng"]), None)


def initialize(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(path)) as db:
        db.executescript("""
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
                created INTEGER NOT NULL, last_post INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS challenges (
                email TEXT PRIMARY KEY, name TEXT NOT NULL, salt TEXT NOT NULL,
                code_hash TEXT NOT NULL, expires INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
                expires INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sightings (
                id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
                lat REAL NOT NULL, lng REAL NOT NULL, caption TEXT NOT NULL,
                timestamp INTEGER NOT NULL, campus TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS sightings_time ON sightings(timestamp);
            CREATE INDEX IF NOT EXISTS sightings_user ON sightings(user_id);
            CREATE TABLE IF NOT EXISTS mail_requests (
                email TEXT NOT NULL, ip TEXT NOT NULL, created INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS mail_requests_time ON mail_requests(created);
        """)
        db.commit()


class Handler(BaseHTTPRequestHandler):
    server_version = "Knightro"

    def log_message(self, fmt, *args):
        # Paths never carry account codes or session credentials.
        super().log_message(fmt, *args)

    def respond(self, status, value, cookie=None):
        data = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if cookie:
            self.send_header("Set-Cookie", cookie)
        if value.get("retryAfter"):
            self.send_header("Retry-After", str(value["retryAfter"]))
        self.end_headers()
        self.wfile.write(data)

    def check_host(self):
        if self.headers.get("Host") not in self.server.allowed_hosts:
            raise APIError(403, "Unrecognized host.")

    @contextmanager
    def db_connection(self):
        db = sqlite3.connect(self.server.database, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        try:
            with db:
                yield db
        finally:
            db.close()

    def token(self):
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
            return cookie["kt_session"].value if "kt_session" in cookie else ""
        except Exception:
            return ""

    def user(self, db, required=False):
        row = db.execute("""
            SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id
            WHERE s.token_hash=? AND s.expires>?
        """, (digest(self.token()), int(time.time()))).fetchone()
        if required and row is None:
            raise APIError(401, "Sign in with your verified UCF email to post.")
        return row

    def session_data(self, row):
        return {
            "user": {"id": row["id"], "displayName": row["name"], "email": row["email"]} if row else None,
            "nextSightingAt": row["last_post"] + COOLDOWN if row else 0,
            "cooldownSeconds": COOLDOWN,
            "emailDelivery": "development" if self.server.dev_mail else "smtp" if os.environ.get("SMTP_HOST") else "unconfigured",
        }

    def session_cookie(self, token, age=SESSION_SECONDS):
        secure = "; Secure" if self.server.public_origin.startswith("https://") else ""
        return f"kt_session={token}; Path=/api; HttpOnly; SameSite=Lax; Max-Age={age}{secure}"

    def do_GET(self):
        try:
            self.check_host()
            path = urlsplit(self.path).path
            if path.startswith("/api/"):
                with self.db_connection() as db:
                    if path == "/api/auth/session":
                        result = self.session_data(self.user(db))
                    elif path == "/api/sightings":
                        rows = db.execute("""
                            SELECT id AS sightingId, lat, lng AS long, caption, timestamp, campus
                            FROM sightings WHERE timestamp>? ORDER BY timestamp DESC
                        """, (int(time.time()) - ACTIVE_SECONDS,)).fetchall()
                        result = {"sightings": [dict(r) for r in rows]}
                    elif path == "/api/leaderboard":
                        rows = db.execute("""
                            SELECT u.id, u.name AS displayName, COUNT(s.id) AS score
                            FROM users u JOIN sightings s ON s.user_id=u.id
                            GROUP BY u.id ORDER BY score DESC, u.created ASC, u.id ASC LIMIT 50
                        """).fetchall()
                        result = {"leaders": [dict(r) for r in rows], "period": "all-time"}
                    elif path == "/api/events":
                        if self.server.events_file.exists():
                            result = json.loads(self.server.events_file.read_text(encoding="utf-8"))
                        else:
                            result = {"events": [], "generatedAt": None, "available": False}
                    else:
                        raise APIError(404, "API route not found.")
                self.respond(200, result)
            else:
                self.serve_frontend(path)
        except APIError as exc:
            self.respond(exc.status, {"error": exc.message})
        except (OSError, ValueError, sqlite3.Error):
            self.respond(503, {"error": "Knightro HQ is temporarily unavailable."})

    def serve_frontend(self, path):
        if path in ("/", "/frontend"):
            self.send_response(302)
            self.send_header("Location", "/frontend/")
            self.end_headers()
            return
        if not path.startswith("/frontend/"):
            raise APIError(404, "Page not found.")
        relative = unquote(path[len("/frontend/"):]) or "index.html"
        target = (FRONTEND / relative).resolve()
        if not target.is_relative_to(FRONTEND) or not target.is_file() or any(p.startswith(".") for p in Path(relative).parts):
            raise APIError(404, "File not found.")
        data = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(str(target))[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        try:
            self.check_host()
            # Cookies never authorize a cross-site request. No permissive CORS.
            if self.headers.get("Origin") not in self.server.allowed_origins:
                raise APIError(403, "Please submit from the Knightro Tracker site.")
            if self.headers.get("Content-Type", "").split(";")[0].strip() != "application/json":
                raise APIError(415, "Use JSON for this request.")
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                raise APIError(400, "Invalid request size.")
            if not 0 < length <= 16384:
                raise APIError(413, "Request is too large or empty.")
            try:
                data = json.loads(self.rfile.read(length))
            except (ValueError, UnicodeError):
                raise APIError(400, "Invalid JSON.")
            if not isinstance(data, dict):
                raise APIError(400, "Expected a JSON object.")
            path = urlsplit(self.path).path
            if path == "/api/auth/code":
                self.request_code(data)
            elif path == "/api/auth/verify":
                self.verify_code(data)
            elif path == "/api/auth/logout":
                with self.db_connection() as db:
                    db.execute("DELETE FROM sessions WHERE token_hash=?", (digest(self.token()),))
                self.respond(200, {"ok": True}, self.session_cookie("", 0))
            elif path == "/api/sightings":
                self.post_sighting(data)
            else:
                raise APIError(404, "API route not found.")
        except APIError as exc:
            self.respond(exc.status, {"error": exc.message, "retryAfter": exc.retry_after})
        except (OSError, ValueError, sqlite3.Error, smtplib.SMTPException):
            self.respond(503, {"error": "Knightro HQ is temporarily unavailable. Please try again."})

    def email(self, data):
        email = data.get("email", "")
        if not isinstance(email, str):
            raise APIError(400, "Enter a UCF email address.")
        email = email.strip().lower()
        if len(email) > 254 or not EMAIL_RE.fullmatch(email):
            raise APIError(400, "Use your @ucf.edu or @knights.ucf.edu email.")
        return email

    def request_code(self, data):
        email = self.email(data)
        name = data.get("displayName", "")
        mode = data.get("mode")
        if mode not in ("signup", "login"):
            raise APIError(400, "Choose sign in or create account.")
        if not isinstance(name, str) or (mode == "signup" and not 2 <= len(name.strip()) <= 30):
            raise APIError(400, "Choose a public display name between 2 and 30 characters.")
        if not self.server.dev_mail and not os.environ.get("SMTP_HOST"):
            raise APIError(503, "Email sign-in is not configured yet. Please try again later.")
        now = int(time.time())
        code, salt = f"{secrets.randbelow(1000000):06d}", secrets.token_hex(16)
        with self.db_connection() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("DELETE FROM mail_requests WHERE created<?", (now - 3600,))
            db.execute("DELETE FROM sessions WHERE expires<=?", (now,))
            db.execute("DELETE FROM challenges WHERE expires<=?", (now,))
            recent = db.execute("SELECT MAX(created) FROM mail_requests WHERE email=?", (email,)).fetchone()[0]
            count = db.execute("SELECT COUNT(*) FROM mail_requests WHERE ip=?", (self.client_address[0],)).fetchone()[0]
            per_email = db.execute("SELECT COUNT(*) FROM mail_requests WHERE email=?", (email,)).fetchone()[0]
            if recent and now - recent < 60:
                raise APIError(429, "Wait a minute before requesting another code.", 60 - (now - recent))
            if count >= 10 or per_email >= 5:
                raise APIError(429, "Too many code requests. Try again in an hour.", 3600)
            db.execute("INSERT INTO mail_requests VALUES (?,?,?)", (email, self.client_address[0], now))
            user = db.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
            should_send = mode == "signup" or user is not None
            if should_send:
                db.execute("INSERT OR REPLACE INTO challenges VALUES (?,?,?,?,?,0)",
                           (email, user["name"] if user else name.strip(), salt, digest(salt + code), now + CODE_SECONDS))
        if should_send:
            try:
                self.send_code(email, code)
            except (OSError, smtplib.SMTPException):
                with self.db_connection() as db:
                    db.execute("DELETE FROM challenges WHERE email=? AND salt=?", (email, salt))
                raise APIError(503, "Couldn't send your code. Please try again in a minute.")
        self.respond(200, {"message": "If this address can sign in, a code is on its way. Check your UCF inbox.", "expiresIn": CODE_SECONDS})

    def send_code(self, email, code):
        if self.server.dev_mail:
            # Explicit local testing mode only. Codes are never returned through the API.
            self.server.outbox.mkdir(parents=True, exist_ok=True)
            file = self.server.outbox / (digest(email) + ".txt")
            file.write_text(f"To: {email}\nYour Knightro verification code: {code}\nExpires in 10 minutes.\n")
            return
        message = EmailMessage()
        message["From"] = os.environ["SMTP_FROM"]
        message["To"] = email
        message["Subject"] = "Your Knightro Tracker sign-in code"
        message.set_content(f"Your code is {code}. It expires in 10 minutes.\nIf you did not request this code, ignore this email.")
        with smtplib.SMTP(os.environ["SMTP_HOST"], int(os.environ.get("SMTP_PORT", 587)), timeout=15) as smtp:
            smtp.starttls(context=ssl.create_default_context())
            if os.environ.get("SMTP_USER"):
                smtp.login(os.environ["SMTP_USER"], os.environ["SMTP_PASSWORD"])
            smtp.send_message(message)

    def verify_code(self, data):
        email = self.email(data)
        code = data.get("code", "")
        if not isinstance(code, str) or not re.fullmatch(r"[0-9]{6}", code):
            raise APIError(400, "Enter the six-digit code from your UCF inbox.")
        now = int(time.time())
        with self.db_connection() as db:
            db.execute("BEGIN IMMEDIATE")
            challenge = db.execute("SELECT * FROM challenges WHERE email=?", (email,)).fetchone()
            if not challenge or challenge["expires"] <= now or challenge["attempts"] >= 5:
                raise APIError(400, "This code has expired. Request a new one.")
            if not hmac.compare_digest(challenge["code_hash"], digest(challenge["salt"] + code)):
                db.execute("UPDATE challenges SET attempts=attempts+1 WHERE email=?", (email,))
                db.commit()  # Persist attempt even though the response is an error.
                raise APIError(400, "That code did not match. Check your inbox.")
            db.execute("INSERT OR IGNORE INTO users(id,email,name,created) VALUES (?,?,?,?)",
                       (secrets.token_hex(16), email, challenge["name"], now))
            user = db.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
            token = secrets.token_urlsafe(32)
            db.execute("DELETE FROM sessions WHERE token_hash=?", (digest(self.token()),))
            db.execute("INSERT INTO sessions VALUES (?,?,?)", (digest(token), user["id"], now + SESSION_SECONDS))
            db.execute("DELETE FROM challenges WHERE email=?", (email,))
        self.respond(200, self.session_data(user), self.session_cookie(token))

    def post_sighting(self, data):
        lat, lng = data.get("lat"), data.get("long")
        caption = data.get("caption", "")
        if any(type(n) not in (int, float) or not math.isfinite(n) for n in (lat, lng)):
            raise APIError(400, "Choose a valid location.")
        campus = campus_for(lat, lng)
        if campus is None:
            raise APIError(400, "Choose a location on Main, Rosen, or Downtown campus.")
        if not isinstance(caption, str) or len(caption.strip()) > 200:
            raise APIError(400, "Keep your caption under 200 characters.")
        now, sid = int(time.time()), secrets.token_hex(16)
        with self.db_connection() as db:
            db.execute("BEGIN IMMEDIATE")  # Serializes cooldown check and write across concurrent requests.
            user = self.user(db, required=True)
            remaining = user["last_post"] + COOLDOWN - now
            if remaining > 0:
                raise APIError(429, f"Please wait {remaining} seconds before another sighting.", remaining)
            db.execute("INSERT INTO sightings VALUES (?,?,?,?,?,?,?)",
                       (sid, user["id"], lat, lng, caption.strip(), now, campus["id"]))
            db.execute("UPDATE users SET last_post=? WHERE id=?", (now, user["id"]))
        self.respond(201, {"sightingId": sid, "timestamp": now, "nextSightingAt": now + COOLDOWN})


def create_server(port, database, events_file, public_origin=None, dev_mail=False, outbox=None):
    origin = public_origin or f"http://localhost:{port}"
    parsed = urlsplit(origin)
    if parsed.scheme not in ("http", "https") or not parsed.netloc or parsed.path not in ("", "/"):
        raise ValueError("PUBLIC_ORIGIN must be a plain HTTP(S) origin")
    if dev_mail and public_origin:
        raise ValueError("--dev-mail is only available with the local default origin")
    if public_origin and parsed.scheme != "https":
        raise ValueError("A deployed PUBLIC_ORIGIN must use HTTPS")
    initialize(database)
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.database, server.events_file = database, events_file
    server.public_origin = origin.rstrip("/")
    server.dev_mail = dev_mail
    server.outbox = outbox or database.parent / "dev-mail"
    actual_port = server.server_address[1]
    server.allowed_origins = {server.public_origin} if public_origin else {f"http://localhost:{actual_port}", f"http://127.0.0.1:{actual_port}"}
    server.allowed_hosts = {urlsplit(o).netloc for o in server.allowed_origins}
    return server


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--database", type=Path, default=ROOT.parent / "knightro-tracker-data/knightro.db")
    parser.add_argument("--events", type=Path, default=FRONTEND / "data/events.json")
    parser.add_argument("--public-origin", default=os.environ.get("PUBLIC_ORIGIN"))
    parser.add_argument("--dev-mail", action="store_true", help="LOCAL ONLY: write codes to a dev-mail folder beside the database; never sends email")
    args = parser.parse_args()
    if not args.dev_mail and os.environ.get("SMTP_HOST") and not os.environ.get("SMTP_FROM"):
        parser.error("Set SMTP_FROM with SMTP_HOST")
    server = create_server(args.port, args.database, args.events, args.public_origin, args.dev_mail)
    print(f"Knightro Tracker: http://localhost:{args.port}/frontend/", flush=True)
    if args.dev_mail:
        print(f"LOCAL TEST MAIL ONLY: codes are in {server.outbox.resolve()}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
