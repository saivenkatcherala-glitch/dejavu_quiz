import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useTeamSession } from '@/contexts/TeamSessionContext';
import { Button, Spinner, ConfirmDialog } from '@/components/ui';
import { useProctoring } from '@/hooks/useProctoring';
import type { ParticipantQuestion, OptionLetter, Quiz, QuizAttempt } from '@/lib/types';
import { getRemainingSeconds, formatTime, seededShuffle, shuffleOptions } from '@/lib/utils';
import { ChevronLeft, ChevronRight, Send, Clock, AlertTriangle, Wifi, WifiOff } from 'lucide-react';

export default function QuizPage() {
  const { session } = useTeamSession();
  const navigate = useNavigate();

  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [attempt, setAttempt] = useState<QuizAttempt | null>(null);
  const [questions, setQuestions] = useState<ParticipantQuestion[]>([]);
  const [answers, setAnswers] = useState<Map<string, OptionLetter | null>>(new Map());
  const [currentIndex, setCurrentIndex] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [reconnecting, setReconnecting] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(true);

  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const pendingSaves = useRef<Map<string, OptionLetter | null>>(new Map());
  const expiresAtRef = useRef<string>('');
  const attemptIdRef = useRef<string>('');

  // Proctoring
  const [violationPopup, setViolationPopup] = useState<{ message: string; visible: boolean }>({ message: '', visible: false });

  const { violationCount } = useProctoring(
    attemptIdRef.current,
    session?.teamId || '',
    quiz?.proctoring_enabled ?? false,
    (message: string) => {
      setViolationPopup({ message, visible: true });
      setTimeout(() => setViolationPopup(prev => ({ ...prev, visible: false })), 5000);
    },
    (phoneCount: number) => {
      if (phoneCount >= 3 && !submitting && !submitted) {
        handleAutoSubmit('phone_detected_twice');
      }
    }
  );

  // Auto-submit if violation limit reached
  useEffect(() => {
    if (
      quiz?.violation_limit_enabled &&
      quiz.violation_limit > 0 &&
      violationCount >= quiz.violation_limit &&
      !submitting &&
      !submitted
    ) {
      handleAutoSubmit('violation_limit_reached');
    }
  }, [violationCount, quiz, submitting, submitted]);

  // =====================================================
  // INITIALIZATION
  // =====================================================

  useEffect(() => {
    if (!session?.teamId) {
      navigate('/quiz/login');
      return;
    }
    initQuiz();

    const handleFullscreen = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreen);

    return () => {
      clearInterval(timerRef.current);
      clearInterval(heartbeatRef.current);
      document.removeEventListener('fullscreenchange', handleFullscreen);
    };
  }, []);

  async function initQuiz() {
    try {
      // Get quiz
      const { data: quizData } = await supabase
        .from('quizzes')
        .select('*')
        .eq('id', session!.quizId)
        .single();

      if (!quizData) {
        navigate('/quiz/login');
        return;
      }
      setQuiz(quizData);

      // Get or resume attempt
      let attemptData: QuizAttempt | null = null;

      // Check for existing active attempt
      const { data: existing } = await supabase
        .from('quiz_attempts')
        .select('*')
        .eq('quiz_id', quizData.id)
        .eq('team_id', session!.teamId)
        .eq('status', 'in_progress')
        .single();

      if (existing) {
        attemptData = existing;
      } else {
        // Check if already submitted
        const { data: submittedAttempt } = await supabase
          .from('quiz_attempts')
          .select('*')
          .eq('quiz_id', quizData.id)
          .eq('team_id', session!.teamId)
          .in('status', ['submitted', 'auto_submitted'])
          .order('attempt_number', { ascending: false })
          .limit(1)
          .single();

        if (submittedAttempt) {
          navigate('/quiz/result');
          return;
        }

        // Start new attempt
        const { data: startResult } = await supabase.rpc('start_quiz_attempt', {
          p_quiz_id: quizData.id,
          p_team_id: session!.teamId,
          p_session_token: session!.sessionToken,
        });

        const result = typeof startResult === 'string' ? JSON.parse(startResult) : startResult;
        if (result.error) {
          navigate('/quiz/login');
          return;
        }

        const { data: newAttempt } = await supabase
          .from('quiz_attempts')
          .select('*')
          .eq('id', result.attempt_id)
          .single();

        attemptData = newAttempt;
      }

      if (!attemptData) {
        navigate('/quiz/login');
        return;
      }

      setAttempt(attemptData);
      attemptIdRef.current = attemptData.id;
      expiresAtRef.current = attemptData.expires_at;

      // Get questions (without correct answers)
      const { data: questionsResult } = await supabase.rpc('get_quiz_questions', {
        p_quiz_id: quizData.id,
      });

      let qs: ParticipantQuestion[] = typeof questionsResult === 'string'
        ? JSON.parse(questionsResult)
        : questionsResult || [];

      // Randomize questions if enabled
      if (quizData.randomize_questions) {
        qs = seededShuffle(qs, attemptData.question_seed);
      }

      setQuestions(qs);

      // Restore saved answers
      const { data: savedAnswers } = await supabase
        .from('answers')
        .select('*')
        .eq('attempt_id', attemptData.id);

      const answerMap = new Map<string, OptionLetter | null>();
      (savedAnswers || []).forEach(a => {
        answerMap.set(a.question_id, a.selected_option as OptionLetter | null);
      });

      // Restore offline answers from localStorage if present
      const localAnswersRaw = localStorage.getItem(`dejavu_answers_${attemptData.id}`);
      if (localAnswersRaw) {
        try {
          const localAnswers = new Map<string, OptionLetter | null>(JSON.parse(localAnswersRaw));
          localAnswers.forEach((val, key) => {
            answerMap.set(key, val);
            // Queue for sync to ensure server gets it
            pendingSaves.current.set(key, val);
          });
        } catch (e) {
          console.error('Failed to parse local answers', e);
        }
      }

      setAnswers(answerMap);
      syncPendingAnswers(); // Try to sync immediately if we had offline answers

      // Start timer
      const remaining = getRemainingSeconds(attemptData.expires_at);
      setTimeRemaining(remaining);

      if (remaining <= 0) {
        // Time already expired, auto-submit
        await handleAutoSubmit('time_expired');
        return;
      }

      startTimer();
      startHeartbeat();
      setLoading(false);

    } catch (err) {
      console.error('Init error:', err);
      navigate('/quiz/login');
    }
  }

  // =====================================================
  // TIMER
  // =====================================================

  function startTimer() {
    timerRef.current = setInterval(() => {
      const remaining = getRemainingSeconds(expiresAtRef.current);
      setTimeRemaining(remaining);
      if (remaining <= 0) {
        clearInterval(timerRef.current);
        handleAutoSubmit('time_expired');
      }
    }, 1000);
  }

  // =====================================================
  // HEARTBEAT (every 30s)
  // =====================================================

  function startHeartbeat() {
    heartbeatRef.current = setInterval(async () => {
      if (attemptIdRef.current) {
        await supabase
          .from('quiz_attempts')
          .update({ last_heartbeat: new Date().toISOString() })
          .eq('id', attemptIdRef.current);
      }
    }, 30000);
  }

  // =====================================================
  // ANSWER SELECTION & AUTOSAVE
  // =====================================================

  const saveAnswer = useCallback(async (questionId: string, option: OptionLetter | null) => {
    if (!attemptIdRef.current) return;

    try {
      const { error } = await supabase
        .from('answers')
        .upsert({
          attempt_id: attemptIdRef.current,
          question_id: questionId,
          selected_option: option,
          answered_at: new Date().toISOString(),
        }, {
          onConflict: 'attempt_id,question_id',
        });

      if (error) {
        // Queue for retry
        pendingSaves.current.set(questionId, option);
      } else {
        pendingSaves.current.delete(questionId);
      }
    } catch {
      pendingSaves.current.set(questionId, option);
    }
  }, []);

  function handleSelectOption(option: OptionLetter) {
    const q = questions[currentIndex];
    if (!q) return;

    const currentAnswer = answers.get(q.id);
    const newAnswer = currentAnswer === option ? null : option; // Toggle deselect

    setAnswers(prev => {
      const next = new Map(prev);
      if (newAnswer === null) {
        next.delete(q.id);
      } else {
        next.set(q.id, newAnswer);
      }
      // Save local backup immediately
      if (attemptIdRef.current) {
        localStorage.setItem(`dejavu_answers_${attemptIdRef.current}`, JSON.stringify(Array.from(next.entries())));
      }
      return next;
    });

    saveAnswer(q.id, newAnswer);
  }

  // =====================================================
  // NETWORK RECOVERY
  // =====================================================

  useEffect(() => {
    const handleOnline = () => {
      setOnline(true);
      setReconnecting(true);
      // Sync pending saves
      syncPendingAnswers().then(() => setReconnecting(false));
    };
    const handleOffline = () => setOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  async function syncPendingAnswers() {
    for (const [qId, option] of pendingSaves.current) {
      await saveAnswer(qId, option);
    }
  }

  // =====================================================
  // SUBMISSION
  // =====================================================

  async function handleSubmit() {
    setSubmitting(true);
    setShowSubmitConfirm(false);

    try {
      // Sync any pending answers first
      await syncPendingAnswers();

      const { data, error } = await supabase.rpc('submit_attempt', {
        p_attempt_id: attemptIdRef.current,
        p_status: 'submitted',
      });

      if (error) throw error;

      const result = typeof data === 'string' ? JSON.parse(data) : data;
      if (result.error) throw new Error(result.error);

      setSubmitted(true);
      clearInterval(timerRef.current);
      clearInterval(heartbeatRef.current);
      localStorage.removeItem(`dejavu_answers_${attemptIdRef.current}`);

      // Exit fullscreen
      try { document.exitFullscreen?.(); } catch {}

      navigate('/quiz/result');
    } catch (err: any) {
      setSubmitting(false);
      setViolationPopup({ message: 'Failed to submit. Please try again.', visible: true });
    }
  }

  async function handleAutoSubmit(reason: 'time_expired' | 'violation_limit_reached' | 'phone_detected_twice' = 'time_expired') {
    try {
      await syncPendingAnswers();
      await supabase.rpc('submit_attempt', {
        p_attempt_id: attemptIdRef.current,
        p_status: 'auto_submitted',
      });
    } catch {}
    clearInterval(timerRef.current);
    clearInterval(heartbeatRef.current);
    localStorage.removeItem(`dejavu_answers_${attemptIdRef.current}`);
    try { document.exitFullscreen?.(); } catch {}
    navigate('/quiz/result', { state: { reason } });
  }

  // =====================================================
  // NAVIGATION
  // =====================================================

  function goToQuestion(index: number) {
    if (index >= 0 && index < questions.length) {
      setCurrentIndex(index);
    }
  }

  // =====================================================
  // RENDER
  // =====================================================

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <Spinner size="lg" />
          <p className="mt-4 text-gray-500">Loading quiz...</p>
        </div>
      </div>
    );
  }

  const currentQuestion = questions[currentIndex];
  const currentAnswer = currentQuestion ? answers.get(currentQuestion.id) : null;
  const answeredCount = answers.size;
  const unansweredCount = questions.length - answeredCount;
  const isTimeLow = timeRemaining < 300;
  const isTimeCritical = timeRemaining < 60;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-bold text-indigo-600">DejaVu</h1>
          <span className="text-sm text-gray-500">{session?.teamName}</span>
        </div>

        <div className="flex items-center gap-4">
          {/* Network status */}
          {!online && (
            <div className="flex items-center gap-1 text-red-600 text-sm">
              <WifiOff className="w-4 h-4" />
              <span>Offline</span>
            </div>
          )}
          {reconnecting && (
            <div className="flex items-center gap-1 text-amber-600 text-sm">
              <Wifi className="w-4 h-4 animate-pulse" />
              <span>Reconnecting...</span>
            </div>
          )}

          {/* Violation Counter - Always visible when proctoring is on */}
          {quiz?.proctoring_enabled && (
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm font-semibold ${
              violationCount === 0
                ? 'bg-emerald-100 text-emerald-700'
                : violationCount < (quiz.violation_limit_enabled ? Math.floor(quiz.violation_limit * 0.7) : 999)
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-red-100 text-red-700 animate-pulse'
            }`}>
              <AlertTriangle className="w-3.5 h-3.5" />
              {violationCount} violation{violationCount !== 1 ? 's' : ''}
              {quiz.violation_limit_enabled && (
                <span className="text-xs opacity-70">/ {quiz.violation_limit}</span>
              )}
            </div>
          )}

          {/* Timer */}
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg font-mono text-lg font-bold ${
            isTimeCritical
              ? 'bg-red-100 text-red-700 animate-pulse'
              : isTimeLow
                ? 'bg-amber-100 text-amber-700'
                : 'bg-gray-100 text-gray-900'
          }`}>
            <Clock className="w-4 h-4" />
            {formatTime(timeRemaining)}
          </div>
        </div>
      </header>

      {/* Violation Popup Overlay */}
      {violationPopup.visible && (
        <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
          <div className="bg-red-600 text-white px-8 py-5 rounded-2xl shadow-2xl max-w-md mx-4 flex items-start gap-4 animate-bounce-once pointer-events-auto">
            <AlertTriangle className="w-7 h-7 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-lg">Violation Detected!</p>
              <p className="text-red-100 text-sm mt-1">{violationPopup.message}</p>
              <p className="text-red-200 text-xs mt-2">Total violations: {violationCount}</p>
            </div>
            <button onClick={() => setViolationPopup(prev => ({ ...prev, visible: false }))} className="ml-auto text-red-200 hover:text-white text-xl leading-none">&times;</button>
          </div>
        </div>
      )}

      {/* Fullscreen Overlay Block */}
      {!isFullscreen && !submitted && (
        <div className="fixed inset-0 z-[100] bg-gray-900/95 flex flex-col items-center justify-center text-white px-4">
          <AlertTriangle className="w-20 h-20 text-red-500 mb-6" />
          <h2 className="text-3xl font-bold mb-3 text-center">Fullscreen Required</h2>
          <p className="text-lg text-gray-300 mb-8 max-w-lg text-center">
            You have exited fullscreen mode. This has been recorded as a violation. You must return to fullscreen to continue the quiz.
          </p>
          <Button 
            size="lg" 
            onClick={() => document.documentElement.requestFullscreen().catch(() => {})}
            className="text-lg px-8 py-4"
          >
            Return to Fullscreen
          </Button>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Question Navigation Palette */}
        <aside className="w-48 bg-white border-r border-gray-200 p-4 overflow-y-auto hidden md:block">
          <p className="text-xs text-gray-500 mb-3 font-medium">
            Q {currentIndex + 1} of {questions.length}
          </p>
          <div className="grid grid-cols-5 gap-1.5">
            {questions.map((q, i) => {
              const isAnswered = answers.has(q.id);
              const isCurrent = i === currentIndex;
              return (
                <button
                  key={q.id}
                  onClick={() => goToQuestion(i)}
                  className={`w-8 h-8 rounded-md text-xs font-medium transition-all ${
                    isCurrent
                      ? 'bg-indigo-600 text-white ring-2 ring-indigo-300'
                      : isAnswered
                        ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
          <div className="mt-4 space-y-1 text-xs text-gray-500">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded bg-emerald-100 border border-emerald-200" />
              Answered ({answeredCount})
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded bg-gray-100 border border-gray-200" />
              Unanswered ({unansweredCount})
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded bg-indigo-600" />
              Current
            </div>
          </div>
        </aside>

        {/* Question Area */}
        <main className="flex-1 p-6 overflow-y-auto">
          <div className="max-w-2xl mx-auto">
            {/* Mobile palette toggle */}
            <div className="flex flex-wrap gap-1.5 mb-4 md:hidden">
              {questions.map((q, i) => {
                const isAnswered = answers.has(q.id);
                const isCurrent = i === currentIndex;
                return (
                  <button
                    key={q.id}
                    onClick={() => goToQuestion(i)}
                    className={`w-7 h-7 rounded text-xs font-medium ${
                      isCurrent
                        ? 'bg-indigo-600 text-white'
                        : isAnswered
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {i + 1}
                  </button>
                );
              })}
            </div>

            {/* Question */}
            {currentQuestion && (
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <span className="bg-indigo-100 text-indigo-700 px-2.5 py-1 rounded-full text-xs font-medium">
                    Question {currentIndex + 1} / {questions.length}
                  </span>
                  <span className="text-xs text-gray-400">
                    {currentQuestion.marks} mark{currentQuestion.marks !== 1 ? 's' : ''}
                    {currentQuestion.negative_marks > 0 && ` · -${currentQuestion.negative_marks} negative`}
                  </span>
                </div>

                <h2 className="text-lg font-medium text-gray-900 mb-6 leading-relaxed">
                  {currentQuestion.question_text}
                </h2>

                <div className="space-y-3">
                  {(['A', 'B', 'C', 'D'] as OptionLetter[]).map(opt => {
                    const optKey = `option_${opt.toLowerCase()}` as keyof ParticipantQuestion;
                    const text = currentQuestion[optKey] as string;
                    const isSelected = currentAnswer === opt;

                    return (
                      <button
                        key={opt}
                        onClick={() => handleSelectOption(opt)}
                        className={`w-full text-left px-5 py-4 rounded-xl border-2 transition-all duration-150 ${
                          isSelected
                            ? 'border-indigo-500 bg-indigo-50 text-indigo-900'
                            : 'border-gray-200 bg-white hover:border-indigo-200 hover:bg-indigo-50/30 text-gray-700'
                        }`}
                      >
                        <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-sm font-medium mr-3 ${
                          isSelected
                            ? 'bg-indigo-600 text-white'
                            : 'bg-gray-100 text-gray-600'
                        }`}>
                          {opt}
                        </span>
                        {text}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Navigation */}
            <div className="flex items-center justify-between mt-8 pt-6 border-t border-gray-100">
              <Button
                variant="secondary"
                onClick={() => goToQuestion(currentIndex - 1)}
                disabled={currentIndex === 0 || !quiz?.allow_previous_question}
              >
                <ChevronLeft className="w-4 h-4 mr-1" />
                Previous
              </Button>

              {currentIndex < questions.length - 1 ? (
                <Button onClick={() => goToQuestion(currentIndex + 1)}>
                  Next
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              ) : (
                <Button
                  variant="success"
                  onClick={() => setShowSubmitConfirm(true)}
                  loading={submitting}
                >
                  <Send className="w-4 h-4 mr-2" />
                  Submit Quiz
                </Button>
              )}
            </div>
          </div>
        </main>
      </div>

      {/* Submit Confirmation */}
      <ConfirmDialog
        open={showSubmitConfirm}
        onClose={() => setShowSubmitConfirm(false)}
        onConfirm={handleSubmit}
        title="Submit Quiz"
        message={`You have answered ${answeredCount} of ${questions.length} questions. ${unansweredCount > 0 ? `${unansweredCount} question(s) are unanswered. ` : ''}Are you sure you want to submit?`}
        confirmText="Submit"
        loading={submitting}
      />
    </div>
  );
}
