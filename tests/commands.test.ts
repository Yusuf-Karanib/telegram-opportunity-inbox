import assert from "node:assert/strict";
import test from "node:test";
import { parseCommand } from "../supabase/functions/_shared/commands.ts";

test("ordinary pasted text is not treated as a command", () => {
  assert.equal(parseCommand("New internship at Example Labs"), null);
});

test("parses dashboard and view commands", () => {
  assert.deepEqual(parseCommand("/inbox"), { kind: "inbox" });
  assert.deepEqual(parseCommand("/discover"), { kind: "discover" });
  assert.deepEqual(parseCommand("/list overdue"), { kind: "list", view: "overdue" });
});

test("status aliases still require an explicit status command", () => {
  assert.deepEqual(parseCommand("/status 12 attended"), {
    kind: "status",
    id: 12,
    status: "completed",
  });
  assert.equal(parseCommand("I applied to #12"), null);
});

test("parses direct field edits", () => {
  assert.deepEqual(parseCommand("/deadline 12 2026-10-15"), {
    kind: "edit",
    id: 12,
    field: "deadline",
    value: "2026-10-15",
  });
  assert.deepEqual(parseCommand("/next 12 tomorrow 9am | Prepare for interview"), {
    kind: "edit",
    id: 12,
    field: "next",
    value: "tomorrow 9am | Prepare for interview",
  });
});
