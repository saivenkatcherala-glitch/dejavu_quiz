import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAdminAuth } from '@/contexts/AdminAuthContext';
import { Button, Card, Badge, ConfirmDialog, Toast, Spinner, Input } from '@/components/ui';
import { Search, Send, RotateCcw, XCircle } from 'lucide-react';
import type { QuizAttempt } from '@/lib/types';
import { downloadCSV } from '@/lib/utils';

export default function AttemptsPage() {
  const { user } = useAdminAuth();
  const [attempts, setAttempts] = useState<QuizAttempt[]>([]);
  const [filtered, setFiltered] = useState<QuizAttempt[]>([]);
  const [quizzes, setQuizzes] = useState<{id: string, title: string, status: string}[]>([]);
  const [selectedQuizId, setSelectedQuizId] = useState<string>('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [confirm, setConfirm] = useState<{
    attemptId: string;
    action: 'force_submit' | 'cancel' | 'delete';
    title: string;
    message: string;
  } | null>(null);
  const [clearAllConfirm, setClearAllConfirm] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  async function handleDeleteAttempt(attemptId: string) {
    setActionLoading(true);
    try {
      await supabase.from('violations').delete().eq('attempt_id', attemptId);
      await supabase.from('quiz_attempts').delete().eq('id', attemptId);
      setToast({ message: 'Attempt deleted', type: 'success' });
      await logAction('Deleted attempt', 'attempt', attemptId);
      if (selectedQuizId) loadAttempts(selectedQuizId);
    } catch (err: any) {
      setToast({ message: err.message || 'Failed to delete attempt', type: 'error' });
    } finally {
      setActionLoading(false);
      setConfirm(null);
    }
  }

  async function handleClearAllAttempts() {
    setActionLoading(true);
    try {
      const { data: attemptsList } = await supabase.from('quiz_attempts').select('id').eq('quiz_id', selectedQuizId);
      if (attemptsList && attemptsList.length > 0) {
        const attemptIds = attemptsList.map(a => a.id);
        await supabase.from('violations').delete().in('attempt_id', attemptIds);
        await supabase.from('quiz_attempts').delete().in('id', attemptIds);
      }
      setToast({ message: 'All quiz attempts & history cleared for this quiz', type: 'success' });
      await logAction('Cleared all quiz history', 'attempts', selectedQuizId);
      if (selectedQuizId) loadAttempts(selectedQuizId);
    } catch (err: any) {
      setToast({ message: err.message || 'Failed to clear history', type: 'error' });
    } finally {
      setActionLoading(false);
      setClearAllConfirm(false);
    }
  }

  useEffect(() => {
    loadQuizzes();
  }, []);

  async function loadQuizzes() {
    const { data: allQuizzes } = await supabase
      .from('quizzes')
      .select('id, title, status')
      .order('created_at', { ascending: false });

    setQuizzes(allQuizzes || []);
    if (allQuizzes && allQuizzes.length > 0) {
      const activeId = selectedQuizId || allQuizzes[0].id;
      setSelectedQuizId(activeId);
      loadAttempts(activeId);
    } else {
      setLoading(false);
    }
  }

  async function loadAttempts(qId: string) {
    setLoading(true);
    const { data } = await supabase
      .from('quiz_attempts')
      .select('*')
      .eq('quiz_id', qId)
      .order('created_at', { ascending: false });
    setAttempts(data || []);
    setFiltered(data || []);
    setLoading(false);
  }

  function handleQuizChange(id: string) {
    setSelectedQuizId(id);
    loadAttempts(id);
  }

  useEffect(() => {
    if (!search.trim()) {
      setFiltered(attempts);
    } else {
      const q = search.toLowerCase();
      setFiltered(attempts.filter(a => a.team_id.toLowerCase().includes(q)));
    }
  }, [search, attempts]);

  async function handleForceSubmit(attemptId: string) {
    setActionLoading(true);
    try {
      const { data, error } = await supabase.rpc('submit_attempt', {
        p_attempt_id: attemptId,
        p_status: 'auto_submitted',
      });

      if (error) throw error;
      setToast({ message: 'Attempt force submitted', type: 'success' });
      await logAction('Force submitted', 'attempt', attemptId);
      if (selectedQuizId) loadAttempts(selectedQuizId);
    } catch (err: any) {
      setToast({ message: err.message || 'Failed', type: 'error' });
    } finally {
      setActionLoading(false);
      setConfirm(null);
    }
  }

  async function handleCancel(attemptId: string) {
    setActionLoading(true);
    try {
      await supabase
        .from('quiz_attempts')
        .update({ status: 'cancelled' })
        .eq('id', attemptId);
      setToast({ message: 'Attempt cancelled', type: 'success' });
      await logAction('Cancelled attempt', 'attempt', attemptId);
      if (selectedQuizId) loadAttempts(selectedQuizId);
    } catch (err: any) {
      setToast({ message: err.message || 'Failed', type: 'error' });
    } finally {
      setActionLoading(false);
      setConfirm(null);
    }
  }

  async function logAction(action: string, targetType: string, targetId: string) {
    await supabase.from('admin_activity_logs').insert({
      admin_user_id: user!.id,
      action,
      target_type: targetType,
      target_id: targetId,
    });
  }

  if (loading) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;

  // Group by team
  const grouped = new Map<string, QuizAttempt[]>();
  filtered.forEach(a => {
    const list = grouped.get(a.team_id) || [];
    list.push(a);
    grouped.set(a.team_id, list);
  });

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Attempts</h1>
          <p className="text-gray-500 text-sm mt-1">{attempts.length} total attempts for this quiz</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-3">
          {quizzes.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-700">Quiz:</span>
              <select
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white font-medium focus:ring-2 focus:ring-indigo-500"
                value={selectedQuizId}
                onChange={e => handleQuizChange(e.target.value)}
              >
                {quizzes.map(q => (
                  <option key={q.id} value={q.id}>
                    {q.title} ({q.status})
                  </option>
                ))}
              </select>
            </div>
          )}
          {attempts.length > 0 && (
            <Button
              variant="danger"
              onClick={() => setClearAllConfirm(true)}
            >
              Clear History For This Quiz
            </Button>
          )}
        </div>
      </div>

      <div className="mb-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            className="pl-10"
            placeholder="Search by Team ID..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-4">
        {Array.from(grouped.entries()).map(([teamId, teamAttempts]) => (
          <Card key={teamId}>
            <h3 className="font-semibold text-gray-900 mb-3">Team {teamId}</h3>
            <div className="space-y-2">
              {teamAttempts
                .sort((a, b) => a.attempt_number - b.attempt_number)
                .map(attempt => (
                <div key={attempt.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-4">
                    <span className="text-sm font-medium">Attempt #{attempt.attempt_number}</span>
                    <Badge variant={attempt.status}>{attempt.status}</Badge>
                    {attempt.score != null && (
                      <span className="text-sm">
                        Score: <strong>{attempt.score}/{attempt.max_score}</strong>
                        <span className="text-gray-400 ml-2">
                          (✓{attempt.correct_count} ✗{attempt.wrong_count} ○{attempt.unanswered_count})
                        </span>
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {attempt.submitted_at && (
                      <span className="text-xs text-gray-500">
                        {new Date(attempt.submitted_at).toLocaleTimeString()}
                      </span>
                    )}
                    {attempt.status === 'in_progress' && (
                      <>
                        <button
                          onClick={() => setConfirm({
                            attemptId: attempt.id,
                            action: 'force_submit',
                            title: 'Force Submit',
                            message: `Force submit attempt #${attempt.attempt_number} for ${teamId}?`,
                          })}
                          className="p-1.5 text-gray-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg"
                          title="Force Submit"
                        >
                          <Send className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setConfirm({
                            attemptId: attempt.id,
                            action: 'cancel',
                            title: 'Cancel Attempt',
                            message: `Cancel attempt #${attempt.attempt_number} for ${teamId}? The team can start a new attempt if they have remaining.`,
                          })}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                          title="Cancel"
                        >
                          <XCircle className="w-4 h-4" />
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => setConfirm({
                        attemptId: attempt.id,
                        action: 'delete',
                        title: 'Delete Attempt',
                        message: `Permanently delete attempt #${attempt.attempt_number} for ${teamId}? This action cannot be undone.`,
                      })}
                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                      title="Delete Attempt History"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ))}

        {grouped.size === 0 && (
          <Card>
            <p className="text-center text-gray-500 py-8">No attempts found.</p>
          </Card>
        )}
      </div>

      {confirm && (
        <ConfirmDialog
          open={!!confirm}
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            if (confirm.action === 'force_submit') handleForceSubmit(confirm.attemptId);
            else if (confirm.action === 'cancel') handleCancel(confirm.attemptId);
            else handleDeleteAttempt(confirm.attemptId);
          }}
          title={confirm.title}
          message={confirm.message}
          variant={confirm.action === 'cancel' || confirm.action === 'delete' ? 'danger' : 'primary'}
          loading={actionLoading}
        />
      )}

      {/* Clear All Attempts Modal */}
      <ConfirmDialog
        open={clearAllConfirm}
        onClose={() => setClearAllConfirm(false)}
        onConfirm={handleClearAllAttempts}
        title="Clear Quiz History"
        message="Are you sure you want to permanently delete ALL quiz attempts and history for the currently selected quiz? This action cannot be undone."
        confirmText="Clear History"
        variant="danger"
        loading={actionLoading}
      />

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
