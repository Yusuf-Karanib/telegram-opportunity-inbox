import assert from "node:assert/strict";
import test from "node:test";
import {
  gdgCandidateFromEventPage,
  gdgUpcomingEventUrls,
} from "../supabase/functions/_shared/discovery.ts";

function nextPage(pageProps: Record<string, unknown>): string {
  return `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps },
  })}</script></html>`;
}

test("reads only official upcoming GDG event links", () => {
  const html = nextPage({
    prerenderData: {
      upcomingEvents: {
        results: [
          { url: "https://gdg.community.dev/events/details/example/?utm_source=test" },
          { url: "https://gdg.community.dev/events/details/example/" },
        ],
      },
    },
  });
  assert.deepEqual(gdgUpcomingEventUrls(html), [
    "https://gdg.community.dev/events/details/example",
  ]);
});

test("builds a future relevant candidate without inventing restrictions", () => {
  const html = nextPage({
    eventData: {
      id: 128709,
      title: "DevFest 2026 by GDG Abu Dhabi",
      chapter_title: "GDG Abu Dhabi",
      completed: false,
      is_hidden: false,
      description: "<p>Meet developers for AI and Google Cloud.</p>",
      event_type_title: "Free registration",
      start_date_iso: "2026-11-21T11:00:00+04:00",
      end_date_iso: "2026-11-21T17:00:00+04:00",
      event_timezone: "Asia/Dubai",
      registration_required: true,
      allow_registration_as_a_guest: true,
      is_virtual_event: false,
      audience_type: "IN_PERSON",
      venue_name: "Abu Dhabi",
      venue_address: "TBA",
      venue_city: "Abu Dhabi",
      venue_state: "Abu Dhabi",
      tags: ["AI", "Google Cloud"],
      url: "https://gdg.community.dev/events/details/devfest-abu-dhabi/",
    },
  });
  const candidate = gdgCandidateFromEventPage(
    html,
    "GDG Abu Dhabi",
    new Date("2026-09-19T08:00:00Z"),
  );
  assert.ok(candidate);
  assert.equal(candidate.name, "DevFest 2026 by GDG Abu Dhabi");
  assert.equal(candidate.category, "event");
  assert.equal(candidate.eventAt, "2026-11-21T07:00:00.000Z");
  assert.equal(candidate.deadlineAt, null);
  assert.match(candidate.notes, /Cost: Free registration/);
  assert.match(candidate.notes, /Nationality\/residency restrictions: Not stated/);
  assert.match(candidate.notes, /Student restrictions: Not stated/);
  assert.match(candidate.notes, /Date checked: 2026-09-19/);
});

test("rejects past and unrelated listings", () => {
  const past = nextPage({ eventData: {
    id: 1, title: "AI Meetup", chapter_title: "GDG", completed: false,
    start_date_iso: "2026-01-01T10:00:00+04:00", url: "https://example.com/past",
  } });
  const unrelated = nextPage({ eventData: {
    id: 2, title: "Community Picnic", chapter_title: "GDG", completed: false,
    start_date_iso: "2026-12-01T10:00:00+04:00", url: "https://example.com/picnic",
    description: "Bring lunch and relax.",
  } });
  const now = new Date("2026-09-19T08:00:00Z");
  assert.equal(gdgCandidateFromEventPage(past, "GDG", now), null);
  assert.equal(gdgCandidateFromEventPage(unrelated, "GDG", now), null);
});

test("rejects a promo-code guide even when it mentions real technology events", () => {
  const guide = nextPage({ eventData: {
    id: 3,
    title: "GITEX and AI Everything | Promo Code Guide",
    chapter_title: "GDG Dubai",
    completed: false,
    start_date_iso: "2026-12-07T10:00:00+04:00",
    url: "https://example.com/promo-guide",
    description: "A discount code guide for AI event tickets.",
    tags: ["AI", "Cloud"],
  } });
  assert.equal(
    gdgCandidateFromEventPage(guide, "GDG Dubai", new Date("2026-09-20T08:00:00Z")),
    null,
  );
});
