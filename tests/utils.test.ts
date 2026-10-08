import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalizeUrl,
  datePrecision,
  formatDubaiMoment,
  parseDubaiDate,
} from "../supabase/functions/_shared/utils.ts";

test("parses future Dubai dates instead of rejecting them", () => {
  const now = new Date("2026-09-09T20:30:00.000Z");
  assert.equal(parseDubaiDate("2030-12-31", now, "23:59"), "2030-12-31T19:59:00.000Z");
  assert.equal(parseDubaiDate("10/10/2026 5pm", now), "2026-10-10T13:00:00.000Z");
  assert.equal(parseDubaiDate("2030-12-31 5pm", now, "23:59"), "2030-12-31T13:00:00.000Z");
});

test("relative dates use the Dubai calendar", () => {
  const now = new Date("2026-09-09T21:30:00.000Z");
  assert.equal(parseDubaiDate("today 9am", now), "2026-09-10T05:00:00.000Z");
  assert.equal(parseDubaiDate("tomorrow 9am", now), "2026-09-11T05:00:00.000Z");
});

test("rejects ambiguous dates without a year", () => {
  assert.equal(parseDubaiDate("10/11"), null);
  assert.equal(parseDubaiDate("next Friday"), null);
});

test("keeps date-only precision visible", () => {
  const value = "2026-10-15T19:59:00.000Z";
  assert.equal(datePrecision("15 October 2026"), "date");
  assert.equal(datePrecision("15 October 2026 5pm"), "datetime");
  assert.equal(formatDubaiMoment(value, "date"), "15 Oct 2026");
  assert.match(formatDubaiMoment(value, "datetime"), /11:59 pm/i);
});

test("canonical links remove common tracking values", () => {
  assert.equal(
    canonicalizeUrl("https://EXAMPLE.com/jobs/?utm_source=x&role=ai#apply"),
    "https://example.com/jobs?role=ai",
  );
});
