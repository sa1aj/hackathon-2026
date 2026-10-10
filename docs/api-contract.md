# Knightro Tracker API

This implementation is served under same-origin `/api` by `backend/server.py`. Timestamps are Unix seconds. Responses are JSON with `Cache-Control: no-store`. All POST routes require JSON and a matching Origin header. The browser sends the HttpOnly session cookie automatically.

| Route | Input | Result |
| --- | --- | --- |
| GET /api/auth/session | — | user (or null), nextSightingAt, cooldownSeconds, emailDelivery |
| POST /api/auth/code | email, mode: signup/login, displayName (signup only) | Generic acknowledgement; sends a six-digit email code |
| POST /api/auth/verify | email, code | Session cookie plus session response; creates new verified account if needed |
| POST /api/auth/logout | {} | Revokes current session and expires cookie |
| GET /api/sightings | — | sightings from last 20 minutes, newest first |
| POST /api/sightings | lat, long, caption? | 201: sightingId, timestamp, nextSightingAt |
| GET /api/leaderboard | — | leaders: [{id, displayName, score}], period: all-time |
| GET /api/events | — | events, generatedAt, available |

User shape: `{id, displayName, email}` (only returned to that signed-in user). Leaderboards and sightings never expose email addresses.

Sighting shape: `{sightingId, lat, long, caption, timestamp, campus}`. Campus is main, rosen, or downtown. Coordinates must be finite numbers inside a configured campus. Captions are trimmed and limited to 200 characters.

Event shape: `{eventId, title, startsAt, endsAt, location, lat, long, hosts, url}`. Coordinates may be null. Missing feeds return `{events:[], generatedAt:null, available:false}`. Browser removes ended events, resolves known building names, and keeps unmappable events in the list.

Errors use `{error, retryAfter?}`. Invalid input: 400. Missing/expired session: 401. Invalid Origin/Host: 403. Wrong Content-Type: 415. Size limit: 413. Rate/cooldown limit: 429 with Retry-After header and seconds. Unconfigured/unavailable service: 503.

The two-minute posting cooldown is checked and written in one database transaction, including concurrent submissions. Reloading, clearing client storage, or using another browser cannot reset an account's cooldown. Two accounts remain two accounts; this does not claim to enforce one account per human.

The earlier API at `https://zxigfjv1p9.execute-api.us-east-1.amazonaws.com` is a separate anonymous deployment. These changes do not modify it.
