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
  searchLanguage?: "en" | "ar";
  freshness?: "pd" | "pw" | "pm" | "py";
}

export interface DirectListingSource {
  key: string;
  name: string;
  url: string;
  organization: string;
  allowedHosts: string[];
  pathPattern: RegExp;
  anchorTextPattern?: RegExp;
  maximumLinks: number;
}

export interface ChallengeOnApiResponse {
  data?: Array<{
    id?: unknown;
    attributes?: Record<string, unknown>;
    relationships?: Record<string, unknown>;
  }>;
  included?: Array<{
    id?: unknown;
    type?: unknown;
    attributes?: Record<string, unknown>;
  }>;
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

const RELEVANT_TECH = /\b(ai|artificial intelligence|machine learning|computer science|software|developer|development|cloud|robot(?:ics)?|automation|coding|programming|startup|hackathon|devfest|data(?: science)?|cybersecurity|deep tech|digital|innovation|engineering|web|android|flutter|google|technology|technical)\b|الذكاء الاصطناعي|تعلم الآلة|علوم الحاسوب|البرمجيات|البرمجة|الحوسبة السحابية|الروبوتات|الأمن السيبراني|الابتكار|التكنولوجيا|التقنية|الهندسة/i;
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

const OPPORTUNITY_SIGNAL = /\b(?:apply|applications?|registration|register|rsvp|open call|now open|join|sign up|tickets?|internship|apprenticeship|fellowship|accelerator|incubator|mentorship|research program|hackathon|competition|challenge|summit|conference|workshop|meetup|bootcamp|scholarship|grant|residency|summer school|exchange program|career fair|demo day|open day|masterclass|seminar)\b|التسجيل|التقديم|سجّل|قدّم|برنامج|تدريب|زمالة|مسرعة|حاضنة|إرشاد|هاكاثون|مسابقة|تحدي|قمة|مؤتمر|ورشة|منحة/i;
const CLOSED_SIGNAL = /\b(?:applications?|registration|submissions?)\b[^\n.!?]{0,180}\b(?:(?:is|are|have)\s+)?(?:(?:currently|now|temporarily)\s+)?(?:closed|over|ended)\b|\bno longer accepting\b|\bdeadline has passed\b|\bapplications? ended\b|انتهى التسجيل|التسجيل مغلق|انتهى التقديم|إغلاق باب التقديم/i;
const FINISHED_SIGNAL = /\b(?:event has ended|program has ended|successfully concluded|that(?:'s| is) a wrap|we were thrilled to host|highlights from|recap of|completion post)\b/i;
const CANCELLED_SIGNAL = /\b(?:event|program|competition|hackathon)\s+(?:was|is|has been)\s+cancelled\b/i;
const NOT_OPEN_SIGNAL = /\b(?:applications?|registration)\s+(?:will\s+)?open(?:s)?\s+(?:on|soon)\b|\bcoming soon\b/i;
const OPEN_SIGNAL = /\b(?:applications?|registration|submissions?)\s+(?:are\s+|is\s+)?open\b|\bapply now\b|\bapply today\b|\bregister now\b|\bsign up\b|\bstart application\b|\bsubmit your application\b|\bnow accepting\b|\bcurrently accepting applications\b|\bget tickets?\b|\bbuy (?:a )?pass\b|\breserve your spot\b|\brsvp\b|التسجيل مفتوح|فتح باب التسجيل|التقديم مفتوح|فتح باب التقديم|سجّل الآن|قدم الآن/i;
const UAE_ACCESS = /\b(?:uae|united arab emirates|abu dhabi|dubai|sharjah|ajman|fujairah|ras al khaimah|umm al quwain|al ain|dubai internet city|expo city)\b|الإمارات|أبو\s?ظبي|دبي|الشارقة|عجمان|الفجيرة|رأس الخيمة|أم القيوين|العين/i;
const REMOTE_ACCESS = /\b(?:remote|online|virtual|worldwide|global applicants?|open internationally|anywhere in the world)\b/i;
const MEANINGFUL_AFFILIATION = /\b(?:mentor(?:ship|ing)?|cohort|fellowship|research|team|incubator|accelerator|internship|apprenticeship|grant|funding|sponsor(?:ed|ship)?|travel support|community|networking|reference|portfolio|demo day|residency)\b/i;
const COMPLETION_OR_NEWS = /\b(?:cve-\d|security bulletin|vulnerability|patch advisory|has completed|successfully completed|graduated from|celebrating our|congratulations to|product update|release notes)\b/i;
const ARTICLE_TITLE = /\b(?:salary|guide|report|news|roundup|landscape|recap|highlights?|launches|announces|shaping the future)\b/i;
const PRIORITY_ORGANIZATION = /\b(?:42 abu dhabi|mbzuai|mohamed bin zayed university|hub71|dubai future foundation|gdg (?:abu dhabi|dubai|sharjah)|uae robotics and automation society|technology innovation institute|g42|core42|khalifa university|nyu abu dhabi|uae university|american university of sharjah|startad|sheraa|in5|difc innovation hub|microsoft reactor|aws user group)\b/i;
const SCHOOL_ONLY = /\b(?:kindergarten|KG\s*[1-2]|grades?\s*[1-9](?:\s*[-–]\s*1[0-2])?|primary school|secondary school|school students?|young learners?)\b/i;

export function isClearlyClosedOpportunity(value: unknown): boolean {
  return CLOSED_SIGNAL.test(cleanText(value, 12_000));
}
const AGGREGATOR_HOSTS = new Set(["devpost.com", "meetup.com", "eventbrite.com", "f6s.com", "lu.ma", "hackathons.ae", "cyberelites.ae"]);
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
  "tii.ae",
  "g42.ai",
  "core42.ai",
  "ku.ac.ae",
  "nyu.edu",
  "uaeu.ac.ae",
  "aus.edu",
  "startad.ae",
  "sheraa.com",
  "in5.ae",
  "difc.com",
  "microsoft.com",
  "google.com",
  "amazon.jobs",
  "atrc.ae",
  "mbrif.ae",
  "adgm.com",
  "dubaichambers.com",
  "dubaiaifestival.com",
  "globalaishow.com",
  "nasaspaceapps.ae",
  "itu.int",
  "odoo.com",
  "volunteers.ae",
  "regulationinnovation.org",
  "digitransformationsummit.com",
]);

const DATE_FRAGMENT = String.raw`(?:\d{4}-\d{2}-\d{2}(?:[ T]\d{1,2}(?::\d{2})?(?:\s*(?:am|pm))?)?|\d{1,2}[\/-]\d{1,2}[\/-]\d{4}(?:\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?|\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{4}(?:\s+(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?[,]?\s+\d{4}(?:\s+(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?)`;

export function opportunitySearchQueries(checkedAt = new Date()): OpportunitySearchQuery[] {
  const year = checkedAt.getUTCFullYear();
  const years = `(${year} OR ${year + 1})`;
  const topics = `(AI OR "artificial intelligence" OR software OR robotics OR cloud OR cybersecurity OR data OR "deep tech" OR startup)`;
  const uae = `(UAE OR Dubai OR "Abu Dhabi" OR Sharjah OR "Al Ain" OR Ajman OR "Ras Al Khaimah")`;
  return [
    {
      key: "uae-programs-internships",
      query: `${uae} ${topics} (internship OR apprenticeship OR fellowship OR accelerator OR mentorship OR residency OR "student program" OR "applications open") ${years}`,
    },
    {
      key: "uae-events",
      query: `${uae} ${topics} (conference OR summit OR workshop OR meetup OR seminar OR masterclass OR "career fair" OR "demo day" OR "registration open") ${years}`,
    },
    {
      key: "uae-build-challenges",
      query: `${uae} ${topics} (hackathon OR competition OR challenge OR buildathon OR ideathon OR datathon) (apply OR register OR join) ${years}`,
    },
    {
      key: "uae-startup-research",
      query: `${uae} ${topics} (research OR incubator OR grant OR funding OR "open call") ${years}`,
    },
    {
      key: "priority-organizations",
      query: `("42 Abu Dhabi" OR MBZUAI OR Hub71 OR ATRC OR TII OR G42 OR "Dubai Future Foundation" OR MBRIF OR "UAE Space Agency" OR "NASA Space Apps" OR "AI for Good" OR Odoo) (apply OR register OR program OR event OR internship OR challenge) ${years}`,
    },
    {
      key: "linkedin-public-posts",
      query: `site:linkedin.com/posts ${uae} ${topics} (internship OR program OR hackathon OR event OR fellowship OR "open call")`,
      freshness: "pm",
    },
    {
      key: "x-public-posts",
      query: `(site:x.com OR site:twitter.com) ${uae} ${topics} (apply OR register OR internship OR hackathon OR program)`,
      freshness: "pm",
    },
    {
      key: "instagram-public-posts",
      query: `site:instagram.com ${uae} ${topics} (apply OR register OR internship OR hackathon OR program OR event)`,
      freshness: "pm",
    },
    {
      key: "opportunity-platforms",
      query: `(site:devpost.com OR site:meetup.com OR site:eventbrite.com OR site:f6s.com OR site:lu.ma OR site:hackathons.ae OR site:nasaspaceapps.ae OR site:aiforgood.itu.int OR site:challengeon.atrc.ae OR site:dubaiaifestival.com OR site:globalaishow.com OR site:odoo.com OR site:regulationinnovation.org) ${uae} ${topics} (apply OR register OR tickets OR challenge OR event) ${years}`,
    },
    {
      key: "global-accessible",
      query: `${topics} (remote OR worldwide OR "open internationally" OR "sponsored travel") (internship OR fellowship OR hackathon OR program OR "summer school" OR exchange) (apply OR "applications open") ${years}`,
    },
    {
      key: "uae-universities-research",
      query: `(MBZUAI OR "Khalifa University" OR "NYU Abu Dhabi" OR UAEU OR "American University of Sharjah") ${topics} (research OR internship OR fellowship OR lab OR program OR event) (apply OR register OR "open call") ${years}`,
    },
    {
      key: "uae-innovation-hubs",
      query: `(Hub71 OR startAD OR Sheraa OR in5 OR "DIFC Innovation Hub" OR MBRIF OR ADGM OR "Dubai Chambers" OR "Technology Innovation Institute") (accelerator OR incubator OR grant OR challenge OR fellowship OR event OR "open call") ${years}`,
    },
    {
      key: "uae-tech-communities",
      query: `("GDG Dubai" OR "GDG Abu Dhabi" OR "GDG Sharjah" OR "AWS User Group" OR "Microsoft Reactor" OR "IEEE UAE" OR "UAE Robotics") (meetup OR workshop OR conference OR hackathon OR program) ${years}`,
    },
    {
      key: "uae-early-career",
      query: `${uae} ${topics} (internship OR apprenticeship OR placement OR "graduate program" OR "early career" OR trainee OR fellowship) (apply OR "applications open") ${years}`,
    },
    {
      key: "uae-arabic-opportunities",
      query: `(الإمارات OR دبي OR "أبو ظبي" OR الشارقة OR عجمان) ("الذكاء الاصطناعي" OR الروبوتات OR البرمجة OR التقنية OR الابتكار) (التسجيل OR التقديم OR برنامج OR تدريب OR هاكاثون OR مسابقة OR ورشة OR مؤتمر) ${years}`,
      searchLanguage: "ar",
    },
  ];
}

export function opportunitySearchPage(checkedAt = new Date()): 0 | 1 | 2 | 3 {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Dubai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(checkedAt);
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const dubaiHour = value("hour");
  if (dubaiHour < 12) return 0;
  const dayIndex = Math.floor(Date.UTC(value("year"), value("month") - 1, value("day")) / 86_400_000);
  return (1 + ((dayIndex + 2) % 3)) as 1 | 2 | 3;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function htmlAttribute(tag: string, name: string): string {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`\\b${escapedName}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i").exec(tag);
  return match ? decodeHtml(match[2]).trim() : "";
}

function metaValue(html: string, key: string): string {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const name = htmlAttribute(tag, "name") || htmlAttribute(tag, "property");
    if (name.toLowerCase() === key.toLowerCase()) return htmlAttribute(tag, "content");
  }
  return "";
}

function officialPageTitle(html: string): string {
  const metaTitle = metaValue(html, "og:title");
  if (metaTitle) return cleanSearchText(metaTitle, 220);
  const heading = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
  if (heading) return plainText(heading, 220);
  return plainText(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1], 220);
}

function officialPageSchemas(html: string): unknown[] {
  const schemas: unknown[] = [];
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      schemas.push(JSON.parse(decodeHtml(match[1].trim())));
    } catch {
      // A broken analytics schema must not block the rest of the official page.
    }
  }
  return schemas;
}

function officialPageDescription(html: string): string {
  const region = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html)?.[1] ??
    /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(html)?.[1] ??
    /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ?? html;
  const withoutChrome = region
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(?:script|style|svg|noscript|header|footer|nav)\b[^>]*>[\s\S]*?<\/(?:script|style|svg|noscript|header|footer|nav)>/gi, " ")
    .replace(/<\/(?:p|li|h[1-6]|div|section|article|tr)>/gi, "\n")
    .replace(/<br\s*\/?\s*>/gi, "\n");
  const text = plainText(withoutChrome, 30_000);
  const meta = cleanSearchText(metaValue(html, "description") || metaValue(html, "og:description"), 700);
  const blocks = text.split(/\n+/).map((value) => cleanSearchText(value, 900)).filter(Boolean);
  const useful = blocks.filter((value) =>
    OPPORTUNITY_SIGNAL.test(value) || RELEVANT_TECH.test(value) || UAE_ACCESS.test(value) ||
    /\b(?:deadline|eligib|open to|who can apply|cost|fee|free|location|duration|benefit|prize|mentor|funding|AED|USD|January|February|March|April|May|June|July|August|September|October|November|December|2026|2027)\b/i.test(value)
  );
  return cleanSearchText([meta, text.slice(0, 1_200), ...useful.slice(0, 16)].filter(Boolean).join("\n"), 3_700);
}

export function directListingLinks(html: string, source: DirectListingSource): string[] {
  const output = new Set<string>();
  const sourceUrl = new URL(source.url);
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const rawHref = htmlAttribute(match[1], "href");
    const anchorText = plainText(match[2], 500);
    if (!rawHref || (source.anchorTextPattern && !source.anchorTextPattern.test(anchorText))) continue;
    let resolved: URL;
    try {
      resolved = new URL(rawHref, sourceUrl);
    } catch {
      continue;
    }
    if (resolved.protocol !== "https:" || resolved.username || resolved.password) continue;
    const host = resolved.hostname.toLowerCase();
    if (!source.allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) continue;
    if (!source.pathPattern.test(resolved.pathname)) continue;
    const canonical = canonicalizeUrl(resolved.toString());
    if (!canonical || canonical === canonicalizeUrl(source.url)) continue;
    output.add(canonical);
    if (output.size >= source.maximumLinks) break;
  }
  return [...output];
}

export function candidateFromOfficialPageHtml(
  html: string,
  sourceUrl: string,
  sourceKey: string,
  sourceName: string,
  organization: string,
  checkedAt = new Date(),
): DiscoveryCandidateInput | null {
  const title = officialPageTitle(html);
  const description = officialPageDescription(html);
  if (!title || !description) return null;
  const candidate = candidateFromBraveResult({
    title,
    url: sourceUrl,
    description,
    profile: { long_name: organization },
    deep_results: { schemas: officialPageSchemas(html) },
  }, checkedAt);
  if (!candidate) return null;
  candidate.sourceKey = `direct:${sourceKey}:${candidate.sourceUrl}`;
  candidate.sourceName = sourceName;
  candidate.organization = organization;
  candidate.decisionDetails.source_platform = `Official ${sourceName} page`;
  candidate.decisionDetails.official_source_url = candidate.sourceUrl;
  candidate.notes = notesFromDecision(candidate.decisionDetails);
  return candidate;
}

export function aiNexusCandidatesFromPage(
  html: string,
  checkedAt = new Date(),
): DiscoveryCandidateInput[] {
  const candidates: DiscoveryCandidateInput[] = [];
  const seen = new Set<string>();
  const eventPattern = /<div\s+class=["'][^"']*event-deets-grid[^"']*["'][^>]*>\s*<a\b([^>]*)>([\s\S]*?)<\/a>\s*<div[^>]*>([\s\S]*?)<\/div>\s*<div\s+class=["'][^"']*location-cell[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<div[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
  for (const match of html.matchAll(eventPattern)) {
    const anchorAttributes = match[1];
    if (htmlAttribute(anchorAttributes, "data-tab").toLowerCase() !== "upcoming") continue;
    const target = htmlAttribute(anchorAttributes, "data-target");
    const title = plainText(match[2], 180);
    const rawDate = plainText(match[3], 120);
    const location = plainText(match[4], 240);
    const statusText = plainText(match[5], 100);
    if (!target || !title || seen.has(title.toLowerCase()) || !/registration open/i.test(statusText)) continue;
    const eventDate = firstListedDate(rawDate, checkedAt);
    if (!eventDate || new Date(eventDate.at) < checkedAt) continue;
    seen.add(title.toLowerCase());

    const panelStart = html.search(new RegExp(`id=["']${target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`, "i"));
    const panelText = panelStart >= 0 ? plainText(html.slice(panelStart, panelStart + 18_000), 1_800) : "";
    const summary = sentenceWith(panelText, /\b(?:about this event|symposium|workshop|conference|research|security|artificial intelligence|AI)\b/i, 700) ||
      `${title} is an upcoming MBZUAI event in Abu Dhabi.`;
    const sourceUrl = canonicalizeUrl(`https://ai-nexus.mbzuai.ac.ae/?panel=${encodeURIComponent(title)}`)!;
    const details: OpportunityDecisionDetails = {
      summary,
      why_relevant: "Direct access to MBZUAI researchers, technical learning, and credible in-person connections in Abu Dhabi.",
      source_platform: "Official MBZUAI AI Nexus page",
      official_source_url: sourceUrl,
      listing_status: "open",
      evidence_level: "official",
      cost: "Not stated",
      location: location || "MBZUAI, Abu Dhabi, UAE",
      format: "In person",
      eligibility: "Not stated on the event listing",
      restrictions: "Nationality, residency, student, age, and experience restrictions are not stated",
      access: "Public registration appears open",
      commitment: rawDate,
      benefits: ["Research exposure", "Technical learning", "Credible networking"],
      uncertainties: ["Registration deadline is not stated", "Cost is not stated", "Eligibility restrictions are not stated"],
      recommendation: "strong_fit",
      fit_score: 88,
      checked_at: checkedAt.toISOString(),
    };
    const sourceText = [title, rawDate, location, statusText, summary].filter(Boolean).join("\n");
    candidates.push({
      sourceKey: `direct:mbzuai-ai-nexus:${target}`,
      sourceUrl,
      sourceName: "MBZUAI AI Nexus",
      name: title,
      organization: "MBZUAI",
      category: "event",
      sourceText: cleanText(sourceText, 8_000),
      deadlineAt: null,
      deadlineRaw: null,
      deadlinePrecision: null,
      eventAt: eventDate.at,
      eventRaw: rawDate,
      eventPrecision: eventDate.precision,
      nextAction: "Open the official page and register if the event fits your schedule",
      notes: notesFromDecision(details),
      decisionDetails: details,
    });
  }
  return candidates;
}

export function challengeOnCandidatesFromApi(
  payload: ChallengeOnApiResponse,
  checkedAt = new Date(),
): DiscoveryCandidateInput[] {
  const includedNames = new Map<string, string>();
  for (const item of payload.included ?? []) {
    const id = cleanText(item.id, 80);
    const type = cleanText(item.type, 80);
    const name = cleanText(item.attributes?.name, 160);
    if (id && type && name) includedNames.set(`${type}:${id}`, name);
  }

  const output: DiscoveryCandidateInput[] = [];
  for (const item of payload.data ?? []) {
    const attributes = item.attributes ?? {};
    const name = cleanText(attributes.name, 180);
    const slug = cleanText(attributes.slug, 160);
    const summary = cleanText(attributes.summary, 700);
    const organization = cleanText(attributes.client, 160) || "ATRC / ASPIRE";
    const status = cleanText(attributes.status, 80).toLowerCase();
    const deadlineRaw = cleanText(
      attributes.create_or_join_team_allowed_until ?? attributes.current_deadline,
      120,
    );
    const deadline = new Date(deadlineRaw);
    const combined = `${name}\n${summary}\n${organization}`;
    if (!name || !slug || !Number.isFinite(deadline.getTime()) || deadline <= checkedAt) continue;
    if (!/open|progress/.test(status) || SCHOOL_ONLY.test(combined) || !RELEVANT_TECH.test(combined)) continue;

    const communityData = objectValue(item.relationships?.communities)?.data;
    const communityItems = Array.isArray(communityData)
      ? communityData as unknown[]
      : [];
    const communities = communityItems.map((value) => {
      const record = objectValue(value);
      return includedNames.get(`${cleanText(record?.type, 80)}:${cleanText(record?.id, 80)}`) ?? "";
    }).filter(Boolean);
    const awards = cleanText(attributes.awards_catchline, 500);
    const sourceUrl = canonicalizeUrl(`https://challengeon.atrc.ae/en/challenges/${slug}`)!;
    const eligibility = communities.length > 0 ? `Listed for: ${communities.join(", ")}` : "See the official challenge rules";
    const benefits = [
      ...awards.split(",").map((value) => cleanText(value, 100)).filter(Boolean),
      "Practical challenge experience",
    ].slice(0, 5);
    const fitScore = communities.some((value) => /startup|researcher|student|other/i.test(value)) ? 84 : 78;
    const details: OpportunityDecisionDetails = {
      summary,
      why_relevant: "A current UAE technology challenge with a direct official application route and potential industry exposure.",
      source_platform: "Official ChallengeON API",
      official_source_url: sourceUrl,
      listing_status: "open",
      evidence_level: "official",
      cost: "Not stated",
      location: "UAE / check the challenge rules",
      format: "Not stated",
      eligibility,
      restrictions: "Check the full official rules for age, residency, team, and nationality requirements",
      access: "Public application appears open",
      commitment: "See the official challenge timeline",
      benefits,
      uncertainties: ["Cost is not stated", "Full eligibility and team restrictions require checking"],
      recommendation: recommendationFor(fitScore, "official", "open"),
      fit_score: fitScore,
      checked_at: checkedAt.toISOString(),
    };
    const id = cleanText(item.id, 80) || slug;
    output.push({
      sourceKey: `direct:challengeon:${id}`,
      sourceUrl,
      sourceName: "ChallengeON by ATRC",
      name,
      organization,
      category: "competition",
      sourceText: cleanText([name, summary, awards, eligibility, `Deadline: ${deadlineRaw}`].join("\n"), 8_000),
      deadlineAt: deadline.toISOString(),
      deadlineRaw,
      deadlinePrecision: "datetime",
      eventAt: null,
      eventRaw: null,
      eventPrecision: null,
      nextAction: "Open the official challenge, verify all rules, and decide whether to apply",
      notes: notesFromDecision(details),
      decisionDetails: details,
    });
  }
  return output;
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
    .replaceAll("&nbsp;", " ")
    .replaceAll("\u00e2\u0080\u0094", "—")
    .replaceAll("\u00e2\u0080\u0093", "–")
    .replaceAll("\u00e2\u0080\u0099", "'")
    .replaceAll("â", "—")
    .replaceAll("â", "–")
    .replaceAll("â", "'")
    .replaceAll("â", "'")
    .replaceAll("â¦", "…");
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
  if (host === "lu.ma" || host.endsWith(".lu.ma")) return "Luma";
  if (host === "hackathons.ae" || host.endsWith(".hackathons.ae")) return "Hackathons UAE";
  return host.replace(/^www\./, "");
}

function hostMatches(host: string, domains: Set<string>): boolean {
  return [...domains].some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function evidenceLevel(url: URL, organization: string): OpportunityEvidenceLevel {
  const host = url.hostname.toLowerCase();
  if (
    host === "linkedin.com" || host.endsWith(".linkedin.com") ||
    host === "x.com" || host.endsWith(".x.com") ||
    host === "twitter.com" || host.endsWith(".twitter.com") ||
    host === "instagram.com" || host.endsWith(".instagram.com")
  ) return "social_lead";
  if (hostMatches(host, AGGREGATOR_HOSTS)) return "aggregator";
  if (hostMatches(host, KNOWN_OFFICIAL_HOSTS) || host.endsWith(".gov.ae") || host.endsWith(".ac.ae")) return "official";
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
  if (/\bintern(?:ship)?\b|\bgraduate trainee\b|\bapprentice(?:ship)?\b|تدريب عملي|تدريب داخلي/i.test(text)) return "internship";
  if (/\bhackathon\b|\bbuildathon\b|هاكاثون/i.test(text)) return "hackathon";
  if (/\bcompetition\b|\bchallenge\b|\bcontest\b|مسابقة|تحدي/i.test(text)) return "competition";
  if (types.includes("event") || /\bconference\b|\bsummit\b|\bmeetup\b|\bworkshop\b|\btech talk\b|\bnetworking event\b|مؤتمر|قمة|ورشة/i.test(text)) return "event";
  if (/\bcourse\b|\bbootcamp\b|\btraining program\b|دورة|برنامج تدريبي/i.test(text)) return "course";
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
  const match = new RegExp(`(?:${labels})[^\\n.!?]{0,100}?(${DATE_FRAGMENT})`, "i").exec(text) ??
    new RegExp(`(${DATE_FRAGMENT})[^\\n.!?]{0,80}?(?:${labels})`, "i").exec(text);
  if (!match) return null;
  const raw = cleanText(match[1], 120);
  const at = parseDubaiDate(raw, new Date(), defaultTime);
  return at ? { at, raw, precision: datePrecision(raw) } : null;
}

function firstListedDate(
  text: string,
  checkedAt: Date,
): { at: string; raw: string; precision: "date" | "datetime" } | null {
  const possibleDates: string[] = [];
  for (const match of text.matchAll(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})\s*[-–]\s*\d{1,2}(?:st|nd|rd|th)?[,]?\s+(\d{4})\b/gi)) {
    possibleDates.push(`${match[1]} ${match[2]}, ${match[3]}`);
  }
  for (const match of text.matchAll(/\b(\d{1,2})\s*[-–]\s*\d{1,2}\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{4})\b/gi)) {
    possibleDates.push(`${match[1]} ${match[2]} ${match[3]}`);
  }
  for (const match of text.matchAll(new RegExp(DATE_FRAGMENT, "gi"))) possibleDates.push(match[0]);
  for (const possible of possibleDates) {
    const raw = cleanText(possible, 120);
    const at = parseDubaiDate(raw, checkedAt, "23:59");
    if (at) return { at, raw, precision: datePrecision(raw) };
  }
  return null;
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
  const cities = [...text.matchAll(/\b(?:Abu Dhabi|Dubai|Sharjah|Ajman|Fujairah|Ras Al Khaimah|Umm Al Quwain|Al Ain|United Arab Emirates|UAE)\b|الإمارات|أبو\s?ظبي|دبي|الشارقة|عجمان|الفجيرة|رأس الخيمة|أم القيوين|العين/gi)]
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
  const money = /\b(?:cost|fee|price|ticket|pass|registration)\b[^\n.!?]{0,80}?\b(AED|USD|EUR|GBP)\s*([0-9][0-9,.]*)\b/i.exec(text) ??
    /\b(AED|USD|EUR|GBP)\s*([0-9][0-9,.]*)\b[^\n.!?]{0,80}?\b(?:cost|fee|price|ticket|pass|registration)\b/i.exec(text);
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
    .replace(/^(?:home|homepage)\s*[|–—-]\s*/i, "")
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
  const text = resultText(result);
  const primaryText = primaryResultText(result);
  const labelledFactText = cleanSearchText([
    primaryText,
    ...strings(result.extra_snippets).slice(0, 2),
  ].join("\n"), 6_000);
  const schema = firstSchema(result, /event|jobposting|course|educationaloccupationalprogram/);
  const structuredOrganization = schemaOrganization(schema);
  const platform = sourcePlatform(url);
  const evidence = evidenceLevel(url, structuredOrganization);
  if (ARTICLE_TITLE.test(searchTitle) && evidence !== "official") return null;
  if (!text || !primaryText || COMPLETION_OR_NEWS.test(primaryText) || FINISHED_SIGNAL.test(primaryText) || NON_OPPORTUNITY_LISTING.test(primaryText) || SCHOOL_ONLY.test(primaryText)) return null;
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
    (["event", "hackathon", "competition"].includes(category)
      ? firstListedDate(`${searchTitle}\n${primaryText}`, checkedAt)
      : null);
  if (deadline && new Date(deadline.at) < checkedAt) return null;
  if (eventDate && new Date(eventDate.at) < checkedAt) return null;

  const profile = asRecord(result.profile);
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
  if (details.evidence_level === "web_listing") return false;
  if (details.evidence_level === "official" && details.listing_status === "open") return true;
  const deadlineIsFuture = candidate.deadlineAt ? new Date(candidate.deadlineAt) >= checkedAt : false;
  const eventIsFuture = candidate.eventAt ? new Date(candidate.eventAt) >= checkedAt : false;
  if (!deadlineIsFuture && !eventIsFuture) return false;
  if (details.evidence_level === "official") return true;
  if (details.evidence_level === "aggregator") return true;
  return details.evidence_level === "social_lead" && details.fit_score >= 60;
}
