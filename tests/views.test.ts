import assert from "node:assert/strict";
import test from "node:test";
import { isOverdue, matchesView, rowsForView, viewCounts } from "../supabase/functions/_shared/views.ts";
import { opportunityFixture } from "./fixtures.ts";

const now = new Date("2026-09-10T08:00:00.000Z");

test("planning items with passed deadlines are overdue", () => {
  const row = opportunityFixture({
    status: "planning",
    deadline_at: "2026-09-09T19:59:00.000Z",
    deadline_precision: "date",
  });
  assert.equal(isOverdue(row, now), true);
  assert.equal(matchesView(row, "overdue", now), true);
});

test("applied items appear in waiting but not deadline overdue", () => {
  const row = opportunityFixture({
    status: "applied",
    status_confirmed_at: "2026-09-09T08:00:00.000Z",
    deadline_at: "2026-09-09T07:00:00.000Z",
    deadline_precision: "datetime",
  });
  assert.equal(matchesView(row, "waiting", now), true);
  assert.equal(isOverdue(row, now), false);
});

test("archived items appear only in archived", () => {
  const row = opportunityFixture({ archived_at: "2026-09-10T07:00:00.000Z" });
  assert.equal(matchesView(row, "archived", now), true);
  assert.equal(matchesView(row, "upcoming", now), false);
});

test("saved items remain findable even when no date was provided", () => {
  const row = opportunityFixture();
  assert.equal(matchesView(row, "saved", now), true);
  assert.equal(viewCounts([row], now).saved, 1);
});

test("registered items remain findable without a date", () => {
  const row = opportunityFixture({
    status: "registered",
    status_confirmed_at: "2026-09-10T07:00:00.000Z",
  });
  assert.equal(matchesView(row, "registered", now), true);
  assert.equal(viewCounts([row], now).registered, 1);
});

test("upcoming items sort by the nearest useful date", () => {
  const later = opportunityFixture({ public_id: 1, deadline_at: "2026-09-20T10:00:00.000Z", deadline_precision: "datetime" });
  const sooner = opportunityFixture({ public_id: 2, event_at: "2026-09-11T10:00:00.000Z", event_precision: "datetime" });
  assert.deepEqual(rowsForView([later, sooner], "upcoming", now).map((row) => row.public_id), [2, 1]);
  assert.equal(viewCounts([later, sooner], now).upcoming, 2);
});
