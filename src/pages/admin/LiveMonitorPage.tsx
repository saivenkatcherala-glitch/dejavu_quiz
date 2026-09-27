import React, { useEffect, useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, Badge, Spinner } from '@/components/ui';
import { Radio } from 'lucide-react';
import { getRemainingSeconds, formatTime } from '@/lib/utils';

interface LiveTeam {
  team_id: string;
  status: string;
  started_at: string;
  last_heartbeat: string;
  expires_at: string;
  violation_count: number;
  attempt_number: number;
}

export default function LiveMonitorPage() {
  const [teams, setTeams] = useState<LiveTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => {
    loadLive();
    // Poll every 10 seconds
    intervalRef.current = setInterval(loadLive, 10000);
    return () => clearInterval(intervalRef.current);
  }, []);

  async function loadLive() {
    const { data: quizData } = await supabase
      .from('quizzes')
      .select('id')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!quizData) {
      setLoading(false);
      return;
    }

    const { data: attempts } = await supabase
      .from('quiz_attempts')
      .select('*')
      .eq('quiz_id', quizData.id)
      .order('created_at', { ascending: false });

    // Get violations per attempt
    const attemptIds = (attempts || []).map(a => a.id);
    const { data: violations } = await supabase
      .from('violations')
      .select('attempt_id')
      .in('attempt_id', attemptIds.length > 0 ? attemptIds : ['none']);

    const violationMap = new Map<string, number>();
    (violations || []).forEach(v => {
      violationMap.set(v.attempt_id, (violationMap.get(v.attempt_id) || 0) + 1);
    });

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
    setLoading(false);
  }

  // Auto-refresh remaining time
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(v => v + 1), 1000);
    return () => clearInterval(t);
  }, []);

  function getStatusLabel(status: string): string {
    const map: Record<string, string> = {
      in_progress: 'In Progress',
      submitted: 'Submitted',
      auto_submitted: 'Auto Submitted',
      expired: 'Expired',
      cancelled: 'Cancelled',
    };
    return map[status] || status;
  }

  if (loading) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;

  const inProgress = teams.filter(t => t.status === 'in_progress');
  const completed = teams.filter(t => t.status !== 'in_progress');

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Radio className="w-5 h-5 text-green-500 animate-pulse" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Live Monitor</h1>
            <p className="text-gray-500 text-sm mt-1">
              {inProgress.length} active · {completed.length} completed · Refreshes every 10s
            </p>
          </div>
        </div>
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
                        <span className={`font-medium ${team.violation_count >= 10 ? 'text-red-600' : team.violation_count >= 5 ? 'text-amber-600' : 'text-gray-700'}`}>
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
                    No participants have started the quiz yet.
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
