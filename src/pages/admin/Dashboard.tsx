import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { StatCard, Card, Badge, Spinner } from '@/components/ui';
import type { DashboardStats, Quiz } from '@/lib/types';
import { Users, PlayCircle, CheckCircle, Clock, AlertTriangle, Award, BarChart3, XCircle } from 'lucide-react';

export default function AdminDashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [recentAttempts, setRecentAttempts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboard();
  }, []);

  async function loadDashboard() {
    try {
      // Get active quiz
      const { data: quizData } = await supabase
        .from('quizzes')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      setQuiz(quizData);

      if (!quizData) {
        setLoading(false);
        return;
      }

      // Get attempts for this quiz
      const { data: attempts } = await supabase
        .from('quiz_attempts')
        .select('*')
        .eq('quiz_id', quizData.id);

      const allAttempts = attempts || [];

      // Get registrations for DejaVu
      const { data: dejavuRegs } = await supabase
        .from('Registration')
        .select('id')
        .eq('eventId', 'evt_384fc25f545a4e68a379dceed0eb3458');
        
      const dejavuRegIds = new Set((dejavuRegs || []).map(r => r.id));

      // Get all teams
      const { data: allTeams } = await supabase.from('Team').select('id, registrationId');
      let teamCount = 0;
      if (allTeams && allTeams.length > 0) {
        if (dejavuRegs && dejavuRegs.length > 0) {
          teamCount = allTeams.filter(t => !t.registrationId || dejavuRegIds.has(t.registrationId)).length;
        } else {
          teamCount = allTeams.length;
        }
      } else {
        const { count } = await supabase.from('teams').select('*', { count: 'exact', head: true });
        teamCount = count || 0;
      }

      // Get violation counts
      const { data: violationData } = await supabase
        .from('violations')
        .select('team_id')
        .in('attempt_id', allAttempts.map(a => a.id));

      const flaggedTeams = new Set((violationData || []).map(v => v.team_id));
      const flaggedWithHighCount = (violationData || []).length;

      const inProgress = allAttempts.filter(a => a.status === 'in_progress').length;
      const submitted = allAttempts.filter(a => ['submitted', 'auto_submitted'].includes(a.status)).length;
      const scores = allAttempts.filter(a => a.score != null).map(a => a.score as number);

      const dashStats: DashboardStats = {
        totalTeams: teamCount || 0,
        started: allAttempts.length,
        inProgress,
        submitted,
        notStarted: Math.max(0, (teamCount || 0) - new Set(allAttempts.map(a => a.team_id)).size),
        averageScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length * 10) / 10 : 0,
        highestScore: scores.length ? Math.max(...scores) : 0,
        flaggedSessions: flaggedTeams.size,
      };

      setStats(dashStats);

      // Recent attempts
      const { data: recent } = await supabase
        .from('quiz_attempts')
        .select('*')
        .eq('quiz_id', quizData.id)
        .order('created_at', { ascending: false })
        .limit(10);

      setRecentAttempts(recent || []);
    } catch (err) {
      console.error('Dashboard load error:', err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-500 text-sm mt-1">DejaVu Quiz Overview</p>
        </div>
        {quiz && <Badge variant={quiz.status}>{quiz.status}</Badge>}
      </div>

      {/* Stats Grid */}
      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard label="Registered Teams" value={stats.totalTeams} icon={<Users className="w-6 h-6" />} />
          <StatCard label="In Progress" value={stats.inProgress} icon={<PlayCircle className="w-6 h-6" />} color="text-blue-600" />
          <StatCard label="Submitted" value={stats.submitted} icon={<CheckCircle className="w-6 h-6" />} color="text-emerald-600" />
          <StatCard label="Not Started" value={stats.notStarted} icon={<Clock className="w-6 h-6" />} color="text-gray-600" />
          <StatCard label="Average Score" value={stats.averageScore} icon={<BarChart3 className="w-6 h-6" />} color="text-purple-600" />
          <StatCard label="Highest Score" value={stats.highestScore} icon={<Award className="w-6 h-6" />} color="text-amber-600" />
          <StatCard label="Started" value={stats.started} icon={<PlayCircle className="w-6 h-6" />} color="text-indigo-600" />
          <StatCard label="Flagged Sessions" value={stats.flaggedSessions} icon={<AlertTriangle className="w-6 h-6" />} color="text-red-600" />
        </div>
      )}

      {/* Recent Attempts */}
      <Card>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Attempts</h2>
        {recentAttempts.length === 0 ? (
          <p className="text-gray-500 text-sm py-4">No attempts yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-3 px-2 text-gray-500 font-medium">Team</th>
                  <th className="text-left py-3 px-2 text-gray-500 font-medium">Attempt</th>
                  <th className="text-left py-3 px-2 text-gray-500 font-medium">Status</th>
                  <th className="text-left py-3 px-2 text-gray-500 font-medium">Score</th>
                  <th className="text-left py-3 px-2 text-gray-500 font-medium">Time</th>
                </tr>
              </thead>
              <tbody>
                {recentAttempts.map(attempt => (
                  <tr key={attempt.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-3 px-2 font-medium">{attempt.team_id}</td>
                    <td className="py-3 px-2">#{attempt.attempt_number}</td>
                    <td className="py-3 px-2"><Badge variant={attempt.status}>{attempt.status}</Badge></td>
                    <td className="py-3 px-2">{attempt.score != null ? `${attempt.score}/${attempt.max_score}` : '—'}</td>
                    <td className="py-3 px-2 text-gray-500">{new Date(attempt.created_at).toLocaleTimeString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
