import assert from "node:assert/strict";
import test from "node:test";
import {
  formatListPage,
  listReplyMarkup,
  draftReplyMarkup,
  formatDraft,
  formatOpportunity,
  itemReplyMarkup,
  statusReplyMarkup,
} from "../supabase/functions/_shared/telegram.ts";
import { parseOpportunityText } from "../supabase/functions/_shared/parser.ts";
import { opportunityFixture } from "./fixtures.ts";

test("draft makes the unconfirmed status explicit and removes pasted HTML", () => {
  const draft = parseOpportunityText("Opportunity: <b>Fake</b> Internship\nStatus: applied");
  const message = formatDraft(draft);
  assert.match(message, /Saved only — not applied or registered/);
  assert.doesNotMatch(message, /<b>Fake<\/b>/);
  assert.match(message, /<b>Name:<\/b> Fake Internship/);
});

test("saved cards escape notes and stay below Telegram's message limit", () => {
  const row = opportunityFixture({ notes: "<script>alert(1)</script> Useful note & details" });
  const message = formatOpportunity(row);
  assert.doesNotMatch(message, /<script>/);
  assert.match(message, /&amp;/);
  assert.ok(message.length < 4096);
});

test("all callback data stays within Telegram's 64-byte limit", () => {
  const markups = [
    draftReplyMarkup("internship", true),
    itemReplyMarkup(opportunityFixture()),
    statusReplyMarkup(999999999),
  ] as Array<{ inline_keyboard: Array<Array<{ callback_data: string }>> }>;
  for (const markup of markups) {
    for (const row of markup.inline_keyboard) {
      for (const button of row) {
        assert.ok(new TextEncoder().encode(button.callback_data).byteLength <= 64);
      }
    }
  }
});

test("non-opportunity classifications cannot be saved from the draft", () => {
  const draft = parseOpportunityText("AWS Security Bulletin\nCVE-2026-12345 vulnerability advisory");
  const message = formatDraft(draft);
  const markup = draftReplyMarkup(draft.category) as {
    inline_keyboard: Array<Array<{ callback_data: string }>>;
  };
  const callbacks = markup.inline_keyboard.flat().map((button) => button.callback_data);
  assert.match(message, /Security alert — not an opportunity/);
  assert.doesNotMatch(message, /Nothing is stored until you tap Save/);
  assert.ok(!callbacks.includes("d:save"));
  assert.ok(callbacks.includes("df:category"));
});

test("unclear drafts are blocked while real opportunity categories keep Save", () => {
  const blocked = draftReplyMarkup("other") as {
    inline_keyboard: Array<Array<{ callback_data: string }>>;
  };
  const allowed = draftReplyMarkup("competition") as {
    inline_keyboard: Array<Array<{ callback_data: string }>>;
  };
  assert.ok(!blocked.inline_keyboard.flat().some((button) => button.callback_data === "d:save"));
  assert.ok(allowed.inline_keyboard.flat().some((button) => button.callback_data === "d:save"));
});

test("large valid drafts stay within Telegram's message limit", () => {
  const draft = parseOpportunityText([
    `Opportunity: ${"N".repeat(180)}`,
    `Organization: ${"O".repeat(160)}`,
    `Link: https://example.com/${"l".repeat(1500)}`,
    `Next action: ${"A".repeat(1800)}`,
    `Notes: ${"X".repeat(1800)}`,
    `Outcome: ${"Y".repeat(1800)}`,
  ].join("\n"));
  assert.ok(formatDraft(draft).length < 4096);
  assert.ok((draft.nextAction?.length ?? 0) <= 1000);
});

test("list pages provide navigation after ten items", () => {
  const rows = Array.from({ length: 10 }, (_, index) =>
    opportunityFixture({ public_id: index + 11, name: `Opportunity ${index + 11}` })
  );
  const message = formatListPage("saved", rows, 25, 1);
  const markup = listReplyMarkup("saved", rows, 1, 25) as {
    inline_keyboard: Array<Array<{ callback_data: string }>>;
  };
  assert.match(message, /Showing 11–20 of 25/);
  const navigation = markup.inline_keyboard.at(-1)?.map((button) => button.callback_data);
  assert.deepEqual(navigation, ["vp:saved:0", "vp:saved:2"]);
});

test("registered list has a visible heading", () => {
  const row = opportunityFixture({ status: "registered", status_confirmed_at: new Date().toISOString() });
  assert.match(formatListPage("registered", [row], 1, 0), /^<b>Registered<\/b>/);
});
