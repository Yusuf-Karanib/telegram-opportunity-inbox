import type { SupabaseClient } from "npm:@supabase/supabase-js@2.116.0";
import {
  aiNexusCandidatesFromPage,
  candidateFromBraveResult,
  candidateFromOfficialPageHtml,
  challengeOnCandidatesFromApi,
  directListingLinks,
  discoveryCandidateIdentityKey,
  gdgCandidateFromEventPage,
  gdgUpcomingEventUrls,
  hasFocusedOpportunityRelevance,
  isClearlyClosedOpportunity,
  isDoNotTrackOpportunity,
  opportunitySearchPage,
  opportunitySearchQueries,
  shouldRefreshPreviouslySeenCandidate,
  shouldNotifyDiscoveryCandidate,
  type BraveWebResult,
  type ChallengeOnApiResponse,
  type DirectListingSource,
  type DiscoveryCandidateInput,
  type OpportunitySearchQuery,
} from "../_shared/discovery.ts";
import { adminClient } from "../_shared/supabase.ts";
import type { OpportunityDiscoveryCandidateRow, OpportunityListingStatus } from "../_shared/types.ts";
import {
  AmbiguousTelegramError,
  deleteMessage,
  discoveryCandidateReplyMarkup,
  formatDiscoveryCandidate,
  sendHtml,
  sendText,
} from "../_shared/telegram.ts";
import {
  canonicalizeUrl,
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
const DIRECT_LISTING_SOURCES: DirectListingSource[] = [
  {
    key: "dubai-future-programs",
    name: "Dubai Future Foundation",
    url: "https://www.dubaifuture.ae/programs/",
    organization: "Dubai Future Foundation",
    allowedHosts: ["dubaifuture.ae"],
    pathPattern: /^\/(?:dcai-accelerators|tks-innovation-program|feel-\d{4}|verified-contributors|deep-\d{4}|[^/]*(?:program|accelerator|fellowship)[^/]*)\/?$/i,
    anchorTextPattern: /apply now|read more/i,
    maximumLinks: 10,
  },
  {
    key: "hub71-programs",
    name: "Hub71",
    url: "https://www.hub71.com/i-am-a-startup",
    organization: "Hub71",
    allowedHosts: ["hub71.com"],
    pathPattern: /^\/program\/[^/]+\/?$/i,
    maximumLinks: 10,
  },
  {
    key: "hub71-events",
    name: "Hub71 Events",
    url: "https://www.hub71.com/events",
    organization: "Hub71",
    allowedHosts: ["hub71.com"],
    pathPattern: /^\/events\/[^/]+\/?$/i,
    maximumLinks: 12,
  },
  {
    key: "startad-programs",
    name: "startAD",
    url: "https://www.startad.ae/programs/",
    organization: "startAD",
    allowedHosts: ["startad.ae"],
    pathPattern: /^\/programs\/[^/]+\/?$/i,
    maximumLinks: 10,
  },
  {
    key: "ai-for-good-events",
    name: "AI for Good",
    url: "https://aiforgood.itu.int/events/",
    organization: "AI for Good / ITU",
    allowedHosts: ["aiforgood.itu.int"],
    pathPattern: /^\/event\/[^/]+\/?$/i,
    maximumLinks: 12,
  },
  {
    key: "dubai-ai-campus-events",
    name: "Dubai AI Campus Events",
    url: "https://dubaiaicampus.com/events",
    organization: "Dubai AI Campus / DIFC",
    allowedHosts: ["dubaiaicampus.com", "dubaiaifestival.com"],
    pathPattern: /^(?:\/register\/?|\/(?:community|flagship)-events\/?|\/events\/[^/]+\/?)$/i,
    anchorTextPattern: /read more|register|learn more|view event/i,
    maximumLinks: 12,
  },
  {
    key: "dubai-chambers-events",
    name: "Dubai Chambers Events",
    url: "https://www.dubaichambers.com/en/events",
    organization: "Dubai Chambers",
    allowedHosts: ["dubaichambers.com"],
    pathPattern: /^\/en\/e\/dc_event_detail_page\/\d+\/\d+\/?$/i,
    maximumLinks: 14,
  },
  {
    key: "adnec-events",
    name: "ADNEC Events",
    url: "https://www.adnec.ae/en/eventlisting",
    organization: "ADNEC",
    allowedHosts: ["adnec.ae"],
    pathPattern: /^\/en\/eventlisting\/[^/]+\/?$/i,
    maximumLinks: 12,
  },
];
const DIRECT_STANDALONE_SOURCES = [
  {
    key: "42-piscine-status",
    name: "42 Abu Dhabi",
    url: "https://42abudhabi.ae/piscine-status/",
    organization: "42 Abu Dhabi",
  },
  {
    key: "nasa-space-apps-uae",
    name: "NASA Space Apps UAE",
    url: "https://nasaspaceapps.ae/",
    organization: "NASA Space Apps UAE",
  },
  {
    key: "dubai-future-forum",
    name: "Dubai Future Forum",
    url: "https://www.dubaifuture.ae/dubai-future-forum-faq/",
    organization: "Dubai Future Foundation",
  },
  {
    key: "dubai-ai-festival-registration",
    name: "Dubai AI Festival",
    url: "https://dubaiaifestival.com/register/",
    organization: "Dubai AI Campus / DIFC",
  },
] as const;
const AI_NEXUS_URL = "https://ai-nexus.mbzuai.ac.ae/";
const CHALLENGE_ON_API_URL = "https://challengeon.atrc.ae/api/v2/listable_challenges?open=true&page=1&per=20";
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

interface ExistingCandidate {
  id: string;
  status: string;
  error_message: string | null;
  event_at: string | null;
  deadline_at: string | null;
  decision_details: { listing_status?: OpportunityListingStatus } | null;
  telegram_message_id: number | null;
  opportunity_id: string | null;
}

interface SentCandidateForDedupe {
  id: string;
  name: string;
  source_url: string;
  event_at: string | null;
  deadline_at: string | null;
  decision_details: {
    evidence_level?: string;
    listing_status?: OpportunityListingStatus;
    cost?: string;
  } | null;
  telegram_message_id: number;
}

interface SentDirectCalendarCandidate {
  id: string;
  name: string;
  source_name: string;
  source_text: string;
  telegram_message_id: number;
}

interface SentDiscoveryCandidate {
  id: string;
  name: string;
  source_url: string;
  source_text: string;
  telegram_message_id: number | null;
  status?: string;
  error_message?: string | null;
}

const QUALITY_RESET_MESSAGE = "Cleared during the discovery quality reset.";
const DO_NOT_TRACK_MESSAGE = "Removed from the master tracker by Yusuf on 2026-10-21.";

function blocksRediscovery(
  row: ExistingCandidate,
  candidate: DiscoveryCandidateInput,
  checkedAt: Date,
): boolean {
  if (row.status === "dismissed" && row.error_message === QUALITY_RESET_MESSAGE) return false;
  return !shouldRefreshPreviouslySeenCandidate({
    status: row.status,
    errorMessage: row.error_message,
    eventAt: row.event_at,
    deadlineAt: row.deadline_at,
    listingStatus: row.decision_details?.listing_status,
    opportunityId: row.opportunity_id,
  }, candidate, checkedAt);
}

async function removeRefreshCard(row: ExistingCandidate): Promise<void> {
  if (!row.telegram_message_id) return;
  try {
    await deleteMessage(row.telegram_message_id);
  } catch (error) {
    console.error(`Could not remove rescheduled discovery card ${row.id}: ${safeError(error)}`);
  }
}

async function removeClearlyClosedCards(database: SupabaseClient): Promise<number> {
  const result = await database.from("opportunity_discovery_candidates")
    .select("id,source_text,telegram_message_id")
    .eq("status", "sent")
    .not("telegram_message_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(100);
  if (result.error) throw new Error(result.error.message);
  let removed = 0;
  for (const row of (result.data ?? []) as SentDiscoveryCandidate[]) {
    if (!isClearlyClosedOpportunity(row.source_text) || !row.telegram_message_id) continue;
    try {
      await deleteMessage(row.telegram_message_id);
    } catch (error) {
      console.error(`Could not remove closed discovery card ${row.id}: ${safeError(error)}`);
      continue;
    }
    const update = await database.from("opportunity_discovery_candidates").update({
      status: "expired",
      error_message: "Removed because the official page says applications or registration are closed.",
      updated_at: new Date().toISOString(),
    }).eq("id", row.id).eq("status", "sent");
    if (update.error) throw new Error(update.error.message);
    removed += 1;
  }
  return removed;
}

async function dismissDoNotTrackCandidates(database: SupabaseClient): Promise<number> {
  const result = await database.from("opportunity_discovery_candidates")
    .select("id,name,source_url,source_text,telegram_message_id,status,error_message")
    .in("status", ["new", "failed", "unknown", "sent", "saved", "dismissed"])
    .order("created_at", { ascending: false })
    .limit(250);
  if (result.error) throw new Error(result.error.message);
  let dismissed = 0;
  for (const row of (result.data ?? []) as SentDiscoveryCandidate[]) {
    if (!isDoNotTrackOpportunity(row.name, row.source_url)) continue;
    if (row.status === "dismissed" && row.error_message === DO_NOT_TRACK_MESSAGE && !row.telegram_message_id) {
      continue;
    }
    if (row.telegram_message_id) {
      try {
        await deleteMessage(row.telegram_message_id);
      } catch (error) {
        // Telegram may refuse to delete older messages. The disabled buttons
        // still prevent the card from being saved again.
        console.error(`Could not remove do-not-track discovery card ${row.id}: ${safeError(error)}`);
      }
    }
    const update = await database.from("opportunity_discovery_candidates").update({
      status: "dismissed",
      error_message: DO_NOT_TRACK_MESSAGE,
      telegram_message_id: null,
      updated_at: new Date().toISOString(),
    }).eq("id", row.id);
    if (update.error) throw new Error(update.error.message);
    dismissed += 1;
  }
  return dismissed;
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

interface DirectScanResult {
  candidates: DiscoveryCandidateInput[];
  pageUrls: string[];
  sourcesChecked: number;
  pagesChecked: number;
  filteredOut: number;
  errors: string[];
}

function candidatePriority(candidate: DiscoveryCandidateInput): number {
  const hasVerifiedDate = Boolean(candidate.deadlineAt || candidate.eventAt);
  const isOfficial = candidate.decisionDetails.evidence_level === "official";
  const isOpen = candidate.decisionDetails.listing_status === "open";
  const hasKnownCost = !/^not stated$/i.test(candidate.decisionDetails.cost);
  return candidate.decisionDetails.fit_score + (hasVerifiedDate ? 25 : 0) +
    (isOfficial ? 10 : 0) + (isOpen ? 15 : 0) + (hasKnownCost ? 5 : 0);
}

function sentCandidateQuality(row: SentCandidateForDedupe): number {
  const details = row.decision_details;
  return (details?.evidence_level === "official" ? 20 : 0) +
    (details?.listing_status === "open" ? 15 : 0) +
    (details?.cost && !/^not stated$/i.test(details.cost) ? 8 : 0) +
    (/\/(?:register|apply|tickets?|passes?)\b/i.test(row.source_url) ? 4 : 0);
}

async function removeRedundantDiscoveryCards(database: SupabaseClient): Promise<number> {
  const result = await database.from("opportunity_discovery_candidates")
    .select("id,name,source_url,event_at,deadline_at,decision_details,telegram_message_id")
    .eq("status", "sent")
    .is("opportunity_id", null)
    .not("telegram_message_id", "is", null)
    .limit(500);
  if (result.error) throw new Error(result.error.message);

  const groups = new Map<string, SentCandidateForDedupe[]>();
  for (const row of (result.data ?? []) as SentCandidateForDedupe[]) {
    const key = discoveryCandidateIdentityKey(row.name, row.event_at, row.deadline_at);
    if (!key || key === "|") continue;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  let removed = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort((left, right) =>
      sentCandidateQuality(right) - sentCandidateQuality(left) ||
      left.telegram_message_id - right.telegram_message_id
    );
    for (const duplicate of group.slice(1)) {
      try {
        await deleteMessage(duplicate.telegram_message_id);
      } catch (error) {
        console.error(`Could not remove duplicate discovery card ${duplicate.id}: ${safeError(error)}`);
        continue;
      }
      const updated = await database.from("opportunity_discovery_candidates").update({
        status: "dismissed",
        telegram_message_id: null,
        error_message: "Removed as a duplicate of a more complete source.",
        updated_at: new Date().toISOString(),
      }).eq("id", duplicate.id).eq("status", "sent");
      if (updated.error) throw new Error(updated.error.message);
      removed += 1;
    }
  }
  return removed;
}

async function removeIrrelevantDirectCalendarCards(database: SupabaseClient): Promise<number> {
  const result = await database.from("opportunity_discovery_candidates")
    .select("id,name,source_name,source_text,telegram_message_id")
    .eq("status", "sent")
    .is("opportunity_id", null)
    .not("telegram_message_id", "is", null)
    .in("source_name", ["Dubai AI Campus Events", "Dubai Chambers Events", "ADNEC Events"])
    .limit(500);
  if (result.error) throw new Error(result.error.message);

  let removed = 0;
  for (const row of (result.data ?? []) as SentDirectCalendarCandidate[]) {
    if (hasFocusedOpportunityRelevance(row.name, row.source_text)) continue;
    try {
      await deleteMessage(row.telegram_message_id);
    } catch (error) {
      console.error(`Could not remove irrelevant discovery card ${row.id}: ${safeError(error)}`);
      continue;
    }
    const updated = await database.from("opportunity_discovery_candidates").update({
      status: "dismissed",
      telegram_message_id: null,
      error_message: "Removed because the event is outside Yusuf's opportunity focus.",
      updated_at: new Date().toISOString(),
    }).eq("id", row.id).eq("status", "sent");
    if (updated.error) throw new Error(updated.error.message);
    removed += 1;
  }
  return removed;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let nextIndex = 0;
  async function run(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = { status: "fulfilled", value: await worker(items[index]) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
  return results;
}

async function scanDirectSources(now: Date): Promise<DirectScanResult> {
  const candidates = new Map<string, DiscoveryCandidateInput>();
  const pageUrls = new Set<string>();
  const errors: string[] = [];
  let sourcesChecked = 0;
  let pagesChecked = 0;
  let filteredOut = 0;

  const listingPromises = DIRECT_LISTING_SOURCES.map(async (source) => ({
    source,
    html: await fetchOfficialPage(source.url),
  }));
  const standalonePromises = DIRECT_STANDALONE_SOURCES.map(async (source) => ({
    source,
    html: await fetchOfficialPage(source.url),
  }));
  const aiNexusPromise = fetchOfficialPage(AI_NEXUS_URL);
  const challengeOnPromise = fetchOfficialPage(CHALLENGE_ON_API_URL);

  const [listingResults, standaloneResults, aiNexusResult, challengeOnResult] = await Promise.all([
    Promise.allSettled(listingPromises),
    Promise.allSettled(standalonePromises),
    aiNexusPromise.then((value) => ({ status: "fulfilled", value }) as const)
      .catch((reason) => ({ status: "rejected", reason }) as const),
    challengeOnPromise.then((value) => ({ status: "fulfilled", value }) as const)
      .catch((reason) => ({ status: "rejected", reason }) as const),
  ]);

  const detailTasks = new Map<string, { source: DirectListingSource; url: string }>();
  for (let index = 0; index < listingResults.length; index += 1) {
    const result = listingResults[index];
    const source = DIRECT_LISTING_SOURCES[index];
    if (result.status === "rejected") {
      errors.push(`${source.name}: ${safeError(result.reason)}`);
      continue;
    }
    sourcesChecked += 1;
    pagesChecked += 1;
    pageUrls.add(canonicalizeUrl(source.url) ?? source.url);
    for (const url of directListingLinks(result.value.html, source)) {
      detailTasks.set(url, { source, url });
    }
  }

  for (let index = 0; index < standaloneResults.length; index += 1) {
    const result = standaloneResults[index];
    const source = DIRECT_STANDALONE_SOURCES[index];
    if (result.status === "rejected") {
      errors.push(`${source.name}: ${safeError(result.reason)}`);
      continue;
    }
    sourcesChecked += 1;
    pagesChecked += 1;
    pageUrls.add(canonicalizeUrl(source.url) ?? source.url);
    const candidate = candidateFromOfficialPageHtml(
      result.value.html,
      source.url,
      source.key,
      source.name,
      source.organization,
      now,
    );
    if (candidate && shouldNotifyDiscoveryCandidate(candidate, now)) {
      candidates.set(candidate.sourceUrl, candidate);
    } else {
      filteredOut += 1;
    }
  }

  if (aiNexusResult.status === "fulfilled") {
    sourcesChecked += 1;
    pagesChecked += 1;
    pageUrls.add(AI_NEXUS_URL);
    const parsed = aiNexusCandidatesFromPage(aiNexusResult.value, now);
    if (parsed.length === 0) filteredOut += 1;
    for (const candidate of parsed) candidates.set(candidate.sourceUrl, candidate);
  } else {
    errors.push(`MBZUAI AI Nexus: ${safeError(aiNexusResult.reason)}`);
  }

  if (challengeOnResult.status === "fulfilled") {
    sourcesChecked += 1;
    pagesChecked += 1;
    pageUrls.add(CHALLENGE_ON_API_URL);
    try {
      const parsed = challengeOnCandidatesFromApi(
        JSON.parse(challengeOnResult.value) as ChallengeOnApiResponse,
        now,
      );
      if (parsed.length === 0) filteredOut += 1;
      for (const candidate of parsed) candidates.set(candidate.sourceUrl, candidate);
    } catch (error) {
      errors.push(`ChallengeON: ${safeError(error)}`);
    }
  } else {
    errors.push(`ChallengeON: ${safeError(challengeOnResult.reason)}`);
  }

  const tasks = [...detailTasks.values()];
  const detailResults = await mapWithConcurrency(tasks, 6, async (task) => ({
    task,
    html: await fetchOfficialPage(task.url),
  }));
  for (let index = 0; index < detailResults.length; index += 1) {
    const result = detailResults[index];
    const task = tasks[index];
    if (result.status === "rejected") {
      errors.push(`${task.source.name} detail: ${safeError(result.reason)}`);
      continue;
    }
    pagesChecked += 1;
    pageUrls.add(task.url);
    const candidate = candidateFromOfficialPageHtml(
      result.value.html,
      task.url,
      task.source.key,
      task.source.name,
      task.source.organization,
      now,
    );
    const datedListingRequired = ["hub71-events", "ai-for-good-events", "startad-programs"]
      .includes(task.source.key);
    if (
      !candidate ||
      !shouldNotifyDiscoveryCandidate(candidate, now) ||
      (datedListingRequired && !candidate.eventAt && !candidate.deadlineAt)
    ) {
      filteredOut += 1;
      continue;
    }
    const previous = candidates.get(candidate.sourceUrl);
    if (!previous || candidate.decisionDetails.fit_score > previous.decisionDetails.fit_score) {
      candidates.set(candidate.sourceUrl, candidate);
    }
  }

  return {
    candidates: [...candidates.values()],
    pageUrls: [...pageUrls],
    sourcesChecked,
    pagesChecked,
    filteredOut,
    errors: errors.slice(0, 12),
  };
}

async function searchBrave(
  search: OpportunitySearchQuery,
  apiKey: string,
  page: 0 | 1 | 2 | 3,
): Promise<BraveWebResult[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const parameters = new URLSearchParams({
      q: search.query,
      count: "20",
      // Recent social posts should not be pushed onto an older result page.
      offset: String(search.freshness && search.freshness !== "py" ? 0 : page),
      // Brave's search-country enum does not include the UAE. Search globally,
      // then use the UAE terms and location headers below to keep local focus.
      country: "ALL",
      search_lang: search.searchLanguage ?? "en",
      safesearch: "strict",
      freshness: search.freshness ?? "py",
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
  checkedAt: Date,
): Promise<boolean> {
  const historyFields = "id,status,error_message,event_at,deadline_at,decision_details,telegram_message_id,opportunity_id" as const;
  const existing = await database.from("opportunity_discovery_candidates")
    .select(historyFields).eq("source_url", candidate.sourceUrl).maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  const exact = existing.data as ExistingCandidate | null;
  if (exact && blocksRediscovery(exact, candidate, checkedAt)) return true;
  if (exact) await removeRefreshCard(exact);
  let existingNameQuery = database.from("opportunity_discovery_candidates")
    .select(historyFields).eq("name", candidate.name);
  if (candidate.organization !== "Not stated") {
    existingNameQuery = existingNameQuery.eq("organization", candidate.organization);
  }
  if (exact) existingNameQuery = existingNameQuery.neq("id", exact.id);
  const existingName = await existingNameQuery.limit(10);
  if (existingName.error) throw new Error(existingName.error.message);
  const nameMatches = (existingName.data ?? []) as ExistingCandidate[];
  if (nameMatches.some((row) => blocksRediscovery(row, candidate, checkedAt))) return true;
  for (const row of nameMatches) await removeRefreshCard(row);
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
    status: "new",
    attempt_count: 0,
    claimed_at: null,
    sent_at: null,
    telegram_message_id: null,
    error_message: null,
    opportunity_id: null,
    updated_at: now.toISOString(),
  };
  const inserted = await database.from("opportunity_discovery_candidates")
    .upsert(values, { onConflict: "source_url" }).select("*").single();
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
  let maintenanceOnly = false;
  let requestedSearchPage: 0 | 1 | 2 | 3 | null = null;
  try {
    const body = await request.json() as Record<string, unknown>;
    notifyEmpty = body?.notify_empty === true;
    maintenanceOnly = body?.maintenance_only === true;
    const page = Number(body?.search_page);
    if (Number.isInteger(page) && page >= 0 && page <= 3) {
      requestedSearchPage = page as 0 | 1 | 2 | 3;
    }
  } catch {
    // An empty or malformed body does not enable scheduled notifications.
  }

  const database = adminClient();
  const now = new Date();
  let relevant = 0;
  let sent = 0;
  let duplicates = 0;
  let deferred = 0;
  let rawSearchResults = 0;
  let filteredOut = 0;
  let officialSourcesChecked = 0;
  let officialPagesChecked = 0;
  const uniquePageUrls = new Set<string>();
  const candidatePool = new Map<string, DiscoveryCandidateInput>();
  const sourceErrors: string[] = [];
  let removedClosedCards = 0;
  let removedDuplicateCards = 0;
  let removedIrrelevantCards = 0;
  let dismissedDoNotTrack = 0;

  try {
    dismissedDoNotTrack = await dismissDoNotTrackCandidates(database);
  } catch (error) {
    sourceErrors.push(`Do-not-track cleanup: ${safeError(error)}`);
  }

  try {
    removedDuplicateCards = await removeRedundantDiscoveryCards(database);
  } catch (error) {
    sourceErrors.push(`Duplicate-card cleanup: ${safeError(error)}`);
  }

  try {
    removedIrrelevantCards = await removeIrrelevantDirectCalendarCards(database);
  } catch (error) {
    sourceErrors.push(`Relevance cleanup: ${safeError(error)}`);
  }

  try {
    removedClosedCards = await removeClearlyClosedCards(database);
    if (removedClosedCards > 0) {
      await sendText(
        `Removed ${removedClosedCards} discovery card${removedClosedCards === 1 ? "" : "s"} because the official source says applications are closed.`,
      );
    }
  } catch (error) {
    sourceErrors.push(`Closed-card cleanup: ${safeError(error)}`);
  }

  if (maintenanceOnly) {
    return jsonResponse({
      ok: sourceErrors.length === 0,
      maintenanceOnly: true,
      removedDuplicateCards,
      removedIrrelevantCards,
      removedClosedCards,
      dismissedDoNotTrack,
      sourceErrors,
    });
  }

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
  const addCandidate = (candidate: DiscoveryCandidateInput): void => {
    if (isDoNotTrackOpportunity(candidate.name, candidate.sourceUrl)) {
      filteredOut += 1;
      return;
    }
    const candidateKey = discoveryCandidateIdentityKey(candidate.name, candidate.eventAt, candidate.deadlineAt) ||
      canonicalizeUrl(candidate.sourceUrl) || candidate.sourceUrl;
    const previous = candidatePool.get(candidateKey);
    if (!previous || candidatePriority(candidate) > candidatePriority(previous)) {
      candidatePool.set(candidateKey, candidate);
    }
  };
  const saveCandidate = async (candidate: DiscoveryCandidateInput): Promise<void> => {
    if (isDoNotTrackOpportunity(candidate.name, candidate.sourceUrl)) {
      filteredOut += 1;
      return;
    }
    if (await candidateAlreadyExists(database, candidate, now)) {
      duplicates += 1;
      return;
    }
    if (insertedThisRun >= MAX_NEW_CANDIDATES_PER_RUN) {
      deferred += 1;
      return;
    }
    const row = await insertCandidate(database, candidate, now);
    if (!row) {
      duplicates += 1;
      return;
    }
    insertedThisRun += 1;
    if (sent < MAX_RUN_MESSAGES && await deliverCandidate(database, row)) sent += 1;
  };

  try {
    const directScan = await scanDirectSources(now);
    officialSourcesChecked += directScan.sourcesChecked;
    officialPagesChecked += directScan.pagesChecked;
    filteredOut += directScan.filteredOut;
    sourceErrors.push(...directScan.errors);
    for (const url of directScan.pageUrls) uniquePageUrls.add(url);
    for (const candidate of directScan.candidates) addCandidate(candidate);
  } catch (error) {
    sourceErrors.push(`Direct official sources: ${safeError(error)}`);
  }

  for (const source of SOURCES) {
    try {
      const chapterHtml = await fetchOfficialPage(source.url);
      officialSourcesChecked += 1;
      officialPagesChecked += 1;
      uniquePageUrls.add(canonicalizeUrl(source.url) ?? source.url);
      const urls = gdgUpcomingEventUrls(chapterHtml);
      for (const url of urls) {
        officialPagesChecked += 1;
        uniquePageUrls.add(canonicalizeUrl(url) ?? url);
        const eventHtml = await fetchOfficialPage(url);
        const candidate = gdgCandidateFromEventPage(eventHtml, source.name, now);
        if (!candidate) {
          filteredOut += 1;
          continue;
        }
        addCandidate(candidate);
      }
    } catch (error) {
      sourceErrors.push(`${source.name}: ${safeError(error)}`);
    }
  }

  const braveApiKey = Deno.env.get("OPPORTUNITY_BRAVE_SEARCH_API_KEY")?.trim() ?? "";
  const searches = opportunitySearchQueries(now);
  const searchPage = requestedSearchPage ?? opportunitySearchPage(now);
  let queriesRun = 0;
  if (!braveApiKey) {
    sourceErrors.push("Broad web and social search is not configured");
  } else {
    const searchResults = await Promise.allSettled(searches.map(async (search) => ({
      search,
      results: await searchBrave(search, braveApiKey, searchPage),
    })));
    const processedWebUrls = new Set<string>();
    for (const result of searchResults) {
      if (result.status === "rejected") {
        sourceErrors.push(`Web search: ${safeError(result.reason)}`);
        continue;
      }
      queriesRun += 1;
      for (const webResult of result.value.results) {
        rawSearchResults += 1;
        const rawUrl = cleanText(webResult.url, 2_000);
        const pageUrl = canonicalizeUrl(rawUrl);
        if (!pageUrl || processedWebUrls.has(pageUrl)) continue;
        processedWebUrls.add(pageUrl);
        uniquePageUrls.add(pageUrl);
        const candidate = candidateFromBraveResult(webResult, now);
        if (!candidate || !shouldNotifyDiscoveryCandidate(candidate, now)) {
          filteredOut += 1;
          continue;
        }
        addCandidate(candidate);
      }
    }
  }

  relevant = candidatePool.size;
  const rankedCandidates = [...candidatePool.values()].sort((left, right) =>
    candidatePriority(right) - candidatePriority(left)
  );
  for (const candidate of rankedCandidates) {
    try {
      await saveCandidate(candidate);
    } catch (error) {
      sourceErrors.push(`${candidate.sourceName}: ${safeError(error)}`);
    }
  }

  const checked = uniquePageUrls.size;
  let emptyNoticeSent = false;
  if (notifyEmpty && sent === 0 && removedClosedCards === 0) {
    const dubaiHour = Number(new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Dubai",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(now));
    const runLabel = dubaiHour < 12 ? "7 AM" : "7 PM";
    const base = `${runLabel} scan complete: ${officialSourcesChecked} official sources and ${queriesRun} public web/social searches reviewed ${checked} unique pages.`;
    const outcome = duplicates > 0
      ? `${duplicates} suitable matches were already in your inbox; no new cards.`
      : "No new suitable opportunities passed verification.";
    const retry = sourceErrors.length > 0
      ? ` ${sourceErrors.length} source checks failed and will retry next run.`
      : "";
    const message = `${base} ${outcome}${retry}`;
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
    deferred,
    queriesRun,
    searchPage,
    uniquePagesChecked: checked,
    rawSearchResults,
    filteredOut,
    officialSourcesChecked,
    officialPagesChecked,
    removedClosedCards,
    removedDuplicateCards,
    removedIrrelevantCards,
    dismissedDoNotTrack,
    broadSearchConfigured: Boolean(braveApiKey),
    emptyNoticeSent,
    sourceErrors,
  });
});
