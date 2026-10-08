import assert from "node:assert/strict";
import test from "node:test";
import { dueReminder, reminderCandidates } from "../supabase/functions/_shared/reminders.ts";
import { opportunityFixture } from "./fixtures.ts";

test("a due manual reminder is selected", () => {
  const now = new Date("2026-09-10T08:00:00.000Z");
  const row = opportunityFixture({
    reminder_at: "2026-09-10T07:55:00.000Z",
    reminder_precision: "datetime",
    next_action: "Review application",
  });
  const reminder = dueReminder(row, now);
  assert.equal(reminder?.kind, "manual");
  assert.match(reminder?.detail ?? "", /Review application/);
});

test("a one-day deadline reminder uses the deadline as its target", () => {
  const now = new Date("2026-09-09T20:05:00.000Z");
  const row = opportunityFixture({
    status: "planning",
    deadline_at: "2026-09-10T20:00:00.000Z",
    deadline_precision: "datetime",
  });
  const reminder = dueReminder(row, now);
  assert.equal(reminder?.kind, "deadline");
  assert.equal(reminder?.targetAt, row.deadline_at);
  assert.match(reminder?.key ?? "", /1-day/);
});

test("terminal items have no reminders", () => {
  const row = opportunityFixture({ status: "completed", status_confirmed_at: new Date().toISOString() });
  assert.deepEqual(reminderCandidates(row), []);
});

test("date-only events do not invent a two-hour reminder", () => {
  const row = opportunityFixture({
    status: "registered",
    status_confirmed_at: "2026-09-09T08:00:00.000Z",
    event_at: "2026-09-11T19:59:00.000Z",
    event_precision: "date",
  });
  const candidates = reminderCandidates(row, new Date("2026-09-09T08:00:00.000Z"));
  assert.equal(candidates.filter((item) => item.kind === "event").length, 1);
  assert.doesNotMatch(candidates.find((item) => item.kind === "event")?.key ?? "", /2-hours/);
});

test("saved event dates still receive event reminders", () => {
  const row = opportunityFixture({
    status: "saved",
    event_at: "2026-09-11T19:59:00.000Z",
    event_precision: "date",
  });
  const candidates = reminderCandidates(row, new Date("2026-09-09T08:00:00.000Z"));
  assert.equal(candidates.some((item) => item.kind === "event"), true);
});

test("course inactivity needs a recorded last activity", () => {
  const now = new Date("2026-09-10T06:00:00.000Z");
  const inactive = opportunityFixture({
    category: "course",
    status: "in_progress",
    status_confirmed_at: "2026-09-01T06:00:00.000Z",
    last_activity_at: "2026-09-01T06:00:00.000Z",
    course_inactivity_days: 7,
  });
  assert.equal(dueReminder(inactive, now)?.kind, "course_inactivity");
  assert.equal(reminderCandidates({ ...inactive, last_activity_at: null, status_confirmed_at: null }, now)
    .some((item) => item.kind === "course_inactivity"), false);
});

test("course inactivity can start from a user-confirmed registered status", () => {
  const now = new Date("2026-09-10T06:00:00.000Z");
  const row = opportunityFixture({
    category: "course",
    status: "registered",
    status_confirmed_at: "2026-09-01T06:00:00.000Z",
    last_activity_at: null,
    course_inactivity_days: 7,
  });
  assert.equal(dueReminder(row, now)?.kind, "course_inactivity");
});
