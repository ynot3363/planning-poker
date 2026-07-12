import type { PlanningPokerDocumentRoot, VotingSession } from '../domain/planningPokerDomain';

/** Ordered privacy-safe ended-session export columns. */
export const SESSION_RESULT_COLUMNS = [
  'Session ID',
  'Team ID',
  'Team Title',
  'Story ID',
  'Story Title',
  'Story Link',
  'Assigned Point Value',
  'Total Votes',
  'Vote Breakdown',
  'Finalized On'
] as const;

/** One finalized round summary without participant or individual-vote data. */
export interface SessionResultExportRow {
  readonly sessionId: string;
  readonly teamId: string;
  readonly teamTitle: string;
  readonly storyId: string;
  readonly storyTitle: string;
  readonly storyLink: string;
  readonly assignedPointValue: string;
  readonly totalVotes: number;
  readonly voteBreakdown: string;
  readonly finalizedOn: string;
}

/**
 * Projects finalized rounds into the privacy-safe session export contract.
 *
 * @param document - Authoritative team snapshot containing the session.
 * @param session - Ended or current session whose finalized results are requested.
 * @returns One scale-ordered summary row per finalized round.
 */
export function createSessionResultRows(
  document: PlanningPokerDocumentRoot,
  session: VotingSession
): readonly SessionResultExportRow[] {
  const finalizedIds = new Set(session.finalizedRoundIds);
  return session.rounds
    .filter((round) => round.status === 'Finalized' && finalizedIds.has(round.id))
    .map((round) => {
      const counts = new Map<string, number>();
      round.votes.forEach((vote) => counts.set(vote.value, (counts.get(vote.value) ?? 0) + 1));
      const voteBreakdown = session.settings.scaleValues
        .filter((value) => (counts.get(value) ?? 0) > 0)
        .map((value) => `${value}: ${counts.get(value) as number}`)
        .join('; ');
      return {
        sessionId: session.id,
        teamId: document.team.id,
        teamTitle: document.team.title,
        storyId: round.storySnapshot.storyId,
        storyTitle: round.storySnapshot.title,
        storyLink: round.storySnapshot.link ?? '',
        assignedPointValue: round.assignedValue ?? '',
        totalVotes: round.votes.length,
        voteBreakdown,
        finalizedOn: round.finalizedAt ?? ''
      };
    });
}

/**
 * Serializes finalized session summaries as an Excel-friendly UTF-8 CSV.
 *
 * @param document - Authoritative team snapshot.
 * @param session - Session containing finalized rounds.
 * @returns BOM-prefixed CSV containing no participant or individual-vote fields.
 */
export function serializeSessionResults(
  document: PlanningPokerDocumentRoot,
  session: VotingSession
): string {
  const lines = [SESSION_RESULT_COLUMNS.join(',')];
  createSessionResultRows(document, session).forEach((row) => {
    lines.push(
      [
        row.sessionId,
        row.teamId,
        row.teamTitle,
        row.storyId,
        row.storyTitle,
        row.storyLink,
        row.assignedPointValue,
        String(row.totalVotes),
        row.voteBreakdown,
        row.finalizedOn
      ]
        .map(escapeCsvCell)
        .join(',')
    );
  });
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/**
 * Builds the required portable results filename.
 *
 * @param teamTitle - Current team title.
 * @param sessionId - Immutable session identifier.
 * @returns Safe `<Team Title>-session-<Session ID>-results.csv` filename.
 */
export function createSessionResultsFileName(teamTitle: string, sessionId: string): string {
  return `${sanitizeFilePart(teamTitle, 'Planning-Poker')}-session-${sanitizeFilePart(sessionId, 'unknown')}-results.csv`;
}

/**
 * Escapes one untrusted value for spreadsheet-safe CSV output.
 *
 * @param value - Untrusted cell text.
 * @returns Formula-safe quoted CSV cell.
 */
function escapeCsvCell(value: string): string {
  const neutralized = /^[=+\-@\t\r\n]/.test(value) ? `'${value}` : value;
  return `"${neutralized.replace(/"/g, '""')}"`;
}

/**
 * Removes control and reserved filename characters from one segment.
 *
 * @param value - Untrusted filename segment.
 * @param fallback - Empty-value fallback.
 * @returns Safe filename segment.
 */
function sanitizeFilePart(value: string, fallback: string): string {
  const withoutControls = Array.from(value, (character) =>
    character.charCodeAt(0) < 32 ? '-' : character
  ).join('');
  const safe = withoutControls
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 100);
  return safe.length > 0 ? safe : fallback;
}
