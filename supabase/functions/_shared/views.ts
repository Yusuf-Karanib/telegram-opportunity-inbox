import type { OpportunityRow, OpportunityView } from "./types.ts";

const DAY_MS = 24 * 60 * 60 * 1_000;

export function isOverdue(row: OpportunityRow, now = new Date()): boolean {
  if (row.archived_at || row.status === "rejected" || row.status === "completed") return false;
  const timestamp = now.getTime();
  if (row.next_action_at && new Date(row.next_action_at).getTime() < timestamp) return true;
  if (row.reminder_at && new Date(row.reminder_at).getTime() < timestamp) return true;
  if (row.deadline_at && ["saved", "planning"].includes(row.status) &&
    new Date(row.deadline_at).getTime() < timestamp) return true;
  if (row.event_at && new Date(row.event_at).getTime() < timestamp) return true;
  const activityBaseline = row.last_activity_at ?? row.status_confirmed_at;
  if (row.category === "course" && activityBaseline &&
    ["accepted", "registered", "in_progress"].includes(row.status) &&
    new Date(activityBaseline).getTime() + row.course_inactivity_days * DAY_MS < timestamp) return true;
  return false;
}

export function nextRelevantTime(row: OpportunityRow, now = new Date()): number | null {
  const current = now.getTime();
  const dates = [row.deadline_at, row.event_at, row.next_action_at, row.reminder_at]
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value) && value >= current)
    .sort((a, b) => a - b);
  return dates[0] ?? null;
}

export function matchesView(row: OpportunityRow, view: OpportunityView, now = new Date()): boolean {
  if (view === "archived") return Boolean(row.archived_at);
  if (row.archived_at) return false;
  if (view === "saved") return row.status === "saved" || row.status === "planning";
  if (view === "overdue") return isOverdue(row, now);
  if (view === "upcoming") {
    return !["rejected", "completed"].includes(row.status) && nextRelevantTime(row, now) !== null;
  }
  if (view === "waiting") return row.status === "applied" || row.status === "waiting";
  if (view === "registered") return row.status === "registered";
  if (view === "accepted") return row.status === "accepted" || row.status === "in_progress";
  if (view === "rejected") return row.status === "rejected";
  return row.status === "completed";
}

export function rowsForView(rows: OpportunityRow[], view: OpportunityView, now = new Date()): OpportunityRow[] {
  return rows.filter((row) => matchesView(row, view, now)).sort((left, right) => {
    if (view === "upcoming") {
      return (nextRelevantTime(left, now) ?? Number.MAX_SAFE_INTEGER) -
        (nextRelevantTime(right, now) ?? Number.MAX_SAFE_INTEGER);
    }
    return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
  });
}

export function viewCounts(rows: OpportunityRow[], now = new Date()): Record<OpportunityView, number> {
  return {
    saved: rowsForView(rows, "saved", now).length,
    upcoming: rowsForView(rows, "upcoming", now).length,
    overdue: rowsForView(rows, "overdue", now).length,
    waiting: rowsForView(rows, "waiting", now).length,
    registered: rowsForView(rows, "registered", now).length,
    accepted: rowsForView(rows, "accepted", now).length,
    rejected: rowsForView(rows, "rejected", now).length,
    completed: rowsForView(rows, "completed", now).length,
    archived: rowsForView(rows, "archived", now).length,
  };
}
