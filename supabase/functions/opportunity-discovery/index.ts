import type { SupabaseClient } from "npm:@supabase/supabase-js@2.116.0";
import { gdgCandidateFromEventPage, gdgUpcomingEventUrls } from "../_shared/discovery.ts";
import { adminClient } from "../_shared/supabase.ts";
import type { OpportunityDiscoveryCandidateRow } from "../_shared/types.ts";
import {
  AmbiguousTelegramError,
  discoveryCandidateReplyMarkup,
  formatDiscoveryCandidate,
  sendHtml,
} from "../_shared/telegram.ts";
import { constantTimeEqual, jsonResponse, requiredEnv, safeError } from "../_shared/utils.ts";

const SOURCES = [
  { name: "GDG Abu Dhabi", url: "https://gdg.community.dev/gdg-abu-dhabi/" },
  { name: "GDG Sharjah", url: "https://gdg.community.dev/gdg-sharjah/" },
  { name: "GDG Dubai", url: "https://gdg.community.dev/gdg-dubai/" },
] as const;
const MAX_DAILY_MESSAGES = 5;

interface CandidateClaim {
  claimed: boolean;
  reason: string;
}

async function fetchOfficialPage(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "Yusuf-Opportunity-Inbox/1.0" },
    });
    if (!response.ok) throw new Error(`Official page returned HTTP ${response.status}`);
    const html = await response.text();
    if (html.length > 2_000_000) throw new Error("Official page was unexpectedly large");
    return html;
  } finally {
    clearTimeout(timeout);
  }
}

async function claimCandidate(database: SupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await database.rpc("claim_opportunity_discovery_candidate", {
    p_candidate_id: id,
  });
  if (error) throw new Error(`Could not claim discovery candidate: ${error.message}`);
  const claim = (Array.isArray(data) ? data[0] : data) as CandidateClaim | null;
  return claim?.claimed === true;
}

async function finishCandidate(
  database: SupabaseClient,
  id: string,
  status: "sent" | "failed" | "unknown",
  messageId: number | null,
  errorMessage: string | null,
): Promise<void> {
  const { error } = await database.from("opportunity_discovery_candidates").update({
    status,
    telegram_message_id: messageId,
    sent_at: status === "sent" ? new Date().toISOString() : null,
    error_message: errorMessage,
    updated_at: new Date().toISOString(),
  }).eq("id", id).eq("status", "sending");
  if (error) throw new Error(`Could not record discovery delivery: ${error.message}`);
}

async function deliverCandidate(
  database: SupabaseClient,
  row: OpportunityDiscoveryCandidateRow,
): Promise<boolean> {
  if (row.event_at && new Date(row.event_at) <= new Date()) {
    await database.from("opportunity_discovery_candidates").update({
      status: "expired", updated_at: new Date().toISOString(),
    }).eq("id", row.id);
    return false;
  }
  if (!await claimCandidate(database, row.id)) return false;
  let messageId: number;
  try {
    messageId = await sendHtml(
      formatDiscoveryCandidate(row),
      discoveryCandidateReplyMarkup(row),
    );
  } catch (error) {
    const status = error instanceof AmbiguousTelegramError ? "unknown" : "failed";
    await finishCandidate(database, row.id, status, null, safeError(error));
    return false;
  }

  // Telegram confirmed the message. If recording fails, leave the row in the
  // sending state so stale-claim cleanup marks it unknown instead of retrying.
  try {
    await finishCandidate(database, row.id, "sent", messageId, null);
  } catch (error) {
    console.error(`Discovery message was sent but not safely recorded: ${safeError(error)}`);
  }
  return true;
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method !== "POST") return jsonResponse({ error: "POST required" }, 405);
  const suppliedSecret = request.headers.get("x-cron-secret") ?? "";
  if (!constantTimeEqual(suppliedSecret, requiredEnv("OPPORTUNITY_CRON_SECRET"))) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const database = adminClient();
  const now = new Date();
  let checked = 0;
  let relevant = 0;
  let sent = 0;
  let duplicates = 0;
  const sourceErrors: string[] = [];

  await database.from("opportunity_discovery_candidates").update({
    status: "unknown",
    error_message: "Delivery result was not safely recorded; not retried.",
    updated_at: now.toISOString(),
  }).eq("status", "sending").lt("claimed_at", new Date(now.getTime() - 30 * 60 * 1_000).toISOString());

  const queued = await database.from("opportunity_discovery_candidates")
    .select("*").in("status", ["new", "failed"])
    .order("created_at", { ascending: true }).limit(MAX_DAILY_MESSAGES);
  if (queued.error) return jsonResponse({ error: safeError(queued.error) }, 500);
  for (const row of (queued.data ?? []) as OpportunityDiscoveryCandidateRow[]) {
    if (await deliverCandidate(database, row)) sent += 1;
  }

  for (const source of SOURCES) {
    try {
      const chapterHtml = await fetchOfficialPage(source.url);
      const urls = gdgUpcomingEventUrls(chapterHtml);
      for (const url of urls) {
        checked += 1;
        if (sent >= MAX_DAILY_MESSAGES) break;

        const existing = await database.from("opportunity_discovery_candidates")
          .select("id").eq("source_url", url).maybeSingle();
        if (existing.error) throw new Error(existing.error.message);
        if (existing.data) {
          duplicates += 1;
          continue;
        }
        const saved = await database.from("opportunities").select("id")
          .eq("source_url", url).maybeSingle();
        if (saved.error) throw new Error(saved.error.message);
        if (saved.data) {
          duplicates += 1;
          continue;
        }

        const eventHtml = await fetchOfficialPage(url);
        const candidate = gdgCandidateFromEventPage(eventHtml, source.name, now);
        if (!candidate) continue;
        relevant += 1;
        const values = {
          source_key: candidate.sourceKey,
          source_url: candidate.sourceUrl,
          source_name: candidate.sourceName,
          name: candidate.name,
          organization: candidate.organization,
          category: candidate.category,
          source_text: candidate.sourceText,
          deadline_at: candidate.deadlineAt,
          deadline_raw: candidate.deadlineRaw,
          deadline_precision: candidate.deadlinePrecision,
          event_at: candidate.eventAt,
          event_raw: candidate.eventRaw,
          event_precision: candidate.eventPrecision,
          next_action: candidate.nextAction,
          notes: candidate.notes,
          checked_at: now.toISOString(),
        };
        const inserted = await database.from("opportunity_discovery_candidates")
          .insert(values).select("*").single();
        if (inserted.error?.code === "23505") {
          duplicates += 1;
          continue;
        }
        if (inserted.error) throw new Error(inserted.error.message);
        const row = inserted.data as OpportunityDiscoveryCandidateRow;
        if (await deliverCandidate(database, row)) sent += 1;
      }
    } catch (error) {
      sourceErrors.push(`${source.name}: ${safeError(error)}`);
    }
  }

  return jsonResponse({ ok: true, checked, relevant, sent, duplicates, sourceErrors });
});
