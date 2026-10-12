import React, { useEffect, useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, Badge, Spinner } from '@/components/ui';
import { Radio } from 'lucide-react';
import { getRemainingSeconds, formatTime } from '@/lib/utils';
import type { Quiz } from '@/lib/types';

interface LiveTeam {
  team_id: string;
  status: string;
  started_at: string;
  last_heartbeat: string;
  expires_at: string;
  violation_count: number;
  attempt_number: number;
}

const STORAGE_QUIZ_KEY = 'dejavu_admin_dashboard_quiz';

export default function LiveMonitorPage() {
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [selectedQuizId, setSelectedQuizId] = useState<string>('');
  const [teams, setTeams] = useState<LiveTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => {
    initLive();
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  useEffect(() => {
    if (selectedQuizId) {
      loadLive(selectedQuizId);
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(() => loadLive(selectedQuizId), 10000);
    }
  }, [selectedQuizId]);

  async function initLive() {
    try {
      const { data: allQuizzes } = await supabase
        .from('quizzes')
        .select('*')
        .order('created_at', { ascending: false });

      if (!allQuizzes || allQuizzes.length === 0) {
        setLoading(false);
        return;
      }

      setQuizzes(allQuizzes);

      // Default to saved or best quiz
      const savedQuizId = localStorage.getItem(STORAGE_QUIZ_KEY);
      const savedExists = savedQuizId && allQuizzes.some(q => q.id === savedQuizId);

      if (savedExists) {
        setSelectedQuizId(savedQuizId!);
      } else {
        const { data: attempts } = await supabase.from('quiz_attempts').select('quiz_id');
        const countMap = new Map<string, number>();
        (attempts || []).forEach(a => countMap.set(a.quiz_id, (countMap.get(a.quiz_id) || 0) + 1));
        const bestQuiz = allQuizzes.find(q => (countMap.get(q.id) || 0) > 0) || allQuizzes[0];
        setSelectedQuizId(bestQuiz.id);
      }
    } catch (err) {
      console.error('Error init live monitor:', err);
    } finally {
      setLoading(false);
    }
  }

  async function loadLive(quizId: string) {
    if (!quizId) return;

    try {
      let attemptsQuery = supabase
        .from('quiz_attempts')
        .select('*')
        .order('created_at', { ascending: false });

      if (quizId !== 'all') {
        attemptsQuery = attemptsQuery.eq('quiz_id', quizId);
      }

      const { data: attempts } = await attemptsQuery;

      // Get violations per attempt
      const attemptIds = (attempts || []).map(a => a.id);
      let violationMap = new Map<string, number>();
      if (attemptIds.length > 0) {
        const { data: violations } = await supabase
          .from('violations')
          .select('attempt_id')
          .in('attempt_id', attemptIds);

        (violations || []).forEach(v => {
          violationMap.set(v.attempt_id, (violationMap.get(v.attempt_id) || 0) + 1);
        });
      }

      // Latest attempt per team
      const teamMap = new Map<string, LiveTeam>();
      (attempts || []).forEach(a => {
        if (!teamMap.has(a.team_id) || a.attempt_number > teamMap.get(a.team_id)!.attempt_number) {
          let status = a.status;
          if (status === 'in_progress' && new Date(a.expires_at) < new Date()) {
            status = 'expired';
          }
          teamMap.set(a.team_id, {
            team_id: a.team_id,
            status,
            started_at: a.started_at,
            last_heartbeat: a.last_heartbeat || a.started_at,
            expires_at: a.expires_at,
            violation_count: violationMap.get(a.id) || 0,
            attempt_number: a.attempt_number,
          });
        }
      });

      setTeams(Array.from(teamMap.values()));
    } catch (err) {
      console.error('Error loading live monitor:', err);
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

  const activeCount = teams.filter(t => t.status === 'in_progress').length;
  const submittedCount = teams.filter(t => ['submitted', 'auto_submitted'].includes(t.status)).length;
  const flaggedCount = teams.filter(t => t.violation_count > 0).length;

  function getStatusLabel(status: string) {
    const labels: Record<string, string> = {
      in_progress: 'In Progress',
      submitted: 'Submitted',
      auto_submitted: 'Auto Submitted',
      expired: 'Expired',
      cancelled: 'Cancelled',
    };
    return labels[status] || status;
  }

  const selectedQuiz = quizzes.find(q => q.id === selectedQuizId);

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900">Live Monitor</h1>
            <span className="flex items-center gap-1 text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium animate-pulse">
              <Radio className="w-3 h-3" /> LIVE
            </span>
          </div>
          <p className="text-gray-500 text-sm mt-1">Real-time participant tracking & status</p>
        </div>

        {/* Quiz Dropdown Selector */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-700">Quiz:</span>
          <select
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white font-medium text-gray-900 shadow-xs focus:ring-2 focus:ring-indigo-500"
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
          {selectedQuiz && <Badge variant={selectedQuiz.status}>{selectedQuiz.status}</Badge>}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        <Card className="text-center">
          <p className="text-2xl font-bold text-blue-600">{activeCount}</p>
          <p className="text-xs text-gray-500 mt-1">Currently Active</p>
        </Card>
        <Card className="text-center">
          <p className="text-2xl font-bold text-emerald-600">{submittedCount}</p>
          <p className="text-xs text-gray-500 mt-1">Submitted</p>
        </Card>
        <Card className="text-center">
          <p className="text-2xl font-bold text-red-600">{flaggedCount}</p>
          <p className="text-xs text-gray-500 mt-1">With Violations</p>
        </Card>
        <Card className="text-center">
          <p className="text-2xl font-bold text-gray-600">{teams.length}</p>
          <p className="text-xs text-gray-500 mt-1">Total Teams</p>
        </Card>
      </div>

      {/* Active Sessions */}
      <Card padding={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left py-3 px-4 text-gray-600 font-medium">Team</th>
                <th className="text-left py-3 px-4 text-gray-600 font-medium">Status</th>
                <th className="text-left py-3 px-4 text-gray-600 font-medium">Started</th>
                <th className="text-left py-3 px-4 text-gray-600 font-medium">Last Seen</th>
                <th className="text-left py-3 px-4 text-gray-600 font-medium">Time Remaining</th>
                <th className="text-center py-3 px-4 text-gray-600 font-medium">Violations</th>
              </tr>
            </thead>
            <tbody>
              {teams
                .sort((a, b) => {
                  if (a.status === 'in_progress' && b.status !== 'in_progress') return -1;
                  if (a.status !== 'in_progress' && b.status === 'in_progress') return 1;
                  return 0;
                })
                .map(team => {
                const remaining = team.status === 'in_progress'
                  ? getRemainingSeconds(team.expires_at)
                  : 0;
                return (
                  <tr key={team.team_id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-3 px-4 font-mono font-medium">{team.team_id}</td>
                    <td className="py-3 px-4">
                      <Badge variant={team.status}>{getStatusLabel(team.status)}</Badge>
                    </td>
                    <td className="py-3 px-4 text-gray-500 text-xs">
                      {new Date(team.started_at).toLocaleTimeString()}
                    </td>
                    <td className="py-3 px-4 text-gray-500 text-xs">
                      {new Date(team.last_heartbeat).toLocaleTimeString()}
                    </td>
                    <td className="py-3 px-4">
                      {team.status === 'in_progress' ? (
                        <span className={`font-mono font-medium ${remaining < 300 ? 'text-red-600' : remaining < 600 ? 'text-amber-600' : 'text-gray-900'}`}>
                          {formatTime(remaining)}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-center">
                      {team.violation_count > 0 ? (
                        <span className={`font-medium ${team.violation_count >= 6 ? 'text-red-600 font-bold' : team.violation_count >= 3 ? 'text-amber-600' : 'text-gray-700'}`}>
                          {team.violation_count}
                        </span>
                      ) : (
                        <span className="text-gray-400">0</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {teams.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-gray-500">
                    No participants have started this quiz yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
