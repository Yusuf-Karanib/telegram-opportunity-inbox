import assert from "node:assert/strict";
import test from "node:test";
import { duplicateScore, parseOpportunityText } from "../supabase/functions/_shared/parser.ts";
import { opportunityFixture } from "./fixtures.ts";

const now = new Date("2026-09-09T08:00:00.000Z");

test("extracts labelled facts and never imports a submitted status", () => {
  const draft = parseOpportunityText([
    "Opportunity: Robotics Internship",
    "Organization: Example Labs",
    "Category: internship",
    "Status: applied",
    "Deadline: 30 September 2026",
    "Event: 15 October 2026 6pm",
    "Next action: Check eligibility",
    "Next action date: 20 September 2026 9am",
    "Link: https://example.com/internship?utm_source=telegram&ref=abc",
  ].join("\n"), now);

  assert.equal(draft.name, "Robotics Internship");
  assert.equal(draft.organization, "Example Labs");
  assert.equal(draft.category, "internship");
  assert.equal(draft.categoryInferred, false);
  assert.equal(draft.status, "saved");
  assert.equal(draft.sourceUrl, "https://example.com/internship");
  assert.equal(draft.deadlineAt, "2026-09-30T19:59:00.000Z");
  assert.equal(draft.deadlinePrecision, "date");
  assert.equal(draft.eventAt, "2026-10-15T14:00:00.000Z");
  assert.equal(draft.eventPrecision, "datetime");
  assert.equal(draft.nextAction, "Check eligibility");
});

test("does not assign an unlabelled date", () => {
  const draft = parseOpportunityText("Dubai Robotics Meetup\nThe event happens 10 October 2026.", now);
  assert.equal(draft.eventAt, null);
  assert.deepEqual(draft.unassignedDates, ["10 October 2026"]);
});

test("a date-only event stays active through the Dubai calendar day", () => {
  const draft = parseOpportunityText("Opportunity: Demo Day\nEvent: 10 September 2026", now);
  assert.equal(draft.eventAt, "2026-09-10T19:59:00.000Z");
  assert.equal(draft.eventPrecision, "date");
});

test("leaves unclear labelled dates empty and warns", () => {
  const draft = parseOpportunityText("Opportunity: Fellowship\nDeadline: 10/11", now);
  assert.equal(draft.deadlineAt, null);
  assert.match(draft.warnings.join(" "), /Deadline was not understood/);
});

test("hyphenated follow-up labels are preserved", () => {
  const draft = parseOpportunityText([
    "Opportunity: Graduate Role",
    "Follow-up: Email the recruiter",
    "Follow-up date: 20 September 2026 9am",
  ].join("\n"), now);
  assert.equal(draft.nextAction, "Email the recruiter");
  assert.equal(draft.nextActionAt, "2026-09-20T05:00:00.000Z");
});

test("keeps a missing organization empty and suggests a category", () => {
  const draft = parseOpportunityText("AI course for beginners\nhttps://example.com/course", now);
  assert.equal(draft.organization, null);
  assert.equal(draft.category, "course");
  assert.equal(draft.categoryInferred, true);
});

test("classifies a CVE bulletin as a security alert even when called a program", () => {
  const draft = parseOpportunityText([
    "Title: AWS Security Bulletin",
    "Category: program",
    "CVE-2026-12345 affects a cloud service and requires a security patch.",
  ].join("\n"), now);
  assert.equal(draft.category, "security_alert");
});

test("does not mistake a cybersecurity hackathon for a security alert", () => {
  const draft = parseOpportunityText([
    "Opportunity: UAE Cybersecurity Hackathon",
    "Registration is open. Register now to join a build team.",
  ].join("\n"), now);
  assert.equal(draft.category, "hackathon");
});

test("separates technical news and LinkedIn completion posts from opportunities", () => {
  const news = parseOpportunityText("Title: Cloud product update\nThe new model release is now generally available.", now);
  const completion = parseOpportunityText(
    "Proud to share that I successfully completed the AI fellowship program.",
    now,
  );
  assert.equal(news.category, "technical_news");
  assert.equal(completion.category, "completion_post");
});

test("recognizes competitions and keeps verified search facts in notes", () => {
  const draft = parseOpportunityText([
    "Opportunity: UAE Robotics Challenge",
    "Category: competition",
    "Cost: Free",
    "Location: Abu Dhabi",
    "Eligibility: UAE residents aged 18+",
    "Nationality or residency restrictions: UAE residency required",
    "Student/age/experience restrictions: Must be 18 or older",
    "Access: Public",
    "Date checked: 19 September 2026",
    "Original source: https://example.com/robotics",
  ].join("\n"), now);
  assert.equal(draft.category, "competition");
  assert.equal(draft.sourceUrl, "https://example.com/robotics");
  assert.match(draft.notes ?? "", /Cost: Free/);
  assert.match(draft.notes ?? "", /Location: Abu Dhabi/);
  assert.match(draft.notes ?? "", /Eligibility: UAE residents aged 18\+/);
  assert.match(draft.notes ?? "", /Nationality\/residency restrictions: UAE residency required/);
  assert.match(draft.notes ?? "", /Student\/age\/experience restrictions: Must be 18 or older/);
  assert.match(draft.notes ?? "", /Access: Public/);
});

test("detects exact links and close name plus organization without forcing a merge", () => {
  const row = opportunityFixture();
  const exact = parseOpportunityText("Robotics role\nhttps://example.com/internship?utm_campaign=x", now);
  assert.equal(duplicateScore(exact, row), 1);

  const similar = parseOpportunityText(
    "Opportunity: Internship Robotics\nOrganization: Example Labs",
    now,
  );
  assert.ok(duplicateScore(similar, row) >= 0.82);
});
