import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAdminAuth } from '@/contexts/AdminAuthContext';
import { Button, Input, Card, Badge, ConfirmDialog, Toast, Spinner } from '@/components/ui';
import type { Quiz, QuizStatus } from '@/lib/types';
import { Play, Pause, Square, Edit, Check, Settings } from 'lucide-react';

export default function QuizControlPage() {
  const { user } = useAdminAuth();
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [confirm, setConfirm] = useState<{ action: QuizStatus; title: string; message: string } | null>(null);
  const [questionCount, setQuestionCount] = useState(0);
  const [editMode, setEditMode] = useState(false);

  const [form, setForm] = useState({
    title: 'DejaVu',
    description: '',
    duration_seconds: 1800,
    default_allowed_attempts: 1,
    negative_marking_enabled: false,
    negative_mark_value: 0,
    randomize_questions: false,
    randomize_options: false,
    show_score_after_submit: true,
    show_correct_answers_after_submit: false,
    allow_previous_question: true,
    auto_submit_on_expiry: true,
    proctoring_enabled: true,
  });

  useEffect(() => {
    loadQuiz();
  }, []);

  async function loadQuiz() {
    const { data } = await supabase
      .from('quizzes')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (data) {
      setQuiz(data);
      setForm({
        title: data.title,
        description: data.description || '',
        duration_seconds: data.duration_seconds,
        default_allowed_attempts: data.default_allowed_attempts,
        negative_marking_enabled: data.negative_marking_enabled,
        negative_mark_value: data.negative_mark_value,
        randomize_questions: data.randomize_questions,
        randomize_options: data.randomize_options,
        show_score_after_submit: data.show_score_after_submit,
        show_correct_answers_after_submit: data.show_correct_answers_after_submit,
        allow_previous_question: data.allow_previous_question,
        auto_submit_on_expiry: data.auto_submit_on_expiry,
        proctoring_enabled: data.proctoring_enabled,
      });

      const { count } = await supabase
        .from('questions')
        .select('*', { count: 'exact', head: true })
        .eq('quiz_id', data.id);
      setQuestionCount(count || 0);
    }
    setLoading(false);
  }

  async function createQuiz() {
    setSaving(true);
    const { data, error } = await supabase
      .from('quizzes')
      .insert({
        title: 'DejaVu',
        status: 'DRAFT',
        duration_seconds: 1800,
        default_allowed_attempts: 1,
      })
      .select()
      .single();

    if (data) {
      setQuiz(data);
      setToast({ message: 'Quiz created', type: 'success' });
      await logAction('Created quiz', 'quiz', data.id);
      setEditMode(true);
    } else {
      setToast({ message: error?.message || 'Failed to create quiz', type: 'error' });
    }
    setSaving(false);
  }

  async function saveSettings() {
    if (!quiz) return;
    setSaving(true);

    const { error } = await supabase
      .from('quizzes')
      .update(form)
      .eq('id', quiz.id);

    if (error) {
      setToast({ message: 'Failed to save settings', type: 'error' });
    } else {
      setToast({ message: 'Settings saved', type: 'success' });
      await logAction('Changed settings', 'quiz', quiz.id, form);
      setEditMode(false);
      loadQuiz();
    }
    setSaving(false);
  }

  async function changeStatus(newStatus: QuizStatus) {
    if (!quiz) return;
    setSaving(true);

    const { error } = await supabase
      .from('quizzes')
      .update({ status: newStatus })
      .eq('id', quiz.id);

    if (error) {
      setToast({ message: 'Failed to change status', type: 'error' });
    } else {
      setToast({ message: `Quiz is now ${newStatus}`, type: 'success' });
      await logAction(`${newStatus === 'LIVE' ? 'Started' : newStatus === 'PAUSED' ? 'Paused' : newStatus === 'CLOSED' ? 'Closed' : 'Updated'} quiz`, 'quiz', quiz.id);
      loadQuiz();
    }
    setSaving(false);
    setConfirm(null);
  }

  async function logAction(action: string, targetType: string, targetId: string, metadata: Record<string, unknown> = {}) {
    await supabase.from('admin_activity_logs').insert({
      admin_user_id: user!.id,
      action,
      target_type: targetType,
      target_id: targetId,
      metadata,
    });
  }

  if (loading) {
    return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;
  }

  if (!quiz) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Settings className="w-16 h-16 text-gray-300 mb-4" />
        <h2 className="text-xl font-semibold text-gray-900 mb-2">No Quiz Created</h2>
        <p className="text-gray-500 mb-6">Create a quiz to get started.</p>
        <Button onClick={createQuiz} loading={saving}>Create Quiz</Button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Quiz Control</h1>
          <p className="text-gray-500 text-sm mt-1">{quiz.title}</p>
        </div>
        <Badge variant={quiz.status} className="text-base px-4 py-1">{quiz.status}</Badge>
      </div>

      {/* Status Controls */}
      <Card className="mb-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Quiz Status</h3>
        <div className="flex items-center gap-3 mb-4">
          <div className="flex gap-2 flex-wrap">
            {quiz.status === 'DRAFT' && (
              <Button variant="secondary" onClick={() => changeStatus('READY')} loading={saving}>
                <Check className="w-4 h-4 mr-2" />
                Mark Ready
              </Button>
            )}
            {['DRAFT', 'READY', 'PAUSED'].includes(quiz.status) && (
              <Button variant="success" onClick={() => setConfirm({
                action: 'LIVE',
                title: 'Start Quiz',
                message: `Start the quiz? ${questionCount} questions loaded. Participants will be able to start.`,
              })} loading={saving}>
                <Play className="w-4 h-4 mr-2" />
                Start Quiz
              </Button>
            )}
            {quiz.status === 'LIVE' && (
              <Button variant="secondary" onClick={() => setConfirm({
                action: 'PAUSED',
                title: 'Pause Quiz',
                message: 'Pause the quiz? New participants cannot start. Active participants can continue.',
              })} loading={saving}>
                <Pause className="w-4 h-4 mr-2" />
                Pause Quiz
              </Button>
            )}
            {['LIVE', 'PAUSED'].includes(quiz.status) && (
              <Button variant="danger" onClick={() => setConfirm({
                action: 'CLOSED',
                title: 'Close Quiz',
                message: 'Close the quiz? No more attempts can be started. Active attempts will be auto-submitted.',
              })} loading={saving}>
                <Square className="w-4 h-4 mr-2" />
                Close Quiz
              </Button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-6 text-sm text-gray-500">
          <span>Questions: <strong className="text-gray-900">{questionCount}</strong></span>
          <span>Duration: <strong className="text-gray-900">{Math.floor(form.duration_seconds / 60)} min</strong></span>
          <span>Default Attempts: <strong className="text-gray-900">{form.default_allowed_attempts}</strong></span>
        </div>
      </Card>

      {/* Settings */}
      <Card>
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-gray-900">Quiz Settings</h3>
          {!editMode ? (
            <Button variant="secondary" size="sm" onClick={() => setEditMode(true)}>
              <Edit className="w-4 h-4 mr-2" />
              Edit
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => { setEditMode(false); loadQuiz(); }}>Cancel</Button>
              <Button size="sm" onClick={saveSettings} loading={saving}>Save</Button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Input
            label="Title"
            value={form.title}
            onChange={e => setForm({ ...form, title: e.target.value })}
            disabled={!editMode}
          />
          <Input
            label="Duration (seconds)"
            type="number"
            value={String(form.duration_seconds)}
            onChange={e => setForm({ ...form, duration_seconds: parseInt(e.target.value) || 0 })}
            disabled={!editMode}
          />
          <Input
            label="Default Allowed Attempts"
            type="number"
            value={String(form.default_allowed_attempts)}
            onChange={e => setForm({ ...form, default_allowed_attempts: parseInt(e.target.value) || 1 })}
            disabled={!editMode}
            min={1}
          />
          <Input
            label="Negative Mark Value"
            type="number"
            value={String(form.negative_mark_value)}
            onChange={e => setForm({ ...form, negative_mark_value: parseFloat(e.target.value) || 0 })}
            disabled={!editMode}
            step={0.25}
          />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-6">
          {[
            { key: 'negative_marking_enabled', label: 'Negative Marking' },
            { key: 'randomize_questions', label: 'Randomize Questions' },
            { key: 'randomize_options', label: 'Randomize Options' },
            { key: 'allow_previous_question', label: 'Allow Previous Question' },
            { key: 'show_score_after_submit', label: 'Show Score After Submit' },
            { key: 'show_correct_answers_after_submit', label: 'Show Correct Answers' },
            { key: 'auto_submit_on_expiry', label: 'Auto Submit on Expiry' },
            { key: 'proctoring_enabled', label: 'Proctoring Enabled' },
          ].map(({ key, label }) => (
            <label key={key} className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                className="w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                checked={form[key as keyof typeof form] as boolean}
                onChange={e => setForm({ ...form, [key]: e.target.checked })}
                disabled={!editMode}
              />
              <span className={editMode ? 'text-gray-900' : 'text-gray-500'}>{label}</span>
            </label>
          ))}
        </div>
      </Card>

      {/* Confirm Dialog */}
      {confirm && (
        <ConfirmDialog
          open={!!confirm}
          onClose={() => setConfirm(null)}
          onConfirm={() => changeStatus(confirm.action)}
          title={confirm.title}
          message={confirm.message}
          confirmText={confirm.title}
          variant={confirm.action === 'CLOSED' ? 'danger' : 'primary'}
          loading={saving}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
