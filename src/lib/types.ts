// =====================================================
// DejaVu — Type Definitions
// =====================================================

export type QuizStatus = 'DRAFT' | 'READY' | 'LIVE' | 'PAUSED' | 'CLOSED';

export type AttemptStatus = 'in_progress' | 'submitted' | 'auto_submitted' | 'expired' | 'cancelled';

export type ViolationType =
  | 'TAB_SWITCH'
  | 'WINDOW_BLUR'
  | 'FULLSCREEN_EXIT'
  | 'CAMERA_DISABLED'
  | 'NO_FACE'
  | 'MULTIPLE_FACES'
  | 'COPY_ATTEMPT'
  | 'PASTE_ATTEMPT'
  | 'RIGHT_CLICK'
  | 'NETWORK_DISCONNECT';

export type Severity = 'low' | 'medium' | 'high';

export type OptionLetter = 'A' | 'B' | 'C' | 'D';

export type FinalScorePolicy = 'best' | 'latest' | 'selected';

// =====================================================
// Existing Registration Table (read-only reference)
// The actual column names will be mapped in teamService
// =====================================================
export interface Team {
  team_id: string;
  team_name: string;
  is_registered: boolean;
  is_eligible: boolean;
  // Add more fields from your existing table as needed
}

// =====================================================
// Quiz Tables
// =====================================================

export interface Quiz {
  id: string;
  title: string;
  description: string | null;
  duration_seconds: number;
  status: QuizStatus;
  default_allowed_attempts: number;
  negative_marking_enabled: boolean;
  negative_mark_value: number;
  randomize_questions: boolean;
  randomize_options: boolean;
  show_score_after_submit: boolean;
  show_correct_answers_after_submit: boolean;
  allow_previous_question: boolean;
  auto_submit_on_expiry: boolean;
  proctoring_enabled: boolean;
  scheduled_start: string | null;
  scheduled_end: string | null;
  created_at: string;
  updated_at: string;
}

export interface Question {
  id: string;
  quiz_id: string;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_option: OptionLetter;
  marks: number;
  negative_marks: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// Question as seen by participant (no correct_option)
export interface ParticipantQuestion {
  id: string;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  marks: number;
  negative_marks: number;
  sort_order: number;
}

export interface TeamQuizSettings {
  team_id: string;
  allowed_attempts: number;
  is_disabled: boolean;
  final_score_policy: FinalScorePolicy;
  selected_attempt_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface QuizAttempt {
  id: string;
  quiz_id: string;
  team_id: string;
  attempt_number: number;
  started_at: string;
  expires_at: string;
  submitted_at: string | null;
  status: AttemptStatus;
  score: number | null;
  max_score: number | null;
  correct_count: number;
  wrong_count: number;
  unanswered_count: number;
  violation_count: number;
  question_seed: number;
  session_token: string | null;
  last_heartbeat: string;
  created_at: string;
  updated_at: string;
}

export interface Answer {
  id: string;
  attempt_id: string;
  question_id: string;
  selected_option: OptionLetter | null;
  answered_at: string;
  updated_at: string;
}

export interface Violation {
  id: string;
  attempt_id: string;
  team_id: string;
  type: ViolationType;
  severity: Severity;
  timestamp: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface AdminActivityLog {
  id: string;
  admin_user_id: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

// =====================================================
// Dashboard Stats
// =====================================================

export interface DashboardStats {
  totalTeams: number;
  started: number;
  inProgress: number;
  submitted: number;
  notStarted: number;
  averageScore: number;
  highestScore: number;
  flaggedSessions: number;
}

// =====================================================
// Team Management View
// =====================================================

export interface TeamWithQuizInfo extends Team {
  allowed_attempts: number;
  attempts_used: number;
  attempts_remaining: number;
  is_disabled: boolean;
  best_score: number | null;
  violation_count: number;
}

// =====================================================
// CSV Import
// =====================================================

export interface CSVQuestionRow {
  question: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_option: string;
  marks: string;
  negative_marks: string;
}

export interface CSVValidationResult {
  valid: CSVQuestionRow[];
  errors: { row: number; message: string }[];
}

// =====================================================
// Session
// =====================================================

export interface TeamSession {
  teamId: string;
  teamName: string;
  attemptId?: string;
  sessionToken: string;
}
