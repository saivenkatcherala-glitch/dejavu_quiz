import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAdminAuth } from '@/contexts/AdminAuthContext';
import { Button, Input, Card, Badge, ConfirmDialog, Toast, Spinner, Modal } from '@/components/ui';
import type { Quiz, QuizStatus } from '@/lib/types';
import { Play, Pause, Square, Edit, Check, Settings } from 'lucide-react';

export default function QuizControlPage() {
  const { user } = useAdminAuth();
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [confirm, setConfirm] = useState<{ action: QuizStatus; title: string; message: string } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
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
    violation_limit_enabled: false,
    violation_limit: 3,
  });

  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [selectedQuizId, setSelectedQuizId] = useState<string>('');
  const [newQuizTitle, setNewQuizTitle] = useState('');
  const [createModalOpen, setCreateModalOpen] = useState(false);

  useEffect(() => {
    loadQuizzes();
  }, []);

  async function loadQuizzes() {
    const { data: allQuizzes } = await supabase
      .from('quizzes')
      .select('*')
      .order('created_at', { ascending: false });

    setQuizzes(allQuizzes || []);
    if (allQuizzes && allQuizzes.length > 0) {
      const targetId = selectedQuizId || allQuizzes[0].id;
      setSelectedQuizId(targetId);
      loadQuizDetails(targetId, allQuizzes);
    } else {
      setLoading(false);
    }
  }

  async function loadQuizDetails(qId: string, quizList?: Quiz[]) {
    const list = quizList || quizzes;
    const target = list.find(q => q.id === qId) || list[0];

    if (target) {
      setQuiz(target);
      setForm({
        title: target.title,
        description: target.description || '',
        duration_seconds: target.duration_seconds,
        default_allowed_attempts: target.default_allowed_attempts,
        negative_marking_enabled: target.negative_marking_enabled,
        negative_mark_value: target.negative_mark_value,
        randomize_questions: target.randomize_questions,
        randomize_options: target.randomize_options,
        show_score_after_submit: target.show_score_after_submit,
        show_correct_answers_after_submit: target.show_correct_answers_after_submit,
        allow_previous_question: target.allow_previous_question,
        auto_submit_on_expiry: target.auto_submit_on_expiry,
        proctoring_enabled: target.proctoring_enabled,
        violation_limit_enabled: target.violation_limit_enabled || false,
        violation_limit: target.violation_limit || 3,
      });

      const { count } = await supabase
        .from('questions')
        .select('*', { count: 'exact', head: true })
        .eq('quiz_id', target.id);
      setQuestionCount(count || 0);
    }
    setLoading(false);
  }

  function handleSelectQuiz(id: string) {
    setSelectedQuizId(id);
    loadQuizDetails(id);
  }

  async function createQuiz() {
    if (!newQuizTitle.trim()) return;
    setSaving(true);
    const { data, error } = await supabase
      .from('quizzes')
      .insert({
        title: newQuizTitle.trim(),
        description: `Quiz section for ${newQuizTitle.trim()}`,
        status: 'DRAFT',
        duration_seconds: 1800,
        default_allowed_attempts: 1,
      })
      .select()
      .single();

    if (data) {
      setToast({ message: `Created quiz "${data.title}"`, type: 'success' });
      await logAction('Created quiz', 'quiz', data.id);
      setCreateModalOpen(false);
      setNewQuizTitle('');
      setSelectedQuizId(data.id);
      loadQuizzes();
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
      setToast({ message: `Failed to save: ${error.message}`, type: 'error' });
    } else {
      setToast({ message: 'Settings saved', type: 'success' });
      await logAction('Changed settings', 'quiz', quiz.id, form);
      setEditMode(false);
      loadQuizzes();
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
      loadQuizzes();
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

  async function handleDeleteQuiz() {
    if (!quiz) return;
    setSaving(true);
    try {
      // 1. Delete questions
      await supabase.from('questions').delete().eq('quiz_id', quiz.id);
      
      // 2. Find and delete attempts and their violations
      const { data: attempts } = await supabase.from('quiz_attempts').select('id').eq('quiz_id', quiz.id);
      if (attempts && attempts.length > 0) {
        const attemptIds = attempts.map(a => a.id);
        await supabase.from('violations').delete().in('attempt_id', attemptIds);
        await supabase.from('quiz_attempts').delete().in('id', attemptIds);
      }
      
      // 3. Delete the quiz
      const { error } = await supabase.from('quizzes').delete().eq('id', quiz.id);
      if (error) throw error;
      
      setToast({ message: 'Quiz permanently deleted', type: 'success' });
      await logAction('Deleted quiz', 'quiz', quiz.id);
      setDeleteConfirm(false);
      // reset selection and load
      setSelectedQuizId('');
      loadQuizzes();
    } catch (err: any) {
      setToast({ message: err.message || 'Failed to delete quiz', type: 'error' });
    } finally {
      setSaving(false);
    }
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
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Quiz Control</h1>
          <p className="text-gray-500 text-sm mt-1">Managing: {quiz.title}</p>
        </div>

        <div className="flex items-center gap-3">
          {/* Quiz Selector */}
          {quizzes.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-700">Select Quiz:</span>
              <select
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white font-medium focus:ring-2 focus:ring-indigo-500"
                value={selectedQuizId}
                onChange={e => handleSelectQuiz(e.target.value)}
              >
                {quizzes.map(q => (
                  <option key={q.id} value={q.id}>
                    {q.title} ({q.status})
                  </option>
                ))}
              </select>
            </div>
          )}

          <Button onClick={() => setCreateModalOpen(true)}>
            + Create Quiz / Section
          </Button>
          <Badge variant={quiz.status} className="text-base px-4 py-1">{quiz.status}</Badge>
        </div>
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
            
            <Button variant="danger" className="bg-red-50 text-red-600 border-red-200 hover:bg-red-100" onClick={() => setDeleteConfirm(true)} loading={saving}>
              Delete Quiz Completely
            </Button>
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
              <Button variant="secondary" size="sm" onClick={() => { setEditMode(false); if (selectedQuizId) loadQuizDetails(selectedQuizId); }}>Cancel</Button>
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
            { key: 'violation_limit_enabled', label: 'Enable Violation Limit' },
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
        
        {form.violation_limit_enabled && (
          <div className="mt-6 border-t pt-4">
            <div className="max-w-xs">
              <Input
                label="Maximum Violations Allowed"
                type="number"
                value={String(form.violation_limit)}
                onChange={e => setForm({ ...form, violation_limit: parseInt(e.target.value) || 1 })}
                disabled={!editMode}
                min={1}
                step={1}
              />
              <p className="text-xs text-gray-500 mt-1">
                Quiz will auto-submit and lock if the team exceeds this many violations.
              </p>
            </div>
          </div>
        )}
      </Card>

      {/* Create New Quiz Modal */}
      <Modal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title="Create New Quiz / Section"
        size="md"
      >
        <div className="space-y-4">
          <Input
            label="Quiz / Theme Title (e.g. AGENTIC_AI, CYBERSECURITY, HEALTHCARE)"
            placeholder="Enter section or theme name..."
            value={newQuizTitle}
            onChange={e => setNewQuizTitle(e.target.value)}
            required
            autoFocus
          />
          <p className="text-xs text-gray-500">
            Teams with a matching theme will automatically be assigned to this quiz when they log in.
          </p>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setCreateModalOpen(false)}>Cancel</Button>
            <Button onClick={createQuiz} loading={saving} disabled={!newQuizTitle.trim()}>
              Create Quiz
            </Button>
          </div>
        </div>
      </Modal>

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

      {/* Delete Quiz Dialog */}
      <ConfirmDialog
        open={deleteConfirm}
        onClose={() => setDeleteConfirm(false)}
        onConfirm={handleDeleteQuiz}
        title="Delete Quiz Completely"
        message={`Are you sure you want to permanently delete "${quiz.title}"? This will ALSO delete all questions, attempts, and violations associated with it. This CANNOT be undone.`}
        confirmText="Yes, Delete Quiz"
        variant="danger"
        loading={saving}
      />

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
