-- =====================================================
-- DejaVu — Complete SQL Migration
-- Run this in Supabase SQL Editor
-- =====================================================

-- Enable pgcrypto for password hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =====================================================
-- 1. TEAMS TABLE (Registration data)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.teams (
  team_id    TEXT PRIMARY KEY,
  team_name  TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'registered',
  email      TEXT,
  college    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================
-- 2. ADMINS TABLE (Custom admin auth)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.admins (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Insert admin users
INSERT INTO public.admins (email, password_hash, name) VALUES
  ('muralikrishna2444b@gmail.com', crypt('Dejavu2026', gen_salt('bf')), 'Murali Krishna'),
  ('saivenkat.cherala@gmail.com', crypt('Dejavu2026', gen_salt('bf')), 'Sai Venkat')
ON CONFLICT (email) DO NOTHING;

-- Admin login verification function
CREATE OR REPLACE FUNCTION public.verify_admin_login(p_email TEXT, p_password TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_admin RECORD;
BEGIN
  SELECT * INTO v_admin FROM public.admins
  WHERE email = lower(p_email) AND password_hash = crypt(p_password, password_hash);

  IF v_admin IS NULL THEN
    RETURN json_build_object('error', 'Invalid email or password');
  END IF;

  RETURN json_build_object(
    'id', v_admin.id,
    'email', v_admin.email,
    'name', v_admin.name
  );
END;
$$;

-- =====================================================
-- 3. QUIZ TABLE
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
-- 4. QUESTIONS TABLE
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
-- 5. TEAM QUIZ SETTINGS
-- =====================================================
CREATE TABLE IF NOT EXISTS public.team_quiz_settings (
  team_id            TEXT PRIMARY KEY REFERENCES public.teams(team_id),
  allowed_attempts   INTEGER NOT NULL DEFAULT 1,
  is_disabled        BOOLEAN NOT NULL DEFAULT false,
  final_score_policy TEXT NOT NULL DEFAULT 'best'
                     CHECK (final_score_policy IN ('best','latest','selected')),
  selected_attempt_id UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================
-- 6. QUIZ ATTEMPTS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.quiz_attempts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id         UUID NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
  team_id         TEXT NOT NULL REFERENCES public.teams(team_id),
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
-- 7. ANSWERS TABLE
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
-- 8. VIOLATIONS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.violations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id  UUID NOT NULL REFERENCES public.quiz_attempts(id) ON DELETE CASCADE,
  team_id     TEXT NOT NULL REFERENCES public.teams(team_id),
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
-- 9. ADMIN ACTIVITY LOGS
-- =====================================================
CREATE TABLE IF NOT EXISTS public.admin_activity_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID,
  action        TEXT NOT NULL,
  target_type   TEXT,
  target_id     TEXT,
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_logs_created ON public.admin_activity_logs(created_at DESC);

-- =====================================================
-- 10. RLS POLICIES (anon-friendly since no Supabase Auth)
-- =====================================================
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quizzes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_quiz_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.violations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_activity_logs ENABLE ROW LEVEL SECURITY;

-- Teams: anyone can read
CREATE POLICY "teams_read" ON public.teams FOR SELECT USING (true);
CREATE POLICY "teams_all" ON public.teams FOR ALL USING (true) WITH CHECK (true);

-- Admins: no direct read (only via RPC verify_admin_login)
CREATE POLICY "admins_deny" ON public.admins FOR SELECT USING (false);

-- Quizzes: anyone can read, anyone can modify (admin check in app layer)
CREATE POLICY "quizzes_read" ON public.quizzes FOR SELECT USING (true);
CREATE POLICY "quizzes_all" ON public.quizzes FOR ALL USING (true) WITH CHECK (true);

-- Questions: all access (admin manages, participants get via RPC without correct_option)
CREATE POLICY "questions_all" ON public.questions FOR ALL USING (true) WITH CHECK (true);

-- Team quiz settings: all access
CREATE POLICY "team_settings_all" ON public.team_quiz_settings FOR ALL USING (true) WITH CHECK (true);

-- Quiz attempts: all access
CREATE POLICY "attempts_all" ON public.quiz_attempts FOR ALL USING (true) WITH CHECK (true);

-- Answers: all access
CREATE POLICY "answers_all" ON public.answers FOR ALL USING (true) WITH CHECK (true);

-- Violations: all access
CREATE POLICY "violations_all" ON public.violations FOR ALL USING (true) WITH CHECK (true);

-- Admin logs: all access
CREATE POLICY "admin_logs_all" ON public.admin_activity_logs FOR ALL USING (true) WITH CHECK (true);

-- =====================================================
-- 11. SERVER-SIDE FUNCTIONS
-- =====================================================

-- Get quiz questions WITHOUT correct_option (for participants)
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

-- Calculate attempt score server-side
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
  SELECT qa.quiz_id INTO v_quiz_id FROM public.quiz_attempts qa WHERE qa.id = p_attempt_id;
  SELECT q.negative_marking_enabled, q.negative_mark_value
  INTO v_neg_enabled, v_neg_value
  FROM public.quizzes q WHERE q.id = v_quiz_id;

  FOR rec IN
    SELECT qs.id AS question_id, qs.correct_option, qs.marks, qs.negative_marks, a.selected_option
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

  UPDATE public.quiz_attempts
  SET score = GREATEST(v_score, 0), max_score = v_max_score,
      correct_count = v_correct, wrong_count = v_wrong,
      unanswered_count = v_unanswered, updated_at = now()
  WHERE id = p_attempt_id;
END;
$$;

-- Submit attempt
CREATE OR REPLACE FUNCTION public.submit_attempt(p_attempt_id UUID, p_status TEXT DEFAULT 'submitted')
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_attempt RECORD;
  v_result JSON;
BEGIN
  SELECT * INTO v_attempt FROM public.quiz_attempts WHERE id = p_attempt_id FOR UPDATE;
  IF v_attempt IS NULL THEN
    RETURN json_build_object('error', 'Attempt not found');
  END IF;
  IF v_attempt.status != 'in_progress' THEN
    RETURN json_build_object('error', 'Attempt already submitted', 'status', v_attempt.status);
  END IF;

  UPDATE public.quiz_attempts SET status = p_status, submitted_at = now(), updated_at = now()
  WHERE id = p_attempt_id;

  PERFORM public.calculate_attempt_score(p_attempt_id);

  SELECT json_build_object(
    'attempt_id', qa.id, 'status', qa.status, 'score', qa.score,
    'max_score', qa.max_score, 'correct_count', qa.correct_count,
    'wrong_count', qa.wrong_count, 'unanswered_count', qa.unanswered_count,
    'submitted_at', qa.submitted_at
  ) INTO v_result FROM public.quiz_attempts qa WHERE qa.id = p_attempt_id;

  RETURN v_result;
END;
$$;

-- Start quiz attempt
CREATE OR REPLACE FUNCTION public.start_quiz_attempt(
  p_quiz_id UUID, p_team_id TEXT, p_session_token TEXT DEFAULT NULL
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
  SELECT * INTO v_quiz FROM public.quizzes WHERE id = p_quiz_id;
  IF v_quiz IS NULL OR v_quiz.status != 'LIVE' THEN
    RETURN json_build_object('error', 'Quiz is not currently live');
  END IF;

  -- Check for active attempt (resume)
  SELECT * INTO v_existing FROM public.quiz_attempts
  WHERE quiz_id = p_quiz_id AND team_id = p_team_id AND status = 'in_progress' LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN json_build_object(
      'attempt_id', v_existing.id, 'attempt_number', v_existing.attempt_number,
      'started_at', v_existing.started_at, 'expires_at', v_existing.expires_at,
      'question_seed', v_existing.question_seed, 'resumed', true
    );
  END IF;

  -- Get team settings
  SELECT * INTO v_settings FROM public.team_quiz_settings WHERE team_id = p_team_id;
  v_allowed := COALESCE(v_settings.allowed_attempts, v_quiz.default_allowed_attempts);

  IF v_settings IS NOT NULL AND v_settings.is_disabled THEN
    RETURN json_build_object('error', 'Team is disabled');
  END IF;

  SELECT COUNT(*) INTO v_attempt_count FROM public.quiz_attempts
  WHERE quiz_id = p_quiz_id AND team_id = p_team_id AND status IN ('submitted','auto_submitted');

  IF v_attempt_count >= v_allowed THEN
    RETURN json_build_object('error', 'No attempts remaining', 'used', v_attempt_count, 'allowed', v_allowed);
  END IF;

  INSERT INTO public.quiz_attempts (
    quiz_id, team_id, attempt_number, started_at, expires_at, status, session_token
  ) VALUES (
    p_quiz_id, p_team_id, v_attempt_count + 1,
    now(), now() + (v_quiz.duration_seconds || ' seconds')::interval,
    'in_progress', p_session_token
  ) RETURNING * INTO v_attempt;

  RETURN json_build_object(
    'attempt_id', v_attempt.id, 'attempt_number', v_attempt.attempt_number,
    'started_at', v_attempt.started_at, 'expires_at', v_attempt.expires_at,
    'question_seed', v_attempt.question_seed, 'resumed', false
  );
END;
$$;

-- =====================================================
-- 12. UPDATED_AT TRIGGERS
-- =====================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
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

-- =====================================================
-- 13. SEED DATA
-- =====================================================

-- Dummy teams
INSERT INTO public.teams (team_id, team_name, status) VALUES
  ('T001', 'Tech Titans', 'registered'),
  ('T002', 'Code Crushers', 'registered'),
  ('T003', 'Byte Brigade', 'registered'),
  ('T004', 'Logic Legends', 'registered'),
  ('T005', 'Debug Dynasty', 'registered')
ON CONFLICT (team_id) DO NOTHING;

-- Create the DejaVu quiz
INSERT INTO public.quizzes (
  id, title, description, duration_seconds, status,
  default_allowed_attempts, negative_marking_enabled, negative_mark_value,
  randomize_questions, randomize_options, show_score_after_submit,
  show_correct_answers_after_submit, allow_previous_question,
  auto_submit_on_expiry, proctoring_enabled
) VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'DejaVu', 'Welcome to DejaVu — the ultimate online proctored team quiz!',
  1800, 'DRAFT', 1, true, 0.25, true, true, true, false, true, true, true
) ON CONFLICT (id) DO NOTHING;

-- 10 dummy questions
INSERT INTO public.questions (quiz_id, question_text, option_a, option_b, option_c, option_d, correct_option, marks, negative_marks, sort_order) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'What does HTML stand for?', 'Hyper Text Markup Language', 'High Tech Modern Language', 'Hyper Transfer Markup Language', 'Home Tool Markup Language', 'A', 1, 0.25, 1),
  ('a0000000-0000-0000-0000-000000000001', 'Which language is primarily used for styling web pages?', 'Python', 'CSS', 'JavaScript', 'HTML', 'B', 1, 0.25, 2),
  ('a0000000-0000-0000-0000-000000000001', 'What is the time complexity of binary search?', 'O(n)', 'O(n²)', 'O(log n)', 'O(1)', 'C', 1, 0.25, 3),
  ('a0000000-0000-0000-0000-000000000001', 'Which data structure uses LIFO (Last In, First Out)?', 'Queue', 'Stack', 'Linked List', 'Array', 'B', 1, 0.25, 4),
  ('a0000000-0000-0000-0000-000000000001', 'What does SQL stand for?', 'Structured Query Language', 'Simple Query Language', 'Standard Question Language', 'Sequential Query Logic', 'A', 1, 0.25, 5),
  ('a0000000-0000-0000-0000-000000000001', 'Which of the following is NOT a JavaScript framework?', 'React', 'Angular', 'Django', 'Vue', 'C', 1, 0.25, 6),
  ('a0000000-0000-0000-0000-000000000001', 'What is the full form of API?', 'Application Programming Interface', 'Advanced Program Integration', 'Automated Protocol Interface', 'Application Process Integration', 'A', 1, 0.25, 7),
  ('a0000000-0000-0000-0000-000000000001', 'Which protocol is used for secure web communication?', 'HTTP', 'FTP', 'HTTPS', 'SMTP', 'C', 1, 0.25, 8),
  ('a0000000-0000-0000-0000-000000000001', 'What does CPU stand for?', 'Central Processing Unit', 'Computer Processing Unit', 'Central Program Utility', 'Computer Program Unit', 'A', 1, 0.25, 9),
  ('a0000000-0000-0000-0000-000000000001', 'Who created the Python programming language?', 'Google', 'Microsoft', 'Guido van Rossum', 'Apple', 'C', 1, 0.25, 10);
