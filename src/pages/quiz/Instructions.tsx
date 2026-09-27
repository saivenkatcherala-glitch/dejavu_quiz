import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useTeamSession } from '@/contexts/TeamSessionContext';
import { Button, Card, Spinner } from '@/components/ui';
import type { Quiz } from '@/lib/types';
import { Clock, AlertTriangle, CheckCircle, Eye, Keyboard, Monitor } from 'lucide-react';

export default function Instructions() {
  const { session } = useTeamSession();
  const navigate = useNavigate();
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!session) {
      navigate('/quiz/login');
      return;
    }
    loadQuiz();
  }, []);

  async function loadQuiz() {
    const { data } = await supabase
      .from('quizzes')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    setQuiz(data);
    setLoading(false);
  }

  async function handleStart() {
    if (!quiz || !session) return;
    setStarting(true);
    setError('');

    try {
      // Check quiz is LIVE
      const { data: freshQuiz } = await supabase
        .from('quizzes')
        .select('status')
        .eq('id', quiz.id)
        .single();

      if (freshQuiz?.status !== 'LIVE') {
        setError('The quiz is not currently live. Please wait for the organizer to start it.');
        setStarting(false);
        return;
      }

      // Start attempt via RPC
      const { data, error: rpcError } = await supabase.rpc('start_quiz_attempt', {
        p_quiz_id: quiz.id,
        p_team_id: session.teamId,
        p_session_token: session.sessionToken,
      });

      if (rpcError) {
        setError(rpcError.message);
        setStarting(false);
        return;
      }

      const result = typeof data === 'string' ? JSON.parse(data) : data;

      if (result.error) {
        setError(result.error);
        setStarting(false);
        return;
      }

      // Store attempt ID
      session.attemptId = result.attempt_id;
      sessionStorage.setItem('dejavu_team_session', JSON.stringify(session));

      // Request fullscreen
      try {
        await document.documentElement.requestFullscreen();
      } catch { /* non-critical */ }

      navigate('/quiz');
    } catch (err: any) {
      setError(err.message || 'Failed to start quiz');
      setStarting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  const duration = quiz ? Math.floor(quiz.duration_seconds / 60) : 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-extrabold text-indigo-600">DejaVu</h1>
          <p className="text-gray-500 mt-2">Welcome, {session?.teamName}</p>
        </div>

        <Card>
          <h2 className="text-xl font-bold text-gray-900 mb-6">Quiz Instructions</h2>

          <div className="space-y-4 mb-8">
            <div className="flex items-start gap-3 p-3 bg-indigo-50 rounded-lg">
              <Clock className="w-5 h-5 text-indigo-600 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium text-gray-900">Duration: {duration} minutes</p>
                <p className="text-sm text-gray-600">The quiz will be auto-submitted when time expires.</p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 bg-amber-50 rounded-lg">
              <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium text-gray-900">Important Rules</p>
                <ul className="text-sm text-gray-600 mt-1 space-y-1">
                  <li>• Do NOT switch tabs or leave the quiz window</li>
                  <li>• Do NOT exit fullscreen mode</li>
                  <li>• Keep your face visible to the camera at all times</li>
                  <li>• Copy, paste, and right-click are disabled</li>
                  <li>• All violations are recorded and visible to the organizer</li>
                </ul>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 bg-emerald-50 rounded-lg">
              <CheckCircle className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium text-gray-900">Quiz Details</p>
                <ul className="text-sm text-gray-600 mt-1 space-y-1">
                  <li>• Your answers are auto-saved as you progress</li>
                  <li>• {quiz?.allow_previous_question ? 'You CAN go back to previous questions' : 'You CANNOT go back to previous questions'}</li>
                  <li>• {quiz?.negative_marking_enabled ? `Negative marking: -${quiz.negative_mark_value} per wrong answer` : 'No negative marking'}</li>
                  <li>• Refreshing the browser will NOT restart your timer or attempt</li>
                </ul>
              </div>
            </div>

            {quiz?.proctoring_enabled && (
              <div className="flex items-start gap-3 p-3 bg-purple-50 rounded-lg">
                <Eye className="w-5 h-5 text-purple-600 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-gray-900">Proctoring Active</p>
                  <p className="text-sm text-gray-600">
                    Camera monitoring, tab switching, and fullscreen detection are enabled.
                  </p>
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">{error}</div>
          )}

          <Button onClick={handleStart} className="w-full" size="lg" loading={starting}>
            Start Quiz
          </Button>
        </Card>
      </div>
    </div>
  );
}
