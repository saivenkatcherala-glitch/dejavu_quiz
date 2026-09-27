import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, Badge, Spinner, Input } from '@/components/ui';
import { Search, AlertTriangle } from 'lucide-react';
import type { Violation } from '@/lib/types';

export default function ViolationsPage() {
  const [violations, setViolations] = useState<Violation[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadViolations();
  }, []);

  async function loadViolations() {
    const { data } = await supabase
      .from('violations')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(500);
    setViolations(data || []);
    setLoading(false);
  }

  const filtered = search.trim()
    ? violations.filter(v => v.team_id.toLowerCase().includes(search.toLowerCase()))
    : violations;

  // Group by team
  const byTeam = new Map<string, Violation[]>();
  filtered.forEach(v => {
    const list = byTeam.get(v.team_id) || [];
    list.push(v);
    byTeam.set(v.team_id, list);
  });

  // Sort teams by violation count
  const teamsSorted = Array.from(byTeam.entries())
    .sort((a, b) => b[1].length - a[1].length);

  function getTeamStatus(count: number): { label: string; variant: string } {
    if (count >= 10) return { label: 'Flagged for Review', variant: 'expired' };
    if (count >= 5) return { label: 'Warning', variant: 'PAUSED' };
    return { label: 'Normal', variant: 'LIVE' };
  }

  if (loading) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Violations</h1>
          <p className="text-gray-500 text-sm mt-1">{violations.length} total events from {byTeam.size} teams</p>
        </div>
      </div>

      <div className="mb-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input className="pl-10" placeholder="Search by Team ID..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      {/* Summary Table */}
      <Card padding={false} className="mb-6">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left py-3 px-4 text-gray-600 font-medium">Team</th>
                <th className="text-center py-3 px-4 text-gray-600 font-medium">Count</th>
                <th className="text-left py-3 px-4 text-gray-600 font-medium">Last Violation</th>
                <th className="text-left py-3 px-4 text-gray-600 font-medium">Types</th>
                <th className="text-left py-3 px-4 text-gray-600 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {teamsSorted.map(([teamId, teamViolations]) => {
                const status = getTeamStatus(teamViolations.length);
                const types = [...new Set(teamViolations.map(v => v.type))];
                const last = teamViolations[0];
                return (
                  <tr key={teamId} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-3 px-4 font-mono font-medium">{teamId}</td>
                    <td className="py-3 px-4 text-center">
                      <span className={`font-bold ${teamViolations.length >= 10 ? 'text-red-600' : teamViolations.length >= 5 ? 'text-amber-600' : 'text-gray-700'}`}>
                        {teamViolations.length}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-gray-500 text-xs">
                      {new Date(last.timestamp).toLocaleString()}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex flex-wrap gap-1">
                        {types.slice(0, 4).map(t => (
                          <span key={t} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                            {t.replace(/_/g, ' ')}
                          </span>
                        ))}
                        {types.length > 4 && (
                          <span className="text-xs text-gray-400">+{types.length - 4}</span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Detail: Chronological timeline */}
      {teamsSorted.length > 0 && (
        <div className="space-y-4">
          {teamsSorted.map(([teamId, teamViolations]) => (
            <details key={teamId} className="group">
              <summary className="cursor-pointer list-none">
                <Card className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <AlertTriangle className={`w-5 h-5 ${teamViolations.length >= 10 ? 'text-red-500' : 'text-amber-500'}`} />
                    <span className="font-medium">{teamId}</span>
                    <span className="text-sm text-gray-500">{teamViolations.length} violations</span>
                  </div>
                  <svg className="w-5 h-5 text-gray-400 group-open:rotate-180 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </Card>
              </summary>
              <div className="mt-2 ml-4 border-l-2 border-gray-200 pl-4 space-y-2">
                {teamViolations.map(v => (
                  <div key={v.id} className="flex items-center gap-3 text-sm py-1">
                    <span className="text-xs text-gray-400 w-36 shrink-0">
                      {new Date(v.timestamp).toLocaleString()}
                    </span>
                    <Badge variant={v.severity === 'high' ? 'expired' : v.severity === 'medium' ? 'PAUSED' : 'DRAFT'}>
                      {v.severity}
                    </Badge>
                    <span className="font-medium">{v.type.replace(/_/g, ' ')}</span>
                  </div>
                ))}
              </div>
            </details>
          ))}
        </div>
      )}

      {teamsSorted.length === 0 && (
        <Card>
          <p className="text-center text-gray-500 py-8">No violations recorded.</p>
        </Card>
      )}
    </div>
  );
}
