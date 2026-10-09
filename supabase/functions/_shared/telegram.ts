import type {
  OpportunityDraft,
  OpportunityDiscoveryCandidateRow,
  OpportunityRow,
  OpportunityStatus,
  OpportunityView,
  ReminderCandidate,
} from "./types.ts";
import { isTrackableOpportunityCategory } from "./types.ts";
import { cleanText, escapeHtml, formatDubaiMoment, requiredEnv, safeError } from "./utils.ts";
import { nextRelevantTime } from "./views.ts";

interface TelegramEnvelope<T> {
  ok: boolean;
  result?: T;
  description?: string;
  parameters?: { retry_after?: number };
}

interface SentMessage {
  message_id: number;
}

export class AmbiguousTelegramError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AmbiguousTelegramError";
  }
}

class TelegramApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TelegramApiError";
  }
}

async function telegramCall<T>(
  method: string,
  payload: Record<string, unknown>,
  retryAmbiguousErrors = true,
): Promise<T> {
  const token = requiredEnv("OPPORTUNITY_TELEGRAM_BOT_TOKEN");
  let lastError = "Telegram request failed";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json() as TelegramEnvelope<T>;
      if (response.ok && body.ok && body.result !== undefined) return body.result;
      lastError = cleanText(body.description || `Telegram HTTP ${response.status}`, 300);
      if (response.status === 429 && attempt < 3) {
        const seconds = Math.min(Math.max(body.parameters?.retry_after ?? attempt, 1), 5);
        await new Promise((resolve) => setTimeout(resolve, seconds * 1_000));
        continue;
      }
      if (response.status >= 500 && retryAmbiguousErrors && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 700));
        continue;
      }
      if (response.status >= 500 && !retryAmbiguousErrors) {
        throw new AmbiguousTelegramError(lastError);
      }
      throw new TelegramApiError(lastError);
    } catch (error) {
      if (error instanceof AmbiguousTelegramError) throw error;
      if (error instanceof TelegramApiError) throw error;
      lastError = safeError(error).replaceAll(token, "[telegram-token]");
      if (!retryAmbiguousErrors) throw new AmbiguousTelegramError(lastError);
      if (attempt === 3) throw new Error(lastError);
      await new Promise((resolve) => setTimeout(resolve, attempt * 700));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(lastError);
}

export async function sendText(
  text: string,
  replyMarkup?: Record<string, unknown>,
  replyToMessageId?: number,
): Promise<number> {
  const result = await telegramCall<SentMessage>("sendMessage", {
    chat_id: requiredEnv("OPPORTUNITY_TELEGRAM_CHAT_ID"),
    text: cleanText(text, 3_900),
    disable_web_page_preview: true,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    ...(replyToMessageId
      ? { reply_parameters: { message_id: replyToMessageId, allow_sending_without_reply: true } }
      : {}),
  }, false);
  return result.message_id;
}

export async function sendHtml(
  html: string,
  replyMarkup?: Record<string, unknown>,
  replyToMessageId?: number,
): Promise<number> {
  const result = await telegramCall<SentMessage>("sendMessage", {
    chat_id: requiredEnv("OPPORTUNITY_TELEGRAM_CHAT_ID"),
    text: html,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    ...(replyToMessageId
      ? { reply_parameters: { message_id: replyToMessageId, allow_sending_without_reply: true } }
      : {}),
  }, false);
  return result.message_id;
}

export async function answerCallback(callbackId: string, text: string): Promise<void> {
  await telegramCall<boolean>("answerCallbackQuery", {
    callback_query_id: callbackId,
    text: cleanText(text, 180),
    show_alert: false,
  });
}

const STATUS_LABELS: Record<OpportunityStatus, string> = {
  saved: "Saved",
  planning: "Planning",
  applied: "Applied",
  registered: "Registered",
  waiting: "Waiting",
  accepted: "Accepted",
  rejected: "Rejected",
  in_progress: "In progress",
  completed: "Completed",
};

const VIEW_LABELS: Record<OpportunityView, string> = {
  saved: "Saved / planning",
  upcoming: "Upcoming",
  overdue: "Overdue",
  waiting: "Waiting",
  registered: "Registered",
  accepted: "Accepted",
  rejected: "Rejected",
  completed: "Completed",
  archived: "Archived",
};

function shown(value: string | null | undefined, maximumLength = 900): string {
  return value ? escapeHtml(cleanText(value, maximumLength)) : "Not set";
}

function discoveryText(value: string | null | undefined, maximumLength: number): string | null {
  if (!value) return null;
  const cleaned = cleanText(value, maximumLength)
    .replaceAll("&#x27;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&")
    .replaceAll("&nbsp;", " ");
  if (
    !cleaned ||
    /^(?:not set|not stated|unknown|unclear|none found|venue not announced)$/i.test(cleaned)
  ) return null;
  return cleaned;
}

function discoveryFact(label: string, value: string | null | undefined, maximumLength: number): string | null {
  const cleaned = discoveryText(value, maximumLength);
  return cleaned ? `<b>${label}:</b> ${escapeHtml(cleaned)}` : null;
}

function categoryName(category: OpportunityDraft["category"]): string {
  return category.replaceAll("_", " ");
}

function classificationDecision(category: OpportunityDraft["category"]): string {
  if (category === "security_alert") return "Security alert — not an opportunity";
  if (category === "technical_news") return "Technical news — not an opportunity";
  if (category === "completion_post") return "Completion or recap post — not a current opportunity";
  if (category === "other") return "Unclear — choose a specific opportunity category";
  return "Trackable opportunity — review the facts before saving";
}

export function formatDraft(draft: OpportunityDraft): string {
  const category = `${categoryName(draft.category)}${draft.categoryInferred ? " (suggested)" : ""}`;
  const trackable = isTrackableOpportunityCategory(draft.category);
  const lines = [
    "<b>Review before saving</b>",
    "",
    `<b>Name:</b> ${shown(draft.name, 180)}`,
    `<b>Organization:</b> ${shown(draft.organization, 160)}`,
    `<b>Category:</b> ${escapeHtml(category)}`,
    `<b>Classification:</b> ${escapeHtml(classificationDecision(draft.category))}`,
    `<b>Link:</b> ${shown(draft.sourceUrl, 400)}`,
    `<b>Discovered:</b> ${escapeHtml(draft.discoveredOn)}`,
    "<b>Status:</b> Saved only — not applied or registered",
    `<b>Deadline:</b> ${escapeHtml(formatDubaiMoment(draft.deadlineAt, draft.deadlinePrecision))}`,
    `<b>Event:</b> ${escapeHtml(formatDubaiMoment(draft.eventAt, draft.eventPrecision))}`,
    `<b>Next action:</b> ${shown(draft.nextAction, 500)}`,
    `<b>Next-action date:</b> ${escapeHtml(formatDubaiMoment(draft.nextActionAt, draft.nextActionAtPrecision))}`,
    `<b>Reminder:</b> ${escapeHtml(formatDubaiMoment(draft.reminderAt, draft.reminderPrecision))}`,
    `<b>Notes:</b> ${shown(draft.notes, 600)}`,
    `<b>Outcome:</b> ${shown(draft.outcome, 400)}`,
  ];
  if (draft.unassignedDates.length > 0) {
    lines.push("", `<b>Possible unassigned dates:</b> ${escapeHtml(cleanText(draft.unassignedDates.join(", "), 400))}`);
  }
  if (draft.warnings.length > 0) {
    lines.push("", `<b>Check:</b> ${escapeHtml(cleanText(draft.warnings.join("; "), 500))}`);
  }
  if (draft.duplicateId) {
    lines.push("", `<b>Possible duplicate:</b> #${draft.duplicateId} ${shown(draft.duplicateName)}`);
  }
  lines.push(
    "",
    trackable
      ? "Nothing is stored until you tap Save."
      : "This cannot be saved as an opportunity. Change the category only if it contains a real application, registration, role, program, competition, or event.",
  );
  return lines.join("\n");
}

export function draftReplyMarkup(
  category: OpportunityDraft["category"],
  hasDuplicate = false,
): Record<string, unknown> {
  const trackable = isTrackableOpportunityCategory(category);
  return {
    inline_keyboard: [
      trackable
        ? [
          { text: hasDuplicate ? "Save anyway" : "Save", callback_data: "d:save" },
          { text: "Cancel", callback_data: "d:cancel" },
        ]
        : [
          { text: "Change category", callback_data: "df:category" },
          { text: "Cancel", callback_data: "d:cancel" },
        ],
      [
        { text: "Name", callback_data: "df:name" },
        { text: "Organization", callback_data: "df:organization" },
        ...(trackable ? [{ text: "Category", callback_data: "df:category" }] : []),
      ],
      [
        { text: "Link", callback_data: "df:link" },
        { text: "Deadline", callback_data: "df:deadline" },
        { text: "Event", callback_data: "df:event" },
      ],
      [
        { text: "Next action", callback_data: "df:next" },
        { text: "Reminder", callback_data: "df:reminder" },
      ],
      [
        { text: "Notes", callback_data: "df:notes" },
        { text: "Outcome", callback_data: "df:outcome" },
      ],
    ],
  };
}

export function formatOpportunity(row: OpportunityRow): string {
  const archived = row.archived_at ? " (archived)" : "";
  const source = row.source_url
    ? `<a href="${escapeHtml(row.source_url)}">Open source</a>`
    : "Not set";
  return [
    `<b>#${row.public_id} ${escapeHtml(cleanText(row.name, 180))}</b>${archived}`,
    "",
    `<b>Organization:</b> ${shown(row.organization)}`,
    `<b>Category:</b> ${escapeHtml(categoryName(row.category))}`,
    `<b>Status:</b> ${escapeHtml(STATUS_LABELS[row.status])}`,
    `<b>Source:</b> ${source}`,
    `<b>Discovered:</b> ${escapeHtml(row.discovered_on)}`,
    `<b>Deadline:</b> ${escapeHtml(formatDubaiMoment(row.deadline_at, row.deadline_precision))}`,
    `<b>Event:</b> ${escapeHtml(formatDubaiMoment(row.event_at, row.event_precision))}`,
    `<b>Next action:</b> ${shown(row.next_action)}`,
    `<b>Next-action date:</b> ${escapeHtml(formatDubaiMoment(row.next_action_at, row.next_action_at_precision))}`,
    `<b>Reminder:</b> ${escapeHtml(formatDubaiMoment(row.reminder_at, row.reminder_precision))}`,
    `<b>Notes:</b> ${shown(row.notes)}`,
    `<b>Outcome:</b> ${shown(row.outcome)}`,
    row.category === "course"
      ? `<b>Last activity:</b> ${escapeHtml(formatDubaiMoment(row.last_activity_at, "datetime"))}`
      : null,
  ].filter((line): line is string => line !== null).join("\n");
}

export function itemReplyMarkup(row: OpportunityRow): Record<string, unknown> {
  if (row.archived_at) {
    return { inline_keyboard: [[{ text: "Restore", callback_data: `a:${row.public_id}:restore` }]] };
  }
  const rows: Array<Array<Record<string, string>>> = [
    [
      { text: "Change status", callback_data: `sm:${row.public_id}` },
      { text: "Edit", callback_data: `em:${row.public_id}` },
    ],
  ];
  if (row.category === "course") {
    rows.push([{ text: "Studied today", callback_data: `a:${row.public_id}:activity` }]);
  }
  rows.push([
    { text: "Snooze 1 day", callback_data: `a:${row.public_id}:snooze` },
    { text: "Archive", callback_data: `a:${row.public_id}:archive` },
  ]);
  return { inline_keyboard: rows };
}

export function statusReplyMarkup(id: number): Record<string, unknown> {
  return {
    inline_keyboard: [
      [
        { text: "Saved", callback_data: `s:${id}:saved` },
        { text: "Planning", callback_data: `s:${id}:planning` },
      ],
      [
        { text: "Applied", callback_data: `s:${id}:applied` },
        { text: "Registered", callback_data: `s:${id}:registered` },
      ],
      [
        { text: "Waiting", callback_data: `s:${id}:waiting` },
        { text: "Accepted", callback_data: `s:${id}:accepted` },
      ],
      [
        { text: "Rejected", callback_data: `s:${id}:rejected` },
        { text: "In progress", callback_data: `s:${id}:in_progress` },
      ],
      [{ text: "Completed / attended", callback_data: `s:${id}:completed` }],
    ],
  };
}

export function editReplyMarkup(id: number): Record<string, unknown> {
  return {
    inline_keyboard: [
      [
        { text: "Name", callback_data: `e:${id}:name` },
        { text: "Organization", callback_data: `e:${id}:organization` },
        { text: "Category", callback_data: `e:${id}:category` },
      ],
      [
        { text: "Link", callback_data: `e:${id}:link` },
        { text: "Deadline", callback_data: `e:${id}:deadline` },
        { text: "Event", callback_data: `e:${id}:event` },
      ],
      [
        { text: "Next action", callback_data: `e:${id}:next` },
        { text: "Reminder", callback_data: `e:${id}:reminder` },
      ],
      [
        { text: "Notes", callback_data: `e:${id}:notes` },
        { text: "Outcome", callback_data: `e:${id}:outcome` },
      ],
    ],
  };
}

export function formatDashboard(counts: Record<OpportunityView, number>): string {
  return [
    "<b>Opportunity Inbox</b>",
    "",
    `Saved / planning: ${counts.saved}`,
    `Upcoming: ${counts.upcoming}`,
    `Overdue: ${counts.overdue}`,
    `Waiting for response: ${counts.waiting}`,
    `Registered: ${counts.registered}`,
    `Accepted / in progress: ${counts.accepted}`,
    `Rejected: ${counts.rejected}`,
    `Completed / attended: ${counts.completed}`,
    `Archived: ${counts.archived}`,
    "",
    "Paste or forward an opportunity to add it.",
  ].join("\n");
}

export function dashboardReplyMarkup(): Record<string, unknown> {
  return {
    inline_keyboard: [
      [{ text: "Saved / planning", callback_data: "v:saved" }],
      [
        { text: "Upcoming", callback_data: "v:upcoming" },
        { text: "Overdue", callback_data: "v:overdue" },
      ],
      [
        { text: "Waiting", callback_data: "v:waiting" },
        { text: "Registered", callback_data: "v:registered" },
      ],
      [
        { text: "Accepted", callback_data: "v:accepted" },
        { text: "Rejected", callback_data: "v:rejected" },
      ],
      [{ text: "Completed", callback_data: "v:completed" }],
      [{ text: "Archived", callback_data: "v:archived" }],
    ],
  };
}

export function formatListPage(
  view: OpportunityView,
  rows: OpportunityRow[],
  total: number,
  page: number,
  now = new Date(),
): string {
  if (rows.length === 0) return `<b>${VIEW_LABELS[view]}</b>\n\nNothing here.`;
  const entries = rows.map((row) => {
    const next = nextRelevantTime(row, now);
    const date = next ? formatDubaiMoment(new Date(next).toISOString(), "date") : STATUS_LABELS[row.status];
    return `#${row.public_id} ${escapeHtml(cleanText(row.name, 90))} — ${escapeHtml(date)}`;
  });
  const first = page * 10 + 1;
  const last = first + rows.length - 1;
  return [
    `<b>${VIEW_LABELS[view]}</b>`,
    "",
    ...entries,
    ...(total > 10 ? ["", `Showing ${first}–${last} of ${total}.`] : []),
  ].join("\n");
}

export function listReplyMarkup(
  view: OpportunityView,
  rows: OpportunityRow[],
  page: number,
  total: number,
): Record<string, unknown> {
  const keyboard = rows.map((row) => [
      { text: `Open #${row.public_id}`, callback_data: `i:${row.public_id}` },
    ]);
  const navigation: Array<{ text: string; callback_data: string }> = [];
  if (page > 0) navigation.push({ text: "Previous", callback_data: `vp:${view}:${page - 1}` });
  if ((page + 1) * 10 < total) navigation.push({ text: "Next", callback_data: `vp:${view}:${page + 1}` });
  if (navigation.length > 0) keyboard.push(navigation);
  return { inline_keyboard: keyboard };
}

export function formatReminder(row: OpportunityRow, reminder: ReminderCandidate): string {
  return [
    `<b>Reminder: ${escapeHtml(reminder.title)}</b>`,
    "",
    `<b>#${row.public_id} ${escapeHtml(cleanText(row.name, 180))}</b>`,
    `<b>Organization:</b> ${shown(row.organization)}`,
    `<b>What:</b> ${escapeHtml(cleanText(reminder.detail, 700))}`,
    `<b>Target:</b> ${escapeHtml(formatDubaiMoment(reminder.targetAt, reminder.targetPrecision))}`,
  ].join("\n");
}

export function reminderReplyMarkup(row: OpportunityRow): Record<string, unknown> {
  return {
    inline_keyboard: [[
      { text: "Open", callback_data: `i:${row.public_id}` },
      { text: "Snooze 1 day", callback_data: `a:${row.public_id}:snooze` },
    ]],
  };
}

export function formatDiscoveryCandidate(row: OpportunityDiscoveryCandidateRow): string {
  const details = row.decision_details;
  const organization = discoveryText(row.organization, 120);
  const shownOrganization = organization && !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(organization)
    ? organization
    : null;
  const category = categoryName(row.category).replace(/^./, (letter) => letter.toUpperCase());
  const meta = [shownOrganization, category].filter(Boolean).join(" · ");
  const lines = [
    `<b>${escapeHtml(discoveryText(row.name, 180) ?? "Opportunity")}</b>`,
    escapeHtml(meta),
  ];

  const summary = discoveryText(details?.summary, 320);
  if (summary && !/^the search result did not provide/i.test(summary)) {
    lines.push("", escapeHtml(summary));
  }

  const facts: string[] = [];
  if (row.deadline_at) {
    facts.push(`<b>Deadline:</b> ${escapeHtml(formatDubaiMoment(row.deadline_at, row.deadline_precision))}`);
  }
  if (row.event_at) {
    facts.push(`<b>Date:</b> ${escapeHtml(formatDubaiMoment(row.event_at, row.event_precision))}`);
  }
  if (details) {
    const location = discoveryText(details.location, 140);
    const format = discoveryText(details.format, 60);
    const place = [location, format]
      .filter((value, index, all): value is string => Boolean(value) && all.indexOf(value) === index)
      .join(" · ");
    const placeLine = discoveryFact("Place", place, 190);
    const costLine = discoveryFact("Cost", details.cost, 100);
    const eligibilityLine = discoveryFact("Eligibility", details.eligibility, 220);
    const restrictions = discoveryText(details.restrictions, 180);
    const restrictionLine = restrictions && restrictions !== discoveryText(details.eligibility, 180)
      ? discoveryFact("Restrictions", restrictions, 180)
      : null;
    const commitmentLine = discoveryFact("Commitment", details.commitment, 150);
    for (const line of [placeLine, costLine, eligibilityLine, restrictionLine, commitmentLine]) {
      if (line) facts.push(line);
    }
  }
  if (facts.length > 0) lines.push("", ...facts);
  return lines.filter((line, index, all) => line !== "" || (index > 0 && all[index - 1] !== "")).join("\n");
}

export function discoveryCandidateReplyMarkup(row: OpportunityDiscoveryCandidateRow): Record<string, unknown> {
  return {
    inline_keyboard: [
      [
        { text: "Save", callback_data: `dc:${row.public_id}:save` },
        { text: "Dismiss", callback_data: `dc:${row.public_id}:dismiss` },
      ],
      [{ text: "Open link", url: row.source_url }],
    ],
  };
}

export function helpText(): string {
  return [
    "Opportunity Inbox",
    "",
    "Paste or forward opportunity text. I will show a draft before saving it.",
    "",
    "/inbox — open the dashboard",
    "/discover — check official sources now",
    "/add — start a new draft",
    "/show 12 — open item #12",
    "/status 12 applied — confirm a status",
    "/deadline 12 2026-10-15 — set a deadline",
    "/event 12 20 Oct 2026 6pm — set an event",
    "/next 12 2026-10-10 09:00 | Prepare for interview",
    "/remind 12 tomorrow 9am — set a reminder",
    "/note 12 Bring identification",
    "/outcome 12 Accepted with scholarship",
    "/activity 12 — record course activity today",
    "/archive 12 — archive without deleting",
    "/cancel — cancel the current edit or draft",
    "",
    "Use '-' as an edit value to clear a field. Times use Dubai time.",
    "Screenshots without a caption and documents are not read in this version.",
    "Technical news, security alerts, completion posts, and unclear items are classified but not saved as opportunities.",
  ].join("\n");
}
