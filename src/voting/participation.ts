import type {
  ConnectionState,
  SessionParticipant,
  VotingSession
} from '../domain/planningPokerDomain';

/** Aggregate participation counts safe for both voting modes. */
export interface ParticipationCounts {
  readonly joined: number;
  readonly connected: number;
  readonly disconnected: number;
  readonly voted: number;
  readonly remaining: number;
}

/** A named participant row that intentionally excludes the selected vote value. */
export interface NamedParticipantRow {
  readonly participantId: string;
  readonly displayName: string;
  readonly upn: string;
  readonly connection: ConnectionState;
  readonly hasVoted: boolean;
  readonly isCurrent: boolean;
}

/** Privacy-shaped session participation used directly by React. */
export type ParticipationPresentation =
  | {
      readonly mode: 'Named';
      readonly counts: ParticipationCounts;
      readonly rows: readonly NamedParticipantRow[];
    }
  | {
      readonly mode: 'Anonymous';
      readonly counts: ParticipationCounts;
      readonly currentAlias?: string;
    };

/**
 * Returns connected voter IDs eligible to block automatic reveal for the current round.
 *
 * @param session - Session whose joined roster defines eligibility.
 * @returns Connected session participant IDs in join order.
 */
export function getEligibleVoterIds(session: VotingSession): readonly string[] {
  return session.participants
    .filter((participant) => participant.presence.connection === 'Connected')
    .map((participant) => participant.id);
}

/**
 * Returns only the current participant's private pre-reveal selection.
 *
 * @param session - Current synchronized session snapshot.
 * @param currentParticipantId - Browser-local joined participant identifier.
 * @returns The current participant's value, when cast in the active round.
 */
export function selectCurrentVoteValue(
  session: VotingSession,
  currentParticipantId?: string
): string | undefined {
  if (currentParticipantId === undefined) {
    return undefined;
  }
  const round = session.rounds.find((candidate) => candidate.id === session.activeRoundId);
  return round?.votes.find((vote) => vote.participantId === currentParticipantId)?.value;
}

/**
 * Creates a privacy-safe participation projection without pre-reveal vote values.
 *
 * @param session - Current synchronized session snapshot.
 * @param currentParticipantId - Browser-local participant identity for this session.
 * @returns Named rows or anonymous counts and the current user's local alias.
 */
export function selectParticipation(
  session: VotingSession,
  currentParticipantId?: string
): ParticipationPresentation {
  const round = session.rounds.find((candidate) => candidate.id === session.activeRoundId);
  const votedIds = new Set(round?.votes.map((vote) => vote.participantId) ?? []);
  const counts: ParticipationCounts = {
    joined: session.participants.length,
    connected: session.participants.filter(
      (participant) => participant.presence.connection === 'Connected'
    ).length,
    disconnected: session.participants.filter(
      (participant) => participant.presence.connection === 'Disconnected'
    ).length,
    voted: session.participants.filter((participant) => votedIds.has(participant.id)).length,
    remaining: session.participants.filter(
      (participant) =>
        participant.presence.connection === 'Connected' && !votedIds.has(participant.id)
    ).length
  };
  if (session.settings.votingMode === 'Anonymous') {
    const current = session.participants.find(
      (participant): participant is Extract<SessionParticipant, { kind: 'Anonymous' }> =>
        participant.kind === 'Anonymous' && participant.id === currentParticipantId
    );
    return { mode: 'Anonymous', counts, currentAlias: current?.alias };
  }
  return {
    mode: 'Named',
    counts,
    rows: session.participants
      .filter(
        (participant): participant is Extract<SessionParticipant, { kind: 'Named' }> =>
          participant.kind === 'Named'
      )
      .map((participant) => ({
        participantId: participant.id,
        displayName: participant.user.displayName,
        upn: participant.user.loginName,
        connection: participant.presence.connection,
        hasVoted: votedIds.has(participant.id),
        isCurrent: participant.id === currentParticipantId
      }))
  };
}
