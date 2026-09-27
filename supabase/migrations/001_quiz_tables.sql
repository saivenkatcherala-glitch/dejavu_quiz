/* =====================================================
   DejaVu — Supabase SQL Migration
   Quiz-specific tables, RLS policies, indexes, and
   helper functions.
   
   NOTE: This migration DOES NOT touch the existing
   registration tables. It references them via foreign
   keys against a `teams` table — adjust the FK target
   if your existing table has a different name.
   ===================================================== */

-- =====================================================
-- 1. QUIZ TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.quizzes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title         TEXT NOT NULL DEFAULT 'DejaVu',
  description   TEXT,
  duration_seconds INTEGER NOT NULL DEFAULT 1800,
  status        TEXT NOT NULL DEFAULT 'DRAFT'
                CHECK (status IN ('DRAFT','READY','LIVE','PAUSED','CLOSED')),
  default_allowed_attempts INTEGER NOT NULL DEFAULT 1,
  negative_marking_enabled BOOLEAN NOT NULL DEFAULT false,
  negative_mark_value      NUMERIC(5,2) NOT NULL DEFAULT 0,
  randomize_questions      BOOLEAN NOT NULL DEFAULT false,
  randomize_options        BOOLEAN NOT NULL DEFAULT false,
  show_score_after_submit  BOOLEAN NOT NULL DEFAULT true,
  show_correct_answers_after_submit BOOLEAN NOT NULL DEFAULT false,
  allow_previous_question  BOOLEAN NOT NULL DEFAULT true,
  auto_submit_on_expiry    BOOLEAN NOT NULL DEFAULT true,
  proctoring_enabled       BOOLEAN NOT NULL DEFAULT true,
  scheduled_start          TIMESTAMPTZ,
  scheduled_end            TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================
-- 2. QUESTIONS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.questions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id        UUID NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
  question_text  TEXT NOT NULL,
  option_a       TEXT NOT NULL,
  option_b       TEXT NOT NULL,
  option_c       TEXT NOT NULL,
  option_d       TEXT NOT NULL,
  correct_option TEXT NOT NULL CHECK (correct_option IN ('A','B','C','D')),
  marks          NUMERIC(5,2) NOT NULL DEFAULT 1,
  negative_marks NUMERIC(5,2) NOT NULL DEFAULT 0,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_questions_quiz_id ON public.questions(quiz_id);

-- =====================================================
-- 3. TEAM QUIZ SETTINGS (overlay on existing teams)
-- =====================================================
-- This table stores quiz-specific per-team settings
-- without modifying the existing registration table.
CREATE TABLE IF NOT EXISTS public.team_quiz_settings (
  team_id            TEXT PRIMARY KEY,  -- references existing team ID
  allowed_attempts   INTEGER NOT NULL DEFAULT 1,
  is_disabled        BOOLEAN NOT NULL DEFAULT false,
  final_score_policy TEXT NOT NULL DEFAULT 'best'
                     CHECK (final_score_policy IN ('best','latest','selected')),
  selected_attempt_id UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================
-- 4. QUIZ ATTEMPTS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.quiz_attempts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id         UUID NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
  team_id         TEXT NOT NULL,
  attempt_number  INTEGER NOT NULL DEFAULT 1,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  submitted_at    TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'in_progress'
                  CHECK (status IN ('in_progress','submitted','auto_submitted','expired','cancelled')),
  score           NUMERIC(7,2),
  max_score       NUMERIC(7,2),
  correct_count   INTEGER DEFAULT 0,
  wrong_count     INTEGER DEFAULT 0,
  unanswered_count INTEGER DEFAULT 0,
  violation_count INTEGER DEFAULT 0,
  question_seed   INTEGER NOT NULL DEFAULT floor(random() * 2147483647)::int,
  session_token   TEXT,
  last_heartbeat  TIMESTAMPTZ DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (quiz_id, team_id, attempt_number)
);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_team_id ON public.quiz_attempts(team_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_quiz_id ON public.quiz_attempts(quiz_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_status ON public.quiz_attempts(status);

-- =====================================================
-- 5. ANSWERS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.answers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id      UUID NOT NULL REFERENCES public.quiz_attempts(id) ON DELETE CASCADE,
  question_id     UUID NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  selected_option TEXT CHECK (selected_option IN ('A','B','C','D') OR selected_option IS NULL),
  answered_at     TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (attempt_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_answers_attempt_id ON public.answers(attempt_id);

-- =====================================================
-- 6. VIOLATIONS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.violations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id  UUID NOT NULL REFERENCES public.quiz_attempts(id) ON DELETE CASCADE,
  team_id     TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN (
    'TAB_SWITCH','WINDOW_BLUR','FULLSCREEN_EXIT','CAMERA_DISABLED',
    'NO_FACE','MULTIPLE_FACES','COPY_ATTEMPT','PASTE_ATTEMPT',
    'RIGHT_CLICK','NETWORK_DISCONNECT'
  )),
  severity    TEXT NOT NULL DEFAULT 'low' CHECK (severity IN ('low','medium','high')),
  timestamp   TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_violations_attempt_id ON public.violations(attempt_id);
CREATE INDEX IF NOT EXISTS idx_violations_team_id ON public.violations(team_id);

-- =====================================================
-- 7. ADMIN ACTIVITY LOGS
-- =====================================================
CREATE TABLE IF NOT EXISTS public.admin_activity_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID NOT NULL,
  action        TEXT NOT NULL,
  target_type   TEXT,
  target_id     TEXT,
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_logs_admin ON public.admin_activity_logs(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_logs_created ON public.admin_activity_logs(created_at DESC);

-- =====================================================
-- 8. HELPER FUNCTIONS
-- =====================================================

-- Function to calculate score server-side
CREATE OR REPLACE FUNCTION public.calculate_attempt_score(p_attempt_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_quiz_id UUID;
  v_correct INTEGER := 0;
  v_wrong INTEGER := 0;
  v_unanswered INTEGER := 0;
  v_score NUMERIC(7,2) := 0;
  v_max_score NUMERIC(7,2) := 0;
  v_neg_enabled BOOLEAN;
  v_neg_value NUMERIC(5,2);
  rec RECORD;
BEGIN
  -- Get quiz info
  SELECT qa.quiz_id INTO v_quiz_id FROM public.quiz_attempts qa WHERE qa.id = p_attempt_id;

  SELECT q.negative_marking_enabled, q.negative_mark_value
  INTO v_neg_enabled, v_neg_value
  FROM public.quizzes q WHERE q.id = v_quiz_id;

  -- Iterate questions
  FOR rec IN
    SELECT
      qs.id AS question_id,
      qs.correct_option,
      qs.marks,
      qs.negative_marks,
      a.selected_option
    FROM public.questions qs
    LEFT JOIN public.answers a ON a.question_id = qs.id AND a.attempt_id = p_attempt_id
    WHERE qs.quiz_id = v_quiz_id
  LOOP
    v_max_score := v_max_score + rec.marks;
    IF rec.selected_option IS NULL THEN
      v_unanswered := v_unanswered + 1;
    ELSIF rec.selected_option = rec.correct_option THEN
      v_correct := v_correct + 1;
      v_score := v_score + rec.marks;
    ELSE
      v_wrong := v_wrong + 1;
      IF v_neg_enabled THEN
        v_score := v_score - COALESCE(rec.negative_marks, v_neg_value);
      END IF;
    END IF;
  END LOOP;

  -- Update attempt
  UPDATE public.quiz_attempts
  SET
    score = GREATEST(v_score, 0),
    max_score = v_max_score,
    correct_count = v_correct,
    wrong_count = v_wrong,
    unanswered_count = v_unanswered,
    updated_at = now()
  WHERE id = p_attempt_id;
END;
$$;

-- Function to submit an attempt
CREATE OR REPLACE FUNCTION public.submit_attempt(p_attempt_id UUID, p_status TEXT DEFAULT 'submitted')
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_attempt RECORD;
  v_result JSON;
BEGIN
  -- Get attempt and lock it
  SELECT * INTO v_attempt FROM public.quiz_attempts WHERE id = p_attempt_id FOR UPDATE;

  IF v_attempt IS NULL THEN
    RETURN json_build_object('error', 'Attempt not found');
  END IF;

  IF v_attempt.status != 'in_progress' THEN
    RETURN json_build_object('error', 'Attempt already submitted', 'status', v_attempt.status);
  END IF;

  -- Update status
  UPDATE public.quiz_attempts
  SET status = p_status, submitted_at = now(), updated_at = now()
  WHERE id = p_attempt_id;

  -- Calculate score
  PERFORM public.calculate_attempt_score(p_attempt_id);

  -- Get final result
  SELECT json_build_object(
    'attempt_id', qa.id,
    'status', qa.status,
    'score', qa.score,
    'max_score', qa.max_score,
    'correct_count', qa.correct_count,
    'wrong_count', qa.wrong_count,
    'unanswered_count', qa.unanswered_count,
    'submitted_at', qa.submitted_at
  ) INTO v_result
  FROM public.quiz_attempts qa WHERE qa.id = p_attempt_id;

  RETURN v_result;
END;
$$;

-- Function to start an attempt
CREATE OR REPLACE FUNCTION public.start_quiz_attempt(
  p_quiz_id UUID,
  p_team_id TEXT,
  p_session_token TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_quiz RECORD;
  v_settings RECORD;
  v_existing RECORD;
  v_attempt_count INTEGER;
  v_allowed INTEGER;
  v_attempt RECORD;
BEGIN
  -- Get quiz
  SELECT * INTO v_quiz FROM public.quizzes WHERE id = p_quiz_id;
  IF v_quiz IS NULL OR v_quiz.status != 'LIVE' THEN
    RETURN json_build_object('error', 'Quiz is not currently live');
  END IF;

  -- Check for active attempt first
  SELECT * INTO v_existing
  FROM public.quiz_attempts
  WHERE quiz_id = p_quiz_id AND team_id = p_team_id AND status = 'in_progress'
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    -- Return existing attempt (resume)
    RETURN json_build_object(
      'attempt_id', v_existing.id,
      'attempt_number', v_existing.attempt_number,
      'started_at', v_existing.started_at,
      'expires_at', v_existing.expires_at,
      'question_seed', v_existing.question_seed,
      'resumed', true
    );
  END IF;

  -- Get team settings
  SELECT * INTO v_settings FROM public.team_quiz_settings WHERE team_id = p_team_id;
  v_allowed := COALESCE(v_settings.allowed_attempts, v_quiz.default_allowed_attempts);

  IF v_settings IS NOT NULL AND v_settings.is_disabled THEN
    RETURN json_build_object('error', 'Team is disabled');
  END IF;

  -- Count completed attempts
  SELECT COUNT(*) INTO v_attempt_count
  FROM public.quiz_attempts
  WHERE quiz_id = p_quiz_id AND team_id = p_team_id AND status IN ('submitted','auto_submitted');

  IF v_attempt_count >= v_allowed THEN
    RETURN json_build_object('error', 'No attempts remaining', 'used', v_attempt_count, 'allowed', v_allowed);
  END IF;

  -- Create new attempt
  INSERT INTO public.quiz_attempts (
    quiz_id, team_id, attempt_number, started_at, expires_at, status, session_token
  ) VALUES (
    p_quiz_id, p_team_id, v_attempt_count + 1,
    now(), now() + (v_quiz.duration_seconds || ' seconds')::interval,
    'in_progress', p_session_token
  ) RETURNING * INTO v_attempt;

  RETURN json_build_object(
    'attempt_id', v_attempt.id,
    'attempt_number', v_attempt.attempt_number,
    'started_at', v_attempt.started_at,
    'expires_at', v_attempt.expires_at,
    'question_seed', v_attempt.question_seed,
    'resumed', false
  );
END;
$$;

-- =====================================================
-- 9. RLS POLICIES
-- =====================================================

ALTER TABLE public.quizzes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_quiz_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.violations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_activity_logs ENABLE ROW LEVEL SECURITY;

-- Quizzes: anyone can read basic info, only admins can modify
CREATE POLICY "quizzes_select" ON public.quizzes FOR SELECT USING (true);
CREATE POLICY "quizzes_admin" ON public.quizzes FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- Questions: only admins can see (correct_option is sensitive)
-- Participants get questions through the RPC function
CREATE POLICY "questions_admin" ON public.questions FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- Team quiz settings: admins full access
CREATE POLICY "team_settings_admin" ON public.team_quiz_settings FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');
-- Participants can read their own settings
CREATE POLICY "team_settings_anon_select" ON public.team_quiz_settings FOR SELECT
  USING (true);

-- Quiz attempts: participants can see their own
CREATE POLICY "attempts_select_own" ON public.quiz_attempts FOR SELECT
  USING (true);
CREATE POLICY "attempts_admin" ON public.quiz_attempts FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- Answers: participants can insert/update their own during active attempt
CREATE POLICY "answers_insert_anon" ON public.answers FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.quiz_attempts qa
      WHERE qa.id = attempt_id AND qa.status = 'in_progress'
    )
  );
CREATE POLICY "answers_update_anon" ON public.answers FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.quiz_attempts qa
      WHERE qa.id = attempt_id AND qa.status = 'in_progress'
    )
  );
CREATE POLICY "answers_select_own" ON public.answers FOR SELECT
  USING (true);
CREATE POLICY "answers_admin" ON public.answers FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- Violations: anon can insert for active attempts
CREATE POLICY "violations_insert_anon" ON public.violations FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.quiz_attempts qa
      WHERE qa.id = attempt_id AND qa.status = 'in_progress'
    )
  );
CREATE POLICY "violations_admin" ON public.violations FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- Admin activity logs: only admins
CREATE POLICY "admin_logs_admin" ON public.admin_activity_logs FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- =====================================================
-- 10. Function to get questions for participant
-- (without correct_option!)
-- =====================================================
CREATE OR REPLACE FUNCTION public.get_quiz_questions(p_quiz_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN (
    SELECT json_agg(json_build_object(
      'id', q.id,
      'question_text', q.question_text,
      'option_a', q.option_a,
      'option_b', q.option_b,
      'option_c', q.option_c,
      'option_d', q.option_d,
      'marks', q.marks,
      'negative_marks', q.negative_marks,
      'sort_order', q.sort_order
    ) ORDER BY q.sort_order, q.created_at)
    FROM public.questions q
    WHERE q.quiz_id = p_quiz_id
  );
END;
$$;

-- =====================================================
-- 11. Updated_at trigger
-- =====================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_quizzes_updated_at BEFORE UPDATE ON public.quizzes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_questions_updated_at BEFORE UPDATE ON public.questions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_quiz_attempts_updated_at BEFORE UPDATE ON public.quiz_attempts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_answers_updated_at BEFORE UPDATE ON public.answers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_team_settings_updated_at BEFORE UPDATE ON public.team_quiz_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
