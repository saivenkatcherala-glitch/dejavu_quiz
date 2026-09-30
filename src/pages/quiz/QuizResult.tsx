import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useTeamSession } from '@/contexts/TeamSessionContext';
import { Card, Spinner, Button } from '@/components/ui';
import type { QuizAttempt } from '@/lib/types';
import { CheckCircle, XCircle, MinusCircle, Clock, Trophy } from 'lucide-react';

export default function QuizResult() {
  const { session, clearSession } = useTeamSession();
  const navigate = useNavigate();
  const [attempt, setAttempt] = useState<QuizAttempt | null>(null);
  const [loading, setLoading] = useState(true);
  const [showScore, setShowScore] = useState(false);

  useEffect(() => {
    if (!session?.teamId) {
      navigate('/quiz/login');
      return;
    }
    loadResult();
  }, []);

  async function loadResult() {
    try {
      // Get latest quiz
      const { data: quizData } = await supabase
        .from('quizzes')
        .select('*')
        .eq('id', session!.quizId)
        .single();

      if (!quizData) {
        navigate('/quiz/login');
        return;
      }

      setShowScore(quizData.show_score_after_submit);

      // Get latest completed attempt
      const { data: attemptData } = await supabase
        .from('quiz_attempts')
        .select('*')
        .eq('quiz_id', quizData.id)
        .eq('team_id', session!.teamId)
        .in('status', ['submitted', 'auto_submitted'])
        .order('attempt_number', { ascending: false })
        .limit(1)
        .single();

      if (!attemptData) {
        // Check for in-progress
        const { data: activeAttempt } = await supabase
          .from('quiz_attempts')
          .select('*')
          .eq('quiz_id', quizData.id)
          .eq('team_id', session!.teamId)
          .eq('status', 'in_progress')
          .single();

        if (activeAttempt) {
          navigate('/quiz');
          return;
        }

        navigate('/quiz/login');
        return;
      }

      setAttempt(attemptData);
    } catch (err) {
      console.error('Error loading result:', err);
    } finally {
      setLoading(false);
    }
  }

  function handleLogout() {
    clearSession();
    navigate('/quiz/login');
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-purple-50">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!attempt) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">No result found.</p>
      </div>
    );
  }

  const percentage = attempt.max_score
    ? Math.round(((attempt.score || 0) / attempt.max_score) * 100)
    : 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-extrabold text-indigo-600">DejaVu</h1>
        </div>

        <Card>
          <div className="text-center">
            {/* Status */}
            <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
              <Trophy className="w-10 h-10 text-emerald-600" />
            </div>

            <h2 className="text-xl font-bold text-gray-900 mb-1">Quiz Submitted!</h2>
            <p className="text-gray-500 mb-6">Team: {session?.teamName}</p>

            {showScore ? (
              <>
                {/* Score */}
                <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-xl p-6 mb-6">
                  <p className="text-sm text-gray-500 mb-1">Your Score</p>
                  <p className="text-5xl font-extrabold text-indigo-600">
                    {attempt.score}
                    <span className="text-2xl text-gray-400 font-normal"> / {attempt.max_score}</span>
                  </p>
                  <p className="text-sm text-gray-500 mt-2">{percentage}%</p>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-4 mb-6">
                  <div className="text-center p-3 bg-emerald-50 rounded-lg">
                    <CheckCircle className="w-5 h-5 text-emerald-600 mx-auto mb-1" />
                    <p className="text-2xl font-bold text-emerald-600">{attempt.correct_count}</p>
                    <p className="text-xs text-gray-500">Correct</p>
                  </div>
                  <div className="text-center p-3 bg-red-50 rounded-lg">
                    <XCircle className="w-5 h-5 text-red-600 mx-auto mb-1" />
                    <p className="text-2xl font-bold text-red-600">{attempt.wrong_count}</p>
                    <p className="text-xs text-gray-500">Wrong</p>
                  </div>
                  <div className="text-center p-3 bg-gray-50 rounded-lg">
                    <MinusCircle className="w-5 h-5 text-gray-500 mx-auto mb-1" />
                    <p className="text-2xl font-bold text-gray-600">{attempt.unanswered_count}</p>
                    <p className="text-xs text-gray-500">Unanswered</p>
                  </div>
                </div>
              </>
            ) : (
              <div className="bg-gray-50 rounded-xl p-6 mb-6">
                <p className="text-gray-600">Your answers have been recorded successfully.</p>
                <p className="text-sm text-gray-400 mt-2">Results will be shared by the organizer.</p>
              </div>
            )}

            {/* Submission time */}
            <div className="flex items-center justify-center gap-2 text-sm text-gray-500 mb-6">
              <Clock className="w-4 h-4" />
              <span>
                {attempt.status === 'auto_submitted' ? 'Auto-submitted' : 'Submitted'} at{' '}
                {attempt.submitted_at ? new Date(attempt.submitted_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
              </span>
            </div>

            <Button variant="secondary" onClick={handleLogout} className="w-full">
              Done
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
