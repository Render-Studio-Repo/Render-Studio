-- Users extras: Cloud waitlist + activity summary counts.
-- Additive only. Do not drop existing columns (including cloud_compute_interest).
-- Service role writes. Authenticated may read their own non-secret summary cols.

-- Cloud compute waitlist (trainings + policies).
alter table public."Users"
  add column if not exists cloud_compute_interest boolean not null default false;

alter table public."Users"
  add column if not exists cloud_compute_interest_at timestamptz;

-- Feedback / Studio activity summaries (counts, bool from suggestions_count > 0).
alter table public."Users"
  add column if not exists suggestions_count integer not null default 0;

alter table public."Users"
  add column if not exists submitted_suggestions boolean not null default false;

alter table public."Users"
  add column if not exists render_agent_questions_count integer not null default 0;

alter table public."Users"
  add column if not exists chats_sent_count integer not null default 0;

alter table public."Users"
  add column if not exists bug_requests_count integer not null default 0;

create index if not exists idx_users_cloud_compute_interest
  on public."Users" (cloud_compute_interest)
  where cloud_compute_interest = true;

grant select (
  cloud_compute_interest,
  cloud_compute_interest_at,
  suggestions_count,
  submitted_suggestions,
  render_agent_questions_count,
  chats_sent_count,
  bug_requests_count
) on public."Users" to authenticated;
