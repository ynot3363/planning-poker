import type {
  SessionParticipant,
  StoryVotingRound,
  VotingSession
} from '../domain/planningPokerDomain';
import { normalizeParticipantUpn } from './participation';

/** One scale-ordered aggregate result row. */
export interface VotingResultBreakdownRow {
  readonly value: string;
  readonly count: number;
  readonly percentage: number;
}

/** One named participant's post-reveal result. */
export interface NamedVotingResultRow {
  readonly participantId: string;
  readonly displayName: string;
  readonly upn: string;
  readonly value?: string;
}

interface IVotingResultSummary {
  readonly breakdown: readonly VotingResultBreakdownRow[];
  readonly votedCount: number;
  readonly missingCount: number;
  readonly reason: 'Automatic' | 'Manual';
}

/** Privacy-shaped results safe for direct rendering after reveal. */
export type VotingResultsPresentation =
  | (IVotingResultSummary & {
      readonly mode: 'Named';
      readonly rows: readonly NamedVotingResultRow[];
    })
  | (IVotingResultSummary & {
      readonly mode: 'Anonymous';
    });

/**
 * Determines whether all currently connected voters have submitted a valid round vote.
 *
 * @param round - Current voting round.
 * @param participants - Current session participant roster.
 * @returns `true` only with at least one connected voter and no connected voter missing a vote.
 */
export function canAutoReveal(
  round: StoryVotingRound,
  participants: readonly SessionParticipant[]
): boolean {
  if (round.status !== 'Voting') {
    return false;
  }
  const connectedIds = participants
    .filter((participant) => participant.presence.connection === 'Connected')
    .map((participant) => participant.id);
  const votedIds = new Set(round.votes.map((vote) => vote.participantId));
  return (
    connectedIds.length > 0 && connectedIds.every((participantId) => votedIds.has(participantId))
  );
}

/**
 * Creates aggregate and privacy-shaped participant results for a revealed round.
 *
 * @param session - Session settings and roster captured around the revealed round.
 * @param round - Revealed or finalized round.
 * @returns Named rows or anonymous aggregates, or `undefined` before reveal.
 */
export function selectVotingResults(
  session: VotingSession,
  round: StoryVotingRound
): VotingResultsPresentation | undefined {
  if (round.status !== 'Revealed' && round.status !== 'Finalized') {
    return undefined;
  }
  const voteByParticipant = new Map(
    round.votes.map((vote) => [vote.participantId, vote.value] as const)
  );
  const votedCount = round.revealedVotedCount ?? round.votes.length;
  const missingCount = round.revealedMissingCount ?? 0;
  const breakdown = session.settings.scaleValues
    .map((value) => {
      const count = round.votes.filter((vote) => vote.value === value).length;
      return {
        value,
        count,
        percentage: votedCount === 0 ? 0 : Math.round((count / votedCount) * 100)
      };
    })
    .filter((row) => row.count > 0);
  const summary = {
    breakdown,
    votedCount,
    missingCount,
    reason: round.revealReason ?? ('Manual' as const)
  };
  if (session.settings.votingMode === 'Anonymous') {
    return { mode: 'Anonymous', ...summary };
  }
  const revealedAt =
    round.revealedAt === undefined ? Number.POSITIVE_INFINITY : Date.parse(round.revealedAt);
  const rows = session.participants
    .filter(
      (participant): participant is Extract<SessionParticipant, { kind: 'Named' }> =>
        participant.kind === 'Named' && Date.parse(participant.joinedAt) <= revealedAt
    )
    .map((participant) => ({
      participantId: participant.id,
      displayName: participant.user.displayName,
      upn: normalizeParticipantUpn(participant.user.loginName),
      ...(voteByParticipant.get(participant.id) === undefined
        ? {}
        : { value: voteByParticipant.get(participant.id) })
    }));
  return { mode: 'Named', ...summary, rows };
}
