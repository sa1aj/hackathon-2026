# Knightro Tracker 🛡️

Live Knightro sightings and KnightConnect events for UCF Main, Rosen, and Downtown campuses.

## Run locally

Python 3.12+; no Python packages or frontend build required:

```powershell
python backend/server.py --port 8000
```

Open [Knightro Tracker](http://localhost:8000/frontend/). Stop an old `python -m http.server` process first, or use `--port 8001`.

**Use the application server above.** A static file server or GitHub Pages alone cannot run the accounts, session cookies, leaderboard, or cooldown API. The frontend now calls same-origin `/api` routes; it does not call the old anonymous AWS endpoint.

## Features

- Pins fade continuously and expire 20 minutes after posting, even when polling fails.
- Normal and hover Knightro SVG assets; nearby sightings/events stack with a count and a list that opens every pin, including identical coordinates.
- Campus selector in the toggleable left menu. Each campus has its own restricted Leaflet viewport and location validation.
- Verified @ucf.edu / @knights.ucf.edu accounts, passwordless email codes, 14-day session cookies, and sign-out.
- Two-minute cooldown enforced atomically on the server for each account.
- All-time leaderboard: one point per accepted sighting, public display names only.
- Scraper event feed, event details, and a looping tween across the three supplied SVG frames.
- Corner notifications and reduced-motion support.

## Account email setup

Set `SMTP_HOST`, `SMTP_FROM`, `SMTP_PORT` (default 587), and, if required, `SMTP_USER` and `SMTP_PASSWORD` in your server environment. SMTP uses STARTTLS with certificate verification. Credentials must not be committed.

For local testing without sending email:

```powershell
python backend/server.py --port 8001 --dev-mail
```

This mode is labeled in the account UI. Verification codes are written to a `dev-mail` folder beside the database, **not emailed or returned through the API**. It is only available with the default local origin. The default database is `../knightro-tracker-data/knightro.db` relative to the repository; `--database` overrides it. Keep this directory private and outside any static file server root.

## Event feed

After a successful SQLite scraper run:

```powershell
python scraper/export_events.py --database scraper/events.db
```

This atomically writes `frontend/data/events.json`, read by `GET /api/events`. The UI refreshes it every minute and removes ended events locally. Use `--output` and server `--events` for a feed outside the repository. Schedule this export after successful scraper runs if you want automatic updates.

No event database is included in this checkout. Until an export is supplied, the app shows an honest empty-feed state. Events without coordinates appear in the list; a known building-name match can place them on the map. Events with unmapped locations never receive invented map positions. The exporter currently consumes the scraper's SQLite database; PostgreSQL export remains a separate deployment integration.

## Campus configuration

`frontend/data/campuses.json` is shared by frontend and server. Rectangular map limits are approximate navigation areas, not surveyed property boundaries. Rosen and Downtown centers use UCF's official location links:

- [Main campus map](https://map.ucf.edu/)
- [Rosen College location](https://www.ucf.edu/location/rosen-college-of-hospitality-management/)
- [Downtown location](https://www.ucf.edu/location/downtown/)

Adjust the bounds together in that file when campus coverage changes.

## Deployment

See [backend setup](backend/README.md) and [API contract](docs/api-contract.md). This change implements a local same-origin server and requires deployment work before replacing the existing AWS site. Existing AWS/DynamoDB sightings are not imported or modified.

## Checks

```powershell
python -m unittest discover -s backend -p "test_*.py" -v
node --test frontend/tests/map-utils.test.cjs
node --check frontend/js/app.js
```

The backend checks use disposable databases and development mail; they do not send real email or touch the live AWS API.
