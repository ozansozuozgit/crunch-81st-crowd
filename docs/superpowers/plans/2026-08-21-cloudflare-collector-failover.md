# Cloudflare Collector Failover Implementation Plan

**Goal:** Serve live crowd data from a Cloudflare Worker and D1 without GitHub Actions credits.

1. Create the Worker, D1 schema, pure parser/analysis helpers, and unit tests.
2. Create the remote D1 database, apply the migration, deploy the Worker, and prove its read-only API and cron handler.
3. Point GitHub Pages at the Worker data origin, test unavailable/valid states, publish, and verify Pages.

The implementation preserves the current four-independent-date quiet-window threshold and treats weather/class context as unavailable until it has an equivalent independent scheduler.

