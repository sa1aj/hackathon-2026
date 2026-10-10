# Knightro Tracker 🛡️

Where's Knightro right now? Students who spot UCF's mascot drop a pin on the campus map, and everyone else sees it live for the next 20 minutes.

- **Live map:** a full-screen Leaflet map of UCF main campus. Pins show sightings from the last 20 minutes, newest pulsing, older ones fading.
- **Report in two steps:** GPS suggests your location, you drag the pin to fix it, add an optional caption, and post.
- **Recent list:** every active sighting with its location, time and caption.

The design is a retro handheld tracker in UCF black and gold. `docs/prototype.html` is the original clickable prototype, including features planned for later (events, leaderboards, check-in).

## Repo layout

```
knightro-tracker/
├── README.md
├── CONTRIBUTING.md
├── index.html             redirects GitHub Pages visitors to frontend/
├── frontend/              plain HTML/CSS/JS, no build step
│   ├── index.html
│   ├── css/styles.css
│   ├── js/                config.js, api.js, pixel.js, fx.js (sounds + animations), app.js
│   └── assets/photos/     stock Knightro photos (see README there)
├── backend/               AWS Lambda functions + API Gateway (see backend/README.md)
│   ├── submit-sighting/
│   └── get-sightings/
├── scraper/               Knight Connect event scraper
├── data/buildings.json    UCF building names + coordinates (frontend labels, scraper)
└── docs/
    ├── api-contract.md    the API the frontend talks to
    ├── prototype.html     original design prototype
    └── images/            screenshots for README / Devpost
```

## Run it locally

No install needed. From the repo root:

```bash
python -m http.server 8000
```

Open http://localhost:8000/frontend/. GPS works on `localhost`; on a phone you need the HTTPS link below.

## Deploy (GitHub Pages)

1. On GitHub: **Settings → Pages → Build and deployment → Deploy from a branch**, branch `main`, folder `/ (root)`.
2. The app is then at `https://<user>.github.io/knightro-tracker/` (the root page redirects to `frontend/`).

Pages serves over HTTPS, so location works on phones.

## API

The frontend uses the live AWS API at `https://zxigfjv1p9.execute-api.us-east-1.amazonaws.com` (set in `frontend/js/config.js`):

- `POST /sightings` with `{ lat, long, caption? }` → `201 { sightingId, timestamp }`
- `GET /sightings` → `{ sightings: [...] }` from the last 20 minutes

Full details: [docs/api-contract.md](docs/api-contract.md).

## Security notes

- Captions come from strangers. The frontend only ever inserts them as text (`textContent`), never as HTML.
- Reports are anonymous, with no login or rate limit yet, so anyone can post a pin. Server-side rate limiting (API Gateway throttling) is a good next step.

## Roadmap

- Photo uploads (needs image storage, e.g. S3 presigned uploads) and review before sightings go public
- Events on the map from the Knight Connect scraper
- Leaderboards and event check-in (see the prototype)
- UCF sign-in
