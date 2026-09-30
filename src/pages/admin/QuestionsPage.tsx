import React, { useEffect, useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAdminAuth } from '@/contexts/AdminAuthContext';
import { Button, Input, Textarea, Card, Modal, ConfirmDialog, Spinner, Toast, Badge } from '@/components/ui';
import { Plus, Edit, Trash2, Upload, Eye, FileText } from 'lucide-react';
import type { Question, Quiz, OptionLetter } from '@/lib/types';
import Papa from 'papaparse';

export default function QuestionsPage() {
  const { user } = useAdminAuth();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Form
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Question | null>(null);
  const [form, setForm] = useState({
    question_text: '',
    option_a: '',
    option_b: '',
    option_c: '',
    option_d: '',
    correct_option: 'A' as OptionLetter,
    marks: '1',
    negative_marks: '0',
  });
  const [formLoading, setFormLoading] = useState(false);

  // Delete
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // CSV Import
  const [csvOpen, setCsvOpen] = useState(false);
  const [csvPreview, setCsvPreview] = useState<any[]>([]);
  const [csvErrors, setCsvErrors] = useState<{ row: number; message: string }[]>([]);
  const [csvLoading, setCsvLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Preview
  const [previewQ, setPreviewQ] = useState<Question | null>(null);

  // Multi-select & Bulk Delete
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [selectedQuizId, setSelectedQuizId] = useState<string>('');
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [deleteAllConfirm, setDeleteAllConfirm] = useState(false);

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
      const activeId = selectedQuizId || allQuizzes[0].id;
      setSelectedQuizId(activeId);
      loadQuestions(activeId);
    } else {
      setLoading(false);
    }
  }

  async function loadQuestions(qId: string) {
    setLoading(true);
    const { data: qData } = await supabase
      .from('quizzes')
      .select('*')
      .eq('id', qId)
      .single();

    setQuiz(qData || null);

    const { data } = await supabase
      .from('questions')
      .select('*')
      .eq('quiz_id', qId)
      .order('sort_order', { ascending: true });

    setQuestions(data || []);
    setSelectedIds([]);
    setLoading(false);
  }

  function handleQuizChange(id: string) {
    setSelectedQuizId(id);
    loadQuestions(id);
  }

  function toggleSelectAll() {
    if (selectedIds.length === questions.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(questions.map(q => q.id));
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  }

  async function handleBulkDelete() {
    if (selectedIds.length === 0) return;
    setDeleteLoading(true);

    const { error } = await supabase.from('questions').delete().in('id', selectedIds);
    if (!error) {
      setToast({ message: `Deleted ${selectedIds.length} questions`, type: 'success' });
      await logAction('Bulk deleted questions', 'questions', selectedIds.join(','));
    } else {
      setToast({ message: 'Failed to delete questions', type: 'error' });
    }

    setDeleteLoading(false);
    setBulkDeleteConfirm(false);
    setSelectedIds([]);
    if (selectedQuizId) loadQuestions(selectedQuizId);
  }

  async function handleDeleteAll() {
    if (!quiz) return;
    setDeleteLoading(true);

    const { error } = await supabase.from('questions').delete().eq('quiz_id', quiz.id);
    if (!error) {
      setToast({ message: `Deleted all questions for ${quiz.title}`, type: 'success' });
      await logAction('Deleted all questions', 'quiz', quiz.id);
    } else {
      setToast({ message: 'Failed to delete all questions', type: 'error' });
    }

    setDeleteLoading(false);
    setDeleteAllConfirm(false);
    setSelectedIds([]);
    if (selectedQuizId) loadQuestions(selectedQuizId);
  }

  function openAdd() {
    setEditing(null);
    setForm({
      question_text: '',
      option_a: '',
      option_b: '',
      option_c: '',
      option_d: '',
      correct_option: 'A',
      marks: '1',
      negative_marks: '0',
    });
    setFormOpen(true);
  }

  function openEdit(q: Question) {
    setEditing(q);
    setForm({
      question_text: q.question_text,
      option_a: q.option_a,
      option_b: q.option_b,
      option_c: q.option_c,
      option_d: q.option_d,
      correct_option: q.correct_option,
      marks: String(q.marks),
      negative_marks: String(q.negative_marks),
    });
    setFormOpen(true);
  }

  async function handleSave() {
    if (!quiz) return;
    setFormLoading(true);

    const payload = {
      quiz_id: quiz.id,
      question_text: form.question_text,
      option_a: form.option_a,
      option_b: form.option_b,
      option_c: form.option_c,
      option_d: form.option_d,
      correct_option: form.correct_option,
      marks: parseFloat(form.marks) || 1,
      negative_marks: parseFloat(form.negative_marks) || 0,
      sort_order: editing ? undefined : questions.length,
    };

    if (editing) {
      const { error } = await supabase.from('questions').update(payload).eq('id', editing.id);
      if (error) {
        setToast({ message: 'Failed to update question', type: 'error' });
      } else {
        setToast({ message: 'Question updated', type: 'success' });
        await logAction('Updated question', 'question', editing.id);
      }
    } else {
      const { error } = await supabase.from('questions').insert(payload);
      if (error) {
        setToast({ message: 'Failed to add question', type: 'error' });
      } else {
        setToast({ message: 'Question added', type: 'success' });
        await logAction('Added question', 'question', '');
      }
    }

    setFormLoading(false);
    setFormOpen(false);
    loadData();
  }

  async function handleDelete() {
    if (!deleteId) return;
    setDeleteLoading(true);
    const { error } = await supabase.from('questions').delete().eq('id', deleteId);
    if (!error) {
      setToast({ message: 'Question deleted', type: 'success' });
      await logAction('Deleted question', 'question', deleteId);
    }
    setDeleteLoading(false);
    setDeleteId(null);
    loadData();
  }

  async function logAction(action: string, targetType: string, targetId: string) {
    await supabase.from('admin_activity_logs').insert({
      admin_user_id: user!.id,
      action,
      target_type: targetType,
      target_id: targetId,
    });
  }

  // CSV Import
  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.trim().toLowerCase().replace(/\s+/g, '_'),
      complete: (results) => {
        const valid: any[] = [];
        const errors: { row: number; message: string }[] = [];

        results.data.forEach((row: any, i: number) => {
          const rowNum = i + 2; // 1-indexed + header
          
          // Allow both 'question' and 'question_text' depending on CSV headers
          const questionText = row.question_text || row.question;
          
          if (!questionText?.trim()) {
            errors.push({ row: rowNum, message: 'Missing question text' });
            return;
          }
          if (!row.option_a?.trim() || !row.option_b?.trim() || !row.option_c?.trim() || !row.option_d?.trim()) {
            errors.push({ row: rowNum, message: 'Missing one or more options' });
            return;
          }
          const correct = (row.correct_option || '').toUpperCase().trim();
          if (!['A', 'B', 'C', 'D'].includes(correct)) {
            errors.push({ row: rowNum, message: `Invalid correct_option: "${row.correct_option}"` });
            return;
          }
          valid.push({
            question_text: questionText.trim(),
            option_a: row.option_a.trim(),
            option_b: row.option_b.trim(),
            option_c: row.option_c.trim(),
            option_d: row.option_d.trim(),
            correct_option: correct,
            marks: parseFloat(row.marks) || 1,
            negative_marks: parseFloat(row.negative_marks) || 0,
          });
        });

        setCsvPreview(valid);
        setCsvErrors(errors);
        setCsvOpen(true);
      },
    });

    // Reset file input
    e.target.value = '';
  }

  async function handleCsvImport() {
    if (!quiz || csvPreview.length === 0) return;
    setCsvLoading(true);

    const rows = csvPreview.map((row, i) => ({
      ...row,
      quiz_id: quiz.id,
      sort_order: questions.length + i,
    }));

    const { error } = await supabase.from('questions').insert(rows);
    if (error) {
      setToast({ message: 'Import failed: ' + error.message, type: 'error' });
    } else {
      setToast({ message: `Imported ${rows.length} questions`, type: 'success' });
      await logAction('Imported questions', 'quiz', quiz.id);
    }

    setCsvLoading(false);
    setCsvOpen(false);
    loadData();
  }

  if (loading) {
    return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Questions</h1>
          <p className="text-gray-500 text-sm mt-1">
            {questions.length} questions {quiz ? `in "${quiz.title}"` : ''}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Quiz Selector */}
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

          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={handleFileSelect}
          />
          <Button variant="secondary" onClick={() => fileRef.current?.click()}>
            <Upload className="w-4 h-4 mr-2" />
            Import CSV
          </Button>
          <Button onClick={openAdd}>
            <Plus className="w-4 h-4 mr-2" />
            Add Question
          </Button>
        </div>
      </div>

      {/* Select All & Bulk Actions Bar */}
      {questions.length > 0 && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between bg-indigo-50/50 border border-indigo-100 rounded-xl px-4 py-3 mb-4 shadow-sm gap-3">
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="selectAll"
              className="w-5 h-5 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500 cursor-pointer accent-indigo-600"
              checked={selectedIds.length === questions.length && questions.length > 0}
              onChange={toggleSelectAll}
            />
            <label htmlFor="selectAll" className="text-sm font-semibold text-gray-900 cursor-pointer select-none flex items-center gap-2">
              Select All Questions
              <span className="text-xs font-medium px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full">
                {selectedIds.length} of {questions.length} selected
              </span>
            </label>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            {selectedIds.length > 0 && (
              <Button
                variant="danger"
                size="sm"
                onClick={() => setBulkDeleteConfirm(true)}
                className="shadow-sm"
              >
                <Trash2 className="w-4 h-4 mr-1.5" />
                Delete Selected ({selectedIds.length})
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              className="text-red-600 hover:bg-red-50 border-red-200"
              onClick={() => setDeleteAllConfirm(true)}
            >
              <Trash2 className="w-4 h-4 mr-1.5" />
              Delete All Questions
            </Button>
          </div>
        </div>
      )}

      {/* Questions List */}
      <div className="space-y-3">
        {questions.map((q, index) => {
          const isSelected = selectedIds.includes(q.id);
          return (
            <Card
              key={q.id}
              className={`transition-all ${
                isSelected ? 'ring-2 ring-indigo-500 bg-indigo-50/30 border-indigo-200' : 'hover:border-gray-300'
              }`}
            >
              <div className="flex items-start gap-4">
                <div className="pt-1">
                  <input
                    type="checkbox"
                    className="w-5 h-5 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500 cursor-pointer accent-indigo-600"
                    checked={isSelected}
                    onChange={() => toggleSelect(q.id)}
                  />
                </div>
                <div className="flex-1 cursor-pointer" onClick={() => toggleSelect(q.id)}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-bold text-indigo-600">Q{index + 1}</span>
                    <span className="text-xs text-gray-400">|</span>
                    <span className="text-xs font-medium text-gray-600">{q.marks} mark{q.marks !== 1 ? 's' : ''}</span>
                    {q.negative_marks > 0 && (
                      <span className="text-xs font-semibold text-red-500">-{q.negative_marks}</span>
                    )}
                  </div>
                  <p className="text-gray-900 font-medium">{q.question_text}</p>
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {(['A', 'B', 'C', 'D'] as OptionLetter[]).map(opt => {
                      const optionText = q[`option_${opt.toLowerCase()}` as keyof Question] as string;
                      const isCorrect = q.correct_option === opt;
                      return (
                        <div
                          key={opt}
                          className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                            isCorrect ? 'bg-emerald-50 text-emerald-800 border border-emerald-300 font-medium' : 'bg-gray-50 text-gray-700'
                          }`}
                        >
                          <span className="font-bold mr-1.5">{opt}.</span> {optionText}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => setPreviewQ(q)}
                    className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg"
                    title="Preview"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => openEdit(q)}
                    className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                    title="Edit"
                  >
                    <Edit className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setDeleteId(q.id)}
                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </Card>
          );
        })}

        {questions.length === 0 && (
          <Card>
            <div className="text-center py-8">
              <FileText className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">No questions yet for this quiz. Add questions or import from CSV.</p>
            </div>
          </Card>
        )}
      </div>

      {/* Add/Edit Question Modal */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'Edit Question' : 'Add Question'}
        size="lg"
      >
        <div className="space-y-4">
          <Textarea
            label="Question Text"
            value={form.question_text}
            onChange={e => setForm({ ...form, question_text: e.target.value })}
            rows={3}
            placeholder="Enter the question..."
            required
          />
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Option A"
              value={form.option_a}
              onChange={e => setForm({ ...form, option_a: e.target.value })}
              required
            />
            <Input
              label="Option B"
              value={form.option_b}
              onChange={e => setForm({ ...form, option_b: e.target.value })}
              required
            />
            <Input
              label="Option C"
              value={form.option_c}
              onChange={e => setForm({ ...form, option_c: e.target.value })}
              required
            />
            <Input
              label="Option D"
              value={form.option_d}
              onChange={e => setForm({ ...form, option_d: e.target.value })}
              required
            />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Correct Option</label>
              <select
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 bg-white"
                value={form.correct_option}
                onChange={e => setForm({ ...form, correct_option: e.target.value as OptionLetter })}
              >
                <option value="A">A</option>
                <option value="B">B</option>
                <option value="C">C</option>
                <option value="D">D</option>
              </select>
            </div>
            <Input
              label="Marks"
              type="number"
              value={form.marks}
              onChange={e => setForm({ ...form, marks: e.target.value })}
              min={0}
            />
            <Input
              label="Negative Marks"
              type="number"
              value={form.negative_marks}
              onChange={e => setForm({ ...form, negative_marks: e.target.value })}
              min={0}
              step={0.25}
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} loading={formLoading}>
              {editing ? 'Update' : 'Add Question'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Single Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Question"
        message="Are you sure you want to delete this question? This cannot be undone."
        confirmText="Delete"
        variant="danger"
        loading={deleteLoading}
      />

      {/* Bulk Delete Confirmation */}
      <ConfirmDialog
        open={bulkDeleteConfirm}
        onClose={() => setBulkDeleteConfirm(false)}
        onConfirm={handleBulkDelete}
        title={`Delete ${selectedIds.length} Questions`}
        message={`Are you sure you want to delete the ${selectedIds.length} selected questions? This cannot be undone.`}
        confirmText={`Delete ${selectedIds.length} Questions`}
        variant="danger"
        loading={deleteLoading}
      />

      {/* Delete All Confirmation */}
      <ConfirmDialog
        open={deleteAllConfirm}
        onClose={() => setDeleteAllConfirm(false)}
        onConfirm={handleDeleteAll}
        title="Delete ALL Questions"
        message={`Are you sure you want to delete ALL ${questions.length} questions in this quiz? This action is permanent and cannot be undone.`}
        confirmText="Delete ALL Questions"
        variant="danger"
        loading={deleteLoading}
      />

      {/* Preview Modal */}
      {previewQ && (
        <Modal open={!!previewQ} onClose={() => setPreviewQ(null)} title="Question Preview" size="md">
          <div className="space-y-4">
            <p className="text-lg font-medium text-gray-900">{previewQ.question_text}</p>
            <div className="space-y-2">
              {(['A', 'B', 'C', 'D'] as OptionLetter[]).map(opt => {
                const text = previewQ[`option_${opt.toLowerCase()}` as keyof Question] as string;
                return (
                  <div key={opt} className="px-4 py-3 border border-gray-200 rounded-lg text-sm hover:bg-indigo-50 cursor-pointer transition-colors">
                    <span className="font-medium mr-2">{opt}.</span>{text}
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-4 text-sm text-gray-500 pt-2">
              <span>Marks: {previewQ.marks}</span>
              <span>Negative: {previewQ.negative_marks}</span>
              <span>Answer: <strong className="text-emerald-600">{previewQ.correct_option}</strong></span>
            </div>
          </div>
        </Modal>
      )}

      {/* CSV Import Preview Modal */}
      <Modal
        open={csvOpen}
        onClose={() => setCsvOpen(false)}
        title="CSV Import Preview"
        size="lg"
      >
        <div className="space-y-4">
          {csvErrors.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <h4 className="text-sm font-medium text-red-800 mb-2">Validation Errors ({csvErrors.length})</h4>
              <ul className="text-xs text-red-700 space-y-1">
                {csvErrors.slice(0, 10).map((err, i) => (
                  <li key={i}>Row {err.row}: {err.message}</li>
                ))}
                {csvErrors.length > 10 && (
                  <li>...and {csvErrors.length - 10} more errors</li>
                )}
              </ul>
            </div>
          )}

          <p className="text-sm text-gray-600">
            <strong>{csvPreview.length}</strong> valid questions ready to import.
          </p>

          {csvPreview.length > 0 && (
            <div className="max-h-60 overflow-y-auto border rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="text-left py-2 px-3">#</th>
                    <th className="text-left py-2 px-3">Question</th>
                    <th className="text-left py-2 px-3">Answer</th>
                    <th className="text-left py-2 px-3">Marks</th>
                  </tr>
                </thead>
                <tbody>
                  {csvPreview.slice(0, 20).map((row, i) => (
                    <tr key={i} className="border-t border-gray-100">
                      <td className="py-2 px-3">{i + 1}</td>
                      <td className="py-2 px-3 truncate max-w-xs">{row.question_text}</td>
                      <td className="py-2 px-3">{row.correct_option}</td>
                      <td className="py-2 px-3">{row.marks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setCsvOpen(false)}>Cancel</Button>
            <Button onClick={handleCsvImport} loading={csvLoading} disabled={csvPreview.length === 0}>
              Import {csvPreview.length} Questions
            </Button>
          </div>
        </div>
      </Modal>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
