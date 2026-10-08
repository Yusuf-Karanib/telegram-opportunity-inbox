import type { OpportunityCategory } from "./types.ts";
import { canonicalizeUrl, cleanText, dubaiDateString } from "./utils.ts";

export interface DiscoveryCandidateInput {
  sourceKey: string;
  sourceUrl: string;
  sourceName: string;
  name: string;
  organization: string;
  category: OpportunityCategory;
  sourceText: string;
  deadlineAt: string | null;
  deadlineRaw: string | null;
  deadlinePrecision: "date" | "datetime" | null;
  eventAt: string | null;
  eventRaw: string | null;
  eventPrecision: "date" | "datetime" | null;
  nextAction: string;
  notes: string;
}

interface GdgEventSummary {
  title?: unknown;
  start_date?: unknown;
  event_type_title?: unknown;
  description?: unknown;
  description_short?: unknown;
  url?: unknown;
}

interface GdgEventDetail extends GdgEventSummary {
  id?: unknown;
  chapter_title?: unknown;
  completed?: unknown;
  is_hidden?: unknown;
  end_date_iso?: unknown;
  start_date_iso?: unknown;
  event_timezone?: unknown;
  audience_type?: unknown;
  registration_required?: unknown;
  allow_registration_as_a_guest?: unknown;
  is_virtual_event?: unknown;
  venue_name?: unknown;
  venue_address?: unknown;
  venue_city?: unknown;
  venue_state?: unknown;
  tags?: unknown;
}

const RELEVANT_TECH = /\b(ai|artificial intelligence|machine learning|software|developer|development|cloud|robot(?:ics)?|automation|coding|programming|startup|hackathon|devfest|data|cybersecurity|web|android|flutter|google|technology|technical)\b/i;
const NON_OPPORTUNITY_LISTING = /\b(?:promo(?:tional)?|discount) code\b|\bpromo code guide\b/i;

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nextData(html: string): Record<string, unknown> {
  const opening = '<script id="__NEXT_DATA__" type="application/json">';
  const start = html.indexOf(opening);
  if (start < 0) throw new Error("Official page data was not found");
  const bodyStart = start + opening.length;
  const end = html.indexOf("</script>", bodyStart);
  if (end < 0) throw new Error("Official page data was incomplete");
  const parsed = JSON.parse(html.slice(bodyStart, end)) as Record<string, unknown>;
  const props = objectValue(parsed.props);
  const pageProps = objectValue(props?.pageProps);
  if (!pageProps) throw new Error("Official page data had an unexpected shape");
  return pageProps;
}

function plainText(html: unknown, maximumLength: number): string {
  return cleanText(String(html ?? "")
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'"), maximumLength);
}

function textValue(value: unknown, maximumLength: number): string {
  return typeof value === "string" ? cleanText(value, maximumLength) : "";
}

export function gdgUpcomingEventUrls(html: string): string[] {
  const pageProps = nextData(html);
  const prerender = objectValue(pageProps.prerenderData);
  const upcoming = objectValue(prerender?.upcomingEvents);
  const results = Array.isArray(upcoming?.results) ? upcoming.results : [];
  const urls = results.map((item) => {
    const summary = objectValue(item) as GdgEventSummary | null;
    return canonicalizeUrl(summary?.url);
  }).filter((url): url is string => Boolean(url));
  return [...new Set(urls)].slice(0, 10);
}

export function gdgCandidateFromEventPage(
  html: string,
  sourceName: string,
  checkedAt = new Date(),
): DiscoveryCandidateInput | null {
  const pageProps = nextData(html);
  const event = objectValue(pageProps.eventData) as GdgEventDetail | null;
  if (!event || event.completed === true || event.is_hidden === true) return null;

  const title = textValue(event.title, 180);
  const organization = textValue(event.chapter_title, 160) || sourceName;
  const sourceUrl = canonicalizeUrl(event.url);
  const startValue = textValue(event.start_date_iso, 80) || textValue(event.start_date, 80);
  const start = new Date(startValue);
  if (!title || !sourceUrl || !Number.isFinite(start.getTime()) || start <= checkedAt) return null;

  const description = plainText(event.description || event.description_short, 2_000);
  const tags = Array.isArray(event.tags) ? event.tags.map((tag) => String(tag)).join(" ") : "";
  if (NON_OPPORTUNITY_LISTING.test(`${title} ${description}`)) return null;
  if (!RELEVANT_TECH.test(`${title} ${description} ${tags}`)) return null;

  const category: OpportunityCategory = /\bhackathon\b/i.test(`${title} ${description}`)
    ? "hackathon"
    : /\bcompetition|challenge\b/i.test(`${title} ${description}`)
    ? "competition"
    : "event";
  const registration = textValue(event.event_type_title, 100) ||
    (event.registration_required === true ? "Registration required; cost not stated" : "Not stated");
  const virtual = event.is_virtual_event === true || textValue(event.audience_type, 30) === "VIRTUAL";
  const locationParts = virtual
    ? ["Online"]
    : [event.venue_name, event.venue_address, event.venue_city, event.venue_state]
      .map((value) => textValue(value, 180))
      .filter((value, index, all) => value && all.indexOf(value) === index && value.toLowerCase() !== "tba");
  const location = locationParts.join(", ") || "Venue not announced";
  const access = event.registration_required === true
    ? event.allow_registration_as_a_guest === true
      ? "Registration required; guest registration allowed"
      : "Registration required; guest access not stated"
    : "Registration requirement not stated";
  const end = textValue(event.end_date_iso, 80);
  const checkedDate = dubaiDateString(checkedAt);
  const notes = [
    `Cost: ${registration}`,
    `Location: ${location}`,
    "Eligibility: Not stated on the official event page",
    "Nationality/residency restrictions: Not stated",
    "Student restrictions: Not stated",
    `Access: ${access}`,
    "Listing status: Upcoming on the official organizer page",
    `Date checked: ${checkedDate}`,
    `Discovery source: ${sourceName}`,
    ...(end ? [`Event end: ${end}`] : []),
  ].join("\n");
  const sourceText = [title, organization, description, notes].filter(Boolean).join("\n");
  const id = Number(event.id);

  return {
    sourceKey: Number.isSafeInteger(id) ? `gdg:${id}` : `gdg:${sourceUrl}`,
    sourceUrl,
    sourceName,
    name: title,
    organization,
    category,
    sourceText: cleanText(sourceText, 8_000),
    deadlineAt: null,
    deadlineRaw: null,
    deadlinePrecision: null,
    eventAt: start.toISOString(),
    eventRaw: startValue,
    eventPrecision: "datetime",
    nextAction: "Open the official page and confirm eligibility and availability",
    notes: cleanText(notes, 4_000),
  };
}
