# Quiet Workout Dashboard Design

## Goal

Refocus the public Crunch E 81st tracker on one decision: when can someone work out with the least crowding and equipment waiting? Keep the site concise, measured, and useful while its history grows.

## Product direction

The dashboard uses the selected **go-now-first** hierarchy. The current public occupancy signal leads. Historical patterns help plan a quiet workout, but the UI never turns sparse history into a forecast or a promise.

## Information hierarchy

1. **Go now?** — Latest recorded occupancy, public status, measured-at time, and a deliberately plain state such as light, moderate, active, or full. It is a measurement, not a forecast.
2. **Today’s recorded rhythm** — A responsive 24-hour occupancy chart. Readings remain connected only across short collection gaps; missing time stays visually missing.
3. **Best quiet workout windows** — At most five weekday/time rows, ranked by a robust typical occupancy only after four independent matching local dates. Each row displays the New York time window, typical occupancy, independent date count, and a compact consistency indicator based on the per-date spread. Until a row clears the threshold, the section shows the strongest current progress rather than a recommendation.
4. **Week / month pattern** — One 7-by-24 New York-time heatmap of historical hourly medians, plus a narrow month-stability strip. The strip groups the eligible quiet-window measurements by local week and displays how many distinct weeks support the pattern and its week-to-week range. It does not create a new recommendation threshold: it provides supporting context once a window is otherwise eligible.
5. **What may matter** — One compact evidence panel for weather, holiday, and scheduled-class context. It reports data-state/progress and only renders an observed weather association after the existing 20 rainy and 20 dry independent-local-date requirement plus decisive interval test. It never says a factor caused crowding.
6. **Schedule context** — Replace the prominent class-list section with a short freshness/source note. If the automatically retained schedule is stale, show that warning. Do not show 51 schedule rows on the main dashboard.

## Data and analysis contracts

The existing public `readings.csv` and `insights.json` remain the only dashboard inputs. Extend the analyzer’s insights document with:

- `quiet_window_details`: only fully evidence-qualified quiet windows, including `slot`, `baseline_occupancy`, `independent_dates`, `independent_weeks`, and a finite per-date `spread` value;
- `quiet_progress`: strongest currently observed matching weekday/time date count and required count, preserving the existing recommendation-progress behavior;
- `monthly_stability`: bounded, validated summaries for qualified quiet windows, based on one average per local date and one aggregate per ISO local week;
- `factor_context`: the pre-existing weather progress/correlation, holiday date counts, and class schedule freshness, all explicitly non-causal.

All date grouping stays in `America/New_York`. Adjacent ten-minute readings on one date never become independent evidence. Weather mixed-condition dates remain excluded from rain/dry comparisons. A class timestamp is schedule context only.

## Data states and errors

- A valid but young data set displays progress, not empty-looking placeholders or forecasts.
- An unavailable/malformed readings file clears all dependent content and tells the visitor to retry.
- An unavailable or malformed insights file leaves measured readings visible but suppresses historical conclusions and factor claims.
- A stale schedule says retained schedule/stale and retains its actual last verified timestamp; failed refresh time is never presented as verified.
- Invalid typed values, dates, counts, or URLs are ignored rather than rendered.

## UI and accessibility

Keep the existing dark editorial identity, responsive layout, reduced-motion behavior, and text-based rendering. Use semantic headings, real lists/tables, accessible SVG titles/descriptions, and color-independent labels. The main page should fit the above sections without an additional navigation system or interactive filters.

## Verification

Tests must cover independent-date/week aggregation, early-data progress, qualified-detail output, malformed inputs, stale schedule display, and no causal language before threshold. Dashboard runtime tests must verify the simplified class context, qualified quiet rows, progress fallback, month strip, and factor state contracts. Run the complete Python suite, compile analyzers, syntax-check dashboard JavaScript, inspect local responsive render states, and verify the public Actions/Pages deployment after publishing.
