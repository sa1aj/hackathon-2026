# Application backend

`server.py` serves the frontend and `/api` from one origin. It uses Python's standard library and SQLite and binds to 127.0.0.1. The older Lambda folders contain historical deployment notes only; their deployed code was not present in this repository.

## Local use

Run `python backend/server.py --port 8000` from the repo root. Use `--port 8001` if another server occupies 8000. Stop with Ctrl+C.

The default database and optional development mail live in `../knightro-tracker-data/`, outside the repository's static root. Override with `--database PATH`. Do not expose that directory through a file server. Database writes use transactions and enforce the sighting cooldown inside a write lock.

## Email verification and cookies

Signup/sign-in sends a random six-digit code valid for 10 minutes. Signup creates the account only after code verification. Existing accounts keep their original public name. Codes are hashed with a random salt, limited to five verification attempts, and consumed once. Code sending is limited to once/minute and five/hour per email, plus ten/hour per connecting IP. Challenge and expired-session cleanup runs when sending a new code.

Both @ucf.edu and @knights.ucf.edu are accepted; subdomains and lookalike suffixes are rejected. No passwords are stored. Each accepted sighting earns one point and locks the account's next sighting for 120 seconds.

A successful verification rotates the browser session and sets an opaque, random `kt_session` cookie with `HttpOnly; SameSite=Lax; Path=/api; Max-Age=1209600`. The database stores only its hash. Sessions expire after 14 days and are deleted on sign-out. With HTTPS `PUBLIC_ORIGIN`, cookies also have `Secure`. No JavaScript-readable authentication token or localStorage login flag is used.

All mutations require JSON and an Origin in the configured allowlist. There is no wildcard CORS. Host validation prevents arbitrary hostnames from reaching the local API. Frontend only renders untrusted text as text nodes.

Set environment variables:

- `SMTP_HOST` and `SMTP_FROM`
- `SMTP_PORT`, default 587 (STARTTLS required)
- `SMTP_USER` and `SMTP_PASSWORD`, when your provider requires authentication

`--dev-mail` is a local-only test mode that writes codes beside the database. It never sends email and cannot be combined with `--public-origin`. Do not use it as public authentication. Without SMTP or explicit development mode, the server fails closed when someone requests a code.

## Production handoff

This is a functional local application server, not an automatic AWS deployment. Before publishing:

1. Configure a real SMTP sender and verify delivery to a UCF inbox.
2. Put the application behind a production HTTPS reverse proxy on the same origin as the frontend and set `PUBLIC_ORIGIN=https://your-host`.
3. Persist and back up the SQLite database outside the web root. This implementation targets a single server; use shared transactional storage before scaling to multiple replicas.
4. Add edge request limits/timeouts and a deployment process/service manager. The standard-library HTTP server is intended for local development, not direct public exposure.
5. The IP mail limit uses the socket peer, never untrusted forwarded headers. Behind a reverse proxy, configure an appropriate edge per-client limit; the application will otherwise see the proxy as one shared IP.
6. Publish the scraper's exported event JSON to the path provided via `--events`.
7. Retire or protect the old anonymous AWS `POST /sightings` endpoint if migrating production. This local change does not secure that separate deployed endpoint or migrate its DynamoDB data.

GitHub Pages alone cannot serve this backend. Keep the frontend and API on the same origin rather than relying on third-party session cookies.
