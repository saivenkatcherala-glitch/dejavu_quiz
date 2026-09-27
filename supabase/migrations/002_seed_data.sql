-- =====================================================
-- DejaVu — Seed Data for Development
-- Run this AFTER running 001_quiz_tables.sql
-- =====================================================

-- NOTE: If your existing registration table is different
-- from "teams", adjust this accordingly. This assumes
-- your registration table is called "teams" with columns:
-- team_id, team_name, status

-- ONLY INSERT IF your registration table is empty or
-- you want test teams alongside real ones.

-- Check if teams table exists first, then insert dummy teams
INSERT INTO public.teams (team_id, team_name, status)
VALUES
  ('T001', 'Tech Titans', 'registered'),
  ('T002', 'Code Crushers', 'registered'),
  ('T003', 'Byte Brigade', 'registered'),
  ('T004', 'Logic Legends', 'registered'),
  ('T005', 'Debug Dynasty', 'registered')
ON CONFLICT (team_id) DO NOTHING;

-- Create the DejaVu quiz
INSERT INTO public.quizzes (
  id, title, description, duration_seconds, status,
  default_allowed_attempts, negative_marking_enabled,
  negative_mark_value, randomize_questions, randomize_options,
  show_score_after_submit, show_correct_answers_after_submit,
  allow_previous_question, auto_submit_on_expiry, proctoring_enabled
) VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'DejaVu',
  'Welcome to DejaVu — the ultimate online proctored team quiz!',
  1800, -- 30 minutes
  'DRAFT',
  1,
  true,
  0.25,
  true,
  true,
  true,
  false,
  true,
  true,
  true
);

-- Insert 10 dummy questions
INSERT INTO public.questions (quiz_id, question_text, option_a, option_b, option_c, option_d, correct_option, marks, negative_marks, sort_order)
VALUES
  ('a0000000-0000-0000-0000-000000000001',
   'What does HTML stand for?',
   'Hyper Text Markup Language',
   'High Tech Modern Language',
   'Hyper Transfer Markup Language',
   'Home Tool Markup Language',
   'A', 1, 0.25, 1),

  ('a0000000-0000-0000-0000-000000000001',
   'Which language is primarily used for styling web pages?',
   'Python',
   'CSS',
   'JavaScript',
   'HTML',
   'B', 1, 0.25, 2),

  ('a0000000-0000-0000-0000-000000000001',
   'What is the time complexity of binary search?',
   'O(n)',
   'O(n²)',
   'O(log n)',
   'O(1)',
   'C', 1, 0.25, 3),

  ('a0000000-0000-0000-0000-000000000001',
   'Which data structure uses LIFO (Last In, First Out)?',
   'Queue',
   'Stack',
   'Linked List',
   'Array',
   'B', 1, 0.25, 4),

  ('a0000000-0000-0000-0000-000000000001',
   'What does SQL stand for?',
   'Structured Query Language',
   'Simple Query Language',
   'Standard Question Language',
   'Sequential Query Logic',
   'A', 1, 0.25, 5),

  ('a0000000-0000-0000-0000-000000000001',
   'Which of the following is NOT a JavaScript framework?',
   'React',
   'Angular',
   'Django',
   'Vue',
   'C', 1, 0.25, 6),

  ('a0000000-0000-0000-0000-000000000001',
   'What is the full form of API?',
   'Application Programming Interface',
   'Advanced Program Integration',
   'Automated Protocol Interface',
   'Application Process Integration',
   'A', 1, 0.25, 7),

  ('a0000000-0000-0000-0000-000000000001',
   'Which protocol is used for secure web communication?',
   'HTTP',
   'FTP',
   'HTTPS',
   'SMTP',
   'C', 1, 0.25, 8),

  ('a0000000-0000-0000-0000-000000000001',
   'What does CPU stand for?',
   'Central Processing Unit',
   'Computer Processing Unit',
   'Central Program Utility',
   'Computer Program Unit',
   'A', 1, 0.25, 9),

  ('a0000000-0000-0000-0000-000000000001',
   'Which company developed the Python programming language?',
   'Google',
   'Microsoft',
   'Guido van Rossum',
   'Apple',
   'C', 1, 0.25, 10);
