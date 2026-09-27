import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAdminAuth } from '@/contexts/AdminAuthContext';
import { Button, Input, Card, Badge, Modal, ConfirmDialog, Spinner, Toast } from '@/components/ui';
import { Search, Eye, Plus, Minus, RotateCcw, Ban, CheckCircle, AlertTriangle } from 'lucide-react';
import type { TeamQuizSettings, Quiz } from '@/lib/types';

interface TeamRow {
  team_id: string;
  team_name: string;
  registration_status?: string;
  allowed_attempts: number;
  attempts_used: number;
  is_disabled: boolean;
  best_score: number | null;
  violation_count: number;
}

export default function TeamsPage() {
  const { user } = useAdminAuth();
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [filteredTeams, setFilteredTeams] = useState<TeamRow[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Modal states
  const [attemptModal, setAttemptModal] = useState<{ teamId: string; current: number } | null>(null);
  const [newAttemptLimit, setNewAttemptLimit] = useState('');
  const [confirmAction, setConfirmAction] = useState<{
    teamId: string;
    action: 'disable' | 'enable' | 'reset' | 'grant';
    title: string;
    message: string;
  } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Detail modal
  const [viewTeam, setViewTeam] = useState<string | null>(null);
  const [teamAttempts, setTeamAttempts] = useState<any[]>([]);
  const [teamViolations, setTeamViolations] = useState<any[]>([]);

  const loadTeams = useCallback(async () => {
    try {
      // Get existing teams from Team table
      const { data: allTeams } = await supabase.from('Team').select('*');
      
      // Get registrations for DejaVu
      const { data: dejavuRegs } = await supabase
        .from('Registration')
        .select('id')
        .eq('eventId', 'evt_384fc25f545a4e68a379dceed0eb3458');
        
      const dejavuRegIds = new Set((dejavuRegs || []).map(r => r.id));
      const regTeams = (allTeams || []).filter(t => dejavuRegIds.has(t.registrationId));

      // Get quiz
      const { data: quizData } = await supabase
        .from('quizzes')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      setQuiz(quizData);

      // Get team quiz settings
      const { data: settings } = await supabase
        .from('team_quiz_settings')
        .select('*');

      const settingsMap = new Map<string, TeamQuizSettings>();
      (settings || []).forEach(s => settingsMap.set(s.team_id, s));

      // Get attempts
      const { data: attempts } = await supabase
        .from('quiz_attempts')
        .select('*')
        .in('status', ['submitted', 'auto_submitted', 'in_progress']);

      // Get violations count per team
      const { data: violations } = await supabase
        .from('violations')
        .select('team_id');

      const violationCount = new Map<string, number>();
      (violations || []).forEach(v => {
        violationCount.set(v.team_id, (violationCount.get(v.team_id) || 0) + 1);
      });

      // Build team rows
      const rows: TeamRow[] = (regTeams || []).map(team => {
        const teamId = team.team_id || team.id;
        const s = settingsMap.get(teamId);
        const teamAttempts = (attempts || []).filter(a => a.team_id === teamId);
        const completedAttempts = teamAttempts.filter(a => ['submitted', 'auto_submitted'].includes(a.status));
        const scores = completedAttempts.map(a => a.score).filter(Boolean);

        return {
          team_id: teamId,
          team_name: team.team_name || team.name || teamId,
          registration_status: team.status || team.registration_status || 'registered',
          allowed_attempts: s?.allowed_attempts ?? quizData?.default_allowed_attempts ?? 1,
          attempts_used: completedAttempts.length,
          is_disabled: s?.is_disabled ?? false,
          best_score: scores.length ? Math.max(...scores) : null,
          violation_count: violationCount.get(teamId) || 0,
        };
      });

      setTeams(rows);
      setFilteredTeams(rows);
    } catch (err) {
      console.error('Error loading teams:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTeams();
  }, [loadTeams]);

  useEffect(() => {
    if (!search.trim()) {
      setFilteredTeams(teams);
    } else {
      const q = search.toLowerCase();
      setFilteredTeams(teams.filter(t =>
        t.team_id.toLowerCase().includes(q) || t.team_name.toLowerCase().includes(q)
      ));
    }
  }, [search, teams]);

  async function logAction(action: string, targetType: string, targetId: string, metadata: Record<string, unknown> = {}) {
    await supabase.from('admin_activity_logs').insert({
      admin_user_id: user!.id,
      action,
      target_type: targetType,
      target_id: targetId,
      metadata,
    });
  }

  async function ensureTeamSettings(teamId: string) {
    const { data: existing } = await supabase
      .from('team_quiz_settings')
      .select('*')
      .eq('team_id', teamId)
      .single();

    if (!existing) {
      await supabase.from('team_quiz_settings').insert({
        team_id: teamId,
        allowed_attempts: quiz?.default_allowed_attempts ?? 1,
      });
    }
    return existing;
  }

  async function handleGrantAttempt(teamId: string) {
    setActionLoading(true);
    try {
      await ensureTeamSettings(teamId);
      const { data } = await supabase
        .from('team_quiz_settings')
        .select('allowed_attempts')
        .eq('team_id', teamId)
        .single();

      const current = data?.allowed_attempts ?? 1;
      await supabase
        .from('team_quiz_settings')
        .update({ allowed_attempts: current + 1 })
        .eq('team_id', teamId);

      await logAction('Granted extra attempt', 'team', teamId, { new_limit: current + 1 });
      setToast({ message: `Granted extra attempt to ${teamId}`, type: 'success' });
      loadTeams();
    } catch (err) {
      setToast({ message: 'Failed to grant attempt', type: 'error' });
    } finally {
      setActionLoading(false);
      setConfirmAction(null);
    }
  }

  async function handleChangeAttemptLimit(teamId: string, newLimit: number) {
    setActionLoading(true);
    try {
      await ensureTeamSettings(teamId);
      await supabase
        .from('team_quiz_settings')
        .update({ allowed_attempts: newLimit })
        .eq('team_id', teamId);

      await logAction('Changed attempt limit', 'team', teamId, { new_limit: newLimit });
      setToast({ message: `Set attempt limit to ${newLimit} for ${teamId}`, type: 'success' });
      loadTeams();
    } catch (err) {
      setToast({ message: 'Failed to change limit', type: 'error' });
    } finally {
      setActionLoading(false);
      setAttemptModal(null);
    }
  }

  async function handleDisableTeam(teamId: string) {
    setActionLoading(true);
    try {
      await ensureTeamSettings(teamId);
      await supabase
        .from('team_quiz_settings')
        .update({ is_disabled: true })
        .eq('team_id', teamId);

      await logAction('Disabled team', 'team', teamId);
      setToast({ message: `Disabled ${teamId}`, type: 'success' });
      loadTeams();
    } catch (err) {
      setToast({ message: 'Failed to disable team', type: 'error' });
    } finally {
      setActionLoading(false);
      setConfirmAction(null);
    }
  }

  async function handleEnableTeam(teamId: string) {
    setActionLoading(true);
    try {
      await ensureTeamSettings(teamId);
      await supabase
        .from('team_quiz_settings')
        .update({ is_disabled: false })
        .eq('team_id', teamId);

      await logAction('Enabled team', 'team', teamId);
      setToast({ message: `Enabled ${teamId}`, type: 'success' });
      loadTeams();
    } catch (err) {
      setToast({ message: 'Failed to enable team', type: 'error' });
    } finally {
      setActionLoading(false);
      setConfirmAction(null);
    }
  }

  async function handleResetAttempt(teamId: string) {
    setActionLoading(true);
    try {
      // Cancel all in-progress attempts
      const { data: activeAttempts } = await supabase
        .from('quiz_attempts')
        .select('id')
        .eq('team_id', teamId)
        .eq('status', 'in_progress');

      for (const a of (activeAttempts || [])) {
        await supabase
          .from('quiz_attempts')
          .update({ status: 'cancelled' })
          .eq('id', a.id);
      }

      await logAction('Reset attempt', 'team', teamId);
      setToast({ message: `Reset active attempt for ${teamId}`, type: 'success' });
      loadTeams();
    } catch (err) {
      setToast({ message: 'Failed to reset attempt', type: 'error' });
    } finally {
      setActionLoading(false);
      setConfirmAction(null);
    }
  }

  async function loadTeamDetails(teamId: string) {
    setViewTeam(teamId);
    const { data: attempts } = await supabase
      .from('quiz_attempts')
      .select('*')
      .eq('team_id', teamId)
      .order('attempt_number', { ascending: true });
    setTeamAttempts(attempts || []);

    const { data: violations } = await supabase
      .from('violations')
      .select('*')
      .eq('team_id', teamId)
      .order('timestamp', { ascending: false })
      .limit(20);
    setTeamViolations(violations || []);
  }

  if (loading) {
    return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Team Management</h1>
          <p className="text-gray-500 text-sm mt-1">{teams.length} registered teams</p>
        </div>
      </div>

      {/* Search */}
      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            className="pl-10"
            placeholder="Search by Team ID or Team Name..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Teams Table */}
      <Card padding={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left py-3 px-4 text-gray-600 font-medium">Team ID</th>
                <th className="text-left py-3 px-4 text-gray-600 font-medium">Team Name</th>
                <th className="text-left py-3 px-4 text-gray-600 font-medium">Status</th>
                <th className="text-center py-3 px-4 text-gray-600 font-medium">Allowed</th>
                <th className="text-center py-3 px-4 text-gray-600 font-medium">Used</th>
                <th className="text-center py-3 px-4 text-gray-600 font-medium">Remaining</th>
                <th className="text-center py-3 px-4 text-gray-600 font-medium">Score</th>
                <th className="text-center py-3 px-4 text-gray-600 font-medium">Violations</th>
                <th className="text-right py-3 px-4 text-gray-600 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredTeams.map(team => (
                <tr key={team.team_id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-3 px-4 font-mono text-sm font-medium">{team.team_id}</td>
                  <td className="py-3 px-4">{team.team_name}</td>
                  <td className="py-3 px-4">
                    {team.is_disabled ? (
                      <Badge variant="expired">Disabled</Badge>
                    ) : (
                      <Badge variant="LIVE">Active</Badge>
                    )}
                  </td>
                  <td className="py-3 px-4 text-center">{team.allowed_attempts}</td>
                  <td className="py-3 px-4 text-center">{team.attempts_used}</td>
                  <td className="py-3 px-4 text-center">
                    {Math.max(0, team.allowed_attempts - team.attempts_used)}
                  </td>
                  <td className="py-3 px-4 text-center">
                    {team.best_score != null ? team.best_score : '—'}
                  </td>
                  <td className="py-3 px-4 text-center">
                    {team.violation_count > 0 ? (
                      <span className="text-red-600 font-medium">{team.violation_count}</span>
                    ) : (
                      <span className="text-gray-400">0</span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => loadTeamDetails(team.team_id)}
                        className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                        title="View Details"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setConfirmAction({
                          teamId: team.team_id,
                          action: 'grant',
                          title: 'Grant Extra Attempt',
                          message: `Grant one additional attempt to ${team.team_id} (${team.team_name})?`,
                        })}
                        className="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                        title="Grant Attempt"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => {
                          setAttemptModal({ teamId: team.team_id, current: team.allowed_attempts });
                          setNewAttemptLimit(String(team.allowed_attempts));
                        }}
                        className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        title="Change Attempt Limit"
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setConfirmAction({
                          teamId: team.team_id,
                          action: 'reset',
                          title: 'Reset Active Attempt',
                          message: `Cancel all active attempts for ${team.team_id}? This will NOT delete submitted attempts.`,
                        })}
                        className="p-1.5 text-gray-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-colors"
                        title="Reset Attempt"
                      >
                        <RotateCcw className="w-4 h-4" />
                      </button>
                      {team.is_disabled ? (
                        <button
                          onClick={() => setConfirmAction({
                            teamId: team.team_id,
                            action: 'enable',
                            title: 'Enable Team',
                            message: `Enable ${team.team_id} (${team.team_name})?`,
                          })}
                          className="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                          title="Enable Team"
                        >
                          <CheckCircle className="w-4 h-4" />
                        </button>
                      ) : (
                        <button
                          onClick={() => setConfirmAction({
                            teamId: team.team_id,
                            action: 'disable',
                            title: 'Disable Team',
                            message: `Disable ${team.team_id} (${team.team_name})? They will not be able to access the quiz.`,
                          })}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Disable Team"
                        >
                          <Ban className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Change Attempt Limit Modal */}
      {attemptModal && (
        <Modal
          open={!!attemptModal}
          onClose={() => setAttemptModal(null)}
          title={`Change Attempt Limit — ${attemptModal.teamId}`}
          size="sm"
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Current limit: <strong>{attemptModal.current}</strong>
            </p>
            <Input
              label="New attempt limit"
              type="number"
              min={1}
              value={newAttemptLimit}
              onChange={e => setNewAttemptLimit(e.target.value)}
            />
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setAttemptModal(null)}>Cancel</Button>
              <Button
                loading={actionLoading}
                onClick={() => handleChangeAttemptLimit(attemptModal.teamId, parseInt(newAttemptLimit))}
              >
                Save
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Confirm Action Dialog */}
      {confirmAction && (
        <ConfirmDialog
          open={!!confirmAction}
          onClose={() => setConfirmAction(null)}
          onConfirm={() => {
            if (confirmAction.action === 'grant') handleGrantAttempt(confirmAction.teamId);
            else if (confirmAction.action === 'disable') handleDisableTeam(confirmAction.teamId);
            else if (confirmAction.action === 'enable') handleEnableTeam(confirmAction.teamId);
            else if (confirmAction.action === 'reset') handleResetAttempt(confirmAction.teamId);
          }}
          title={confirmAction.title}
          message={confirmAction.message}
          variant={confirmAction.action === 'disable' ? 'danger' : 'primary'}
          loading={actionLoading}
        />
      )}

      {/* Team Detail Modal */}
      {viewTeam && (
        <Modal open={!!viewTeam} onClose={() => setViewTeam(null)} title={`Team ${viewTeam}`} size="lg">
          <div className="space-y-6">
            <div>
              <h3 className="font-semibold text-gray-900 mb-3">Attempts</h3>
              {teamAttempts.length === 0 ? (
                <p className="text-sm text-gray-500">No attempts yet</p>
              ) : (
                <div className="space-y-2">
                  {teamAttempts.map(a => (
                    <div key={a.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div>
                        <span className="font-medium">Attempt #{a.attempt_number}</span>
                        <Badge variant={a.status} className="ml-2">{a.status}</Badge>
                      </div>
                      <div className="text-sm text-gray-600">
                        {a.score != null ? `Score: ${a.score}/${a.max_score}` : 'In Progress'}
                        {a.submitted_at && (
                          <span className="ml-2 text-gray-400">
                            {new Date(a.submitted_at).toLocaleTimeString()}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h3 className="font-semibold text-gray-900 mb-3">Recent Violations</h3>
              {teamViolations.length === 0 ? (
                <p className="text-sm text-gray-500">No violations</p>
              ) : (
                <div className="space-y-2">
                  {teamViolations.map(v => (
                    <div key={v.id} className="flex items-center justify-between p-3 bg-red-50 rounded-lg">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-red-500" />
                        <span className="text-sm font-medium">{v.type}</span>
                        <Badge variant={v.severity === 'high' ? 'expired' : v.severity === 'medium' ? 'PAUSED' : 'DRAFT'}>
                          {v.severity}
                        </Badge>
                      </div>
                      <span className="text-xs text-gray-500">{new Date(v.timestamp).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
