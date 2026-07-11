/**
 * Formats a durable ISO audit timestamp for compact application display.
 *
 * Stored timestamps retain their full precision; the UI intentionally displays only through
 * the minute because seconds do not help users identify story changes.
 *
 * @param timestamp - Durable ISO timestamp from the team document.
 * @returns A locale-aware date and time without seconds.
 */
export function formatStoryTimestamp(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(timestamp));
}
