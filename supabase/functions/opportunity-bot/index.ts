import type { SupabaseClient } from "npm:@supabase/supabase-js@2.116.0";
import { adminClient } from "../_shared/supabase.ts";
import { parseCommand, type BotCommand } from "../_shared/commands.ts";
import { duplicateScore, parseOpportunityText } from "../_shared/parser.ts";
import {
  CATEGORIES,
  isTrackableOpportunityCategory,
  type BotSessionRow,
  type DraftField,
  type OpportunityDraft,
  type OpportunityDiscoveryCandidateRow,
  type OpportunityRow,
  type OpportunityStatus,
  type OpportunityView,
  type TelegramCallbackQuery,
  type TelegramMessage,
  type TelegramUpdate,
} from "../_shared/types.ts";
import {
  answerCallback,
  dashboardReplyMarkup,
  draftReplyMarkup,
  editReplyMarkup,
  formatDashboard,
  formatDraft,
  formatListPage,
  formatOpportunity,
  helpText,
  itemReplyMarkup,
  listReplyMarkup,
  sendHtml,
  sendText,
  statusReplyMarkup,
} from "../_shared/telegram.ts";
import {
  canonicalizeUrl,
  cleanText,
  constantTimeEqual,
  datePrecision,
  dubaiDateString,
  jsonResponse,
  normalizeKey,
  parseDubaiDate,
  requiredEnv,
  safeError,
} from "../_shared/utils.ts";
import { rowsForView, viewCounts } from "../_shared/views.ts";

const MAX_WEBHOOK_BYTES = 100_000;
const MAX_SOURCE_TEXT = 8_000;
const DRAFT_ACTION_PATTERN = /^d:(save|cancel)$/;
const DRAFT_FIELD_PATTERN = /^df:(name|organization|category|link|deadline|event|next|reminder|notes|outcome)$/;
const VIEW_PATTERN = /^v:(saved|upcoming|overdue|waiting|registered|accepted|rejected|completed|archived)$/;
const PAGE_PATTERN = /^vp:(saved|upcoming|overdue|waiting|registered|accepted|rejected|completed|archived):(\d+)$/;
const ITEM_PATTERN = /^i:(\d+)$/;
const STATUS_MENU_PATTERN = /^sm:(\d+)$/;
const EDIT_MENU_PATTERN = /^em:(\d+)$/;
const STATUS_PATTERN = /^s:(\d+):(saved|planning|applied|registered|waiting|accepted|rejected|in_progress|completed)$/;
const EDIT_PATTERN = /^e:(\d+):(name|organization|category|link|deadline|event|next|reminder|notes|outcome)$/;
const ACTION_PATTERN = /^a:(\d+):(archive|restore|snooze|activity)$/;
const DISCOVERY_CANDIDATE_PATTERN = /^dc:(\d+):(save|dismiss)$/;

interface UpdateClaim {
  claimed: boolean;
  reason: string;
}

function idleSession(chatId: string): BotSessionRow {
  return {
    chat_id: chatId,
    mode: "idle",
    draft: null,
    pending_field: null,
    editing_public_id: null,
    preview_message_id: null,
    updated_at: new Date().toISOString(),
  };
}

async function saveSession(database: SupabaseClient, session: BotSessionRow): Promise<void> {
  const { error } = await database.from("opportunity_bot_sessions").upsert({
    ...session,
    updated_at: new Date().toISOString(),
  }, { onConflict: "chat_id" });
  if (error) throw new Error(`Could not save the current bot step: ${error.message}`);
}

async function loadSession(database: SupabaseClient, chatId: string): Promise<BotSessionRow> {
  const { data, error } = await database.from("opportunity_bot_sessions")
    .select("*").eq("chat_id", chatId).maybeSingle();
  if (error) throw new Error(`Could not load the current bot step: ${error.message}`);
  return data ? data as BotSessionRow : idleSession(chatId);
}

async function loadItem(database: SupabaseClient, publicId: number): Promise<OpportunityRow | null> {
  const { data, error } = await database.from("opportunities")
    .select("*").eq("public_id", publicId).maybeSingle();
  if (error) throw new Error(`Could not load opportunity #${publicId}: ${error.message}`);
  return data ? data as OpportunityRow : null;
}

async function loadRows(database: SupabaseClient): Promise<OpportunityRow[]> {
  const rows: OpportunityRow[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await database.from("opportunities")
      .select("*").order("updated_at", { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(`Could not load opportunities: ${error.message}`);
    const page = (data ?? []) as OpportunityRow[];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

async function loadDiscoveryCandidate(
  database: SupabaseClient,
  publicId: number,
): Promise<OpportunityDiscoveryCandidateRow | null> {
  const { data, error } = await database.from("opportunity_discovery_candidates")
    .select("*").eq("public_id", publicId).maybeSingle();
  if (error) throw new Error(`Could not load discovery candidate #${publicId}: ${error.message}`);
  return data ? data as OpportunityDiscoveryCandidateRow : null;
}

async function saveDiscoveryCandidate(
  database: SupabaseClient,
  candidate: OpportunityDiscoveryCandidateRow,
): Promise<OpportunityRow> {
  if (candidate.opportunity_id) {
    const { data, error } = await database.from("opportunities")
      .select("*").eq("id", candidate.opportunity_id).maybeSingle();
    if (error) throw new Error(`Could not load the saved opportunity: ${error.message}`);
    if (data) return data as OpportunityRow;
  }
  const values = {
    draft_save_token: candidate.save_token,
    name: cleanText(candidate.name, 180),
    organization: cleanText(candidate.organization, 160),
    normalized_name: normalizeKey(candidate.name),
    normalized_organization: normalizeKey(candidate.organization),
    category: candidate.category,
    source_url: candidate.source_url,
    source_text: cleanText(candidate.source_text, MAX_SOURCE_TEXT),
    discovered_on: dubaiDateString(new Date(candidate.checked_at)),
    status: "saved",
    status_confirmed_at: null,
    deadline_at: candidate.deadline_at,
    deadline_raw: candidate.deadline_raw,
    deadline_precision: candidate.deadline_precision,
    event_at: candidate.event_at,
    event_raw: candidate.event_raw,
    event_precision: candidate.event_precision,
    next_action: candidate.next_action,
    next_action_at: null,
    next_action_at_raw: null,
    next_action_at_precision: null,
    reminder_at: null,
    reminder_raw: null,
    reminder_precision: null,
    notes: candidate.notes,
    outcome: null,
  };
  const inserted = await database.from("opportunities").insert(values).select("*").single();
  let row = inserted.data as OpportunityRow | null;
  if (inserted.error?.code === "23505") {
    const existing = await database.from("opportunities").select("*")
      .eq("draft_save_token", candidate.save_token).maybeSingle();
    if (existing.error) throw new Error(`Could not check the saved discovery: ${existing.error.message}`);
    row = existing.data as OpportunityRow | null;
  } else if (inserted.error) {
    throw new Error(`Could not save the discovered opportunity: ${inserted.error.message}`);
  }
  if (!row) throw new Error("The discovered opportunity save could not be confirmed");
  const { error: candidateError } = await database.from("opportunity_discovery_candidates").update({
    status: "saved",
    opportunity_id: row.id,
    updated_at: new Date().toISOString(),
  }).eq("id", candidate.id);
  if (candidateError) throw new Error(`Opportunity saved, but discovery status failed: ${candidateError.message}`);
  return row;
}

async function runDiscoveryNow(): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 80_000);
  try {
    const response = await fetch(`${requiredEnv("SUPABASE_URL")}/functions/v1/opportunity-discovery`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-cron-secret": requiredEnv("OPPORTUNITY_CRON_SECRET"),
      },
      body: "{}",
    });
    const result = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(cleanText(result.error || `Discovery HTTP ${response.status}`, 300));
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

async function findDuplicate(
  database: SupabaseClient,
  draft: OpportunityDraft,
): Promise<OpportunityRow | null> {
  if (draft.sourceUrl) {
    const exactLink = await database.from("opportunities").select("*")
      .eq("source_url", draft.sourceUrl).order("updated_at", { ascending: false }).limit(1);
    if (exactLink.error) throw new Error(`Could not check duplicate links: ${exactLink.error.message}`);
    if (exactLink.data?.[0]) return exactLink.data[0] as OpportunityRow;
  }
  const normalizedName = normalizeKey(draft.name);
  if (normalizedName) {
    let exactQuery = database.from("opportunities").select("*")
      .eq("normalized_name", normalizedName);
    if (draft.organization) {
      exactQuery = exactQuery.eq("normalized_organization", normalizeKey(draft.organization));
    }
    const exactName = await exactQuery.order("updated_at", { ascending: false }).limit(1);
    if (exactName.error) throw new Error(`Could not check duplicate names: ${exactName.error.message}`);
    if (exactName.data?.[0]) return exactName.data[0] as OpportunityRow;
  }
  const { data, error } = await database.from("opportunities")
    .select("*").order("updated_at", { ascending: false }).limit(150);
  if (error) throw new Error(`Could not check duplicates: ${error.message}`);
  let best: { row: OpportunityRow; score: number } | null = null;
  for (const value of (data ?? []) as OpportunityRow[]) {
    const score = duplicateScore(draft, value);
    if (score >= 0.82 && (!best || score > best.score)) best = { row: value, score };
  }
  return best?.row ?? null;
}

async function showDraft(
  database: SupabaseClient,
  session: BotSessionRow,
  replyToMessageId?: number,
): Promise<void> {
  if (!session.draft) throw new Error("Draft is missing");
  const previewId = await sendHtml(
    formatDraft(session.draft),
    draftReplyMarkup(session.draft.category, Boolean(session.draft.duplicateId)),
    replyToMessageId,
  );
  await saveSession(database, {
    ...session,
    mode: "review_draft",
    pending_field: null,
    editing_public_id: null,
    preview_message_id: previewId,
  });
}

async function beginDraft(
  database: SupabaseClient,
  chatId: string,
  source: string,
  replyToMessageId?: number,
): Promise<void> {
  if (source.length > MAX_SOURCE_TEXT) {
    await sendText(
      "That message is too long to store safely. Send the opportunity title, organization, link, and dates in a shorter message.",
      undefined,
      replyToMessageId,
    );
    return;
  }
  const draft = parseOpportunityText(source);
  const duplicate = await findDuplicate(database, draft);
  if (duplicate) {
    draft.duplicateId = duplicate.public_id;
    draft.duplicateName = duplicate.name;
  }
  await showDraft(database, {
    ...idleSession(chatId),
    mode: "review_draft",
    draft,
  }, replyToMessageId);
}

async function saveDraft(database: SupabaseClient, session: BotSessionRow): Promise<OpportunityRow> {
  const draft = session.draft;
  if (!draft) throw new Error("Draft is missing");
  if (!cleanText(draft.name, 180)) throw new Error("Set a name before saving");
  if (!isTrackableOpportunityCategory(draft.category)) {
    throw new Error("Choose a specific opportunity category before saving");
  }
  const values = {
    draft_save_token: draft.saveToken,
    name: cleanText(draft.name, 180),
    organization: draft.organization ? cleanText(draft.organization, 160) : null,
    normalized_name: normalizeKey(draft.name),
    normalized_organization: normalizeKey(draft.organization),
    category: draft.category,
    source_url: draft.sourceUrl,
    source_text: draft.sourceText,
    discovered_on: draft.discoveredOn,
    status: "saved",
    status_confirmed_at: null,
    deadline_at: draft.deadlineAt,
    deadline_raw: draft.deadlineRaw,
    deadline_precision: draft.deadlinePrecision,
    event_at: draft.eventAt,
    event_raw: draft.eventRaw,
    event_precision: draft.eventPrecision,
    next_action: draft.nextAction,
    next_action_at: draft.nextActionAt,
    next_action_at_raw: draft.nextActionAtRaw,
    next_action_at_precision: draft.nextActionAtPrecision,
    reminder_at: draft.reminderAt,
    reminder_raw: draft.reminderRaw,
    reminder_precision: draft.reminderPrecision,
    notes: draft.notes,
    outcome: draft.outcome,
  };
  const inserted = await database.from("opportunities").insert(values).select("*").single();
  let row = inserted.data as OpportunityRow | null;
  if (inserted.error?.code === "23505") {
    const existing = await database.from("opportunities").select("*")
      .eq("draft_save_token", draft.saveToken).maybeSingle();
    if (existing.error) throw new Error(`Could not check the saved draft: ${existing.error.message}`);
    row = existing.data as OpportunityRow | null;
  } else if (inserted.error) {
    throw new Error(`Could not save the opportunity: ${inserted.error.message}`);
  }
  if (!row) throw new Error("The draft save could not be confirmed");
  await saveSession(database, idleSession(session.chat_id));
  return row;
}

function isClear(value: string): boolean {
  return /^(?:-|clear|none|not set)$/i.test(cleanText(value, 30));
}

function parseDateEdit(
  value: string,
  defaultTime: string,
): { at: string; raw: string; precision: "date" | "datetime" } | null {
  const at = parseDubaiDate(value, new Date(), defaultTime);
  return at ? { at, raw: cleanText(value, 120), precision: datePrecision(value) } : null;
}

function applyDraftField(
  original: OpportunityDraft,
  field: DraftField,
  input: string,
): { draft?: OpportunityDraft; error?: string } {
  const draft: OpportunityDraft = structuredClone(original);
  const value = cleanText(input, 4_000);
  let assignedDateText: string | null = null;
  let resolvedDateWarning: string | null = null;
  if (field === "name") {
    if (isClear(value) || !value) return { error: "A name is required." };
    draft.name = cleanText(value, 180);
  } else if (field === "organization") {
    draft.organization = isClear(value) ? null : cleanText(value, 160);
  } else if (field === "category") {
    const category = value.toLowerCase().replace(/\s+/g, "_");
    if (!(CATEGORIES as readonly string[]).includes(category)) {
      return { error: `Use one of: ${CATEGORIES.join(", ")}.` };
    }
    draft.category = category as OpportunityDraft["category"];
    draft.categoryInferred = false;
  } else if (field === "link") {
    if (isClear(value)) draft.sourceUrl = null;
    else {
      const link = canonicalizeUrl(value);
      if (!link) return { error: "Send a complete http:// or https:// link." };
      draft.sourceUrl = link;
    }
  } else if (["deadline", "event", "reminder"].includes(field)) {
    const prefix = field === "deadline" ? "deadline" : field;
    resolvedDateWarning = field === "deadline"
      ? "Deadline was not understood:"
      : field === "event"
      ? "Event date was not understood:"
      : "Reminder was not understood:";
    if (isClear(value)) {
      (draft as unknown as Record<string, unknown>)[`${prefix}At`] = null;
      (draft as unknown as Record<string, unknown>)[`${prefix}Raw`] = null;
      (draft as unknown as Record<string, unknown>)[`${prefix}Precision`] = null;
    } else {
      const parsed = parseDateEdit(
        value,
        field === "deadline" || field === "event" ? "23:59" : "09:00",
      );
      if (!parsed) return { error: "Use YYYY-MM-DD, DD/MM/YYYY, a month name, today, or tomorrow. Add a time if known." };
      (draft as unknown as Record<string, unknown>)[`${prefix}At`] = parsed.at;
      (draft as unknown as Record<string, unknown>)[`${prefix}Raw`] = parsed.raw;
      (draft as unknown as Record<string, unknown>)[`${prefix}Precision`] = parsed.precision;
      assignedDateText = value;
    }
  } else if (field === "next") {
    if (isClear(value)) {
      draft.nextAction = null;
      draft.nextActionAt = null;
      draft.nextActionAtRaw = null;
      draft.nextActionAtPrecision = null;
      resolvedDateWarning = "Next-action date was not understood:";
    } else if (value.includes("|")) {
      const [dateText, ...actionParts] = value.split("|");
      const parsed = parseDateEdit(dateText.trim(), "09:00");
      const action = cleanText(actionParts.join("|"), 1_000);
      if (!parsed || !action) return { error: "Use: 2026-10-10 09:00 | Prepare for interview" };
      draft.nextActionAt = parsed.at;
      draft.nextActionAtRaw = parsed.raw;
      draft.nextActionAtPrecision = parsed.precision;
      draft.nextAction = action;
      assignedDateText = dateText.trim();
      resolvedDateWarning = "Next-action date was not understood:";
    } else {
      draft.nextAction = cleanText(value, 1_000);
    }
  } else if (field === "notes") {
    draft.notes = isClear(value) ? null : cleanText(value, 4_000);
  } else if (field === "outcome") {
    draft.outcome = isClear(value) ? null : cleanText(value, 2_000);
  }
  draft.warnings = draft.warnings.filter((warning) =>
    !(field === "name" && warning === "Name is missing") &&
    !(field === "link" && warning === "The link was not valid") &&
    !(resolvedDateWarning && warning.startsWith(resolvedDateWarning))
  );
  if (assignedDateText) {
    const assignedKey = normalizeKey(assignedDateText);
    draft.unassignedDates = draft.unassignedDates.filter((candidate) =>
      normalizeKey(candidate) !== assignedKey
    );
  }
  return { draft };
}

function itemFieldPatch(
  row: OpportunityRow,
  field: DraftField,
  input: string,
): { patch?: Record<string, unknown>; error?: string } {
  const value = cleanText(input, 4_000);
  if (field === "name") {
    if (isClear(value) || !value) return { error: "A name is required." };
    return { patch: { name: cleanText(value, 180), normalized_name: normalizeKey(value) } };
  }
  if (field === "organization") {
    const organization = isClear(value) ? null : cleanText(value, 160);
    return { patch: { organization, normalized_organization: normalizeKey(organization) } };
  }
  if (field === "category") {
    const category = value.toLowerCase().replace(/\s+/g, "_");
    if (!(CATEGORIES as readonly string[]).includes(category)) {
      return { error: `Use one of: ${CATEGORIES.join(", ")}.` };
    }
    const typedCategory = category as OpportunityDraft["category"];
    if (!isTrackableOpportunityCategory(typedCategory)) {
      return { error: "That classification is not an opportunity. Archive this item instead." };
    }
    return { patch: { category: typedCategory } };
  }
  if (field === "link") {
    if (isClear(value)) return { patch: { source_url: null } };
    const sourceUrl = canonicalizeUrl(value);
    return sourceUrl ? { patch: { source_url: sourceUrl } } : { error: "Send a complete http:// or https:// link." };
  }
  if (["deadline", "event", "reminder"].includes(field)) {
    const column = field === "deadline" ? "deadline" : field;
    if (isClear(value)) {
      return { patch: { [`${column}_at`]: null, [`${column}_raw`]: null, [`${column}_precision`]: null } };
    }
    const parsed = parseDateEdit(
      value,
      field === "deadline" || field === "event" ? "23:59" : "09:00",
    );
    if (!parsed) return { error: "That date was unclear. Include a four-digit year and add a time if known." };
    return { patch: {
      [`${column}_at`]: parsed.at,
      [`${column}_raw`]: parsed.raw,
      [`${column}_precision`]: parsed.precision,
    } };
  }
  if (field === "next") {
    if (isClear(value)) {
      return { patch: {
        next_action: null,
        next_action_at: null,
        next_action_at_raw: null,
        next_action_at_precision: null,
      } };
    }
    if (!value.includes("|")) return { patch: { next_action: cleanText(value, 1_000) } };
    const [dateText, ...actionParts] = value.split("|");
    const parsed = parseDateEdit(dateText.trim(), "09:00");
    const action = cleanText(actionParts.join("|"), 1_000);
    if (!parsed || !action) return { error: "Use: 2026-10-10 09:00 | Prepare for interview" };
    return { patch: {
      next_action: action,
      next_action_at: parsed.at,
      next_action_at_raw: parsed.raw,
      next_action_at_precision: parsed.precision,
    } };
  }
  if (field === "notes") return { patch: { notes: isClear(value) ? null : cleanText(value, 4_000) } };
  if (field === "outcome") return { patch: { outcome: isClear(value) ? null : cleanText(value, 2_000) } };
  return { error: `Cannot edit ${field} on #${row.public_id}.` };
}

function fieldPrompt(field: DraftField): string {
  if (field === "category") return `Send one category: ${CATEGORIES.join(", ")}.`;
  if (field === "deadline") return "Send the deadline, for example: 2026-10-15 or 2026-10-15 5pm";
  if (field === "event") return "Send the event date, for example: 20 Oct 2026 6pm";
  if (field === "reminder") return "Send the reminder time, for example: tomorrow 9am";
  if (field === "next") return "Send an action, or: 2026-10-10 09:00 | Prepare for interview";
  if (field === "link") return "Send the complete opportunity link.";
  return `Send the new ${field}. Use - to clear it.`;
}

async function updateItemField(
  database: SupabaseClient,
  id: number,
  field: DraftField,
  value: string,
): Promise<OpportunityRow | null> {
  const row = await loadItem(database, id);
  if (!row) return null;
  const result = itemFieldPatch(row, field, value);
  if (!result.patch) throw new Error(result.error ?? "That edit could not be applied");
  const { data, error } = await database.from("opportunities")
    .update(result.patch).eq("public_id", id).select("*").single();
  if (error) throw new Error(`Could not update #${id}: ${error.message}`);
  return data as OpportunityRow;
}

async function setStatus(
  database: SupabaseClient,
  id: number,
  status: OpportunityStatus,
): Promise<OpportunityRow | null> {
  const existing = await loadItem(database, id);
  if (!existing) return null;
  const confirmedAt = new Date().toISOString();
  const { data, error } = await database.from("opportunities").update({
    status,
    status_confirmed_at: confirmedAt,
    ...(existing.category === "course" &&
        ["registered", "accepted", "in_progress"].includes(status) &&
        !existing.last_activity_at
      ? { last_activity_at: confirmedAt }
      : {}),
  }).eq("public_id", id).select("*").maybeSingle();
  if (error) throw new Error(`Could not change status for #${id}: ${error.message}`);
  return data ? data as OpportunityRow : null;
}

async function renderItem(database: SupabaseClient, id: number, replyTo?: number): Promise<void> {
  const row = await loadItem(database, id);
  if (!row) {
    await sendText(`Opportunity #${id} was not found.`, undefined, replyTo);
    return;
  }
  await sendHtml(formatOpportunity(row), itemReplyMarkup(row), replyTo);
}

async function renderDashboard(database: SupabaseClient, replyTo?: number): Promise<void> {
  const rows = await loadRows(database);
  await sendHtml(formatDashboard(viewCounts(rows)), dashboardReplyMarkup(), replyTo);
}

async function renderView(
  database: SupabaseClient,
  view: OpportunityView,
  requestedPage = 0,
  replyTo?: number,
): Promise<void> {
  const allRows = rowsForView(await loadRows(database), view);
  const lastPage = Math.max(0, Math.ceil(allRows.length / 10) - 1);
  const page = Math.max(0, Math.min(requestedPage, lastPage));
  const rows = allRows.slice(page * 10, page * 10 + 10);
  await sendHtml(
    formatListPage(view, rows, allRows.length, page),
    listReplyMarkup(view, rows, page, allRows.length),
    replyTo,
  );
}

async function handleCommand(
  database: SupabaseClient,
  chatId: string,
  message: TelegramMessage,
  command: BotCommand,
): Promise<void> {
  const replyTo = Number.isInteger(message.message_id) ? Number(message.message_id) : undefined;
  if (command.kind === "help") {
    await sendText(helpText(), undefined, replyTo);
    return;
  }
  if (command.kind === "cancel") {
    await saveSession(database, idleSession(chatId));
    await sendText("Cancelled.", undefined, replyTo);
    return;
  }
  if (command.kind === "add") {
    if (command.text) await beginDraft(database, chatId, command.text, replyTo);
    else {
      await saveSession(database, { ...idleSession(chatId), mode: "await_draft" });
      await sendText("Paste or forward the opportunity details.", undefined, replyTo);
    }
    return;
  }
  if (command.kind === "inbox") {
    await renderDashboard(database, replyTo);
    return;
  }
  if (command.kind === "discover") {
    await sendText("Checking official sites and public web/social results now.", undefined, replyTo);
    const result = await runDiscoveryNow();
    const sent = Number(result.sent ?? 0);
    const checked = Number(result.checked ?? 0);
    const inserted = Number(result.inserted ?? 0);
    const queriesRun = Number(result.queriesRun ?? 0);
    const broadSearchConfigured = result.broadSearchConfigured === true;
    const sourceErrors = Array.isArray(result.sourceErrors)
      ? result.sourceErrors.map((value) => cleanText(value, 300)).filter(Boolean)
      : [];
    const errors = sourceErrors.length;
    const firstWebError = sourceErrors.find((value) => value.startsWith("Web search:"));
    if (!broadSearchConfigured) {
      await sendText(
        `Search finished. The three GDG pages were checked, but broad web and social search is not configured yet. Sent ${sent} new opportunities.`,
      );
    } else {
      await sendText(errors > 0
        ? `Search finished across ${queriesRun} web/social searches. Checked ${checked} results, saved ${inserted} new candidates, and sent ${sent}. ${errors} source checks failed.${firstWebError ? `\n\nProblem: ${firstWebError.replace(/^Web search:\s*/, "")}` : ""}`
        : `Search finished across ${queriesRun} web/social searches. Checked ${checked} results, saved ${inserted} new candidates, and sent ${sent}.`);
    }
    return;
  }
  if (command.kind === "list") {
    await renderView(database, command.view, 0, replyTo);
    return;
  }
  if (command.kind === "show") {
    await renderItem(database, command.id, replyTo);
    return;
  }
  if (command.kind === "status") {
    const row = await setStatus(database, command.id, command.status);
    if (!row) await sendText(`Opportunity #${command.id} was not found.`, undefined, replyTo);
    else await sendHtml(formatOpportunity(row), itemReplyMarkup(row), replyTo);
    return;
  }
  if (command.kind === "edit") {
    const row = await updateItemField(database, command.id, command.field, command.value);
    if (!row) await sendText(`Opportunity #${command.id} was not found.`, undefined, replyTo);
    else await sendHtml(formatOpportunity(row), itemReplyMarkup(row), replyTo);
    return;
  }
  if (command.kind === "archive" || command.kind === "restore" || command.kind === "activity") {
    const patch = command.kind === "archive"
      ? { archived_at: new Date().toISOString() }
      : command.kind === "restore"
      ? { archived_at: null }
      : { last_activity_at: new Date().toISOString() };
    const { data, error } = await database.from("opportunities").update(patch)
      .eq("public_id", command.id).select("*").maybeSingle();
    if (error) throw new Error(`Could not update #${command.id}: ${error.message}`);
    if (!data) await sendText(`Opportunity #${command.id} was not found.`, undefined, replyTo);
    else await sendHtml(formatOpportunity(data as OpportunityRow), itemReplyMarkup(data as OpportunityRow), replyTo);
    return;
  }
  await sendText(`I did not understand that command.\n\n${helpText()}`, undefined, replyTo);
}

async function handleMessage(
  database: SupabaseClient,
  chatId: string,
  message: TelegramMessage,
): Promise<void> {
  const raw = String(message.text ?? message.caption ?? "");
  const replyTo = Number.isInteger(message.message_id) ? Number(message.message_id) : undefined;
  const command = parseCommand(raw);
  if (command) {
    await handleCommand(database, chatId, message, command);
    return;
  }
  if (!raw.trim()) {
    if ((message.photo?.length ?? 0) > 0) {
      await sendText("I cannot read screenshot pixels in this version. Send it again with the important text in the caption.", undefined, replyTo);
    }
    return;
  }
  if (raw.length > MAX_SOURCE_TEXT) {
    await sendText("That message is too long. Shorten it to the opportunity title, organization, link, and dates.", undefined, replyTo);
    return;
  }
  const session = await loadSession(database, chatId);
  if (session.mode === "draft_field" && session.draft && session.pending_field) {
    const changed = applyDraftField(session.draft, session.pending_field, raw);
    if (!changed.draft) {
      await sendText(changed.error ?? "That value was not understood.", undefined, replyTo);
      return;
    }
    const duplicate = await findDuplicate(database, changed.draft);
    changed.draft.duplicateId = duplicate?.public_id ?? null;
    changed.draft.duplicateName = duplicate?.name ?? null;
    await showDraft(database, { ...session, draft: changed.draft }, replyTo);
    return;
  }
  if (session.mode === "item_field" && session.pending_field && session.editing_public_id) {
    try {
      const row = await updateItemField(database, session.editing_public_id, session.pending_field, raw);
      if (!row) await sendText(`Opportunity #${session.editing_public_id} was not found.`, undefined, replyTo);
      else await sendHtml(formatOpportunity(row), itemReplyMarkup(row), replyTo);
      await saveSession(database, idleSession(chatId));
    } catch (error) {
      await sendText(safeError(error), undefined, replyTo);
    }
    return;
  }
  await beginDraft(database, chatId, raw, replyTo);
}

async function handleCallback(
  database: SupabaseClient,
  chatId: string,
  callback: TelegramCallbackQuery,
): Promise<void> {
  const callbackId = callback.id as string;
  const data = callback.data ?? "";
  const messageId = Number(callback.message?.message_id);
  const session = await loadSession(database, chatId);

  const discoveryCandidate = DISCOVERY_CANDIDATE_PATTERN.exec(data);
  if (discoveryCandidate) {
    const id = Number(discoveryCandidate[1]);
    const action = discoveryCandidate[2];
    const candidate = await loadDiscoveryCandidate(database, id);
    if (!candidate) {
      await answerCallback(callbackId, "This suggestion was not found");
      return;
    }
    if (action === "dismiss") {
      if (candidate.status === "saved") {
        await answerCallback(callbackId, "Already saved");
        return;
      }
      const { error } = await database.from("opportunity_discovery_candidates").update({
        status: "dismissed",
        updated_at: new Date().toISOString(),
      }).eq("id", candidate.id);
      if (error) throw new Error(`Could not dismiss suggestion: ${error.message}`);
      await answerCallback(callbackId, "Dismissed");
      return;
    }
    if (candidate.status === "dismissed" || candidate.status === "expired") {
      await answerCallback(callbackId, "This suggestion is no longer active");
      return;
    }
    if (candidate.event_at && new Date(candidate.event_at) <= new Date()) {
      await database.from("opportunity_discovery_candidates").update({
        status: "expired", updated_at: new Date().toISOString(),
      }).eq("id", candidate.id);
      await answerCallback(callbackId, "The event has already passed");
      return;
    }
    await answerCallback(callbackId, "Saving");
    const row = await saveDiscoveryCandidate(database, candidate);
    await sendHtml(formatOpportunity(row), itemReplyMarkup(row));
    return;
  }

  const draftAction = DRAFT_ACTION_PATTERN.exec(data);
  if (draftAction) {
    if (!session.draft || session.mode === "idle" ||
      !Number.isInteger(messageId) || session.preview_message_id !== messageId) {
      await answerCallback(callbackId, "This draft is no longer current");
      return;
    }
    if (draftAction[1] === "cancel") {
      await saveSession(database, idleSession(chatId));
      await answerCallback(callbackId, "Cancelled");
      await sendText("Draft cancelled.");
      return;
    }
    if (!session.draft.name) {
      await answerCallback(callbackId, "Set a name first");
      return;
    }
    if (!isTrackableOpportunityCategory(session.draft.category)) {
      await answerCallback(callbackId, "Choose an opportunity category first");
      return;
    }
    await answerCallback(callbackId, "Saving");
    const row = await saveDraft(database, session);
    await sendHtml(formatOpportunity(row), itemReplyMarkup(row));
    return;
  }

  const draftField = DRAFT_FIELD_PATTERN.exec(data);
  if (draftField) {
    if (!session.draft || !Number.isInteger(messageId) || session.preview_message_id !== messageId) {
      await answerCallback(callbackId, "This draft is no longer current");
      return;
    }
    const field = draftField[1] as DraftField;
    await saveSession(database, {
      ...session,
      mode: "draft_field",
      pending_field: field,
      editing_public_id: null,
    });
    await answerCallback(callbackId, `Editing ${field}`);
    await sendText(fieldPrompt(field));
    return;
  }

  const viewMatch = VIEW_PATTERN.exec(data);
  if (viewMatch) {
    await answerCallback(callbackId, "Opening view");
    await renderView(database, viewMatch[1] as OpportunityView);
    return;
  }
  const pageMatch = PAGE_PATTERN.exec(data);
  if (pageMatch) {
    await answerCallback(callbackId, "Opening page");
    await renderView(database, pageMatch[1] as OpportunityView, Number(pageMatch[2]));
    return;
  }
  const itemMatch = ITEM_PATTERN.exec(data);
  if (itemMatch) {
    await answerCallback(callbackId, "Opening");
    await renderItem(database, Number(itemMatch[1]));
    return;
  }
  const statusMenu = STATUS_MENU_PATTERN.exec(data);
  if (statusMenu) {
    await answerCallback(callbackId, "Choose the confirmed status");
    await sendText(`Confirm status for #${statusMenu[1]}.`, statusReplyMarkup(Number(statusMenu[1])));
    return;
  }
  const editMenu = EDIT_MENU_PATTERN.exec(data);
  if (editMenu) {
    await answerCallback(callbackId, "Choose a field");
    await sendText(`Edit #${editMenu[1]}.`, editReplyMarkup(Number(editMenu[1])));
    return;
  }
  const statusMatch = STATUS_PATTERN.exec(data);
  if (statusMatch) {
    const id = Number(statusMatch[1]);
    const status = statusMatch[2] as OpportunityStatus;
    await answerCallback(callbackId, "Updating status");
    const row = await setStatus(database, id, status);
    if (!row) await sendText(`Opportunity #${id} was not found.`);
    else await sendHtml(formatOpportunity(row), itemReplyMarkup(row));
    return;
  }
  const editMatch = EDIT_PATTERN.exec(data);
  if (editMatch) {
    const id = Number(editMatch[1]);
    const field = editMatch[2] as DraftField;
    if (!await loadItem(database, id)) {
      await answerCallback(callbackId, "Opportunity was not found");
      return;
    }
    await saveSession(database, {
      ...idleSession(chatId),
      mode: "item_field",
      pending_field: field,
      editing_public_id: id,
    });
    await answerCallback(callbackId, `Editing ${field}`);
    await sendText(fieldPrompt(field));
    return;
  }
  const actionMatch = ACTION_PATTERN.exec(data);
  if (actionMatch) {
    const id = Number(actionMatch[1]);
    const action = actionMatch[2];
    const patch = action === "archive"
      ? { archived_at: new Date().toISOString() }
      : action === "restore"
      ? { archived_at: null }
      : action === "activity"
      ? { last_activity_at: new Date().toISOString() }
      : {
        reminder_at: new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString(),
        reminder_raw: "Snoozed for one day",
        reminder_precision: "datetime",
      };
    const { data: updated, error } = await database.from("opportunities").update(patch)
      .eq("public_id", id).select("*").maybeSingle();
    if (error) throw new Error(`Could not update #${id}: ${error.message}`);
    await answerCallback(callbackId, updated ? "Updated" : "Opportunity was not found");
    if (updated) await sendHtml(formatOpportunity(updated as OpportunityRow), itemReplyMarkup(updated as OpportunityRow));
    return;
  }
  await answerCallback(callbackId, "That button is no longer supported");
}

async function finishUpdate(
  database: SupabaseClient,
  updateId: number,
  status: "processed" | "failed",
  errorMessage: string | null = null,
): Promise<void> {
  const { error } = await database.rpc("finish_opportunity_telegram_update", {
    p_update_id: updateId,
    p_status: status,
    p_error: errorMessage,
  });
  if (error) console.error(`Could not finish Telegram update: ${safeError(error)}`);
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method !== "POST") return jsonResponse({ error: "POST required" }, 405);
  const suppliedSecret = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!constantTimeEqual(suppliedSecret, requiredEnv("OPPORTUNITY_TELEGRAM_WEBHOOK_SECRET"))) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_WEBHOOK_BYTES) return jsonResponse({ error: "Request too large" }, 413);

  let update: TelegramUpdate;
  try {
    const body = await request.text();
    if (body.length > MAX_WEBHOOK_BYTES) return jsonResponse({ error: "Request too large" }, 413);
    update = JSON.parse(body) as TelegramUpdate;
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const callback = update.callback_query;
  const message = update.message;
  const actorId = String(callback?.from?.id ?? message?.from?.id ?? "");
  const chatId = String(callback?.message?.chat?.id ?? message?.chat?.id ?? "");
  if (actorId !== requiredEnv("OPPORTUNITY_TELEGRAM_ALLOWED_USER_ID") ||
    chatId !== requiredEnv("OPPORTUNITY_TELEGRAM_CHAT_ID")) {
    // Telegram already proved the request with the webhook secret. Silently
    // accept messages from other chats so Telegram does not retry them.
    return jsonResponse({ ok: true, ignored: true });
  }
  if (callback && !callback.id) return jsonResponse({ error: "Invalid callback" }, 400);
  const updateId = Number(update.update_id);
  if (!Number.isSafeInteger(updateId) || updateId < 0) {
    return jsonResponse({ error: "Invalid update ID" }, 400);
  }

  const database = adminClient();
  const { data: claimData, error: claimError } = await database.rpc(
    "claim_opportunity_telegram_update",
    { p_update_id: updateId },
  );
  if (claimError) return jsonResponse({ error: "Could not claim update" }, 503);
  const claim = (Array.isArray(claimData) ? claimData[0] : claimData) as UpdateClaim | null;
  if (!claim?.claimed) {
    if (claim?.reason === "processing") {
      // Another invocation may still be handling this update. A temporary
      // failure keeps Telegram's retry alive. If the worker died, the database
      // changes the reason to stale_review_required after ten minutes.
      return jsonResponse({ ok: false, reason: "processing" }, 503);
    }
    if (callback?.id) {
      try {
        await answerCallback(
          callback.id,
          claim?.reason === "stale_review_required" ? "Check the inbox before trying again" : "Already handled",
        );
      } catch {
        // Telegram may have already closed an old callback. The update is still safely ignored.
      }
    }
    if (claim?.reason === "stale_review_required") {
      try {
        await sendText("A previous action stopped unexpectedly. Check /inbox before trying it again.");
      } catch {
        // The database still records the visible-recovery state for later inspection.
      }
    }
    return jsonResponse({ ok: true, duplicate: true, reason: claim?.reason });
  }

  try {
    if (callback) await handleCallback(database, chatId, callback);
    else if (message) await handleMessage(database, chatId, message);
    await finishUpdate(database, updateId, "processed");
    return jsonResponse({ ok: true });
  } catch (error) {
    const errorMessage = safeError(error);
    console.error(`Opportunity Telegram update failed: ${errorMessage}`);
    await finishUpdate(database, updateId, "failed", errorMessage);
    try {
      await sendText("That action may not have finished. Check /inbox before trying it again.");
    } catch (notificationError) {
      console.error(`Failure notice could not be sent: ${safeError(notificationError)}`);
    }
    // Do not ask Telegram to replay a partially completed action.
    return jsonResponse({ ok: true, action: "failed_safely" });
  }
});
