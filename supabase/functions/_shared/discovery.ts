import type {
  OpportunityCategory,
  OpportunityDecisionDetails,
  OpportunityEvidenceLevel,
  OpportunityListingStatus,
} from "./types.ts";
import {
  canonicalizeUrl,
  cleanText,
  datePrecision,
  dubaiDateString,
  parseDubaiDate,
} from "./utils.ts";

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
  decisionDetails: OpportunityDecisionDetails;
}

export interface OpportunitySearchQuery {
  key: string;
  query: string;
}

export interface BraveWebResult {
  title?: unknown;
  url?: unknown;
  description?: unknown;
  page_age?: unknown;
  extra_snippets?: unknown;
  profile?: unknown;
  deep_results?: unknown;
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
  const decisionDetails: OpportunityDecisionDetails = {
    summary: description || `${title} is an upcoming technology community event.`,
    why_relevant: virtual
      ? "Relevant technology learning and community access that is available online."
      : "Relevant in-person UAE technology learning and networking.",
    source_platform: "Official GDG page",
    official_source_url: sourceUrl,
    listing_status: event.registration_required === true && event.allow_registration_as_a_guest === true
      ? "open"
      : "unverified",
    evidence_level: "official",
    cost: registration,
    location,
    format: virtual ? "Online" : "In person",
    eligibility: "Not stated on the official event page",
    restrictions: "Nationality, residency, age, and student restrictions are not stated",
    access,
    commitment: end ? `Runs from ${startValue} to ${end}` : `Starts ${startValue}; end time not stated`,
    benefits: ["Technical learning", "Community networking"],
    uncertainties: [
      "Application or RSVP deadline is not stated",
      ...(registration.toLowerCase().includes("not stated") ? ["Cost is not stated"] : []),
      "Eligibility restrictions are not stated",
    ],
    recommendation: "possible_fit",
    fit_score: 76,
    checked_at: checkedAt.toISOString(),
  };

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
    decisionDetails,
  };
}

const OPPORTUNITY_SIGNAL = /\b(?:apply|applications?|registration|register|rsvp|open call|now open|join|internship|apprenticeship|fellowship|accelerator|incubator|mentorship|research program|hackathon|competition|challenge|summit|conference|workshop|meetup|bootcamp|scholarship|grant)\b/i;
const CLOSED_SIGNAL = /\b(?:applications?|registration|submissions?)\s+(?:are\s+)?closed\b|\bno longer accepting\b|\bdeadline has passed\b|\bapplications? ended\b/i;
const FINISHED_SIGNAL = /\b(?:event has ended|program has ended|successfully concluded|that(?:'s| is) a wrap|we were thrilled to host|highlights from|recap of|completion post)\b/i;
const CANCELLED_SIGNAL = /\b(?:event|program|competition|hackathon)\s+(?:was|is|has been)\s+cancelled\b/i;
const NOT_OPEN_SIGNAL = /\b(?:applications?|registration)\s+(?:will\s+)?open(?:s)?\s+(?:on|soon)\b|\bcoming soon\b/i;
const OPEN_SIGNAL = /\b(?:applications?|registration|submissions?)\s+(?:are\s+|is\s+)?open\b|\bapply now\b|\bregister now\b|\bnow accepting\b|\brsvp\b/i;
const UAE_ACCESS = /\b(?:uae|united arab emirates|abu dhabi|dubai|sharjah|ajman|fujairah|ras al khaimah|umm al quwain|al ain)\b/i;
const REMOTE_ACCESS = /\b(?:remote|online|virtual|worldwide|global applicants?|open internationally|anywhere in the world)\b/i;
const MEANINGFUL_AFFILIATION = /\b(?:mentor(?:ship|ing)?|cohort|fellowship|research|team|incubator|accelerator|internship|apprenticeship|grant|funding|sponsor(?:ed|ship)?|travel support|community|networking|reference|portfolio|demo day|residency)\b/i;
const COMPLETION_OR_NEWS = /\b(?:cve-\d|security bulletin|vulnerability|patch advisory|has completed|successfully completed|graduated from|celebrating our|congratulations to|product update|release notes)\b/i;
const ARTICLE_TITLE = /\b(?:salary|guide|report|news|roundup|landscape|recap|highlights?|launches|announces|shaping the future)\b/i;
const PRIORITY_ORGANIZATION = /\b(?:42 abu dhabi|mbzuai|mohamed bin zayed university|hub71|dubai future foundation|gdg (?:abu dhabi|dubai|sharjah)|uae robotics and automation society|technology innovation institute|khalifa university|nyu abu dhabi|american university of sharjah)\b/i;
const AGGREGATOR_HOSTS = new Set(["devpost.com", "www.devpost.com", "meetup.com", "www.meetup.com", "eventbrite.com", "www.eventbrite.com", "f6s.com", "www.f6s.com"]);
const KNOWN_OFFICIAL_HOSTS = new Set([
  "42abudhabi.ae",
  "mbzuai.ac.ae",
  "ai-nexus.mbzuai.ac.ae",
  "hub71.com",
  "www.dubaifuture.ae",
  "dubaifuture.ae",
  "gdg.community.dev",
  "amazon.com",
  "gitex.com",
  "aieverythingglobal.com",
  "stevensinitiative.org",
]);

const DATE_FRAGMENT = String.raw`(?:\d{4}-\d{2}-\d{2}(?:[ T]\d{1,2}(?::\d{2})?(?:\s*(?:am|pm))?)?|\d{1,2}[\/-]\d{1,2}[\/-]\d{4}(?:\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?|\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{4}(?:\s+(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?[,]?\s+\d{4}(?:\s+(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?)`;

export function opportunitySearchQueries(checkedAt = new Date()): OpportunitySearchQuery[] {
  const year = checkedAt.getUTCFullYear();
  const years = `(${year} OR ${year + 1})`;
  const topics = `(AI OR "artificial intelligence" OR software OR robotics OR cloud OR startup)`;
  const uae = `(UAE OR Dubai OR "Abu Dhabi" OR Sharjah)`;
  return [
    {
      key: "uae-programs-internships",
      query: `${uae} ${topics} (internship OR fellowship OR accelerator OR mentorship OR "applications open") ${years}`,
    },
    {
      key: "uae-events",
      query: `${uae} ${topics} (conference OR summit OR workshop OR meetup OR "registration open") ${years}`,
    },
    {
      key: "uae-build-challenges",
      query: `${uae} ${topics} (hackathon OR competition OR challenge OR buildathon) (apply OR register) ${years}`,
    },
    {
      key: "uae-startup-research",
      query: `${uae} ${topics} (research OR incubator OR grant OR funding OR "open call") ${years}`,
    },
    {
      key: "priority-organizations",
      query: `("42 Abu Dhabi" OR MBZUAI OR Hub71 OR "Dubai Future Foundation" OR "UAE Robotics") (apply OR register OR program OR event OR internship) ${years}`,
    },
    {
      key: "linkedin-public-posts",
      query: `site:linkedin.com/posts ${uae} ${topics} (internship OR program OR hackathon OR event OR fellowship OR "open call")`,
    },
    {
      key: "x-public-posts",
      query: `(site:x.com OR site:twitter.com) ${uae} ${topics} (apply OR register OR internship OR hackathon OR program)`,
    },
    {
      key: "instagram-public-posts",
      query: `site:instagram.com ${uae} ${topics} (apply OR register OR internship OR hackathon OR program OR event)`,
    },
    {
      key: "opportunity-platforms",
      query: `(site:devpost.com OR site:meetup.com OR site:eventbrite.com OR site:f6s.com) ${uae} ${topics} ${years}`,
    },
    {
      key: "global-accessible",
      query: `${topics} (remote OR worldwide OR "open internationally" OR "sponsored travel") (internship OR fellowship OR hackathon OR program) (apply OR "applications open") ${years}`,
    },
  ];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function strings(value: unknown): string[] {
  if (typeof value === "string" || typeof value === "number") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(strings);
  return [];
}

function flattenRecords(value: unknown, maximum = 250): Record<string, unknown>[] {
  const output: Record<string, unknown>[] = [];
  const queue: unknown[] = [value];
  while (queue.length > 0 && output.length < maximum) {
    const current = queue.shift();
    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }
    const record = asRecord(current);
    if (!record) continue;
    output.push(record);
    queue.push(...Object.values(record));
  }
  return output;
}

function schemaRecords(result: BraveWebResult): Record<string, unknown>[] {
  const deep = asRecord(result.deep_results);
  return flattenRecords(deep?.schemas ?? []);
}

function schemaTypes(record: Record<string, unknown>): string {
  return strings(record["@type"] ?? record.type).join(" ").toLowerCase();
}

function firstSchema(result: BraveWebResult, pattern: RegExp): Record<string, unknown> | null {
  return schemaRecords(result).find((record) => pattern.test(schemaTypes(record))) ?? null;
}

function namedValue(value: unknown): string {
  const direct = strings(value).find(Boolean);
  if (direct) return cleanText(direct, 300);
  const record = asRecord(value);
  return cleanText(record?.name ?? record?.legalName ?? record?.title, 300);
}

function resultText(result: BraveWebResult): string {
  const deep = asRecord(result.deep_results);
  const schemas = deep?.schemas ? JSON.stringify(deep.schemas) : "";
  return cleanSearchText([
    result.title,
    result.description,
    ...strings(result.extra_snippets),
    schemas,
  ].filter(Boolean).join("\n"), 12_000);
}

function cleanSearchText(value: unknown, maximumLength: number): string {
  return cleanText(value, maximumLength)
    .replaceAll("&#x27;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&")
    .replaceAll("&nbsp;", " ");
}

function primaryResultText(result: BraveWebResult): string {
  return cleanSearchText([result.title, result.description].filter(Boolean).join("\n"), 4_000);
}

function sourcePlatform(url: URL): string {
  const host = url.hostname.toLowerCase();
  if (host === "linkedin.com" || host.endsWith(".linkedin.com")) return "LinkedIn";
  if (host === "x.com" || host.endsWith(".x.com") || host === "twitter.com" || host.endsWith(".twitter.com")) return "X";
  if (host === "instagram.com" || host.endsWith(".instagram.com")) return "Instagram";
  if (host.endsWith("devpost.com")) return "Devpost";
  if (host.endsWith("meetup.com")) return "Meetup";
  if (host.endsWith("eventbrite.com")) return "Eventbrite";
  if (host.endsWith("f6s.com")) return "F6S";
  return host.replace(/^www\./, "");
}

function evidenceLevel(url: URL, organization: string): OpportunityEvidenceLevel {
  const host = url.hostname.toLowerCase();
  if (
    host === "linkedin.com" || host.endsWith(".linkedin.com") ||
    host === "x.com" || host.endsWith(".x.com") ||
    host === "twitter.com" || host.endsWith(".twitter.com") ||
    host === "instagram.com" || host.endsWith(".instagram.com")
  ) return "social_lead";
  if (AGGREGATOR_HOSTS.has(host)) return "aggregator";
  if ([...KNOWN_OFFICIAL_HOSTS].some((domain) => host === domain || host.endsWith(`.${domain}`))) return "official";
  if (!organization) return "web_listing";
  const hostWords = host.replace(/^www\./, "").split(/[.\-_]/).filter((word) => word.length >= 4);
  const organizationWords = organization.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4);
  return organizationWords.some((word) => hostWords.includes(word)) ? "official" : "web_listing";
}

function listingStatus(text: string): OpportunityListingStatus {
  if (CANCELLED_SIGNAL.test(text)) return "cancelled";
  if (CLOSED_SIGNAL.test(text)) return "closed";
  if (FINISHED_SIGNAL.test(text)) return "finished";
  if (NOT_OPEN_SIGNAL.test(text)) return "not_open_yet";
  if (OPEN_SIGNAL.test(text)) return "open";
  return "unverified";
}

function inferCategory(text: string, schema: Record<string, unknown> | null): OpportunityCategory {
  const types = schema ? schemaTypes(schema) : "";
  if (/\bintern(?:ship)?\b|\bgraduate trainee\b|\bapprentice(?:ship)?\b/i.test(text)) return "internship";
  if (/\bhackathon\b|\bbuildathon\b/i.test(text)) return "hackathon";
  if (/\bcompetition\b|\bchallenge\b|\bcontest\b/i.test(text)) return "competition";
  if (types.includes("event") || /\bconference\b|\bsummit\b|\bmeetup\b|\bworkshop\b|\btech talk\b|\bnetworking event\b/i.test(text)) return "event";
  if (/\bcourse\b|\bbootcamp\b|\btraining program\b/i.test(text)) return "course";
  if (types.includes("jobposting") || /\bjob opening\b|\bjunior (?:developer|engineer)\b/i.test(text)) return "job";
  return "program";
}

function parseKnownDate(value: unknown): { at: string; raw: string; precision: "date" | "datetime" } | null {
  const raw = cleanText(strings(value)[0], 120);
  if (!raw) return null;
  const parsed = parseDubaiDate(raw, new Date(), "23:59");
  if (parsed) return { at: parsed, raw, precision: datePrecision(raw) };
  const direct = new Date(raw);
  if (!Number.isFinite(direct.getTime())) return null;
  return { at: direct.toISOString(), raw, precision: /[T ]\d{1,2}:\d{2}/.test(raw) ? "datetime" : "date" };
}

function labelledDate(
  text: string,
  labels: string,
  defaultTime: string,
): { at: string; raw: string; precision: "date" | "datetime" } | null {
  const match = new RegExp(`(?:${labels})[^\\n.!?]{0,100}?(${DATE_FRAGMENT})`, "i").exec(text);
  if (!match) return null;
  const raw = cleanText(match[1], 120);
  const at = parseDubaiDate(raw, new Date(), defaultTime);
  return at ? { at, raw, precision: datePrecision(raw) } : null;
}

function firstDateInTitle(title: string): { at: string; raw: string; precision: "date" | "datetime" } | null {
  const range = /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})\s*[-–]\s*\d{1,2}(?:st|nd|rd|th)?[,]?\s+(\d{4})\b/i.exec(title);
  const match = range
    ? `${range[1]} ${range[2]}, ${range[3]}`
    : new RegExp(DATE_FRAGMENT, "i").exec(title)?.[0];
  if (!match) return null;
  const raw = cleanText(match, 120);
  const at = parseDubaiDate(raw, new Date(), "23:59");
  return at ? { at, raw, precision: datePrecision(raw) } : null;
}

function schemaOrganization(schema: Record<string, unknown> | null): string {
  if (!schema) return "";
  for (const key of ["organizer", "hiringOrganization", "provider", "sponsor"]) {
    const value = namedValue(schema[key]);
    if (value) return value;
  }
  return "";
}

function schemaLocation(schema: Record<string, unknown> | null): string {
  if (!schema) return "";
  const location = schema.location ?? schema.jobLocation ?? schema.applicantLocationRequirements;
  const records = flattenRecords(location, 30);
  const parts = records.flatMap((record) => [
    namedValue(record.name),
    namedValue(record.streetAddress),
    namedValue(record.addressLocality),
    namedValue(record.addressRegion),
    namedValue(record.addressCountry),
  ]).filter(Boolean);
  return cleanText([...new Set(parts)].join(", "), 300);
}

function textLocation(text: string): string {
  const cities = [...text.matchAll(/\b(?:Abu Dhabi|Dubai|Sharjah|Ajman|Fujairah|Ras Al Khaimah|Umm Al Quwain|Al Ain|United Arab Emirates|UAE)\b/gi)]
    .map((match) => match[0]);
  if (cities.length > 0) return [...new Set(cities.map((city) => city.replace(/^uae$/i, "UAE")))].slice(0, 3).join(", ");
  if (REMOTE_ACCESS.test(text)) return "Online / accessible from the UAE";
  return "Not stated";
}

function eventFormat(text: string, schema: Record<string, unknown> | null): string {
  const attendance = cleanText(schema?.eventAttendanceMode, 100);
  if (/mixed|hybrid/i.test(`${attendance} ${text}`)) return "Hybrid";
  if (/online|virtual|remote/i.test(`${attendance} ${text}`)) return "Online";
  if (/offline|in.?person|venue/i.test(`${attendance} ${text}`)) return "In person";
  return "Not stated";
}

function costValue(text: string, schema: Record<string, unknown> | null): string {
  const offers = flattenRecords(schema?.offers, 20);
  for (const offer of offers) {
    const price = cleanText(offer.price ?? offer.lowPrice, 50);
    const currency = cleanText(offer.priceCurrency, 12).toUpperCase();
    if (price) return Number(price) === 0 ? "Free" : `${currency || "Price"} ${price}`;
  }
  const money = /\b(AED|USD|EUR|GBP)\s*([0-9][0-9,.]*)\b/i.exec(text);
  if (money) return `${money[1].toUpperCase()} ${money[2]}`;
  if (/\bfree (?:entry|admission|registration|event|program|workshop|course)\b|\bno (?:fee|cost)\b/i.test(text)) return "Free";
  return "Not stated";
}

function sentenceWith(text: string, pattern: RegExp, maximumLength = 350): string {
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).map((value) => cleanText(value, maximumLength));
  return sentences.find((value) => pattern.test(value)) ?? "";
}

function benefitsFrom(text: string, category: OpportunityCategory): string[] {
  const benefits: string[] = [];
  if (/\bmentor(?:ship|ing|s)?\b/i.test(text)) benefits.push("Mentorship");
  if (/\bteam|collaborat|build|project\b/i.test(text)) benefits.push("Team or project experience");
  if (/\bresearch|lab\b/i.test(text)) benefits.push("Research exposure");
  if (/\baccelerator|incubator|funding|grant|demo day\b/i.test(text)) benefits.push("Startup support or funding");
  if (/\bsponsor(?:ed|ship)? travel|travel support|flights?|accommodation\b/i.test(text)) benefits.push("Possible travel support");
  if (/\bnetwork(?:ing)?|community|meet (?:leaders|founders|engineers)\b/i.test(text)) benefits.push("Credible networking");
  if (/\bstipend|paid|salary\b/i.test(text)) benefits.push("Possible financial support");
  if (category === "internship") benefits.push("Practical work experience");
  if (["hackathon", "competition"].includes(category)) benefits.push("Portfolio and competition experience");
  if (category === "event") benefits.push("Technical learning");
  return [...new Set(benefits)].slice(0, 5);
}

function recommendationFor(
  score: number,
  evidence: OpportunityEvidenceLevel,
  status: OpportunityListingStatus,
): "strong_fit" | "possible_fit" | "investigate" {
  if (score >= 80 && evidence === "official" && status === "open") return "strong_fit";
  if (score >= 62 && !["social_lead", "web_listing"].includes(evidence) && !["closed", "finished", "cancelled"].includes(status)) {
    return "possible_fit";
  }
  return "investigate";
}

function cleanSearchTitle(value: unknown): string {
  return cleanSearchText(value, 220)
    .replace(/^home\s*[|–—-]\s*/i, "")
    .replace(/\s*[|–—-]\s*(?:LinkedIn|Instagram|X|Twitter|Eventbrite|Meetup|Devpost)\s*$/i, "")
    .trim();
}

function notesFromDecision(details: OpportunityDecisionDetails): string {
  return cleanText([
    `Summary: ${details.summary}`,
    `Why relevant: ${details.why_relevant}`,
    `Listing status: ${details.listing_status}`,
    `Cost: ${details.cost}`,
    `Location: ${details.location}`,
    `Format: ${details.format}`,
    `Eligibility: ${details.eligibility}`,
    `Restrictions: ${details.restrictions}`,
    `Access: ${details.access}`,
    `Commitment: ${details.commitment}`,
    `Potential value: ${details.benefits.join(", ") || "Not stated"}`,
    `Evidence: ${details.evidence_level}`,
    `Recommendation: ${details.recommendation} (${details.fit_score}/100)`,
    `Uncertainties: ${details.uncertainties.join("; ") || "None found"}`,
    `Date checked: ${dubaiDateString(new Date(details.checked_at))}`,
  ].join("\n"), 4_000);
}

export function candidateFromBraveResult(
  result: BraveWebResult,
  checkedAt = new Date(),
): DiscoveryCandidateInput | null {
  const sourceUrl = canonicalizeUrl(result.url);
  if (!sourceUrl) return null;
  const url = new URL(sourceUrl);
  if (url.protocol !== "https:" || url.username || url.password) return null;

  const searchTitle = cleanSearchTitle(result.title);
  if (ARTICLE_TITLE.test(searchTitle)) return null;
  const text = resultText(result);
  const primaryText = primaryResultText(result);
  const labelledFactText = cleanSearchText([
    primaryText,
    ...strings(result.extra_snippets).slice(0, 2),
  ].join("\n"), 6_000);
  if (!text || !primaryText || COMPLETION_OR_NEWS.test(primaryText) || FINISHED_SIGNAL.test(primaryText) || NON_OPPORTUNITY_LISTING.test(primaryText)) return null;
  const schema = firstSchema(result, /event|jobposting|course|educationaloccupationalprogram/);
  if (!schema && (!OPPORTUNITY_SIGNAL.test(primaryText) || !RELEVANT_TECH.test(primaryText))) return null;
  if (!UAE_ACCESS.test(primaryText) && !REMOTE_ACCESS.test(primaryText) && !PRIORITY_ORGANIZATION.test(primaryText)) return null;

  const status = listingStatus(primaryText);
  if (["closed", "finished", "cancelled"].includes(status)) return null;
  const category = inferCategory(primaryText, schema);
  const name = cleanSearchText(schema?.name ?? schema?.title, 180) || searchTitle;
  if (!name) return null;

  const deadline = parseKnownDate(schema?.applicationDeadline ?? schema?.validThrough) ??
    labelledDate(labelledFactText, "deadline|apply by|applications? close|submissions? close|closing date|valid through", "23:59");
  const eventDate = parseKnownDate(schema?.startDate) ??
    labelledDate(primaryText, "event date|starts?|date", "23:59") ??
    (category === "event" ? firstDateInTitle(searchTitle) : null);
  if (deadline && new Date(deadline.at) < checkedAt) return null;
  if (eventDate && new Date(eventDate.at) < checkedAt) return null;

  const profile = asRecord(result.profile);
  const structuredOrganization = schemaOrganization(schema);
  const platform = sourcePlatform(url);
  const evidence = evidenceLevel(url, structuredOrganization);
  const organization = cleanSearchText(
    structuredOrganization || (evidence === "official" ? profile?.long_name || profile?.name : ""),
    160,
  );
  const summary = cleanSearchText(result.description || strings(result.extra_snippets)[0], 700) ||
    "The search result did not provide a usable description.";
  const benefits = benefitsFrom(primaryText, category);
  const location = schemaLocation(schema) || textLocation(primaryText);
  const eligibility = sentenceWith(labelledFactText, /\b(?:eligib\w*|who can apply|open to|applicants? must|participants? must)\b/i) || "Not stated";
  const restrictions = sentenceWith(
    `${primaryText}\n${eligibility === "Not stated" ? "" : eligibility}`,
    /\b(?:nationality|citizens?|residents?|residency|students?|graduates?|age|years? old|experience required)\b/i,
  ) || "Not stated";
  const commitment = sentenceWith(primaryText, /\b(?:weeks?|months?|hours? per week|full.?time|part.?time|duration|runs? from)\b/i) || "Not stated";
  const access = /\binvite.?only\b/i.test(text)
    ? "Invite only"
    : /\breferral required\b/i.test(text)
    ? "Referral required"
    : eligibility !== "Not stated"
    ? "Eligibility gated"
    : status === "open"
    ? "Public application or registration appears open"
    : "Unclear";
  const cost = costValue(primaryText, schema);
  const themes = [
    /\bartificial intelligence|\bai\b|machine learning/i.test(primaryText) ? "applied AI" : "",
    /\brobot(?:ics)?|automation\b/i.test(primaryText) ? "robotics or automation" : "",
    /\bsoftware|developer|coding|programming\b/i.test(primaryText) ? "software" : "",
    /\bcloud|aws|azure|google cloud\b/i.test(primaryText) ? "cloud" : "",
    /\bstartup|founder|entrepreneur\b/i.test(primaryText) ? "startups" : "",
  ].filter(Boolean);
  const whyRelevant = themes.length > 0
    ? `Matches Yusuf's ${themes.slice(0, 3).join(", ")} direction${benefits.length ? ` and may provide ${benefits.slice(0, 2).join(" and ").toLowerCase()}` : ""}.`
    : "Potentially useful UAE-accessible technical affiliation; the exact fit needs checking.";

  let fitScore = 42;
  if (RELEVANT_TECH.test(primaryText)) fitScore += 12;
  if (UAE_ACCESS.test(primaryText) || REMOTE_ACCESS.test(primaryText)) fitScore += 10;
  if (MEANINGFUL_AFFILIATION.test(primaryText)) fitScore += 14;
  if (PRIORITY_ORGANIZATION.test(primaryText)) fitScore += 10;
  if (status === "open") fitScore += 6;
  if (evidence === "official") fitScore += 6;
  if (evidence === "social_lead") fitScore -= 8;
  if (status === "unverified") fitScore -= 4;
  fitScore = Math.max(0, Math.min(100, fitScore));

  const uncertainties = [
    ...(status === "unverified" ? ["Current application or registration status is not confirmed"] : []),
    ...(!deadline ? ["Exact deadline is not stated"] : []),
    ...(cost === "Not stated" ? ["Cost is not stated"] : []),
    ...(eligibility === "Not stated" ? ["Eligibility is not stated"] : []),
    ...(restrictions === "Not stated" ? ["Nationality, residency, student, age, or experience restrictions are not stated"] : []),
    ...(["social_lead", "web_listing"].includes(evidence) ? ["An official application or registration page was not confirmed from this result"] : []),
  ];
  const recommendation = recommendationFor(fitScore, evidence, status);
  const checkedIso = checkedAt.toISOString();
  const decisionDetails: OpportunityDecisionDetails = {
    summary,
    why_relevant: whyRelevant,
    source_platform: platform,
    official_source_url: evidence === "official" ? sourceUrl : null,
    listing_status: status,
    evidence_level: evidence,
    cost,
    location,
    format: eventFormat(text, schema),
    eligibility,
    restrictions,
    access,
    commitment,
    benefits,
    uncertainties,
    recommendation,
    fit_score: fitScore,
    checked_at: checkedIso,
  };
  const nextAction = ["social_lead", "web_listing"].includes(evidence)
    ? "Find and verify the official application or registration page before acting"
    : status === "open"
    ? "Open the official page and decide whether to apply or register"
    : "Open the source and confirm that applications or registration are currently open";

  return {
    sourceKey: `brave:${sourceUrl}`,
    sourceUrl,
    sourceName: `Brave Search · ${platform}`,
    name,
    organization: organization || "Not stated",
    category,
    sourceText: cleanText(text, 8_000),
    deadlineAt: deadline?.at ?? null,
    deadlineRaw: deadline?.raw ?? null,
    deadlinePrecision: deadline?.precision ?? null,
    eventAt: eventDate?.at ?? null,
    eventRaw: eventDate?.raw ?? null,
    eventPrecision: eventDate?.precision ?? null,
    nextAction,
    notes: notesFromDecision(decisionDetails),
    decisionDetails,
  };
}

export function shouldNotifyDiscoveryCandidate(
  candidate: DiscoveryCandidateInput,
  checkedAt = new Date(),
): boolean {
  const details = candidate.decisionDetails;
  if (["closed", "finished", "cancelled", "not_open_yet"].includes(details.listing_status)) return false;
  if (/invite only|referral required/i.test(details.access)) return false;
  const deadlineIsFuture = candidate.deadlineAt ? new Date(candidate.deadlineAt) >= checkedAt : false;
  const eventIsFuture = candidate.eventAt ? new Date(candidate.eventAt) >= checkedAt : false;
  if (!deadlineIsFuture && !eventIsFuture) return false;
  if (details.evidence_level === "web_listing") return false;
  if (details.evidence_level === "official") return true;
  return details.listing_status === "open";
}
