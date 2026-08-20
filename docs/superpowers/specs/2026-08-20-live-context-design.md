# Live Context Completion — Design

## Goal

Make the tracker visibly useful while its historical dataset matures: automatically publish Crunch E 81st's current public weekly class schedule, and turn weather and quiet-window empty states into concrete collection-progress reports. Do not weaken the existing thresholds for recommendations or weather associations.

## Class schedule feed

The nightly analysis workflow will first fetch Crunch's public E 81st weekly schedule PDF (club 40). A small, pinned PDF-text dependency will extract positioned page text, reconstruct each day column, validate weekday/time/class records, and write `docs/data/classes.csv` only when a complete parse succeeds. The generated schedule includes a source timestamp and URL in analysis output. A failed request or malformed PDF retains the last valid schedule and emits a visible stale/unavailable state rather than erasing annotations.

## Evidence progress

Analysis will always publish a weather-progress object: independent rainy-date and dry-date counts, the 20/20 threshold, and whether a statistical association is eligible. It may also publish safely available weather coverage metadata, but never describes an effect unless the existing 95% confidence test passes.

Analysis will also publish quiet-window progress: the largest number of independent matching weekday/time observations currently available and the four-date requirement. The dashboard will render this progress when recommendations are not ready, making clear why more calendar time—not a broken feature—is required.

## UI and safety

The class panel will display imported schedule rows and its source freshness. Weather and recommendation panels will distinguish collecting, stale, unavailable, and evidence-ready states. All parsed class text is rendered as text; malformed source data never becomes a schedule entry. Existing public-only data boundaries, non-causation language, and resilient writer behaviour remain unchanged.

## Verification

Tests will cover PDF schedule parsing with a captured fixture, stale-schedule retention, workflow ordering, weather/recommendation progress counts, and dashboard states. Before publishing, the class sync will be run against the live public E 81st source, all tests will pass, and the deployed dashboard will be checked for its imported rows and progress text.
