import json
import sqlite3
from datetime import datetime, timezone, timedelta

DB_PATH = "events.db"
OUT_PATH = "events.json"   # move this into the repo's data/ folder afterward
DAYS_AHEAD = 14            # only keep events starting within this window

def to_dt(s):
    # SQLite stores UTC datetimes with no timezone suffix
    return datetime.fromisoformat(s).replace(tzinfo=timezone.utc)

now = datetime.now(timezone.utc)
cutoff = now + timedelta(days=DAYS_AHEAD)

conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row

rows = conn.execute(
    """SELECT event_id, name, starts_at, ends_at, location,
              latitude, longitude, hosts, source_url
       FROM events
       WHERE is_listed = 1 AND status != 'CANCELLED'
       ORDER BY starts_at"""
).fetchall()

events = []
for r in rows:
    starts, ends = to_dt(r["starts_at"]), to_dt(r["ends_at"])
    if ends <= now or starts > cutoff:
        continue  # already over, or too far in the future
    events.append({
        "eventId": r["event_id"],
        "title": r["name"],
        "startsAt": int(starts.timestamp()),
        "endsAt": int(ends.timestamp()),
        "location": r["location"],
        "lat": r["latitude"],     # can be null, the frontend should skip those pins
        "long": r["longitude"],
        "hosts": json.loads(r["hosts"] or "[]"),
        "url": r["source_url"],
    })

with open(OUT_PATH, "w") as f:
    json.dump({"events": events}, f, indent=2)

with_coords = sum(1 for e in events if e["lat"] is not None)
print(f"Wrote {len(events)} events ({with_coords} with coordinates) to {OUT_PATH}")
