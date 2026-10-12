import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, Badge, Spinner, Input, Button } from '@/components/ui';
import { Search, Download } from 'lucide-react';
import { downloadCSV } from '@/lib/utils';
import type { Quiz } from '@/lib/types';

interface ResultRow {
  team_id: string;
  attempt_number: number;
  score: number;
  max_score: number;
  correct_count: number;
  wrong_count: number;
  unanswered_count: number;
  submitted_at: string;
  status: string;
  violation_count: number;
}

const STORAGE_QUIZ_KEY = 'dejavu_admin_dashboard_quiz';

export default function ResultsPage() {
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [selectedQuizId, setSelectedQuizId] = useState<string>('');
  const [results, setResults] = useState<ResultRow[]>([]);
  const [filtered, setFiltered] = useState<ResultRow[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<'score' | 'team_id' | 'submitted_at'>('score');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    initResults();
  }, []);

  useEffect(() => {
    if (selectedQuizId) {
      loadResults(selectedQuizId);
    }
  }, [selectedQuizId]);

  async function initResults() {
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
      console.error('Error init results:', err);
    } finally {
      setLoading(false);
    }
  }

  async function loadResults(quizId: string) {
    if (!quizId) return;

    try {
      let attemptsQuery = supabase
        .from('quiz_attempts')
        .select('*')
        .in('status', ['submitted', 'auto_submitted'])
        .order('score', { ascending: false });

      if (quizId !== 'all') {
        attemptsQuery = attemptsQuery.eq('quiz_id', quizId);
      }

      const { data: attempts } = await attemptsQuery;

      // Get violations
      const ids = (attempts || []).map(a => a.id);
      const vMap = new Map<string, number>();
      if (ids.length > 0) {
        const { data: violations } = await supabase
          .from('violations')
          .select('attempt_id')
          .in('attempt_id', ids);

        (violations || []).forEach(v => {
          vMap.set(v.attempt_id, (vMap.get(v.attempt_id) || 0) + 1);
        });
      }

      const rows: ResultRow[] = (attempts || []).map(a => ({
        team_id: a.team_id,
        attempt_number: a.attempt_number,
        score: a.score || 0,
        max_score: a.max_score || 0,
        correct_count: a.correct_count || 0,
        wrong_count: a.wrong_count || 0,
        unanswered_count: a.unanswered_count || 0,
        submitted_at: a.submitted_at,
        status: a.status,
        violation_count: vMap.get(a.id) || 0,
      }));

      setResults(rows);
      setFiltered(rows);
    } catch (err) {
      console.error('Error loading results:', err);
    }
  }

  function handleSelectQuiz(id: string) {
    setSelectedQuizId(id);
    localStorage.setItem(STORAGE_QUIZ_KEY, id);
  }

  useEffect(() => {
    let data = search.trim()
      ? results.filter(r => r.team_id.toLowerCase().includes(search.toLowerCase()))
      : [...results];

    data.sort((a, b) => {
      let valA = a[sortKey];
      let valB = b[sortKey];
      if (typeof valA === 'string') {
        return sortDir === 'asc'
          ? (valA as string).localeCompare(valB as string)
          : (valB as string).localeCompare(valA as string);
      }
      return sortDir === 'asc' ? (valA as number) - (valB as number) : (valB as number) - (valA as number);
    });

    setFiltered(data);
  }, [search, results, sortKey, sortDir]);

  function toggleSort(key: typeof sortKey) {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  function handleExport() {
    downloadCSV(
      filtered.map(r => ({
        'Team ID': r.team_id,
        'Attempt': r.attempt_number,
        'Status': r.status,
        'Score': r.score,
        'Max Score': r.max_score,
        'Correct': r.correct_count,
        'Wrong': r.wrong_count,
        'Unanswered': r.unanswered_count,
        'Submitted': r.submitted_at ? new Date(r.submitted_at).toLocaleString() : '',
        'Violations': r.violation_count,
      })),
      `dejavu_results_${new Date().toISOString().slice(0, 10)}.csv`
    );
  }

  if (loading) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;

  const selectedQuiz = quizzes.find(q => q.id === selectedQuizId);

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Results</h1>
          <p className="text-gray-500 text-sm mt-1">{results.length} submitted attempts</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
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

          <Button variant="secondary" onClick={handleExport}>
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </div>

      <div className="mb-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input className="pl-10" placeholder="Search by Team ID..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      <Card padding={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left py-3 px-4 text-gray-600 font-medium cursor-pointer hover:text-gray-900" onClick={() => toggleSort('team_id')}>
                  Team ID {sortKey === 'team_id' && (sortDir === 'asc' ? '↑' : '↓')}
                </th>
                <th className="text-center py-3 px-3 text-gray-600 font-medium">Attempt</th>
                <th className="text-center py-3 px-3 text-gray-600 font-medium">Status</th>
                <th className="text-center py-3 px-3 text-gray-600 font-medium cursor-pointer hover:text-gray-900" onClick={() => toggleSort('score')}>
                  Score {sortKey === 'score' && (sortDir === 'asc' ? '↑' : '↓')}
                </th>
                <th className="text-center py-3 px-3 text-gray-600 font-medium">Correct</th>
                <th className="text-center py-3 px-3 text-gray-600 font-medium">Wrong</th>
                <th className="text-center py-3 px-3 text-gray-600 font-medium">Unanswered</th>
                <th className="text-center py-3 px-3 text-gray-600 font-medium">Violations</th>
                <th className="text-left py-3 px-4 text-gray-600 font-medium cursor-pointer hover:text-gray-900" onClick={() => toggleSort('submitted_at')}>
                  Submitted At {sortKey === 'submitted_at' && (sortDir === 'asc' ? '↑' : '↓')}
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(row => (
                <tr key={`${row.team_id}-${row.attempt_number}`} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-3 px-4 font-mono font-medium">{row.team_id}</td>
                  <td className="py-3 px-3 text-center text-gray-500">#{row.attempt_number}</td>
                  <td className="py-3 px-3 text-center">
                    <Badge variant={row.status}>{row.status}</Badge>
                  </td>
                  <td className="py-3 px-3 text-center font-bold text-gray-900">
                    {row.score}/{row.max_score}
                  </td>
                  <td className="py-3 px-3 text-center text-emerald-600 font-medium">{row.correct_count}</td>
                  <td className="py-3 px-3 text-center text-red-600 font-medium">{row.wrong_count}</td>
                  <td className="py-3 px-3 text-center text-gray-400">{row.unanswered_count}</td>
                  <td className="py-3 px-3 text-center">
                    {row.violation_count > 0 ? (
                      <span className="text-red-600 font-medium">{row.violation_count}</span>
                    ) : (
                      <span className="text-gray-400">0</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-gray-500 text-xs">
                    {row.submitted_at ? new Date(row.submitted_at).toLocaleString() : '—'}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-gray-500">
                    {results.length === 0 ? 'No submitted attempts found for this quiz.' : 'No results match your search.'}
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
