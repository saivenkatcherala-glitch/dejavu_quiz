import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, Spinner } from '@/components/ui';
import type { AdminActivityLog } from '@/lib/types';

export default function ActivityLogPage() {
  const [logs, setLogs] = useState<AdminActivityLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadLogs();
  }, []);

  async function loadLogs() {
    const { data } = await supabase
      .from('admin_activity_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);
    setLogs(data || []);
    setLoading(false);
  }

  if (loading) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Activity Log</h1>
        <p className="text-gray-500 text-sm mt-1">Admin action history</p>
      </div>

      <Card padding={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left py-3 px-4 text-gray-600 font-medium">Time</th>
                <th className="text-left py-3 px-4 text-gray-600 font-medium">Action</th>
                <th className="text-left py-3 px-4 text-gray-600 font-medium">Target</th>
                <th className="text-left py-3 px-4 text-gray-600 font-medium">Details</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => (
                <tr key={log.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-3 px-4 text-xs text-gray-500 whitespace-nowrap">
                    {new Date(log.created_at).toLocaleString()}
                  </td>
                  <td className="py-3 px-4 font-medium">{log.action}</td>
                  <td className="py-3 px-4 text-gray-600">
                    {log.target_type && (
                      <span>
                        {log.target_type}
                        {log.target_id && <span className="text-gray-400 ml-1 font-mono text-xs">{log.target_id.slice(0, 8)}</span>}
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-xs text-gray-500 max-w-xs truncate">
                    {log.metadata && Object.keys(log.metadata).length > 0
                      ? JSON.stringify(log.metadata)
                      : '—'}
                  </td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-gray-500">No activity recorded yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
