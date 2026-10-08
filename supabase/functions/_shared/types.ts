export const CATEGORIES = [
  "job",
  "internship",
  "program",
  "event",
  "course",
  "competition",
  "hackathon",
  "technical_news",
  "security_alert",
  "completion_post",
  "other",
] as const;

export type OpportunityCategory = (typeof CATEGORIES)[number];

export const TRACKABLE_OPPORTUNITY_CATEGORIES: readonly OpportunityCategory[] = [
  "job",
  "internship",
  "program",
  "event",
  "course",
  "competition",
  "hackathon",
];

export function isTrackableOpportunityCategory(category: OpportunityCategory): boolean {
  return TRACKABLE_OPPORTUNITY_CATEGORIES.includes(category);
}

export const STATUSES = [
  "saved",
  "planning",
  "applied",
  "registered",
  "waiting",
  "accepted",
  "rejected",
  "in_progress",
  "completed",
] as const;

export type OpportunityStatus = (typeof STATUSES)[number];

export const VIEWS = [
  "saved",
  "upcoming",
  "overdue",
  "waiting",
  "registered",
  "accepted",
  "rejected",
  "completed",
  "archived",
] as const;

export type OpportunityView = (typeof VIEWS)[number];

export type DatePrecision = "date" | "datetime";

export type OpportunityListingStatus =
  | "open"
  | "not_open_yet"
  | "closed"
  | "finished"
  | "cancelled"
  | "unverified";

export type OpportunityEvidenceLevel = "official" | "aggregator" | "web_listing" | "social_lead";

export type OpportunityRecommendation = "strong_fit" | "possible_fit" | "investigate";

export interface OpportunityDecisionDetails {
  summary: string;
  why_relevant: string;
  source_platform: string;
  official_source_url: string | null;
  listing_status: OpportunityListingStatus;
  evidence_level: OpportunityEvidenceLevel;
  cost: string;
  location: string;
  format: string;
  eligibility: string;
  restrictions: string;
  access: string;
  commitment: string;
  benefits: string[];
  uncertainties: string[];
  recommendation: OpportunityRecommendation;
  fit_score: number;
  checked_at: string;
}

export interface OpportunityDraft {
  saveToken: string;
  name: string;
  organization: string | null;
  category: OpportunityCategory;
  categoryInferred: boolean;
  sourceUrl: string | null;
  sourceText: string;
  discoveredOn: string;
  status: "saved";
  deadlineAt: string | null;
  deadlineRaw: string | null;
  deadlinePrecision: DatePrecision | null;
  eventAt: string | null;
  eventRaw: string | null;
  eventPrecision: DatePrecision | null;
  nextAction: string | null;
  nextActionAt: string | null;
  nextActionAtRaw: string | null;
  nextActionAtPrecision: DatePrecision | null;
  reminderAt: string | null;
  reminderRaw: string | null;
  reminderPrecision: DatePrecision | null;
  notes: string | null;
  outcome: string | null;
  unassignedDates: string[];
  warnings: string[];
  duplicateId?: number | null;
  duplicateName?: string | null;
}

export interface OpportunityRow {
  id: string;
  public_id: number;
  draft_save_token: string;
  name: string;
  organization: string | null;
  normalized_name: string;
  normalized_organization: string;
  category: OpportunityCategory;
  source_url: string | null;
  source_text: string;
  discovered_on: string;
  status: OpportunityStatus;
  status_confirmed_at: string | null;
  deadline_at: string | null;
  deadline_raw: string | null;
  deadline_precision: DatePrecision | null;
  event_at: string | null;
  event_raw: string | null;
  event_precision: DatePrecision | null;
  next_action: string | null;
  next_action_at: string | null;
  next_action_at_raw: string | null;
  next_action_at_precision: DatePrecision | null;
  reminder_at: string | null;
  reminder_raw: string | null;
  reminder_precision: DatePrecision | null;
  notes: string | null;
  outcome: string | null;
  last_activity_at: string | null;
  course_inactivity_days: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface OpportunityDiscoveryCandidateRow {
  id: string;
  public_id: number;
  save_token: string;
  source_key: string;
  source_url: string;
  source_name: string;
  name: string;
  organization: string;
  category: OpportunityCategory;
  source_text: string;
  deadline_at: string | null;
  deadline_raw: string | null;
  deadline_precision: DatePrecision | null;
  event_at: string | null;
  event_raw: string | null;
  event_precision: DatePrecision | null;
  next_action: string | null;
  notes: string | null;
  decision_details: OpportunityDecisionDetails | null;
  status: "new" | "sending" | "sent" | "failed" | "unknown" | "saved" | "dismissed" | "expired";
  attempt_count: number;
  claimed_at: string | null;
  sent_at: string | null;
  telegram_message_id: number | null;
  error_message: string | null;
  opportunity_id: string | null;
  checked_at: string;
  created_at: string;
  updated_at: string;
}

export type DraftField =
  | "name"
  | "organization"
  | "category"
  | "link"
  | "deadline"
  | "event"
  | "next"
  | "reminder"
  | "notes"
  | "outcome";

export interface BotSessionRow {
  chat_id: string;
  mode: "idle" | "await_draft" | "review_draft" | "draft_field" | "item_field";
  draft: OpportunityDraft | null;
  pending_field: DraftField | null;
  editing_public_id: number | null;
  preview_message_id: number | null;
  updated_at: string;
}

export interface TelegramMessage {
  message_id?: number;
  from?: { id?: number | string };
  chat?: { id?: number | string };
  text?: string;
  caption?: string;
  photo?: Array<{ file_id?: string }>;
}

export interface TelegramCallbackQuery {
  id?: string;
  from?: { id?: number | string };
  data?: string;
  message?: TelegramMessage;
}

export interface TelegramUpdate {
  update_id?: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface ReminderCandidate {
  key: string;
  kind: "manual" | "next_action" | "deadline" | "event" | "overdue" | "course_inactivity";
  dueAt: string;
  targetAt: string;
  targetPrecision: DatePrecision;
  title: string;
  detail: string;
  maximumLatenessMs: number;
}
