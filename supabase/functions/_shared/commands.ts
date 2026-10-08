import { STATUSES, VIEWS } from "./types.ts";
import type { DraftField, OpportunityStatus, OpportunityView } from "./types.ts";
import { cleanText } from "./utils.ts";

export type BotCommand =
  | { kind: "help" }
  | { kind: "inbox" }
  | { kind: "discover" }
  | { kind: "add"; text: string }
  | { kind: "cancel" }
  | { kind: "list"; view: OpportunityView }
  | { kind: "show"; id: number }
  | { kind: "status"; id: number; status: OpportunityStatus }
  | { kind: "archive" | "restore" | "activity"; id: number }
  | { kind: "edit"; id: number; field: DraftField; value: string }
  | { kind: "unknown" };

const STATUS_ALIASES: Record<string, OpportunityStatus> = {
  save: "saved", saved: "saved", plan: "planning", planning: "planning",
  apply: "applied", applied: "applied", register: "registered", registered: "registered",
  wait: "waiting", waiting: "waiting", accepted: "accepted", reject: "rejected",
  rejected: "rejected", progress: "in_progress", in_progress: "in_progress",
  complete: "completed", completed: "completed", attended: "completed",
};

function numericId(value: string | undefined): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function parseCommand(input: unknown): BotCommand | null {
  const text = cleanText(input, 8_000);
  if (!text.startsWith("/")) return null;
  const match = /^\/([a-z_]+)(?:@[a-z0-9_]+)?(?:\s+([\s\S]*))?$/i.exec(text);
  if (!match) return { kind: "unknown" };
  const verb = match[1].toLowerCase();
  const rest = cleanText(match[2] ?? "", 7_500);
  if (verb === "start" || verb === "help") return { kind: "help" };
  if (verb === "inbox") return { kind: "inbox" };
  if (verb === "discover") return { kind: "discover" };
  if (verb === "cancel") return { kind: "cancel" };
  if (verb === "add") return { kind: "add", text: rest };

  if (verb === "list") {
    const view = (rest || "upcoming").toLowerCase().replace(/[- ]/g, "_");
    return (VIEWS as readonly string[]).includes(view)
      ? { kind: "list", view: view as OpportunityView }
      : { kind: "unknown" };
  }

  const pieces = rest.split(/\s+/);
  const id = numericId(pieces[0]);
  if (verb === "show" && id) return { kind: "show", id };
  if (["archive", "restore", "activity"].includes(verb) && id) {
    return { kind: verb as "archive" | "restore" | "activity", id };
  }
  if (verb === "status" && id) {
    const statusText = pieces[1]?.toLowerCase() ?? "";
    const status = STATUS_ALIASES[statusText] ?? statusText;
    return (STATUSES as readonly string[]).includes(status)
      ? { kind: "status", id, status: status as OpportunityStatus }
      : { kind: "unknown" };
  }

  const fieldByVerb: Partial<Record<string, DraftField>> = {
    name: "name", organization: "organization", org: "organization", category: "category",
    link: "link", deadline: "deadline", event: "event", next: "next",
    remind: "reminder", reminder: "reminder", note: "notes", notes: "notes", outcome: "outcome",
  };
  const field = fieldByVerb[verb];
  if (field && id) {
    const value = cleanText(rest.slice(pieces[0].length), 4_000);
    if (value) return { kind: "edit", id, field, value };
  }
  return { kind: "unknown" };
}
