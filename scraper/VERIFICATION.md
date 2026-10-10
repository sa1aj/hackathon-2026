# Verification

Checked on October 9, 2026, on Windows with Python 3.12 and installed Chrome.

- Full live discovery loaded all 516 publicly listed upcoming/ongoing events through the site's Load More control. Every per-event calendar downloaded, passed identity/date validation, and was committed to SQLite. Run completed at approximately 6:37 PM America/New_York.
- Two three-event smoke runs against the same SQLite database produced three rows total and two successful limited-run records, confirming live repeat-run behavior.
- Nine automated tests passed: folded/escaped calendar text, host/category extraction and UTC conversion; calendar identity mismatch; invalid time range; all-day date conversion; upserts preserving first-seen time; limited-run membership preservation; full-run reconciliation retaining historical rows; failed-download preservation with failed-run recording; and transaction rollback after a database write failure.
- `aws.yaml` passed cfn-lint 1.57.2 with no diagnostics.
- The bundled database passed SQLite integrity checking and row-count/required-field checks.

The downloaded project includes the resulting `events.db` snapshot. The listing count can change as events end or new events are published.

Docker is not installed in the verification environment, so the container image was not built/run here. AWS resources were not deployed, and a live PostgreSQL connection was not tested. The default bundled Chromium installation could not complete under this environment's filesystem sandbox; the successful live runs used the supported `--browser-channel chrome` option. Setup instructions include both browser options.
