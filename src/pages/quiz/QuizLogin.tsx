import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useTeamSession } from '@/contexts/TeamSessionContext';
import { Button, Input, Card } from '@/components/ui';
import type { Quiz } from '@/lib/types';

export default function QuizLogin() {
  const [teamId, setTeamId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [teamName, setTeamName] = useState('');
  const [verified, setVerified] = useState(false);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [selectedQuizId, setSelectedQuizId] = useState<string>('');
  const { setTeamSession } = useTeamSession();
  const navigate = useNavigate();

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const trimmedId = teamId.trim();

      // 1. Fetch team from the Team table
      const { data: team, error: teamError } = await supabase
        .from('Team')
        .select('*')
        .eq('id', trimmedId)
        .single();

      if (teamError || !team) {
        setError('Team ID not found. Please check and try again.');
        setLoading(false);
        return;
      }

      // 2. Fetch the registration to verify the event
      if (team.registrationId) {
        const { data: reg } = await supabase
          .from('Registration')
          .select('eventId')
          .eq('id', team.registrationId)
          .single();
          
        if (!reg || reg.eventId !== 'evt_384fc25f545a4e68a379dceed0eb3458') {
          setError('This team is not registered for the DejaVu Hackathon.');
          setLoading(false);
          return;
        }
      }

      // 2. Check registration status (if you have a status column, otherwise skip)
      // We will skip this since we just verified they are in the table for this event


      // 3. Check if team is disabled
      const { data: settings } = await supabase
        .from('team_quiz_settings')
        .select('*')
        .eq('team_id', trimmedId)
        .single();

      if (settings?.is_disabled) {
        setError('This team has been disabled. Contact the organizer.');
        setLoading(false);
        return;
      }

      // Check if team already has attempts (locks them to a quiz)
      const { data: pastAttempts } = await supabase
        .from('quiz_attempts')
        .select('quiz_id')
        .eq('team_id', trimmedId)
        .in('status', ['submitted', 'auto_submitted', 'in_progress']);

      let lockedQuizId = null;
      if (pastAttempts && pastAttempts.length > 0) {
        lockedQuizId = pastAttempts[0].quiz_id;
      }

      // Fetch LIVE quizzes
      let query = supabase.from('quizzes').select('*').eq('status', 'LIVE').order('created_at', { ascending: false });
      
      // If locked, we fetch that specific quiz even if it's not LIVE anymore (so they can review it or resume if allowed)
      if (lockedQuizId) {
        query = supabase.from('quizzes').select('*').eq('id', lockedQuizId);
      }

      const { data: quizList, error: quizError } = await query;
      
      if (quizError || !quizList || quizList.length === 0) {
        setError(lockedQuizId ? 'Your assigned quiz is no longer available.' : 'No LIVE quizzes are currently available.');
        setLoading(false);
        return;
      }

      setQuizzes(quizList);
      if (quizList.length === 1 || lockedQuizId) {
        setSelectedQuizId(quizList[0].id);
      } else {
        // If multiple LIVE quizzes and no lock, let them select (no default to force explicit choice if we want, or default to first)
        setSelectedQuizId('');
      }

      // Success (verification step)
      const name = team.team_name || team.name || trimmedId;
      setTeamName(name);
      setVerified(true);


    } catch (err) {
      setError('An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  }



  async function handleContinue() {
    if (!selectedQuizId) {
      setError('Please select a quiz to continue.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const trimmedId = teamId.trim();
      const { data: quiz } = await supabase.from('quizzes').select('default_allowed_attempts').eq('id', selectedQuizId).single();
      const { data: settings } = await supabase.from('team_quiz_settings').select('allowed_attempts').eq('team_id', trimmedId).single();
      
      const { data: activeAttempt } = await supabase.from('quiz_attempts')
        .select('id').eq('quiz_id', selectedQuizId).eq('team_id', trimmedId).eq('status', 'in_progress').maybeSingle();

      if (!activeAttempt) {
        const { count: completedCount } = await supabase.from('quiz_attempts')
          .select('*', { count: 'exact', head: true })
          .eq('quiz_id', selectedQuizId).eq('team_id', trimmedId).in('status', ['submitted', 'auto_submitted']);

        const allowedAttempts = settings?.allowed_attempts ?? quiz?.default_allowed_attempts ?? 1;
        if ((completedCount || 0) >= allowedAttempts) {
          setError(`All attempts have been used (${completedCount}/${allowedAttempts}). Contact the organizer for additional attempts.`);
          setLoading(false);
          return;
        }
      }

      setTeamSession(trimmedId, teamName, selectedQuizId);
      navigate('/quiz/check');
    } catch(err) {
      setError('Failed to start quiz. Please try again.');
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex flex-col justify-between items-center px-4 py-6">
      <div className="w-full max-w-4xl flex justify-end">
        <button
          onClick={() => navigate('/admin/login')}
          className="text-sm font-medium text-indigo-600 hover:text-indigo-800 bg-white border border-indigo-200 px-4 py-2 rounded-full shadow-sm hover:shadow transition-all flex items-center gap-1.5"
        >
          🔐 Admin Portal
        </button>
      </div>

      <div className="w-full max-w-md my-auto">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-extrabold text-indigo-600 tracking-tight">DejaVu</h1>
          <p className="text-gray-500 mt-2">Online Proctored Quiz</p>
        </div>

        <Card>
          {!verified ? (
            <form onSubmit={handleVerify} className="space-y-5">
              <Input
                label="Team ID"
                value={teamId}
                onChange={e => setTeamId(e.target.value)}
                placeholder="Enter your Team ID (e.g., T001)"
                required
                autoFocus
              />
              {error && (
                <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
              )}
              <Button type="submit" className="w-full" loading={loading} size="lg">
                Continue
              </Button>
            </form>
          ) : (
            <div className="text-center space-y-5">
              <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
                <svg className="w-8 h-8 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <p className="text-sm text-gray-500">Team ID: {teamId.trim()}</p>
                <h2 className="text-2xl font-bold text-gray-900 mt-1">Welcome, {teamName}</h2>
              </div>
              
              <div className="text-left mt-6 mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {quizzes.length === 1 ? 'Assigned Quiz / Theme' : 'Select your Theme / Quiz'}
                </label>
                <select
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-sm"
                  value={selectedQuizId}
                  onChange={(e) => setSelectedQuizId(e.target.value)}
                  disabled={quizzes.length === 1}
                >
                  <option value="" disabled>-- Select a Quiz --</option>
                  {quizzes.map(q => (
                    <option key={q.id} value={q.id}>{q.title}</option>
                  ))}
                </select>
                {quizzes.length > 1 && (
                  <p className="text-xs text-orange-600 mt-2 font-medium">
                    ⚠️ You can only attempt ONE quiz. Once started, you cannot switch.
                  </p>
                )}
              </div>

              {error && (
                <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
              )}
              
              <Button onClick={handleContinue} className="w-full" size="lg" loading={loading}>
                Proceed to System Check
              </Button>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
