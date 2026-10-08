import type { OpportunityRow, ReminderCandidate } from "./types.ts";
import { dubaiDateString, formatDubaiMoment, parseDubaiDate } from "./utils.ts";

const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;

function shiftedIso(value: string, milliseconds: number): string {
  return new Date(new Date(value).getTime() + milliseconds).toISOString();
}

function candidate(
  key: string,
  kind: ReminderCandidate["kind"],
  dueAt: string,
  targetAt: string,
  targetPrecision: ReminderCandidate["targetPrecision"],
  title: string,
  detail: string,
  maximumLatenessMs: number,
): ReminderCandidate {
  return { key, kind, dueAt, targetAt, targetPrecision, title, detail, maximumLatenessMs };
}

function dailyReminderTime(now: Date, hour: string): string {
  return parseDubaiDate(`${dubaiDateString(now)} ${hour}`, now, hour) as string;
}

export function reminderCandidates(row: OpportunityRow, now = new Date()): ReminderCandidate[] {
  if (row.archived_at || row.status === "rejected" || row.status === "completed") return [];
  const result: ReminderCandidate[] = [];
  const nowMs = now.getTime();

  if (row.reminder_at) {
    result.push(candidate(
      `manual:${row.reminder_at}`,
      "manual",
      row.reminder_at,
      row.reminder_at,
      row.reminder_precision ?? "datetime",
      "Manual reminder",
      row.next_action || "Review this opportunity",
      30 * DAY_MS,
    ));
  }

  if (row.next_action_at) {
    result.push(candidate(
      `next-action:${row.next_action_at}`,
      "next_action",
      row.next_action_at,
      row.next_action_at,
      row.next_action_at_precision ?? "datetime",
      "Next action",
      row.next_action || "Complete the saved next action",
      30 * DAY_MS,
    ));
  }

  if (row.deadline_at && ["saved", "planning"].includes(row.status)) {
    const deadlineMs = new Date(row.deadline_at).getTime();
    if (deadlineMs > nowMs) {
      for (const [label, offset, late] of [
        ["7-days", -7 * DAY_MS, 26 * HOUR_MS],
        ["1-day", -DAY_MS, 22 * HOUR_MS],
        ["2-hours", -2 * HOUR_MS, 3 * HOUR_MS],
      ] as const) {
        result.push(candidate(
          `deadline:${label}:${row.deadline_at}`,
          "deadline",
          shiftedIso(row.deadline_at, offset),
          row.deadline_at,
          row.deadline_precision ?? "datetime",
          "Application deadline reminder",
          `Deadline: ${formatDubaiMoment(row.deadline_at, row.deadline_precision)}`,
          late,
        ));
      }
    }
  }

  if (row.event_at) {
    const eventMs = new Date(row.event_at).getTime();
    if (eventMs > nowMs) {
      const offsets = row.event_precision === "date"
        ? [["1-day", -DAY_MS, 22 * HOUR_MS] as const]
        : [
          ["1-day", -DAY_MS, 22 * HOUR_MS] as const,
          ["2-hours", -2 * HOUR_MS, 3 * HOUR_MS] as const,
        ];
      for (const [label, offset, late] of offsets) {
        result.push(candidate(
          `event:${label}:${row.event_at}`,
          "event",
          shiftedIso(row.event_at, offset),
          row.event_at,
          row.event_precision ?? "datetime",
          "Event reminder",
          `Event: ${formatDubaiMoment(row.event_at, row.event_precision)}`,
          late,
        ));
      }
    }
  }

  const overdueParts: string[] = [];
  let overdueTarget: { at: string; precision: "date" | "datetime" } | null = null;
  if (row.deadline_at && ["saved", "planning"].includes(row.status) &&
    new Date(row.deadline_at).getTime() < nowMs) {
    overdueParts.push("application deadline passed");
    overdueTarget = { at: row.deadline_at, precision: row.deadline_precision ?? "datetime" };
  }
  if (row.event_at && new Date(row.event_at).getTime() < nowMs) {
    overdueParts.push("event date passed");
    overdueTarget ??= { at: row.event_at, precision: row.event_precision ?? "datetime" };
  }
  if (row.next_action_at && new Date(row.next_action_at).getTime() < nowMs) {
    overdueParts.push("next action is late");
    overdueTarget ??= { at: row.next_action_at, precision: row.next_action_at_precision ?? "datetime" };
  }
  if (overdueParts.length > 0 && overdueTarget) {
    const day = dubaiDateString(now);
    result.push(candidate(
      `overdue:${day}`,
      "overdue",
      dailyReminderTime(now, "08:00"),
      overdueTarget.at,
      overdueTarget.precision,
      "Opportunity needs attention",
      overdueParts.join("; "),
      22 * HOUR_MS,
    ));
  }

  const activityBaseline = row.last_activity_at ?? row.status_confirmed_at;
  if (row.category === "course" && activityBaseline &&
    ["registered", "accepted", "in_progress"].includes(row.status)) {
    const inactiveAt = shiftedIso(activityBaseline, row.course_inactivity_days * DAY_MS);
    if (new Date(inactiveAt).getTime() <= nowMs) {
      const day = dubaiDateString(now);
      result.push(candidate(
        `course-inactivity:${day}`,
        "course_inactivity",
        dailyReminderTime(now, "09:00"),
        inactiveAt,
        "datetime",
        "Course activity",
        `No activity recorded for ${row.course_inactivity_days} days. Tap Studied today after you work on it.`,
        21 * HOUR_MS,
      ));
    }
  }

  return result;
}

export function dueReminders(row: OpportunityRow, now = new Date()): ReminderCandidate[] {
  const timestamp = now.getTime();
  return reminderCandidates(row, now)
    .filter((item) => {
      const due = new Date(item.dueAt).getTime();
      return due <= timestamp && timestamp - due <= item.maximumLatenessMs;
    })
    .sort((left, right) => new Date(right.dueAt).getTime() - new Date(left.dueAt).getTime());
}

export function dueReminder(row: OpportunityRow, now = new Date()): ReminderCandidate | null {
  return dueReminders(row, now)[0] ?? null;
}
