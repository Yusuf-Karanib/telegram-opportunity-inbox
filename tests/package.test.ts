import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

const migration = read("../supabase/migrations/202609090001_opportunity_inbox.sql");
const categoryMigration = read("../supabase/migrations/202609190001_add_competition_category.sql");
const discoveryMigration = read("../supabase/migrations/202609190002_add_opportunity_discovery.sql");
const broadDiscoveryMigration = read("../supabase/migrations/202610080001_twice_daily_broad_discovery.sql");
const bot = read("../supabase/functions/opportunity-bot/index.ts");
const reminders = read("../supabase/functions/opportunity-reminders/index.ts");
const discovery = read("../supabase/functions/opportunity-discovery/index.ts");
const config = read("../supabase/config.toml");
const webhook = read("../tools/set-telegram-webhook.ps1");
const schedule = read("../supabase/setup_schedule.sql");
const criteria = read("../SEARCH_CRITERIA.md");

test("public clients cannot read the private tables", () => {
  for (const table of [
    "opportunities",
    "opportunity_bot_sessions",
    "opportunity_telegram_updates",
    "opportunity_reminder_deliveries",
  ]) {
    assert.ok(migration.includes(`alter table public.${table} enable row level security`));
    assert.ok(migration.includes(`revoke all on table public.${table} from anon, authenticated`));
  }
  assert.match(migration, /grant select, insert, update, delete on table public\.opportunities to service_role/);
});

test("database requires explicit status confirmation", () => {
  assert.match(migration, /opportunities_status_requires_confirmation/);
  assert.match(migration, /status in \('saved', 'planning'\) or status_confirmed_at is not null/);
  assert.match(bot, /status_confirmed_at: confirmedAt/);
});

test("only classified opportunities can be saved", () => {
  assert.match(categoryMigration, /'competition'/);
  assert.doesNotMatch(categoryMigration, /'technical_news'|'security_alert'|'completion_post'/);
  assert.match(bot, /isTrackableOpportunityCategory\(draft\.category\)/);
  assert.match(bot, /Choose a specific opportunity category before saving/);
});

test("repeated draft saves reuse a unique token instead of creating another item", () => {
  assert.match(migration, /draft_save_token uuid not null unique/);
  assert.match(bot, /inserted\.error\?\.code === "23505"/);
  assert.match(bot, /eq\("draft_save_token", draft\.saveToken\)/);
});

test("webhook is authenticated, allowlisted, bounded, and replay-safe", () => {
  assert.match(bot, /x-telegram-bot-api-secret-token/);
  assert.match(bot, /OPPORTUNITY_TELEGRAM_ALLOWED_USER_ID/);
  assert.match(bot, /OPPORTUNITY_TELEGRAM_CHAT_ID/);
  assert.match(bot, /MAX_WEBHOOK_BYTES/);
  assert.match(bot, /claim_opportunity_telegram_update/);
  assert.match(migration, /stale_review_required/);
  assert.match(bot, /reason === "processing"[\s\S]*?503/);
  assert.match(bot, /return jsonResponse\(\{ ok: true, ignored: true \}\)/);
  assert.match(migration, /update_id bigint primary key/);
});

test("list views have next and previous page callbacks", () => {
  assert.match(bot, /PAGE_PATTERN/);
  assert.match(bot, /formatListPage/);
  assert.match(bot, /requestedPage/);
  assert.match(bot, /\.range\(offset, offset \+ pageSize - 1\)/);
});

test("duplicate checks do not forget exact older links", () => {
  assert.match(bot, /eq\("source_url", draft\.sourceUrl\)/);
  assert.match(bot, /eq\("normalized_name", normalizedName\)/);
});

test("reminders use claims, three-attempt limits, and an independent cron secret", () => {
  assert.match(reminders, /claim_opportunity_reminder/);
  assert.match(reminders, /AmbiguousTelegramError/);
  assert.match(reminders, /claimedCount < 30/);
  assert.match(reminders, /MAX_CLAIM_CHECKS = 250/);
  assert.match(reminders, /\.range\(offset, offset \+ pageSize - 1\)/);
  assert.match(reminders, /90 \* 24 \* 60 \* 60/);
  assert.match(migration, /Delivery result was not safely recorded; not retried/);
  assert.match(reminders, /was sent but its result could not be recorded/);
  assert.match(migration, /attempt_count smallint not null default 1 check \(attempt_count between 1 and 3\)/);
  assert.match(schedule, /opportunity-inbox-reminders-15m/);
  assert.match(reminders, /OPPORTUNITY_CRON_SECRET/);
});

test("replacing the schedule project reference does not break its safety check", () => {
  assert.equal(schedule.match(/YOUR_PROJECT_REF/g)?.length, 1);
  const configured = schedule.replaceAll("YOUR_PROJECT_REF", "abcdefghijklmnopqrst");
  assert.match(configured, /https:\/\/abcdefghijklmnopqrst[.]supabase[.]co/);
  assert.match(configured, /v_project_url !~ '\^https:\/\//);
  assert.doesNotMatch(configured, /like '%abcdefghijklmnopqrst%'/);
});

test("Opportunity functions do not overwrite AI News names", () => {
  assert.match(config, /\[functions\.opportunity-bot\]/);
  assert.match(config, /\[functions\.opportunity-reminders\]/);
  assert.match(config, /\[functions\.opportunity-discovery\]/);
  assert.doesNotMatch(config, /daily-news|telegram-feedback/);
  assert.match(webhook, /functions\/v1\/opportunity-bot/);
  assert.match(webhook, /drop_pending_updates = 'false'/);
});

test("discovery is private, approval-based, duplicate-safe, and scheduled for 7 AM and 7 PM Dubai", () => {
  assert.match(discoveryMigration, /alter table public\.opportunity_discovery_candidates enable row level security/);
  assert.match(discoveryMigration, /revoke all on table public\.opportunity_discovery_candidates from anon, authenticated/);
  assert.match(discoveryMigration, /source_url text not null unique/);
  assert.match(broadDiscoveryMigration, /decision_details jsonb/);
  assert.match(broadDiscoveryMigration, /'0 3,15 \* \* \*'/);
  assert.match(broadDiscoveryMigration, /opportunity-inbox-twice-daily-discovery/);
  assert.match(broadDiscoveryMigration, /opportunity-inbox-daily-discovery/);
  assert.match(discovery, /OPPORTUNITY_CRON_SECRET/);
  assert.match(discovery, /OPPORTUNITY_BRAVE_SEARCH_API_KEY/);
  assert.match(discovery, /api[.]search[.]brave[.]com/);
  assert.match(discovery, /country:\s*["']ALL["']/);
  assert.doesNotMatch(discovery, /country:\s*["']AE["']/);
  assert.match(discovery, /MAX_RUN_MESSAGES = 8/);
  assert.match(bot, /DISCOVERY_CANDIDATE_PATTERN/);
  assert.match(bot, /saveDiscoveryCandidate/);
});

test("search criteria require original-source verification and meaningful affiliation", () => {
  for (const source of [
    "42 Abu Dhabi",
    "GDG Abu Dhabi",
    "UAE Robotics and Automation Society",
    "MBZUAI",
    "Hub71",
    "Dubai Future Foundation",
    "Devpost",
    "Meetup",
    "Eventbrite",
  ]) assert.match(criteria, new RegExp(source));
  assert.match(criteria, /original source/i);
  assert.match(criteria, /nationality or residency restrictions/i);
  assert.match(criteria, /certificate alone is not a reason/i);
  assert.match(criteria, /security_alert/);
  assert.match(criteria, /completion_post/);
});
