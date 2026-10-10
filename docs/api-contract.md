# Knightro Tracker API contract

The backend is live and tested with curl.

**Base URL:** `https://zxigfjv1p9.execute-api.us-east-1.amazonaws.com`

## 1) Report a sighting

`POST /sightings`

- Header: `Content-Type: application/json`
- Body: `{"lat": 28.6024, "long": -81.2001, "caption": "optional, max 200 chars"}`
- `lat` and `long` must be numbers (not strings)
- Success: `201` → `{"sightingId": "...", "timestamp": 1791516484}`
- Bad input: `400` → `{"error": "..."}`

## 2) Get active sightings

`GET /sightings`

- Success: `200` → `{"sightings": [{"sightingId", "lat", "long", "timestamp", "caption"}, ...]}`
- Only returns sightings from the **last 20 minutes**
- Old sightings may have no `caption` field, so use `(s.caption || "")`
- `timestamp` is in **seconds** since 1970. Age in seconds = `Date.now()/1000 - s.timestamp`
- An empty list is normal when nobody has reported recently

## Frontend notes

- CORS is on, so `fetch()` works from localhost, a local file, or a hosted page
- Poll `GET /sightings` every 10–15 seconds to keep the map fresh
- Show captions with `textContent`, **never** `innerHTML` (strangers type these, so it's an XSS risk)
- `navigator.geolocation` only works on HTTPS or localhost, so test on phones with a deployed link
- Stock Knightro photos live in the frontend. The backend doesn't store images yet

## Example calls

```js
await fetch(BASE + "/sightings", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ lat, long: lng, caption }),
});

const data = await (await fetch(BASE + "/sightings")).json();
```
