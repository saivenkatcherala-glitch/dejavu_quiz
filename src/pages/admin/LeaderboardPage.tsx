import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, Spinner } from '@/components/ui';
import { Trophy, Medal } from 'lucide-react';
import type { QuizAttempt, Quiz } from '@/lib/types';

interface LeaderboardEntry extends QuizAttempt {
  team_name: string;
}

export default function LeaderboardPage() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [selectedQuizId, setSelectedQuizId] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadQuizzes();
  }, []);

  useEffect(() => {
    if (selectedQuizId) {
      loadLeaderboard(selectedQuizId);
      const interval = setInterval(() => loadLeaderboard(selectedQuizId), 5000);
      return () => clearInterval(interval);
    }
  }, [selectedQuizId]);

  async function loadQuizzes() {
    const { data: quizList } = await supabase
      .from('quizzes')
      .select('*')
      .order('created_at', { ascending: false });

    if (quizList && quizList.length > 0) {
      setQuizzes(quizList);
      setSelectedQuizId(quizList[0].id);
    } else {
      setLoading(false);
    }
  }

  async function loadLeaderboard(quizId: string) {
    const { data } = await supabase
      .from('quiz_attempts')
      .select(`
        *,
        team:teams(name)
      `)
      .eq('quiz_id', quizId)
      .in('status', ['submitted', 'auto_submitted'])
      .order('score', { ascending: false })
      .order('completed_at', { ascending: true }); // Faster completion breaks ties

    if (data) {
      const formatted = data.map((d: any) => ({
        ...d,
        team_name: d.team?.name || d.team_id,
      }));
      setEntries(formatted);
    }
    setLoading(false);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-gradient-to-r from-indigo-600 to-purple-600 p-6 rounded-xl text-white shadow-lg">
        <div className="flex items-center gap-4">
          <div className="bg-white/20 p-3 rounded-xl">
            <Trophy className="w-8 h-8 text-yellow-300" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">Live Leaderboard</h1>
            <p className="text-indigo-100 mt-1">Real-time rankings and scores</p>
          </div>
        </div>

        <select
          className="px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white font-medium focus:ring-2 focus:ring-white/50 w-full sm:w-64"
          value={selectedQuizId}
          onChange={(e) => setSelectedQuizId(e.target.value)}
        >
          {quizzes.map(q => (
            <option key={q.id} value={q.id} className="text-gray-900">{q.title}</option>
          ))}
        </select>
      </div>

      <Card className="p-0 overflow-hidden">
        {loading && entries.length === 0 ? (
          <div className="p-8 text-center">
            <Spinner size="md" />
            <p className="mt-2 text-gray-500">Loading rankings...</p>
          </div>
        ) : entries.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            No completed attempts yet for this quiz.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="py-4 px-6 text-sm font-semibold text-gray-500">Rank</th>
                  <th className="py-4 px-6 text-sm font-semibold text-gray-500">Team Name</th>
                  <th className="py-4 px-6 text-sm font-semibold text-gray-500 text-right">Score</th>
                  <th className="py-4 px-6 text-sm font-semibold text-gray-500 text-right">Violations</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {entries.map((entry, index) => (
                  <tr 
                    key={entry.id} 
                    className={`transition-colors hover:bg-gray-50 ${index < 3 ? 'bg-gradient-to-r from-yellow-50/50 to-transparent' : ''}`}
                  >
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-2">
                        {index === 0 && <Medal className="w-5 h-5 text-yellow-500" />}
                        {index === 1 && <Medal className="w-5 h-5 text-gray-400" />}
                        {index === 2 && <Medal className="w-5 h-5 text-amber-600" />}
                        <span className={`font-bold ${
                          index === 0 ? 'text-yellow-600 text-lg' : 
                          index === 1 ? 'text-gray-600 text-lg' : 
                          index === 2 ? 'text-amber-700 text-lg' : 
                          'text-gray-500'
                        }`}>
                          #{index + 1}
                        </span>
                      </div>
                    </td>
                    <td className="py-4 px-6 font-medium text-gray-900">
                      {entry.team_name}
                    </td>
                    <td className="py-4 px-6 text-right">
                      <span className="font-bold text-lg text-indigo-600">
                        {entry.score}
                      </span>
                      <span className="text-gray-400 text-sm ml-1">
                        / {entry.max_score}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-right">
                      {entry.violation_count > 0 ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                          {entry.violation_count}
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
                          Clean
                        </span>
                      )}
                    </td>
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
