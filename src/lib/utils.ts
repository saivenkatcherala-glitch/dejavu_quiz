import type { ParticipantQuestion, OptionLetter } from './types';

/**
 * Seeded PRNG (xoshiro128**) for deterministic question/option shuffling.
 * Given the same seed, produces the same shuffle order.
 */
export function seededShuffle<T>(array: T[], seed: number): T[] {
  const result = [...array];
  let s = seed | 0;
  for (let i = result.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) | 0;
    const j = ((s >>> 0) % (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Shuffle options within a question, returning new question with shuffled options
 * and a mapping from new labels to original labels.
 */
export function shuffleOptions(
  question: ParticipantQuestion,
  seed: number
): { question: ParticipantQuestion; optionMap: Record<OptionLetter, OptionLetter> } {
  const options: { label: OptionLetter; text: string }[] = [
    { label: 'A', text: question.option_a },
    { label: 'B', text: question.option_b },
    { label: 'C', text: question.option_c },
    { label: 'D', text: question.option_d },
  ];

  const shuffled = seededShuffle(options, seed);
  const labels: OptionLetter[] = ['A', 'B', 'C', 'D'];
  const optionMap: Record<string, string> = {};

  labels.forEach((newLabel, i) => {
    optionMap[newLabel] = shuffled[i].label;
  });

  return {
    question: {
      ...question,
      option_a: shuffled[0].text,
      option_b: shuffled[1].text,
      option_c: shuffled[2].text,
      option_d: shuffled[3].text,
    },
    optionMap: optionMap as Record<OptionLetter, OptionLetter>,
  };
}

/**
 * Format seconds to MM:SS or HH:MM:SS
 */
export function formatTime(seconds: number): string {
  if (seconds < 0) seconds = 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Format date string to localized display
 */
export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString();
}

/**
 * Format date to time only
 */
export function formatTimeOnly(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Generate a random session token
 */
export function generateSessionToken(): string {
  return crypto.randomUUID();
}

/**
 * Calculate remaining seconds from an expiry timestamp
 */
export function getRemainingSeconds(expiresAt: string): number {
  const expiryTime = new Date(expiresAt).getTime();
  const now = Date.now();
  return Math.max(0, Math.floor((expiryTime - now) / 1000));
}

/**
 * Status badge color classes
 */
export function getStatusColor(status: string): string {
  const map: Record<string, string> = {
    DRAFT: 'bg-gray-100 text-gray-700',
    READY: 'bg-blue-100 text-blue-700',
    LIVE: 'bg-green-100 text-green-700',
    PAUSED: 'bg-yellow-100 text-yellow-700',
    CLOSED: 'bg-red-100 text-red-700',
    in_progress: 'bg-blue-100 text-blue-700',
    submitted: 'bg-green-100 text-green-700',
    auto_submitted: 'bg-orange-100 text-orange-700',
    expired: 'bg-red-100 text-red-700',
    cancelled: 'bg-gray-100 text-gray-700',
  };
  return map[status] || 'bg-gray-100 text-gray-700';
}

/**
 * CSV export helper
 */
export function downloadCSV(data: Record<string, unknown>[], filename: string): void {
  if (!data.length) return;
  const headers = Object.keys(data[0]);
  const csvRows = [
    headers.join(','),
    ...data.map(row =>
      headers.map(h => {
        const val = String(row[h] ?? '');
        return val.includes(',') || val.includes('"') || val.includes('\n')
          ? `"${val.replace(/"/g, '""')}"`
          : val;
      }).join(',')
    ),
  ];
  const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Debounce helper
 */
export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Clamp a number between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
