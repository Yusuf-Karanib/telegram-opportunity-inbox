import { Parser } from "htmlparser2";

export interface OpportunityPage {
  title: string;
  summary: string;
  text: string;
  schemas: unknown[];
  links: Array<{ url: string; text: string }>;
}

const compact = (value: unknown): string => String(value ?? "").replace(/\s+/g, " ").trim();
const CHROME =
  /^(?:login|log in|sign in|sign up|home|homepage|menu|search|contact us|services|let.s chat|whatsapp|عربي|english|register|about the (?:event|workshop)|share|back|read more)$/i;
const CHROME_SENTENCE =
  /clear (?:your |the )?(?:browser )?cache|browsing data|privacy tab|manage website data|accept all cookies|cookie preferences|subscribe to (?:our|the) newsletter|seems you are facing an issue accessing our website/i;
const SKIP_TAGS = new Set(["script", "style", "svg", "noscript", "template", "iframe", "nav", "aside", "footer"]);
const BLOCK_TAGS = new Set(["p", "li", "h1", "h2", "h3", "h4", "div", "section", "article", "tr", "br"]);

interface Region {
  priority: number;
  active: boolean;
  parts: string[];
  size: number;
}
interface Frame {
  tag: string;
  skip: boolean;
  text: string;
  href?: string;
  json?: boolean;
  region?: Region;
  box?: { starts: Array<{ region: Region; offset: number; size: number }>; discard: boolean };
}

/** A streaming HTML reader: no scripts, DOM tree, selector engine or browser. */
export function extractOpportunityPage(html: string, sourceUrl: string, panelId?: string): OpportunityPage {
  const meta = new Map<string, string>();
  const schemas: unknown[] = [];
  const links: OpportunityPage["links"] = [];
  const regions: Region[] = [];
  const stack: Frame[] = [];
  const headings: string[] = [];
  let documentTitle = "";
  const isHub71 = new URL(sourceUrl).hostname.replace(/^www\./, "") === "hub71.com";
  const append = (text: string): void => {
    for (const region of regions) {
      if (region.active && region.size < 32_000) {
        const part = text.slice(0, 32_000 - region.size);
        region.parts.push(part);
        region.size += part.length;
      }
    }
  };
  const parser = new Parser({
    onopentag(tag, attributes) {
      const parent = stack.at(-1);
      const label = `${attributes.id ?? ""} ${attributes.class ?? ""}`;
      const selectedPanel = Boolean(panelId && attributes.id === panelId);
      const chrome = !["body", "html"].includes(tag) &&
        /(?:^|[\s_-])(?:cookie|modal|popup|newsletter|mega-menu|related-events|related-posts|upcoming-events|site-footer|site-header)(?:[\s_-]|$)/i
          .test(label);
      const skip = !selectedPanel && (parent?.skip === true || SKIP_TAGS.has(tag) || chrome ||
        Object.hasOwn(attributes, "hidden") || attributes["aria-hidden"] === "true" ||
        /^(?:navigation|dialog|banner|contentinfo)$/.test(attributes.role ?? "") ||
        /display\s*:\s*none|visibility\s*:\s*hidden/i.test(attributes.style ?? "") ||
        (tag === "header" && !regions.some((region) => region.active && region.priority >= 2)));
      const frame: Frame = { tag, skip, text: "" };
      if (tag === "meta") {
        meta.set((attributes.name ?? attributes.property ?? "").toLowerCase(), compact(attributes.content));
      }
      if (tag === "script" && attributes.type?.toLowerCase() === "application/ld+json") frame.json = true;
      if (!skip) {
        const priority = selectedPanel
          ? 4
          : tag === "main" || attributes.role === "main"
          ? 3
          : tag === "article"
          ? 2
          : tag === "body"
          ? 1
          : 0;
        if (priority && (!panelId || selectedPanel)) {
          frame.region = { priority, active: true, parts: [], size: 0 };
          regions.push(frame.region);
        }
        if (tag === "a" && attributes.href) frame.href = attributes.href;
        if (isHub71 && /(?:^|\s)box(?:\s|$)/.test(attributes.class ?? "")) {
          frame.box = {
            starts: regions.filter((region) => region.active)
              .map((region) => ({ region, offset: region.parts.length, size: region.size })),
            discard: false,
          };
        }
        if (isHub71 && /(?:^|\s)links-container(?:\s|$)/.test(attributes.class ?? "")) {
          const box = [...stack].reverse().find((ancestor) => ancestor.box)?.box;
          if (box) box.discard = true;
        }
      }
      stack.push(frame);
      if (tag === "br" && !skip) append("\n");
    },
    ontext(text) {
      const frame = stack.at(-1);
      if (!frame) return;
      if (frame.json) {
        if (frame.text.length < 150_000) frame.text += text;
        return;
      }
      if (frame.skip) return;
      append(text);
      for (const ancestor of stack) {
        if (["h1", "title", "a"].includes(ancestor.tag) && ancestor.text.length < 1_000) ancestor.text += text;
      }
    },
    onclosetag() {
      const frame = stack.pop();
      if (!frame) return;
      if (frame.json) {
        try {
          schemas.push(JSON.parse(frame.text));
        } catch { /* Ignore invalid structured data. */ }
      }
      if (frame.skip) return;
      if (frame.tag === "h1") headings.push(compact(frame.text));
      if (frame.tag === "title") documentTitle = compact(frame.text);
      if (frame.href) {
        try {
          const url = new URL(frame.href, sourceUrl);
          if (url.protocol === "https:" && !url.username && !url.password) {
            links.push({ url: url.href, text: compact(frame.text) });
          }
        } catch { /* Ignore malformed links. */ }
      }
      if (frame.box?.discard) {
        for (const start of frame.box.starts) {
          start.region.parts.length = start.offset;
          start.region.size = start.size;
        }
      }
      if (BLOCK_TAGS.has(frame.tag)) append("\n");
      if (frame.region) frame.region.active = false;
    },
  }, { decodeEntities: true });
  parser.end(html);

  const root = regions.sort((left, right) => right.priority - left.priority || right.size - left.size)[0];
  const heading = headings.find((value) => value.length > 12) ?? headings[0] ?? "";
  const metaTitle = meta.get("og:title") ?? "";
  const title = (metaTitle.length > 12 && !/^(?:home|homepage)\s*[|–—-]?\s*$/i.test(metaTitle) ? metaTitle : heading) ||
    documentTitle;
  let blocks = (root?.parts.join("") ?? "").split(/\n+/).map(compact)
    .filter((value) => value && !CHROME.test(value) && !CHROME_SENTENCE.test(value));
  const headingIndex = blocks.findIndex((value) => value === heading && heading.length > 12);
  if (headingIndex >= 0) blocks = blocks.slice(headingIndex);
  const relatedIndex = blocks.findIndex((value) =>
    /^(?:other|related|more|upcoming) (?:events|programmes|programs|opportunities)$/i.test(value)
  );
  if (relatedIndex >= 0) blocks = blocks.slice(0, relatedIndex);
  const ancillaryIndex = blocks.findIndex((value) =>
    /^(?:speakers|our speakers|a selection of our partners|AI for Good Agent|AI assistant|getting here)$/i.test(value)
  );
  if (ancillaryIndex >= 0) blocks = blocks.slice(0, ancillaryIndex);
  blocks = [...new Set(blocks)];
  const description = meta.get("description") || meta.get("og:description");
  const bodySummary = blocks.find((value) => value.length >= 45 && value !== title && !/^https?:/i.test(value));
  const summary = compact(description && !CHROME_SENTENCE.test(description) ? description : bodySummary ?? title).slice(
    0,
    700,
  );
  return { title, summary, text: [summary, ...blocks].filter(Boolean).join("\n").slice(0, 16_000), schemas, links };
}

export function opportunityPanelText(html: string, id: string): string {
  return extractOpportunityPage(html, "https://ai-nexus.mbzuai.ac.ae/", id).text;
}
