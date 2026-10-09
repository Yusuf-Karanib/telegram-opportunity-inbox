import type { SupabaseClient } from "npm:@supabase/supabase-js@2.116.0";
import {
  candidateFromBraveResult,
  gdgCandidateFromEventPage,
  gdgUpcomingEventUrls,
  opportunitySearchQueries,
  shouldNotifyDiscoveryCandidate,
  type BraveWebResult,
  type DiscoveryCandidateInput,
  type OpportunitySearchQuery,
} from "../_shared/discovery.ts";
import { adminClient } from "../_shared/supabase.ts";
import type { OpportunityDiscoveryCandidateRow } from "../_shared/types.ts";
import {
  AmbiguousTelegramError,
  discoveryCandidateReplyMarkup,
  formatDiscoveryCandidate,
  sendHtml,
  sendText,
} from "../_shared/telegram.ts";
import {
  cleanText,
  constantTimeEqual,
  jsonResponse,
  normalizeKey,
  requiredEnv,
  safeError,
} from "../_shared/utils.ts";

const SOURCES = [
  { name: "GDG Abu Dhabi", url: "https://gdg.community.dev/gdg-abu-dhabi/" },
  { name: "GDG Sharjah", url: "https://gdg.community.dev/gdg-sharjah/" },
  { name: "GDG Dubai", url: "https://gdg.community.dev/gdg-dubai/" },
] as const;
const MAX_RUN_MESSAGES = 5;
const MAX_NEW_CANDIDATES_PER_RUN = 5;

interface BraveSearchResponse {
  web?: { results?: BraveWebResult[] };
  error?: {
    code?: unknown;
    detail?: unknown;
    status?: unknown;
  };
}

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

async function searchBrave(
  search: OpportunitySearchQuery,
  apiKey: string,
): Promise<BraveWebResult[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const parameters = new URLSearchParams({
      q: search.query,
      count: "20",
      // Brave's search-country enum does not include the UAE. Search globally,
      // then use the UAE terms and location headers below to keep local focus.
      country: "ALL",
      search_lang: "en",
      safesearch: "strict",
      freshness: "pm",
      result_filter: "web",
      extra_snippets: "true",
      text_decorations: "false",
    });
    const response = await fetch(`https://api.search.brave.com/res/v1/web/search?${parameters}`, {
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "x-subscription-token": apiKey,
        "x-loc-city": "Dubai",
        "x-loc-country": "AE",
        "x-loc-timezone": "Asia/Dubai",
        "user-agent": "Yusuf-Opportunity-Inbox/2.0",
      },
    });
    const bodyText = await response.text();
    let body: BraveSearchResponse = {};
    try {
      body = JSON.parse(bodyText) as BraveSearchResponse;
    } catch {
      // Brave can return a non-JSON gateway message. Do not echo arbitrary HTML.
    }
    if (!response.ok) {
      const code = cleanText(body.error?.code, 80);
      const detail = cleanText(body.error?.detail, 180);
      const explanation = [code, detail].filter(Boolean).join(": ");
      throw new Error(
        `Brave Search returned HTTP ${response.status}${explanation ? ` (${explanation})` : ""}`,
      );
    }
    return Array.isArray(body.web?.results) ? body.web.results : [];
  } finally {
    clearTimeout(timeout);
  }
}

async function candidateAlreadyExists(
  database: SupabaseClient,
  candidate: DiscoveryCandidateInput,
): Promise<boolean> {
  const existing = await database.from("opportunity_discovery_candidates")
    .select("id").eq("source_url", candidate.sourceUrl).maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) return true;
  let existingNameQuery = database.from("opportunity_discovery_candidates")
    .select("id").eq("name", candidate.name);
  if (candidate.organization !== "Not stated") {
    existingNameQuery = existingNameQuery.eq("organization", candidate.organization);
  }
  const existingName = await existingNameQuery.limit(1);
  if (existingName.error) throw new Error(existingName.error.message);
  if ((existingName.data?.length ?? 0) > 0) return true;
  const saved = await database.from("opportunities").select("id")
    .eq("source_url", candidate.sourceUrl).maybeSingle();
  if (saved.error) throw new Error(saved.error.message);
  if (saved.data) return true;
  let savedNameQuery = database.from("opportunities").select("id")
    .eq("normalized_name", normalizeKey(candidate.name));
  if (candidate.organization !== "Not stated") {
    savedNameQuery = savedNameQuery.eq("normalized_organization", normalizeKey(candidate.organization));
  }
  const savedName = await savedNameQuery.limit(1);
  if (savedName.error) throw new Error(savedName.error.message);
  return (savedName.data?.length ?? 0) > 0;
}

async function insertCandidate(
  database: SupabaseClient,
  candidate: DiscoveryCandidateInput,
  now: Date,
): Promise<OpportunityDiscoveryCandidateRow | null> {
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
    decision_details: candidate.decisionDetails,
    checked_at: now.toISOString(),
  };
  const inserted = await database.from("opportunity_discovery_candidates")
    .insert(values).select("*").single();
  if (inserted.error?.code === "23505") return null;
  if (inserted.error) throw new Error(inserted.error.message);
  return inserted.data as OpportunityDiscoveryCandidateRow;
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

  let notifyEmpty = false;
  try {
    const body = await request.json() as Record<string, unknown>;
    notifyEmpty = body?.notify_empty === true;
  } catch {
    // An empty or malformed body does not enable scheduled notifications.
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
    .order("created_at", { ascending: true }).limit(MAX_RUN_MESSAGES);
  if (queued.error) return jsonResponse({ error: safeError(queued.error) }, 500);
  for (const row of (queued.data ?? []) as OpportunityDiscoveryCandidateRow[]) {
    if (await deliverCandidate(database, row)) sent += 1;
  }

  let insertedThisRun = 0;
  for (const source of SOURCES) {
    try {
      const chapterHtml = await fetchOfficialPage(source.url);
      const urls = gdgUpcomingEventUrls(chapterHtml);
      for (const url of urls) {
        checked += 1;
        const eventHtml = await fetchOfficialPage(url);
        const candidate = gdgCandidateFromEventPage(eventHtml, source.name, now);
        if (!candidate) continue;
        relevant += 1;
        if (await candidateAlreadyExists(database, candidate)) {
          duplicates += 1;
          continue;
        }
        const row = await insertCandidate(database, candidate, now);
        if (!row) {
          duplicates += 1;
          continue;
        }
        insertedThisRun += 1;
        if (sent < MAX_RUN_MESSAGES && await deliverCandidate(database, row)) sent += 1;
      }
    } catch (error) {
      sourceErrors.push(`${source.name}: ${safeError(error)}`);
    }
  }

  const braveApiKey = Deno.env.get("OPPORTUNITY_BRAVE_SEARCH_API_KEY")?.trim() ?? "";
  const searches = opportunitySearchQueries(now);
  let queriesRun = 0;
  if (!braveApiKey) {
    sourceErrors.push("Broad web and social search is not configured");
  } else {
    const searchResults = await Promise.allSettled(searches.map(async (search) => ({
      search,
      results: await searchBrave(search, braveApiKey),
    })));
    const candidates = new Map<string, DiscoveryCandidateInput>();
    for (const result of searchResults) {
      if (result.status === "rejected") {
        sourceErrors.push(`Web search: ${safeError(result.reason)}`);
        continue;
      }
      queriesRun += 1;
      for (const webResult of result.value.results) {
        checked += 1;
        const candidate = candidateFromBraveResult(webResult, now);
        if (!candidate || !shouldNotifyDiscoveryCandidate(candidate, now)) continue;
        relevant += 1;
        const previous = candidates.get(candidate.sourceUrl);
        if (!previous || candidate.decisionDetails.fit_score > previous.decisionDetails.fit_score) {
          candidates.set(candidate.sourceUrl, candidate);
        }
      }
    }

    const ranked = [...candidates.values()].sort((left, right) =>
      right.decisionDetails.fit_score - left.decisionDetails.fit_score
    );
    for (const candidate of ranked) {
      if (insertedThisRun >= MAX_NEW_CANDIDATES_PER_RUN) break;
      try {
        if (await candidateAlreadyExists(database, candidate)) {
          duplicates += 1;
          continue;
        }
        const row = await insertCandidate(database, candidate, now);
        if (!row) {
          duplicates += 1;
          continue;
        }
        insertedThisRun += 1;
        if (sent < MAX_RUN_MESSAGES && await deliverCandidate(database, row)) sent += 1;
      } catch (error) {
        sourceErrors.push(`${candidate.sourceName}: ${safeError(error)}`);
      }
    }
  }

  let emptyNoticeSent = false;
  if (notifyEmpty && sent === 0) {
    const dubaiHour = Number(new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Dubai",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(now));
    const runLabel = dubaiHour < 12 ? "7 AM" : "7 PM";
    const message = sourceErrors.length === 0
      ? `${runLabel} search complete. No new verified opportunities found.`
      : `${runLabel} search finished with ${sourceErrors.length} source errors. I will retry at the next run.`;
    try {
      await sendText(message);
      emptyNoticeSent = true;
    } catch (error) {
      sourceErrors.push(`Scheduled status message: ${safeError(error)}`);
    }
  }

  return jsonResponse({
    ok: true,
    checked,
    relevant,
    sent,
    duplicates,
    inserted: insertedThisRun,
    queriesRun,
    broadSearchConfigured: Boolean(braveApiKey),
    emptyNoticeSent,
    sourceErrors,
  });
});
