-- AuraStudy Migration 002: Item Attachments & User Tags Management
-- Idempotent script: safe to re-run in Supabase SQL Editor.

-- 1. Add attachments JSONB column to calendar_items
ALTER TABLE public.calendar_items
  ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb;

-- 2. Create user_tags table
CREATE TABLE IF NOT EXISTS public.user_tags (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(trim(name)) > 0),
  color TEXT NOT NULL CHECK (
    color IN ('indigo', 'emerald', 'amber', 'rose', 'violet', 'cyan', 'orange', 'slate')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_tags_user_id
  ON public.user_tags(user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_tags_user_name_unique
  ON public.user_tags(user_id, lower(trim(name)));

-- 3. Enable RLS & define idempotent policies on user_tags
ALTER TABLE public.user_tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_tags_select_own ON public.user_tags;
CREATE POLICY user_tags_select_own
  ON public.user_tags FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS user_tags_insert_own ON public.user_tags;
CREATE POLICY user_tags_insert_own
  ON public.user_tags FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS user_tags_update_own ON public.user_tags;
CREATE POLICY user_tags_update_own
  ON public.user_tags FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS user_tags_delete_own ON public.user_tags;
CREATE POLICY user_tags_delete_own
  ON public.user_tags FOR DELETE
  USING (auth.uid() = user_id);
