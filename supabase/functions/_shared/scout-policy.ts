import type { OpportunityDiscoveryCandidateRow } from "./types.ts";
import { dubaiDateString, formatDubaiMoment } from "./utils.ts";

export interface DiscoveryRunRow {
  id: string;
  status: "running" | "completed" | "partial" | "failed";
  scheduled: boolean;
  started_at: string;
  finished_at: string | null;
  metrics: Record<string, unknown>;
  error_message: string | null;
}

export function discoveryRunKey(
  scheduled: boolean,
  now: Date,
  purpose: "search" | "preview" | "maintenance" = "search",
): string {
  if (purpose !== "search") return `${purpose}:${crypto.randomUUID()}`;
  if (!scheduled) return `manual:${crypto.randomUUID()}`;
  const hour = Number(new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Dubai",
    hour: "numeric",
    hourCycle: "h23",
  }).format(now));
  return `scheduled:${dubaiDateString(now)}:${hour < 12 ? "morning" : "evening"}`;
}

export function discoveryCandidateExpired(
  row: Pick<OpportunityDiscoveryCandidateRow, "event_at" | "deadline_at" | "decision_details">,
  now = new Date(),
): boolean {
  const end = row.decision_details?.event_end_at ?? row.event_at;
  return Boolean(
    (row.deadline_at && new Date(row.deadline_at) < now) ||
      (end && new Date(end) < now),
  );
}

export function discoveryHealthText(run: DiscoveryRunRow | null, now = new Date()): string {
  if (!run) return "No search has been recorded yet. Send /discover to run one.\nScheduled: 7 AM and 7 PM UAE time.";
  const age = now.getTime() - new Date(run.started_at).getTime();
  const state = run.status === "running"
    ? age > 6 * 60_000 ? "Stopped before finishing" : "Still searching"
    : run.status === "failed"
    ? "Failed"
    : run.status === "partial"
    ? "Finished with some source failures"
    : "Finished";
  const metrics = run.metrics ?? {};
  const lines = [
    `Last search: ${formatDubaiMoment(run.started_at, "datetime")} — ${state}`,
    `Cards sent: ${Number(metrics.sent ?? 0)}. Waiting to send: ${Number(metrics.queued ?? 0)}.`,
    `Official sources: ${Number(metrics.officialSourcesChecked ?? 0)}. Web searches: ${
      Number(metrics.queriesRun ?? 0)
    }.`,
    "Scheduled: 7 AM and 7 PM UAE time.",
  ];
  if (age > 16 * 60 * 60_000) lines.push("The latest scheduled search may have been missed. Send /discover.");
  if (run.status === "failed" && run.error_message) lines.push(`Problem: ${run.error_message.slice(0, 200)}`);
  return lines.join("\n");
}
