-- AuraStudy Phase 4: Initial PostgreSQL Schema & Row Level Security (RLS)
-- Strictly separates Deadline and Schedule semantics at the database constraint level.

CREATE TABLE IF NOT EXISTS public.calendar_items (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('deadline', 'schedule')),
  title TEXT NOT NULL CHECK (char_length(trim(title)) > 0),
  due_date TEXT,
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  description TEXT,
  tag TEXT,
  status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_calendar_items_deadline_fields CHECK (
    type <> 'deadline' OR (
      due_date IS NOT NULL
      AND char_length(trim(due_date)) > 0
      AND start_at IS NULL
      AND end_at IS NULL
      AND (status IS NULL OR status IN ('pending', 'completed'))
    )
  ),

  CONSTRAINT chk_calendar_items_schedule_fields CHECK (
    type <> 'schedule' OR (
      due_date IS NULL
      AND start_at IS NOT NULL
      AND end_at IS NOT NULL
      AND end_at > start_at
      AND (status IS NULL OR status IN ('scheduled', 'completed', 'cancelled'))
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_calendar_items_user_id
  ON public.calendar_items(user_id);

CREATE INDEX IF NOT EXISTS idx_calendar_items_user_start_at
  ON public.calendar_items(user_id, start_at)
  WHERE type = 'schedule';

CREATE TABLE IF NOT EXISTS public.proposal_changes (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_item_id TEXT,
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected', 'stale', 'blocked')),
  before_snapshot JSONB,
  after_snapshot JSONB,
  base_revision INTEGER CHECK (base_revision IS NULL OR base_revision > 0),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_proposal_changes_action_fields CHECK (
    (action = 'create' AND target_item_id IS NULL AND before_snapshot IS NULL AND after_snapshot IS NOT NULL AND base_revision IS NULL)
    OR
    (action = 'update' AND target_item_id IS NOT NULL AND before_snapshot IS NOT NULL AND after_snapshot IS NOT NULL AND base_revision IS NOT NULL)
    OR
    (action = 'delete' AND target_item_id IS NOT NULL AND before_snapshot IS NOT NULL AND after_snapshot IS NULL AND base_revision IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_proposal_changes_user_id
  ON public.proposal_changes(user_id);

CREATE INDEX IF NOT EXISTS idx_proposal_changes_user_proposal
  ON public.proposal_changes(user_id, proposal_id);

CREATE TABLE IF NOT EXISTS public.decision_logs (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  change_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  decision TEXT NOT NULL CHECK (decision IN ('accepted', 'rejected')),
  target_item_id TEXT,
  summary TEXT NOT NULL CHECK (char_length(trim(summary)) > 0),
  reason TEXT,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_decision_logs_user_decided_at
  ON public.decision_logs(user_id, decided_at DESC);

-- ============================================================================
-- Row Level Security (RLS): Strict per-user isolation via auth.uid() = user_id
-- ============================================================================

ALTER TABLE public.calendar_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proposal_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.decision_logs ENABLE ROW LEVEL SECURITY;

-- calendar_items policies
DROP POLICY IF EXISTS calendar_items_select_own ON public.calendar_items;
CREATE POLICY calendar_items_select_own
  ON public.calendar_items FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS calendar_items_insert_own ON public.calendar_items;
CREATE POLICY calendar_items_insert_own
  ON public.calendar_items FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS calendar_items_update_own ON public.calendar_items;
CREATE POLICY calendar_items_update_own
  ON public.calendar_items FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS calendar_items_delete_own ON public.calendar_items;
CREATE POLICY calendar_items_delete_own
  ON public.calendar_items FOR DELETE
  USING (auth.uid() = user_id);

-- proposal_changes policies
DROP POLICY IF EXISTS proposal_changes_select_own ON public.proposal_changes;
CREATE POLICY proposal_changes_select_own
  ON public.proposal_changes FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS proposal_changes_insert_own ON public.proposal_changes;
CREATE POLICY proposal_changes_insert_own
  ON public.proposal_changes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS proposal_changes_update_own ON public.proposal_changes;
CREATE POLICY proposal_changes_update_own
  ON public.proposal_changes FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS proposal_changes_delete_own ON public.proposal_changes;
CREATE POLICY proposal_changes_delete_own
  ON public.proposal_changes FOR DELETE
  USING (auth.uid() = user_id);

-- decision_logs policies
DROP POLICY IF EXISTS decision_logs_select_own ON public.decision_logs;
CREATE POLICY decision_logs_select_own
  ON public.decision_logs FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS decision_logs_insert_own ON public.decision_logs;
CREATE POLICY decision_logs_insert_own
  ON public.decision_logs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS decision_logs_update_own ON public.decision_logs;
CREATE POLICY decision_logs_update_own
  ON public.decision_logs FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS decision_logs_delete_own ON public.decision_logs;
CREATE POLICY decision_logs_delete_own
  ON public.decision_logs FOR DELETE
  USING (auth.uid() = user_id);
