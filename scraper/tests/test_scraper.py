import sys
import unittest
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from sqlalchemy import create_engine, select
from sqlalchemy.exc import IntegrityError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scraper import metadata, events, parse_calendar, save, run, runs

CALENDAR = b'''BEGIN:VCALENDAR\r
VERSION:2.0\r
BEGIN:VEVENT\r
UID:https://knightconnect.campuslabs.com/engage/event/123\r
URL:https://knightconnect.campuslabs.com/engage/event/123\r
SUMMARY:Game night\r
DESCRIPTION:A long description that is\r
 folded onto the next line.\\nBring a friend.\r
DTSTART:20261010T200000Z\r
DTEND:20261010T220000Z\r
LOCATION:Room 1\\, Student Union\r
X-HOSTS:Chess Club\r
CATEGORIES:Social\r
CATEGORIES:Free Food\r
GEO:28.6;-81.2\r
STATUS:CONFIRMED\r
END:VEVENT\r
END:VCALENDAR\r
'''


class ScraperTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")
        metadata.create_all(self.engine)
        self.now = datetime(2026, 10, 9, tzinfo=timezone.utc)
        self.row = parse_calendar(CALENDAR, "123")

    def tearDown(self):
        self.engine.dispose()

    def test_calendar_decodes_folding_escaping_and_utc(self):
        self.assertEqual(self.row["location"], "Room 1, Student Union")
        self.assertEqual(self.row["hosts"], ["Chess Club"])
        self.assertEqual(self.row["categories"], ["Social", "Free Food"])
        self.assertIn("isfolded", self.row["description"])
        self.assertIn("\nBring", self.row["description"])
        self.assertEqual(self.row["starts_at"].utcoffset().total_seconds(), 0)
        self.assertAlmostEqual(self.row["longitude"], -81.2)

    def test_identity_mismatch_rejected(self):
        with self.assertRaises(ValueError):
            parse_calendar(CALENDAR, "999")

    def test_invalid_time_range_rejected(self):
        with self.assertRaises(ValueError):
            parse_calendar(CALENDAR.replace(b"DTEND:20261010T220000Z", b"DTEND:20261010T190000Z"), "123")

    def test_all_day_dates_use_institution_timezone(self):
        calendar = CALENDAR.replace(b"DTSTART:20261010T200000Z", b"DTSTART;VALUE=DATE:20261010")
        calendar = calendar.replace(b"DTEND:20261010T220000Z", b"DTEND;VALUE=DATE:20261011")
        row = parse_calendar(calendar, "123")
        self.assertEqual(row["starts_at"], datetime(2026, 10, 10, 4, tzinfo=timezone.utc))
        self.assertEqual((row["ends_at"] - row["starts_at"]).total_seconds(), 86400)

    def test_repeat_run_updates_without_duplicate_and_preserves_first_seen(self):
        later = datetime(2026, 10, 10, tzinfo=timezone.utc)
        with self.engine.begin() as conn:
            save(conn, [self.row], True, self.now)
            save(conn, [{**self.row, "name": "Updated name"}], True, later)
        with self.engine.connect() as conn:
            records = conn.execute(select(events)).mappings().all()
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["name"], "Updated name")
        self.assertEqual(records[0]["first_seen_at"], self.now.replace(tzinfo=None))

    def test_limited_run_preserves_listing_membership(self):
        with self.engine.begin() as conn:
            save(conn, [self.row], True, self.now)
            save(conn, [], False, self.now)
        with self.engine.connect() as conn:
            self.assertTrue(conn.execute(select(events.c.is_listed)).scalar())

    def test_complete_run_marks_missing_without_deleting(self):
        with self.engine.begin() as conn:
            save(conn, [self.row], True, self.now)
            save(conn, [], True, self.now)
        with self.engine.connect() as conn:
            self.assertFalse(conn.execute(select(events.c.is_listed)).scalar())
            self.assertEqual(conn.execute(select(events.c.event_id)).scalar(), "123")

    def test_failure_preserves_data_and_records_failed_run(self):
        with tempfile.TemporaryDirectory() as folder:
            url = "sqlite:///" + str(Path(folder) / "events.db")
            engine = create_engine(url)
            metadata.create_all(engine)
            with engine.begin() as conn:
                save(conn, [self.row], True, self.now)
            with patch("scraper.robots", side_effect=RuntimeError("offline")):
                with self.assertRaises(RuntimeError):
                    run(url)
            with engine.connect() as conn:
                self.assertTrue(conn.execute(select(events.c.is_listed)).scalar())
                self.assertEqual(conn.execute(select(events.c.name)).scalar(), "Game night")
                self.assertEqual(conn.execute(select(runs.c.status)).scalar(), "failed")
            engine.dispose()

    def test_database_failure_rolls_back_reconciliation_and_updates(self):
        with self.engine.begin() as conn:
            save(conn, [self.row], True, self.now)
        with self.assertRaises(IntegrityError):
            with self.engine.begin() as conn:
                save(conn, [{**self.row, "name": "Changed"},
                            {**self.row, "event_id": "456", "name": None}], True, self.now)
        with self.engine.connect() as conn:
            records = conn.execute(select(events)).mappings().all()
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["name"], "Game night")
        self.assertTrue(records[0]["is_listed"])


if __name__ == "__main__":
    unittest.main()
