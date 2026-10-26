import assert from "node:assert/strict";
import test from "node:test";
import {
  candidateFromBraveResult,
  candidateFromOfficialPageHtml,
  discoveryCandidateIdentityKey,
  gdgCandidateFromEventPage,
  shouldNotifyDiscoveryCandidate,
  shouldRefreshPreviouslySeenCandidate,
} from "../supabase/functions/_shared/discovery.ts";
import { extractOpportunityPage } from "../supabase/functions/_shared/opportunity-page.ts";
import { fetchPublicPage } from "../supabase/functions/_shared/public-page.ts";
import {
  discoveryCandidateExpired,
  discoveryHealthText,
  discoveryRunKey,
  type DiscoveryRunRow,
} from "../supabase/functions/_shared/scout-policy.ts";

const now = new Date("2026-10-25T12:00:00Z");

test("a familiar official domain does not turn a search snippet into verified facts", () => {
  const result = {
    title: "AI Fellowship in Abu Dhabi",
    url: "https://www.hub71.com/program/ai-fellowship",
    description: "Applications are open for an AI fellowship in Abu Dhabi. Deadline: 30 November 2026.",
  };
  const snippet = candidateFromBraveResult(result, now)!;
  assert.equal(snippet.decisionDetails.verification_method, "search_snippet");
  assert.equal(shouldNotifyDiscoveryCandidate(snippet, now), false);
  const live = candidateFromOfficialPageHtml(
    "<main><h1>AI Fellowship in Abu Dhabi</h1><p>Applications are closed for this AI fellowship.</p></main>",
    result.url,
    "hub71",
    "Hub71",
    "Hub71",
    now,
  );
  assert.equal(live, null);
});

test("main event facts survive menus, hidden dialogs, related events and a body menu class", () => {
  const page = extractOpportunityPage(
    `<html><head><title>AI Builders Festival</title></head>
    <body class="mega-menu-menu-1"><nav>Old AI conference 1 January 2025</nav>
    <div role="dialog">Applications are closed. Clear your browser cache.</div>
    <main><h1>AI Builders Festival</h1><p>Build applied AI projects with software teams and mentors in Dubai.</p>
    <p>Event date: 26-27 October 2026</p><p>Registration is open.</p>
    <section class="related-events"><h2>Sports day</h2><p>1 January 2025</p></section></main></body></html>`,
    "https://dubaiaifestival.com/register",
  );
  assert.match(page.text, /26-27 October 2026/);
  assert.doesNotMatch(page.text, /closed|cache|Sports|2025/);
  assert.match(page.summary, /Build applied AI/);
});

test("Hub71 programme classification and status ignore another programme's closed card", () => {
  const candidate = candidateFromOfficialPageHtml(
    `<main><h1>Hub71+ AI</h1>
    <p>Applications are open for this Abu Dhabi AI startup ecosystem. It provides mentorship and partners.</p>
    <p>Founders should include their competition and market in the pitch deck.</p>
    <div class="box"><h2>Another programme for Emirati founders</h2><div class="links-container">Application Closed</div></div>
    </main>`,
    "https://www.hub71.com/program/hub71-plus-ai",
    "hub71",
    "Hub71",
    "Hub71",
    now,
  )!;
  assert.ok(candidate);
  assert.equal(candidate.category, "program");
  assert.equal(candidate.decisionDetails.listing_status, "open");
  assert.doesNotMatch(candidate.sourceText, /Emirati|Application Closed/);
});

test("certificate text saying it does not guarantee an internship stays a course and is withheld", () => {
  const candidate = candidateFromBraveResult({
    title: "Certificate in Artificial Intelligence for Africa 2027",
    url: "https://x.com/example/status/123",
    description:
      "An online AI certificate. No monthly stipend; no degree or university credit; completing it does not guarantee a job or internship. Deadline: 15 November 2026. Start: 17 January 2027.",
  }, now)!;
  assert.ok(candidate);
  assert.equal(candidate.category, "course");
  assert.equal(shouldNotifyDiscoveryCandidate(candidate, now), false);
});

test("a dated social internship with explicitly open applications is still delivered as a lead", () => {
  const candidate = candidateFromBraveResult({
    title: "Remote AI Internship applications open",
    url: "https://www.linkedin.com/posts/example-internship",
    description:
      "Applications are open worldwide for a remote AI internship with mentorship and project teams. Deadline: 15 November 2026.",
  }, now)!;
  assert.ok(candidate);
  assert.equal(candidate.decisionDetails.evidence_level, "social_lead");
  assert.equal(candidate.decisionDetails.recommendation, "investigate");
  assert.equal(shouldNotifyDiscoveryCandidate(candidate, now), true);
});

test("an official news story and about page cannot become extra event cards", () => {
  for (
    const path of [
      "/whats-on/news/ai-festival-announcement",
      "/about-us",
      "/start-up-agenda",
      "/purchase-start-up-package",
      "/exhibit",
    ]
  ) {
    assert.equal(
      candidateFromOfficialPageHtml(
        "<main><h1>AI Festival Dubai</h1><p>Register now for 26-27 October 2026 in Dubai.</p></main>",
        `https://dubaiaifestival.com${path}`,
        "festival",
        "Festival",
        "Festival",
        now,
      ),
      null,
    );
  }
  assert.equal(
    discoveryCandidateIdentityKey("About Us - Dubai AI Festival", "2026-10-26T19:59:00Z"),
    discoveryCandidateIdentityKey("Register for Dubai AI Festival 2026", "2026-10-26T19:59:00Z"),
  );
});

test("speaker biographies do not make a general business workshop technically relevant", () => {
  assert.equal(
    candidateFromOfficialPageHtml(
      `<main><h1>Dubai Quality Performance Lab 2026</h1>
    <p>A quality management workshop in Dubai for improving customer journeys and business processes.</p>
    <p>11 November 2026. Register now.</p><h2>Speakers</h2>
    <p>A founder who researches AI, software and robotics.</p></main>`,
      "https://www.dubaichambers.com/en/e/dc_event_detail_page/1/2",
      "dc",
      "Dubai Chambers",
      "Dubai Chambers",
      now,
    ),
    null,
  );
});

test("a website chatbot's online question does not make a foreign in-person event UAE-accessible", () => {
  assert.equal(
    candidateFromOfficialPageHtml(
      `<main><h1>Robotics for Good Youth Challenge South Korea</h1>
    <p>A national robotics competition for teams in Seoul, South Korea.</p><p>21 November 2026.</p>
    <h2>AI for Good Agent</h2><p>Can I watch online? What are today's AI events?</p></main>`,
      "https://aiforgood.itu.int/event/robotics-south-korea",
      "itu",
      "AI for Good",
      "ITU",
      now,
    ),
    null,
  );
});

test("a venue's parking discount cannot turn a real AI summit into a promo-code guide", () => {
  const candidate = candidateFromOfficialPageHtml(
    `<main><h1>The Arabian AI and Agentic Summit</h1>
    <p>Abu Dhabi AI leaders discuss agentic software at this summit.</p><p>26 October 2026</p>
    <p>Location:</p><p>Conference Hall B</p><h2>Getting Here</h2>
    <p>Visitors can get a taxi discount with promo code ADNEC.</p></main>`,
    "https://www.adnec.ae/en/eventlisting/the-arabian-ai-agentic-summit",
    "adnec",
    "ADNEC",
    "ADNEC",
    now,
  )!;
  assert.ok(candidate);
  assert.equal(shouldNotifyDiscoveryCandidate(candidate, now), true);
  assert.match(candidate.decisionDetails.location, /Conference Hall B/);
  assert.doesNotMatch(candidate.sourceText, /promo code/);
});

test("a specific metadata title wins over a homepage slogan", () => {
  const candidate = candidateFromOfficialPageHtml(
    `<html><head><meta property="og:title" content="NASA Space Apps Challenge 2026 — UAE"></head>
    <body><main><h1>Five UAE cities. One global hackathon.</h1><p>Join the AI and data hackathon in Abu Dhabi on 14-15 November 2026.</p></main></body></html>`,
    "https://nasaspaceapps.ae/",
    "nasa",
    "NASA Space Apps",
    "NASA",
    now,
  )!;
  assert.equal(candidate.name, "NASA Space Apps Challenge 2026 — UAE");
});

test("conflicting GDG dates stay unassigned and show both organizer claims", () => {
  const html = `<script id="__NEXT_DATA__" type="application/json">${
    JSON.stringify({
      props: {
        pageProps: {
          eventData: {
            id: 123,
            title: "DevFest 2026 by GDG Abu Dhabi",
            chapter_title: "GDG Abu Dhabi",
            start_date_iso: "2026-11-07T09:00:00+04:00",
            end_date_iso: "2026-11-07T18:00:00+04:00",
            event_timezone: "Asia/Dubai",
            registration_required: true,
            allow_registration_as_a_guest: true,
            description: "DevFest is returning on November 21th for AI and cloud learning in Abu Dhabi.",
            url: "https://gdg.community.dev/events/details/devfest-abu-dhabi/",
          },
        },
      },
    })
  }</script>`;
  const candidate = gdgCandidateFromEventPage(html, "GDG Abu Dhabi", now)!;
  assert.equal(candidate.eventAt, null);
  assert.equal(candidate.eventPrecision, null);
  assert.match(candidate.decisionDetails.date_conflict!, /7\/11\/2026/);
  assert.match(candidate.decisionDetails.date_conflict!, /November 21/);
  assert.equal(candidate.decisionDetails.recommendation, "investigate");
});

test("Yusuf's dismissal remains blocked even when an event date changes", () => {
  const candidate = candidateFromOfficialPageHtml(
    "<main><h1>Dubai AI Festival</h1><p>Register now for an AI festival in Dubai on 26 October 2026.</p></main>",
    "https://dubaiaifestival.com/register",
    "festival",
    "Festival",
    "Festival",
    now,
  )!;
  assert.equal(
    shouldRefreshPreviouslySeenCandidate({ status: "dismissed", eventAt: "2026-04-07T19:59:00Z" }, candidate, now),
    false,
  );
});

test("a cancelled structured event overrides a leftover Register Now button", () => {
  const candidate = candidateFromOfficialPageHtml(
    `<html><head><script type="application/ld+json">
    {"@type":"Event","name":"Dubai AI Summit","startDate":"2026-11-15","eventStatus":"https://schema.org/EventCancelled"}
    </script></head><body><main><h1>Dubai AI Summit</h1><p>Register now for AI sessions in Dubai.</p></main></body></html>`,
    "https://dubaiaifestival.com/cancelled",
    "festival",
    "Festival",
    "Festival",
    now,
  );
  assert.equal(candidate, null);
});

test("both attendance fees and VAT are retained instead of showing only the cheapest fee", () => {
  const candidate = candidateFromOfficialPageHtml(
    `<main><h1>Dubai AI Workshop</h1>
    <p>Register now to learn AI and software in Dubai on 26 November 2026.</p>
    <p>Participation Fees (Excluding VAT)</p><p>Dubai Chambers' Member: AED 600/-</p><p>Non-member: AED 1500/-</p>
    </main>`,
    "https://www.dubaichambers.com/en/e/dc_event_detail_page/1/2",
    "dc",
    "Dubai Chambers",
    "Dubai Chambers",
    now,
  )!;
  assert.ok(candidate);
  assert.match(candidate.decisionDetails.cost, /Member: AED 600/);
  assert.match(candidate.decisionDetails.cost, /Non-member: AED 1500/);
  assert.match(candidate.decisionDetails.cost, /excluding VAT/);
});

test("event ranges stay active through their last date; closed application deadlines expire", () => {
  const candidate = candidateFromOfficialPageHtml(
    `<main><h1>Dubai AI Festival</h1>
    <p>Register now for the applied AI festival in Dubai. 26-27 October 2026.</p></main>`,
    "https://dubaiaifestival.com/register",
    "festival",
    "Festival",
    "Festival",
    now,
  )!;
  assert.ok(candidate);
  const row = { event_at: candidate.eventAt, deadline_at: null, decision_details: candidate.decisionDetails };
  assert.equal(discoveryCandidateExpired(row, new Date("2026-10-27T08:00:00Z")), false);
  assert.equal(discoveryCandidateExpired(row, new Date("2026-10-28T08:00:00Z")), true);
  assert.equal(discoveryCandidateExpired({ ...row, deadline_at: "2026-10-24T19:59:00Z" }, now), true);
});

test("scheduled run identities follow Dubai days and morning/evening slots", () => {
  assert.equal(discoveryRunKey(true, new Date("2026-10-25T03:00:00Z")), "scheduled:2026-10-25:morning");
  assert.equal(discoveryRunKey(true, new Date("2026-10-25T15:00:00Z")), "scheduled:2026-10-25:evening");
  assert.equal(discoveryRunKey(true, new Date("2026-10-25T21:00:00Z")), "scheduled:2026-10-26:morning");
  assert.match(discoveryRunKey(true, now, "preview"), /^preview:/);
  assert.match(discoveryRunKey(true, now, "maintenance"), /^maintenance:/);
});

test("health shows recorded failures and stale searches without calling them successful", () => {
  const run: DiscoveryRunRow = {
    id: "run",
    scheduled: true,
    status: "failed",
    started_at: "2026-10-24T03:00:00Z",
    finished_at: "2026-10-24T03:01:00Z",
    metrics: {},
    error_message: "Search provider unavailable",
  };
  const text = discoveryHealthText(run, now);
  assert.match(text, /Failed/);
  assert.match(text, /may have been missed/);
  assert.match(text, /Search provider unavailable/);
  assert.match(
    discoveryHealthText({ ...run, started_at: "2026-10-25T11:50:00Z", status: "running" }, now),
    /Stopped before finishing/,
  );
});

test("page fetch rejects private redirect targets and limits streamed response size", async () => {
  const redirect: typeof fetch = async () =>
    new Response(null, { status: 302, headers: { location: "https://127.0.0.1/" } });
  await assert.rejects(fetchPublicPage("https://example.com/event", redirect), /public HTTPS/);
  const large: typeof fetch = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(2_000_001));
          controller.close();
        },
      }),
    );
  await assert.rejects(fetchPublicPage("https://example.com/event", large), /too large/);
});
