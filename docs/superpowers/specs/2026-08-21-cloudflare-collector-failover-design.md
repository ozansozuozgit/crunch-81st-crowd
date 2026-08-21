# Cloudflare Collector Failover Design

## Goal

Remove GitHub Actions credits from the live Crunch E 81st collection path while retaining the public GitHub Pages dashboard.

## Architecture

A Cloudflare Worker with a UTC 10-minute Cron Trigger fetches the official public Crunch location page, validates the embedded public occupancy record, and persists it to a D1 database. The Worker exposes read-only CORS-controlled endpoints for the Pages dashboard:

- `GET /v1/readings.csv`: chronological public records;
- `GET /v1/insights.json`: core quiet-workout insights derived from D1;
- `GET /health`: non-sensitive collection status.

On its first successful run, the Worker imports the existing public GitHub CSV into D1. Timestamp uniqueness makes this idempotent. The Worker then stores new readings by UTC timestamp; a failed fetch does not write a zero or overwrite prior data.

GitHub Pages continues to host the dashboard code. Its data requests move from relative GitHub CSV/JSON files to the Worker endpoints. GitHub Actions remain in the repository as an optional manual/archive path but are no longer required for live collection.

## Data and evidence

The Worker returns the existing core quiet-workout contract: latest record, weekday/ten-minute baselines, eligible quiet windows (four independent local dates), recommendation progress, and ISO-local-week stability. It uses `America/New_York` for local grouping. Weather and class/holiday effects are returned as explicitly unavailable contextual fields until separately migrated; no claim is downgraded or fabricated.

## Safety

The Worker has no public write endpoint and needs no application secret. D1 stores ISO timestamps, nonnegative occupancy, and a constrained public status. The source page URL is fixed in code; parsing rejects absent, malformed, or negative values. The public API permits only the GitHub Pages origin via CORS. D1 prepared statements and a unique timestamp prevent injection and duplicate records.

## Operational limits

This is designed for Workers Free and D1 Free: one collection cron and a modest public-read API. No billing upgrade is made. If Worker Free CPU limits prove insufficient for the live Crunch page, deployment remains intact but collection errors will be visible through `/health`; upgrading to Workers Paid is a separate user decision.

