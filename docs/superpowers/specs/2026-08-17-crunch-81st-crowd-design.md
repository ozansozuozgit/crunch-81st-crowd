# Crunch E 81st Crowd Tracker — Design

## Goal

Publish a small, public GitHub Pages dashboard that records Crunch E 81st's
official public `current_occupancy` value every ten minutes and recommends
less-crowded times. It must retain the source observation and distinguish
measured facts from forecasts and low-confidence correlations.

## Architecture

A GitHub Actions workflow runs every ten minutes. A Python collector fetches
the public E 81st location page, extracts the embedded club record, and writes
one UTC timestamped observation containing the numeric occupancy and the
reported status. The collector validates the fields, ignores duplicate
timestamps, and records no data when the club is closed or the source is
unavailable. The workflow commits a changed data file only after a valid
observation.

The repository stores append-only CSV data in Git. A second daily workflow
enriches readings with hourly weather (temperature, apparent temperature,
precipitation, wind, and weather code), US federal-holiday flags, and an
editable class schedule. It calculates a weekday-and-time baseline, then
reports only factor effects that pass minimum sample and uncertainty checks.

GitHub Pages serves a dependency-light static dashboard. It shows the latest
measured value, a 24-hour line chart, a weekday/time heatmap, recommended
windows, and plainly labelled correlation summaries. It must never represent a
prediction as a live count or causation.

## Data and limits

The official Crunch public location page is the sole live-count source.
`max_occupancy` is excluded from analysis because its displayed value is not a
reliable physical-capacity denominator. Google Maps may be compared manually,
but is not scraped or treated as a count source. Weather and calendar data are
predictive context, not proof of cause. A user can optionally add equipment
availability notes later; that is out of scope for the initial collector.

The public repository intentionally exposes its code and recorded data. No
Crunch login, tokens, secrets, or account-specific API traffic are used.

## Failure handling

An invalid page, missing numeric occupancy, changed page format, non-successful
response, or duplicate sample produces a non-zero or no-change workflow result
and does not commit a fabricated reading. Analyses with inadequate evidence
output `insufficient_data` rather than a correlation claim.

## Verification

Tests will be written first for parsing, validation, de-duplication,
baseline calculation, and the evidence threshold. The Action will run tests
before collection or analysis. Before handoff, the collector will be exercised
against the live public page, the generated dashboard will be served locally,
and the committed repository will be checked for secrets and a clean status.
