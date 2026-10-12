import React, { useEffect, useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { StatCard, Card, Badge, Spinner, Button } from '@/components/ui';
import type { DashboardStats, Quiz } from '@/lib/types';
import { Users, PlayCircle, CheckCircle, Clock, AlertTriangle, Award, BarChart3, RotateCcw } from 'lucide-react';

const STORAGE_QUIZ_KEY = 'dejavu_admin_dashboard_quiz';

export default function AdminDashboard() {
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [selectedQuizId, setSelectedQuizId] = useState<string>('');
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentAttempts, setRecentAttempts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => {
    initDashboard();
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  useEffect(() => {
    if (selectedQuizId) {
      loadStatsForQuiz(selectedQuizId);
      // Auto-refresh stats every 10 seconds
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(() => {
        loadStatsForQuiz(selectedQuizId, true);
      }, 10000);
    }
  }, [selectedQuizId]);

  async function initDashboard() {
    try {
      const { data: allQuizzes, error: qErr } = await supabase
        .from('quizzes')
        .select('*')
        .order('created_at', { ascending: false });

      if (qErr || !allQuizzes || allQuizzes.length === 0) {
        setLoading(false);
        return;
      }

      setQuizzes(allQuizzes);

      // Check if user previously selected a quiz
      const savedQuizId = localStorage.getItem(STORAGE_QUIZ_KEY);
      const savedExists = savedQuizId && allQuizzes.some(q => q.id === savedQuizId);

      if (savedExists) {
        setSelectedQuizId(savedQuizId!);
      } else {
        // Find the quiz that has the most attempts or is currently LIVE
        const { data: attempts } = await supabase
          .from('quiz_attempts')
          .select('quiz_id');

        const attemptCountMap = new Map<string, number>();
        (attempts || []).forEach(a => {
          attemptCountMap.set(a.quiz_id, (attemptCountMap.get(a.quiz_id) || 0) + 1);
        });

        // Pick quiz with most attempts, or first LIVE quiz, or first quiz
        let bestQuiz = allQuizzes.find(q => (attemptCountMap.get(q.id) || 0) > 0);
        if (!bestQuiz) {
          bestQuiz = allQuizzes.find(q => q.status === 'LIVE') || allQuizzes[0];
        }

        setSelectedQuizId(bestQuiz.id);
        localStorage.setItem(STORAGE_QUIZ_KEY, bestQuiz.id);
      }
    } catch (err) {
      console.error('Failed to init dashboard:', err);
    } finally {
      setLoading(false);
    }
  }

  async function loadStatsForQuiz(quizId: string, isSilent = false) {
    if (!isSilent) setRefreshing(true);

    try {
      // 1. Get attempts
      let attemptsQuery = supabase.from('quiz_attempts').select('*');
      if (quizId !== 'all') {
        attemptsQuery = attemptsQuery.eq('quiz_id', quizId);
      }

      const { data: attempts, error: attErr } = await attemptsQuery;
      if (attErr) console.error('Error fetching attempts:', attErr);

      const allAttempts = attempts || [];
      const attemptIds = allAttempts.map(a => a.id);

      // 2. Get registrations for DejaVu
      const { data: dejavuRegs } = await supabase
        .from('Registration')
        .select('id')
        .eq('eventId', 'evt_384fc25f545a4e68a379dceed0eb3458');
        
      const dejavuRegIds = new Set((dejavuRegs || []).map(r => r.id));

      // 3. Get all teams count
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

      // 4. Get violation counts (safely guard against empty array)
      let violationData: any[] = [];
      if (attemptIds.length > 0) {
        const { data: vData } = await supabase
          .from('violations')
          .select('team_id')
          .in('attempt_id', attemptIds);
        violationData = vData || [];
      }

      const flaggedTeams = new Set(violationData.map(v => v.team_id));
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

      // 5. Recent attempts
      let recentQuery = supabase
        .from('quiz_attempts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(15);

      if (quizId !== 'all') {
        recentQuery = recentQuery.eq('quiz_id', quizId);
      }

      const { data: recent } = await recentQuery;
      setRecentAttempts(recent || []);
    } catch (err) {
      console.error('Dashboard load error:', err);
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }

  function handleSelectQuiz(id: string) {
    setSelectedQuizId(id);
    localStorage.setItem(STORAGE_QUIZ_KEY, id);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner size="lg" />
      </div>
    );
  }

  const selectedQuiz = quizzes.find(q => q.id === selectedQuizId);

  return (
    <div>
      {/* Header with Quiz Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-500 text-sm mt-1">Real-time Quiz Overview & Statistics</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Quiz Dropdown Selector */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-700">Quiz:</span>
            <select
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white font-medium text-gray-900 shadow-xs focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              value={selectedQuizId}
              onChange={e => handleSelectQuiz(e.target.value)}
            >
              <option value="all">🌐 All Quizzes (Combined)</option>
              {quizzes.map(q => (
                <option key={q.id} value={q.id}>
                  {q.title} ({q.status})
                </option>
              ))}
            </select>
          </div>

          {selectedQuiz && (
            <Badge variant={selectedQuiz.status}>{selectedQuiz.status}</Badge>
          )}

          {/* Refresh Button */}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => selectedQuizId && loadStatsForQuiz(selectedQuizId)}
            disabled={refreshing}
            className="flex items-center gap-1.5"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </Button>
        </div>
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
          <StatCard label="Total Attempts" value={stats.started} icon={<PlayCircle className="w-6 h-6" />} color="text-indigo-600" />
          <StatCard label="Flagged Sessions" value={stats.flaggedSessions} icon={<AlertTriangle className="w-6 h-6" />} color="text-red-600" />
        </div>
      )}

      {/* Recent Attempts */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">
            Recent Attempts {selectedQuiz ? `— ${selectedQuiz.title}` : ''}
          </h2>
          <span className="text-xs text-gray-500">Auto-refreshing every 10s</span>
        </div>

        {recentAttempts.length === 0 ? (
          <p className="text-gray-500 text-sm py-4">No attempts recorded for this quiz yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-3 px-2 text-gray-500 font-medium">Team</th>
                  <th className="text-left py-3 px-2 text-gray-500 font-medium">Attempt</th>
                  <th className="text-left py-3 px-2 text-gray-500 font-medium">Status</th>
                  <th className="text-left py-3 px-2 text-gray-500 font-medium">Score</th>
                  <th className="text-left py-3 px-2 text-gray-500 font-medium">Violations</th>
                  <th className="text-left py-3 px-2 text-gray-500 font-medium">Time</th>
                </tr>
              </thead>
              <tbody>
                {recentAttempts.map(attempt => (
                  <tr key={attempt.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="py-3 px-2 font-medium text-gray-900">{attempt.team_id}</td>
                    <td className="py-3 px-2 text-gray-600">#{attempt.attempt_number}</td>
                    <td className="py-3 px-2"><Badge variant={attempt.status}>{attempt.status}</Badge></td>
                    <td className="py-3 px-2 font-semibold text-gray-900">
                      {attempt.score != null ? `${attempt.score}/${attempt.max_score}` : '—'}
                    </td>
                    <td className="py-3 px-2">
                      {attempt.violation_count > 0 ? (
                        <span className="inline-flex items-center gap-1 text-red-600 font-medium text-xs bg-red-50 px-2 py-0.5 rounded">
                          <AlertTriangle className="w-3 h-3" />
                          {attempt.violation_count}
                        </span>
                      ) : (
                        <span className="text-gray-400 text-xs">0</span>
                      )}
                    </td>
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
