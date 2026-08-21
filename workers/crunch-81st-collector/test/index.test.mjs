import assert from "node:assert/strict";
import test from "node:test";

import { buildInsights, parseClubRecord, toCsv } from "../src/index.js";

test("parses entity-encoded public Crunch occupancy", () => {
  const page = '<div data-react-props="{&quot;club&quot;:{&quot;current_occupancy&quot;:42,&quot;occupancy_status&quot;:&quot;light&quot;}}"></div>';
  assert.deepEqual(parseClubRecord(page), { occupancy: 42, status: "light" });
});

test("rejects invalid public Crunch occupancy", () => {
  assert.throws(() => parseClubRecord('<div data-react-props="{}"></div>'));
  assert.throws(() => parseClubRecord('<div data-react-props="{&quot;club&quot;:{&quot;current_occupancy&quot;:-1,&quot;occupancy_status&quot;:&quot;light&quot;}}"></div>'));
});

test("only qualifies a quiet window after four independent local dates", () => {
  const rows = [
    ["2026-08-17T22:01:00Z", 20, "light"],
    ["2026-08-17T22:09:00Z", 24, "light"],
    ["2026-08-24T22:01:00Z", 30, "light"],
    ["2026-08-31T22:01:00Z", 20, "light"],
    ["2026-09-07T22:01:00Z", 30, "light"],
  ].map(([timestamp_utc, occupancy, status]) => ({ timestamp_utc, occupancy, status }));
  const insights = buildInsights(rows, "2026-09-08T00:00:00Z");
  assert.equal(insights.quiet_window_details.status, "ready");
  assert.equal(insights.quiet_window_details.items[0].independent_dates, 4);
  assert.equal(insights.quiet_window_details.items[0].baseline_occupancy, 26);
  assert.equal(insights.recommendation_progress.status, "ready");
});

test("emits the public CSV contract", () => {
  assert.equal(toCsv([{ timestamp_utc: "2026-08-17T22:01:00Z", occupancy: 20, status: "light" }]), "timestamp_utc,occupancy,status\n2026-08-17T22:01:00Z,20,light\n");
});

