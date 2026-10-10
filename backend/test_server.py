"""Integration checks use disposable databases, local mail, and loopback only."""
from concurrent.futures import ThreadPoolExecutor
import http.client
import json
from pathlib import Path
import re
import sqlite3
import tempfile
import threading
import time
import unittest
from contextlib import closing
from server import create_server, digest, CAMPUSES


class AppTests(unittest.TestCase):
    def setUp(self):
        scratch = Path(__file__).parent / ".data/tests"
        scratch.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=scratch)
        self.root = Path(self.temp.name)
        self.db = self.root / "app.db"
        self.app = create_server(0, self.db, self.root / "events.json", dev_mail=True)
        self.port = self.app.server_address[1]
        self.origin = f"http://127.0.0.1:{self.port}"
        self.thread = threading.Thread(target=self.app.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.app.shutdown()
        self.app.server_close()
        self.thread.join()
        self.temp.cleanup()

    def request(self, path, body=None, cookie="", origin=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        headers = {"Origin": origin or self.origin, "Content-Type": "application/json", "Cookie": cookie}
        conn.request("GET" if body is None else "POST", path, None if body is None else json.dumps(body), headers)
        response = conn.getresponse()
        raw = response.read()
        result = (response.status, dict(response.getheaders()), json.loads(raw) if "json" in response.getheader("Content-Type","") else raw)
        conn.close()
        return result

    def signup(self, email="knight@ucf.edu"):
        status, _, _ = self.request("/api/auth/code", {"mode":"signup","email":email,"displayName":"A Knight"})
        self.assertEqual(status,200)
        code = re.search(r"code: (\d{6})", (self.app.outbox / (digest(email) + ".txt")).read_text())[1]
        status, headers, data = self.request("/api/auth/verify", {"email":email,"code":code})
        self.assertEqual(status,200)
        self.last_cookie_header = headers["Set-Cookie"]
        return headers["Set-Cookie"].split(";")[0], data, code

    def test_verified_session_cookie_replay_logout_and_email_privacy(self):
        cookie, data, code = self.signup()
        self.assertEqual(data["user"]["email"],"knight@ucf.edu")
        status, headers, _ = self.request("/api/auth/verify", {"email":"knight@ucf.edu","code":code})
        self.assertEqual(status,400)  # A used code cannot mint a new session.
        status, _, session = self.request("/api/auth/session", cookie=cookie)
        self.assertEqual(session["user"]["displayName"],"A Knight")
        self.assertNotIn("email", str(self.request("/api/leaderboard")[2]))
        status, headers, _ = self.request("/api/auth/logout", {}, cookie)
        self.assertIn("HttpOnly", headers["Set-Cookie"])
        self.assertIn("SameSite=Lax", headers["Set-Cookie"])
        self.assertIn("Max-Age=0", headers["Set-Cookie"])
        self.assertIsNone(self.request("/api/auth/session",cookie=cookie)[2]["user"])

    def test_domains_csrf_unauthenticated_and_offcampus_rejected(self):
        for email in ("x@gmail.com","x@ucf.edu.evil.com","x@sub.ucf.edu"):
            self.assertEqual(self.request("/api/auth/code",{"mode":"signup","email":email,"displayName":"Knight"})[0],400)
        point = {"lat":28.6024,"long":-81.2001}
        self.assertEqual(self.request("/api/sightings",point)[0],401)
        self.assertEqual(self.request("/api/auth/code",{"email":"x@ucf.edu"},origin="https://evil.example")[0],403)
        cookie, _, _ = self.signup("knight@knights.ucf.edu")
        for point in ({"lat":0,"long":0},{"lat":True,"long":-81.2},{"lat":28.6,"long":-81.2,"caption":"x"*201}):
            self.assertEqual(self.request("/api/sightings",point,cookie)[0],400)

    def test_atomic_cooldown_leaderboard_and_all_three_campuses(self):
        cookie, _, _ = self.signup()
        point = {"lat":28.6024,"long":-81.2001}
        with ThreadPoolExecutor(2) as pool:
            results = list(pool.map(lambda _: self.request("/api/sightings",point,cookie), range(2)))
        self.assertEqual(sorted(r[0] for r in results),[201,429])
        self.assertGreater(next(r[2]["retryAfter"] for r in results if r[0]==429),0)
        for campus in CAMPUSES[1:]:
            with closing(sqlite3.connect(self.db)) as db:
                db.execute("UPDATE users SET last_post=0")
                db.commit()
            center = campus["center"]
            self.assertEqual(self.request("/api/sightings",{"lat":center["lat"],"long":center["lng"]},cookie)[0],201)
        self.assertEqual(self.request("/api/leaderboard")[2]["leaders"][0]["score"],3)
        self.assertEqual(len(self.request("/api/sightings")[2]["sightings"]),3)
        with closing(sqlite3.connect(self.db)) as db:
            db.execute("UPDATE sightings SET timestamp=?", (int(time.time())-1201,))
            db.commit()
        self.assertEqual(self.request("/api/sightings")[2]["sightings"],[])

    def test_code_limits_expiration_and_rate_limit(self):
        email="knight@ucf.edu"
        body={"mode":"signup","email":email,"displayName":"Knight"}
        self.assertEqual(self.request("/api/auth/code",body)[0],200)
        self.assertEqual(self.request("/api/auth/code",body)[0],429)
        code=re.search(r"code: (\d{6})",(self.app.outbox/(digest(email)+".txt")).read_text())[1]
        wrong="000000" if code!="000000" else "111111"
        for _ in range(5):
            self.assertEqual(self.request("/api/auth/verify",{"email":email,"code":wrong})[0],400)
        self.assertEqual(self.request("/api/auth/verify",{"email":email,"code":code})[0],400)
        with closing(sqlite3.connect(self.db)) as db:
            db.execute("UPDATE challenges SET attempts=0,expires=0")
            db.commit()
        self.assertEqual(self.request("/api/auth/verify",{"email":email,"code":code})[0],400)

    def test_static_isolation_events_and_secure_cookie(self):
        self.assertEqual(self.request("/frontend/")[0],200)
        for path in ("/frontend/../backend/server.py","/frontend/%2e%2e/backend/server.py","/backend/server.py"):
            self.assertEqual(self.request(path)[0],404)
        self.assertEqual(self.request("/api/events")[2]["available"],False)
        (self.root/"events.json").write_text('{"events":[],"available":true,"generatedAt":123}')
        self.assertEqual(self.request("/api/events")[2]["generatedAt"],123)
        self.app.public_origin="https://tracker.example"
        cookie, _, _ = self.signup()
        self.assertIn("; Secure", self.last_cookie_header)
        self.assertTrue(cookie.startswith("kt_session="))
        with closing(sqlite3.connect(self.db)) as db:
            db.execute("UPDATE sessions SET expires=0")
            db.commit()
        self.assertIsNone(self.request("/api/auth/session",cookie=cookie)[2]["user"])


if __name__ == "__main__":
    unittest.main()
