import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useTeamSession } from '@/contexts/TeamSessionContext';
import { Button, Input, Card } from '@/components/ui';

export default function QuizLogin() {
  const [teamId, setTeamId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [teamName, setTeamName] = useState('');
  const [verified, setVerified] = useState(false);
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

      // 4. Fetch quizzes and match by team theme if specified
      const { data: quizList } = await supabase
        .from('quizzes')
        .select('*')
        .order('created_at', { ascending: false });

      let quiz = null;
      
      if (team.theme && quizList && quizList.length > 0) {
        // Helper to normalize strings for comparison (removes spaces, underscores, etc)
        const normalize = (str: string) => (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const teamThemeNorm = normalize(team.theme);

        // First try finding a LIVE quiz matching team's theme
        quiz = quizList.find(q => {
          if (q.status !== 'LIVE') return false;
          const titleNorm = normalize(q.title);
          const descNorm = normalize(q.description || '');
          if (!teamThemeNorm) return false;
          
          return (
            (titleNorm && titleNorm.includes(teamThemeNorm)) ||
            (descNorm && descNorm.includes(teamThemeNorm)) ||
            (titleNorm && teamThemeNorm.includes(titleNorm))
          );
        });

        // Then try finding ANY status quiz matching team's theme
        if (!quiz) {
          quiz = quizList.find(q => {
            const titleNorm = normalize(q.title);
            const descNorm = normalize(q.description || '');
            if (!teamThemeNorm) return false;
            
            return (
              (titleNorm && titleNorm.includes(teamThemeNorm)) ||
              (descNorm && descNorm.includes(teamThemeNorm)) ||
              (titleNorm && teamThemeNorm.includes(titleNorm))
            );
          });
        }

        // STRICT MODE: If team has a theme but we couldn't find a matching quiz, block them.
        if (!quiz) {
          setError(`No quiz section found for your theme (${team.theme}). Please contact the organizer.`);
          setLoading(false);
          return;
        }
      } else {
        // Fallback for teams WITHOUT a theme (if applicable)
        if (quizList && quizList.length > 0) {
          quiz = quizList.find(q => q.status === 'LIVE') || quizList[0];
        }
      }

      if (!quiz) {
        setError('No quizzes are currently available.');
        setLoading(false);
        return;
      }

      // Check for active attempt (can resume)
      const { data: activeAttempt } = await supabase
        .from('quiz_attempts')
        .select('*')
        .eq('quiz_id', quiz.id)
        .eq('team_id', trimmedId)
        .eq('status', 'in_progress')
        .single();

      if (!activeAttempt) {
        // Check completed attempts
        const { count: completedCount } = await supabase
          .from('quiz_attempts')
          .select('*', { count: 'exact', head: true })
          .eq('quiz_id', quiz.id)
          .eq('team_id', trimmedId)
          .in('status', ['submitted', 'auto_submitted']);

        const allowedAttempts = settings?.allowed_attempts ?? quiz.default_allowed_attempts;
        if ((completedCount || 0) >= allowedAttempts) {
          setError(`All attempts have been used (${completedCount}/${allowedAttempts}). Contact the organizer for additional attempts.`);
          setLoading(false);
          return;
        }
      }

      // Success
      const name = team.team_name || team.name || trimmedId;
      setTeamName(name);
      setVerified(true);
      setTeamSession(trimmedId, name);

    } catch (err) {
      setError('An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  function handleContinue() {
    navigate('/quiz/check');
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
              <Button onClick={handleContinue} className="w-full" size="lg">
                Proceed to System Check
              </Button>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
