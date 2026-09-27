import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, Badge, Spinner, Input, Button } from '@/components/ui';
import { Search, Download } from 'lucide-react';
import { downloadCSV } from '@/lib/utils';

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

export default function ResultsPage() {
  const [results, setResults] = useState<ResultRow[]>([]);
  const [filtered, setFiltered] = useState<ResultRow[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<'score' | 'team_id' | 'submitted_at'>('score');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    loadResults();
  }, []);

  async function loadResults() {
    const { data: quizData } = await supabase
      .from('quizzes')
      .select('id')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (quizData) {
      const { data: attempts } = await supabase
        .from('quiz_attempts')
        .select('*')
        .eq('quiz_id', quizData.id)
        .in('status', ['submitted', 'auto_submitted'])
        .order('score', { ascending: false });

      // Get violations
      const ids = (attempts || []).map(a => a.id);
      const { data: violations } = await supabase
        .from('violations')
        .select('attempt_id')
        .in('attempt_id', ids.length > 0 ? ids : ['none']);

      const vMap = new Map<string, number>();
      (violations || []).forEach(v => {
        vMap.set(v.attempt_id, (vMap.get(v.attempt_id) || 0) + 1);
      });

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
    }
    setLoading(false);
  }

  useEffect(() => {
    let data = search.trim()
      ? results.filter(r => r.team_id.toLowerCase().includes(search.toLowerCase()))
      : [...results];

    data.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'score') cmp = a.score - b.score;
      else if (sortKey === 'team_id') cmp = a.team_id.localeCompare(b.team_id);
      else if (sortKey === 'submitted_at') cmp = new Date(a.submitted_at).getTime() - new Date(b.submitted_at).getTime();
      return sortDir === 'desc' ? -cmp : cmp;
    });

    setFiltered(data);
  }, [search, results, sortKey, sortDir]);

  function toggleSort(key: typeof sortKey) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
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

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Results</h1>
          <p className="text-gray-500 text-sm mt-1">{results.length} submitted attempts</p>
        </div>
        <Button variant="secondary" onClick={handleExport}>
          <Download className="w-4 h-4 mr-2" />
          Export CSV
        </Button>
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
                <th className="text-center py-3 px-4 text-gray-600 font-medium">Attempt</th>
                <th className="text-center py-3 px-4 text-gray-600 font-medium cursor-pointer hover:text-gray-900" onClick={() => toggleSort('score')}>
                  Score {sortKey === 'score' && (sortDir === 'asc' ? '↑' : '↓')}
                </th>
                <th className="text-center py-3 px-4 text-gray-600 font-medium">Correct</th>
                <th className="text-center py-3 px-4 text-gray-600 font-medium">Wrong</th>
                <th className="text-center py-3 px-4 text-gray-600 font-medium">Unanswered</th>
                <th className="text-left py-3 px-4 text-gray-600 font-medium cursor-pointer hover:text-gray-900" onClick={() => toggleSort('submitted_at')}>
                  Submitted {sortKey === 'submitted_at' && (sortDir === 'asc' ? '↑' : '↓')}
                </th>
                <th className="text-center py-3 px-4 text-gray-600 font-medium">Violations</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={`${r.team_id}-${r.attempt_number}`} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-3 px-4 font-mono font-medium">{r.team_id}</td>
                  <td className="py-3 px-4 text-center">#{r.attempt_number}</td>
                  <td className="py-3 px-4 text-center">
                    <span className="font-bold text-indigo-600">{r.score}</span>
                    <span className="text-gray-400">/{r.max_score}</span>
                  </td>
                  <td className="py-3 px-4 text-center text-emerald-600">{r.correct_count}</td>
                  <td className="py-3 px-4 text-center text-red-600">{r.wrong_count}</td>
                  <td className="py-3 px-4 text-center text-gray-500">{r.unanswered_count}</td>
                  <td className="py-3 px-4 text-gray-500 text-xs">
                    {r.submitted_at ? new Date(r.submitted_at).toLocaleString() : '—'}
                  </td>
                  <td className="py-3 px-4 text-center">
                    {r.violation_count > 0 ? (
                      <span className="text-red-600 font-medium">{r.violation_count}</span>
                    ) : (
                      <span className="text-gray-400">0</span>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-gray-500">No results yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
