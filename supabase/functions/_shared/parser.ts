import type { OpportunityCategory, OpportunityDraft, OpportunityRow } from "./types.ts";
import {
  canonicalizeUrl,
  cleanText,
  datePrecision,
  dubaiDateString,
  normalizeKey,
  parseDubaiDate,
} from "./utils.ts";

const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;
const DATE_TOKEN_PATTERN = /\b(?:\d{4}-\d{1,2}-\d{1,2}(?:[ T]\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?|\d{1,2}\/\d{1,2}\/\d{4}(?:\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2},?\s+\d{4}(?:\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?|\d{1,2}\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{4}(?:\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?)\b/gi;

const LABEL_PATTERN = /^(?:[-*•]\s*)?(.{2,60}?)\s*(?::|[–—]|\s-\s)\s*(.+)$/;
const SECURITY_ALERT_PATTERN = /\bcve[- ]?\d{4}-\d{4,}\b|\bsecurity (?:bulletin|advisory|alert)\b|\bvulnerabilit(?:y|ies)\b|\bzero[- ]day\b|\b(?:critical|high severity) (?:security )?(?:flaw|patch)\b/;
const COMPLETION_POST_PATTERN = /\b(?:proud|pleased|happy|thrilled|excited) to (?:share|announce)\b[\s\S]{0,160}\b(?:completed|graduated|finished)\b|\b(?:successfully )?completed (?:the |a |my )?(?:course|program|fellowship|internship|bootcamp|training|certificate)\b|\bgraduated from\b|\bcongratulations to (?:our|the) (?:graduates|participants|cohort)\b/;
const TECHNICAL_NEWS_PATTERN = /\brelease notes?\b|\bchangelog\b|\bproduct update\b|\bservice update\b|\btechnical news\b|\bresearch news\b|\bnow generally available\b|\bgeneral availability\b|\bnew (?:feature|model|service) release\b/;
const ACTIONABLE_PATTERN = /\bapply now\b|\bapplications? (?:are )?open\b|\bregister now\b|\bregistration (?:is )?open\b|\bregistration deadline\b|\bapplication deadline\b|\bcall for (?:applications|participants)\b|\bhiring\b|\bvacanc(?:y|ies)\b/;

function labelledValues(lines: string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const rawLine of lines) {
    const match = LABEL_PATTERN.exec(rawLine.trim());
    if (!match) continue;
    result.set(normalizeKey(match[1]), cleanText(match[2], 2_000));
  }
  return result;
}

function firstLabel(labels: Map<string, string>, names: string[]): string | null {
  for (const name of names) {
    const value = labels.get(normalizeKey(name));
    if (value) return value;
  }
  return null;
}

export function categoryFromText(
  value: unknown,
  fullSource: unknown = value,
): { category: OpportunityCategory; inferred: boolean } {
  const text = normalizeKey(value);
  const source = normalizeKey(fullSource);
  if (SECURITY_ALERT_PATTERN.test(source)) return { category: "security_alert", inferred: true };
  if (COMPLETION_POST_PATTERN.test(source)) return { category: "completion_post", inferred: true };

  const explicitCategories: Record<string, OpportunityCategory> = {
    job: "job",
    internship: "internship",
    program: "program",
    event: "event",
    course: "course",
    competition: "competition",
    hackathon: "hackathon",
    "technical news": "technical_news",
    "security alert": "security_alert",
    "completion post": "completion_post",
    other: "other",
  };
  if (explicitCategories[text]) return { category: explicitCategories[text], inferred: false };
  if (TECHNICAL_NEWS_PATTERN.test(source) && !ACTIONABLE_PATTERN.test(source)) {
    return { category: "technical_news", inferred: true };
  }
  const searchable = `${text} ${source}`.trim();
  if (/\bintern(?:ship)?\b/.test(searchable)) return { category: "internship", inferred: true };
  if (/\bhackathon\b/.test(searchable)) return { category: "hackathon", inferred: true };
  if (/\bcompetition\b|\bchallenge\b|\bcontest\b/.test(searchable)) {
    return { category: "competition", inferred: true };
  }
  if (/\bcourse\b|\bcertificate\b|\bcertification\b|\bbootcamp\b/.test(searchable)) {
    return { category: "course", inferred: true };
  }
  if (/\bworkshop\b|\bconference\b|\bwebinar\b|\bmeetup\b|\bevent\b|\bdevfest\b/.test(searchable)) {
    return { category: "event", inferred: true };
  }
  if (/\bprogram(?:me)?\b|\bfellowship\b|\baccelerator\b|\bincubator\b|\bmentorship\b|\bresearch placement\b/.test(searchable)) {
    return { category: "program", inferred: true };
  }
  if (/\bjob\b|\brole\b|\bposition\b|\bhiring\b|\bvacanc(?:y|ies)\b/.test(searchable)) {
    return { category: "job", inferred: true };
  }
  return { category: "other", inferred: true };
}

function notesFromVerifiedLabels(labels: Map<string, string>): string | null {
  const lines: string[] = [];
  const ordinaryNotes = firstLabel(labels, ["notes", "note"]);
  if (ordinaryNotes) lines.push(ordinaryNotes);
  for (const [label, names] of [
    ["Listing status", ["listing status", "current listing status"]],
    ["Deadline timezone", ["deadline timezone", "application deadline timezone", "registration deadline timezone"]],
    ["Event end", ["event end", "end date", "ends"]],
    ["Cost", ["cost", "price", "fee"]],
    ["Location", ["location", "venue"]],
    ["Format", ["format", "delivery format"]],
    ["Eligibility", ["eligibility", "eligible applicants"]],
    ["Nationality/residency restrictions", ["nationality restrictions", "residency restrictions", "nationality or residency restrictions"]],
    ["Student/age/experience restrictions", ["student restrictions", "age restrictions", "experience restrictions", "student age or experience restrictions", "student/age/experience restrictions"]],
    ["Access", ["access", "access type"]],
    ["Date checked", ["date checked", "verified on"]],
    ["Discovery source", ["discovery source", "found via"]],
    ["Affiliation value", ["affiliation value", "relationship value"]],
  ] as const) {
    const value = firstLabel(labels, [...names]);
    if (value) lines.push(`${label}: ${value}`);
  }
  return cleanText(lines.join("\n"), 4_000) || null;
}

function fallbackName(lines: string[]): string {
  for (const line of lines) {
    const candidate = cleanText(line.replace(/^[-*•]\s*/, ""), 180);
    if (!candidate || URL_PATTERN.test(candidate) || LABEL_PATTERN.test(candidate)) {
      URL_PATTERN.lastIndex = 0;
      continue;
    }
    URL_PATTERN.lastIndex = 0;
    return candidate;
  }
  return "";
}

function parseLabelledDate(
  labels: Map<string, string>,
  names: string[],
  warnings: string[],
  label: string,
  now: Date,
  defaultTime: string,
): { value: string | null; raw: string | null; precision: "date" | "datetime" | null } {
  const raw = firstLabel(labels, names);
  if (!raw) return { value: null, raw: null, precision: null };
  const value = parseDubaiDate(raw, now, defaultTime);
  if (!value) warnings.push(`${label} was not understood: ${cleanText(raw, 80)}`);
  return { value, raw, precision: value ? datePrecision(raw) : null };
}

export function parseOpportunityText(input: unknown, now = new Date()): OpportunityDraft {
  const sourceText = cleanText(input, 8_000);
  const lines = sourceText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const labels = labelledValues(lines);
  const warnings: string[] = [];

  const explicitName = firstLabel(labels, ["opportunity", "opportunity name", "name", "title"]);
  const name = cleanText(explicitName ?? fallbackName(lines), 180);
  if (!name) warnings.push("Name is missing");

  const organization = firstLabel(labels, ["organization", "organisation", "company", "provider", "host"]);
  const categoryText = firstLabel(labels, ["category", "type"]);
  const category = categoryFromText(categoryText ?? "", sourceText);
  const explicitLink = firstLabel(labels, ["link", "url", "source", "original source", "official link", "registration link"]);
  const foundUrl = explicitLink ?? sourceText.match(URL_PATTERN)?.[0] ?? null;
  const sourceUrl = foundUrl ? canonicalizeUrl(foundUrl) : null;
  if (foundUrl && !sourceUrl) warnings.push("The link was not valid");

  const deadline = parseLabelledDate(
    labels,
    ["deadline", "application deadline", "registration deadline", "register by", "apply by"],
    warnings,
    "Deadline",
    now,
    "23:59",
  );
  const event = parseLabelledDate(
    labels,
    ["event", "event date", "starts", "start date", "when"],
    warnings,
    "Event date",
    now,
    "23:59",
  );
  const reminder = parseLabelledDate(
    labels,
    ["reminder", "reminder date", "remind me"],
    warnings,
    "Reminder",
    now,
    "09:00",
  );
  const nextActionAt = parseLabelledDate(
    labels,
    ["next action date", "follow up date", "interview", "interview date", "preparation date"],
    warnings,
    "Next-action date",
    now,
    "09:00",
  );

  const assignedRaw = [deadline.raw, event.raw, reminder.raw, nextActionAt.raw]
    .filter((value): value is string => Boolean(value))
    .map((value) => normalizeKey(value));
  const unassignedDates = [...new Set(sourceText.match(DATE_TOKEN_PATTERN) ?? [])]
    .filter((candidate) => !assignedRaw.some((assigned) => assigned.includes(normalizeKey(candidate))))
    .slice(0, 5);

  return {
    saveToken: crypto.randomUUID(),
    name,
    organization: organization ? cleanText(organization, 160) : null,
    category: category.category,
    categoryInferred: category.inferred,
    sourceUrl,
    sourceText,
    discoveredOn: dubaiDateString(now),
    status: "saved",
    deadlineAt: deadline.value,
    deadlineRaw: deadline.raw,
    deadlinePrecision: deadline.precision,
    eventAt: event.value,
    eventRaw: event.raw,
    eventPrecision: event.precision,
    nextAction: cleanText(firstLabel(labels, ["next action", "action", "follow up"]), 1_000) || null,
    nextActionAt: nextActionAt.value,
    nextActionAtRaw: nextActionAt.raw,
    nextActionAtPrecision: nextActionAt.precision,
    reminderAt: reminder.value,
    reminderRaw: reminder.raw,
    reminderPrecision: reminder.precision,
    notes: notesFromVerifiedLabels(labels),
    outcome: firstLabel(labels, ["outcome", "result"]),
    unassignedDates,
    warnings,
  };
}

function tokenSimilarity(left: string, right: string): number {
  const a = new Set(normalizeKey(left).split(" ").filter(Boolean));
  const b = new Set(normalizeKey(right).split(" ").filter(Boolean));
  if (a.size === 0 || b.size === 0) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  return intersection / union;
}

export function duplicateScore(draft: OpportunityDraft, row: OpportunityRow): number {
  if (draft.sourceUrl && row.source_url && canonicalizeUrl(draft.sourceUrl) === canonicalizeUrl(row.source_url)) {
    return 1;
  }
  const nameScore = tokenSimilarity(draft.name, row.name);
  const draftOrganization = normalizeKey(draft.organization);
  const rowOrganization = normalizeKey(row.organization);
  const organizationScore = draftOrganization && rowOrganization
    ? (draftOrganization === rowOrganization ? 1 : tokenSimilarity(draftOrganization, rowOrganization))
    : 0;
  if (nameScore === 1 && organizationScore === 1) return 0.98;
  if (nameScore === 1 && (!draftOrganization || !rowOrganization)) return 0.88;
  return nameScore * 0.8 + organizationScore * 0.2;
}
