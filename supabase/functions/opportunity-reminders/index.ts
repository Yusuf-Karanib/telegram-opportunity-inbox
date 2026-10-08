import type { SupabaseClient } from "npm:@supabase/supabase-js@2.116.0";
import { adminClient } from "../_shared/supabase.ts";
import { dueReminders } from "../_shared/reminders.ts";
import type { OpportunityRow, ReminderCandidate } from "../_shared/types.ts";
import {
  AmbiguousTelegramError,
  formatReminder,
  reminderReplyMarkup,
  sendHtml,
} from "../_shared/telegram.ts";
import {
  constantTimeEqual,
  jsonResponse,
  requiredEnv,
  safeError,
} from "../_shared/utils.ts";

interface ReminderClaim {
  claimed: boolean;
  delivery_id: string | null;
  delivery_token: string | null;
  reason: string;
}

const MAX_CLAIM_CHECKS = 250;

async function cleanOldHistory(database: SupabaseClient, now: Date): Promise<void> {
  const updateCutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1_000).toISOString();
  const deliveryCutoff = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1_000).toISOString();
  const staleClaimCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1_000).toISOString();
  try {
    const results = await Promise.all([
      database.from("opportunity_telegram_updates").delete()
        .lt("completed_at", updateCutoff),
      database.from("opportunity_reminder_deliveries").delete()
        .lt("completed_at", deliveryCutoff),
      database.from("opportunity_reminder_deliveries").update({
        status: "unknown",
        error_message: "Worker claim expired; delivery was not retried.",
        completed_at: now.toISOString(),
      }).eq("status", "claimed").lt("claimed_at", staleClaimCutoff),
      database.from("opportunity_telegram_updates").update({
        status: "failed",
        error_message: "Update processing record expired after one day.",
        completed_at: now.toISOString(),
      }).eq("status", "processing").lt("started_at", staleClaimCutoff),
    ]);
    for (const result of results) {
      if (result.error) console.error(`History cleanup warning: ${safeError(result.error)}`);
    }
  } catch (error) {
    console.error(`History cleanup warning: ${safeError(error)}`);
  }
}

async function claimReminder(
  database: SupabaseClient,
  row: OpportunityRow,
  reminder: ReminderCandidate,
): Promise<ReminderClaim | null> {
  const { data, error } = await database.rpc("claim_opportunity_reminder", {
    p_opportunity_id: row.id,
    p_reminder_key: reminder.key,
    p_reminder_kind: reminder.kind,
    p_due_at: reminder.dueAt,
  });
  if (error) throw new Error(`Could not claim reminder for #${row.public_id}: ${error.message}`);
  return (Array.isArray(data) ? data[0] : data) as ReminderClaim | null;
}

async function finishReminder(
  database: SupabaseClient,
  claim: ReminderClaim,
  status: "sent" | "failed" | "unknown",
  messageId: number | null,
  errorMessage: string | null,
): Promise<void> {
  let lastError = "Could not finish reminder delivery";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const { data, error } = await database.rpc("finish_opportunity_reminder", {
      p_delivery_id: claim.delivery_id,
      p_claim_token: claim.delivery_token,
      p_status: status,
      p_message_id: messageId,
      p_error: errorMessage,
    });
    if (!error && data === true) return;
    if (!error && data === false) {
      const { data: existing, error: checkError } = await database
        .from("opportunity_reminder_deliveries")
        .select("status,telegram_message_id")
        .eq("id", claim.delivery_id)
        .maybeSingle();
      if (!checkError && existing?.status === status &&
        (messageId === null || Number(existing.telegram_message_id) === messageId)) return;
      throw new Error("Reminder delivery ownership expired");
    }
    lastError = error ? `Could not finish reminder delivery: ${error.message}` : lastError;
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 400));
  }
  throw new Error(lastError);
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method !== "POST") return jsonResponse({ error: "POST required" }, 405);
  const suppliedSecret = request.headers.get("x-cron-secret") ?? "";
  if (!constantTimeEqual(suppliedSecret, requiredEnv("OPPORTUNITY_CRON_SECRET"))) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const database = adminClient();
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  let claimedCount = 0;
  let checkedCount = 0;
  const now = new Date();
  await cleanOldHistory(database, now);
  const pageSize = 500;
  let offset = 0;
  while (claimedCount < 30 && checkedCount < MAX_CLAIM_CHECKS) {
    const { data, error } = await database.from("opportunities")
      .select("*")
      .is("archived_at", null)
      .not("status", "in", "(rejected,completed)")
      .order("public_id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) return jsonResponse({ error: safeError(error) }, 500);
    const page = (data ?? []) as OpportunityRow[];
    for (const row of page) {
      for (const reminder of dueReminders(row, now)) {
        if (checkedCount >= MAX_CLAIM_CHECKS) break;
        checkedCount += 1;
        try {
          const claim = await claimReminder(database, row, reminder);
          if (!claim?.claimed || !claim.delivery_id || !claim.delivery_token) {
            skipped += 1;
            continue;
          }
          claimedCount += 1;
          let messageId: number;
          try {
            messageId = await sendHtml(
              formatReminder(row, reminder),
              reminderReplyMarkup(row),
            );
          } catch (deliveryError) {
            const message = safeError(deliveryError);
            const status = deliveryError instanceof AmbiguousTelegramError ? "unknown" : "failed";
            await finishReminder(database, claim, status, null, message);
            failed += 1;
            break;
          }

          // Telegram returned a message ID, so this reminder must never be sent
          // again even if recording the result now has a database problem.
          try {
            await finishReminder(database, claim, "sent", messageId, null);
            if (reminder.kind === "manual") {
              const { error: clearError } = await database.from("opportunities").update({
                reminder_at: null,
                reminder_raw: null,
                reminder_precision: null,
              }).eq("id", row.id).eq("reminder_at", row.reminder_at);
              if (clearError) console.error(`Could not clear manual reminder for #${row.public_id}: ${safeError(clearError)}`);
            }
            sent += 1;
          } catch (recordError) {
            console.error(`Reminder #${row.public_id} was sent but its result could not be recorded: ${safeError(recordError)}`);
            failed += 1;
          }
          break;
        } catch (rowError) {
          console.error(`Reminder for #${row.public_id} failed: ${safeError(rowError)}`);
          failed += 1;
          break;
        }
      }
      if (claimedCount >= 30 || checkedCount >= MAX_CLAIM_CHECKS) break;
    }
    if (page.length < pageSize || claimedCount >= 30 || checkedCount >= MAX_CLAIM_CHECKS) break;
    offset += pageSize;
  }

  return jsonResponse({
    ok: true,
    sent,
    skipped,
    failed,
    claimed: claimedCount,
    checked: checkedCount,
  });
});
