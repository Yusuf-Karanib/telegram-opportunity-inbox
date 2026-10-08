const TRACKING_KEYS = new Set(["fbclid", "gclid", "mc_cid", "mc_eid", "ref", "ref_src"]);

export function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing required secret: ${name}`);
  return value;
}

export function cleanText(value: unknown, maximumLength = 4_000): string {
  const text = String(value ?? "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length <= maximumLength) return text;
  return `${text.slice(0, Math.max(0, maximumLength - 1)).trimEnd()}…`;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function normalizeKey(value: unknown): string {
  return cleanText(value, 500)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/https?:\/\//g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function canonicalizeUrl(value: unknown): string | null {
  const raw = cleanText(value, 2_000).replace(/[),.;!?]+$/, "");
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith("utm_") || TRACKING_KEYS.has(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return null;
  }
}

export function constantTimeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

export function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export function safeError(error: unknown): string {
  return cleanText(error instanceof Error ? error.message : String(error), 500)
    .replace(/\d{6,12}:[A-Za-z0-9_-]{20,}/g, "[telegram-token]")
    .replace(/sb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, "[secret]");
}

function dubaiParts(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dubai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day) };
}

export function dubaiDateString(date = new Date()): string {
  const { year, month, day } = dubaiParts(date);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseClock(
  hourText: string | undefined,
  minuteText: string | undefined,
  meridiem: string | undefined,
  defaultTime: string,
): { hour: number; minute: number } | null {
  const [defaultHour, defaultMinute] = defaultTime.split(":").map(Number);
  let hour = hourText === undefined ? defaultHour : Number(hourText);
  const minute = hourText === undefined
    ? defaultMinute
    : minuteText === undefined
    ? 0
    : Number(minuteText);
  const marker = meridiem?.toLowerCase();
  if (marker) {
    if (hour < 1 || hour > 12) return null;
    if (marker === "pm" && hour !== 12) hour += 12;
    if (marker === "am" && hour === 12) hour = 0;
  }
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 ||
    !Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function makeDubaiIso(
  year: number,
  month: number,
  day: number,
  clock: { hour: number; minute: number },
): string | null {
  const dateOnly = new Date(Date.UTC(year, month - 1, day));
  if (dateOnly.getUTCFullYear() !== year || dateOnly.getUTCMonth() !== month - 1 ||
    dateOnly.getUTCDate() !== day) return null;
  return new Date(Date.UTC(year, month - 1, day, clock.hour - 4, clock.minute)).toISOString();
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

export function parseDubaiDate(
  value: unknown,
  now = new Date(),
  defaultTime = "09:00",
): string | null {
  let text = cleanText(value, 120).toLowerCase().replace(/\s+/g, " ").trim();
  if (!text) return null;
  text = text.replace(/\bat\s+(?=\d)/, "");

  const relative = /^(today|tomorrow)(?:\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?$/.exec(text);
  if (relative) {
    const base = dubaiParts(now);
    const shifted = new Date(Date.UTC(base.year, base.month - 1, base.day + (relative[1] === "tomorrow" ? 1 : 0)));
    const clock = parseClock(relative[2], relative[3], relative[4], defaultTime);
    return clock
      ? makeDubaiIso(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate(), clock)
      : null;
  }

  const isoWithZone = /^\d{4}-\d{2}-\d{2}t\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:z|[+-]\d{2}:?\d{2})$/i;
  if (isoWithZone.test(text)) {
    const milliseconds = Date.parse(text);
    return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
  }

  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ t,]+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?$/.exec(text);
  if (match) {
    const clock = parseClock(match[4], match[5], match[6], defaultTime);
    return clock ? makeDubaiIso(Number(match[1]), Number(match[2]), Number(match[3]), clock) : null;
  }

  match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,]+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?$/.exec(text);
  if (match) {
    const clock = parseClock(match[4], match[5], match[6], defaultTime);
    return clock ? makeDubaiIso(Number(match[3]), Number(match[2]), Number(match[1]), clock) : null;
  }

  match = /^([a-z]+)\s+(\d{1,2})(?:,)?\s+(\d{4})(?:[ ,]+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?$/.exec(text);
  if (match && MONTHS[match[1]]) {
    const clock = parseClock(match[4], match[5], match[6], defaultTime);
    return clock ? makeDubaiIso(Number(match[3]), MONTHS[match[1]], Number(match[2]), clock) : null;
  }

  match = /^(\d{1,2})\s+([a-z]+)\s+(\d{4})(?:[ ,]+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?$/.exec(text);
  if (match && MONTHS[match[2]]) {
    const clock = parseClock(match[4], match[5], match[6], defaultTime);
    return clock ? makeDubaiIso(Number(match[3]), MONTHS[match[2]], Number(match[1]), clock) : null;
  }

  return null;
}

export function datePrecision(value: unknown): "date" | "datetime" {
  const text = cleanText(value, 120).toLowerCase();
  return /(?:t|\s)\d{1,2}:\d{2}|\b\d{1,2}\s*(?:am|pm)\b/.test(text)
    ? "datetime"
    : "date";
}

export function formatDubaiDate(value: string | null | undefined): string {
  if (!value) return "Not set";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Not set";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dubai",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

export function formatDubaiMoment(
  value: string | null | undefined,
  precision: "date" | "datetime" | null | undefined,
): string {
  if (!value) return "Not set";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Not set";
  if (precision === "date") {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Dubai",
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(date);
  }
  return formatDubaiDate(value);
}
