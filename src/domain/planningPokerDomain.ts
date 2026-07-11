/** The schema version written by this client. */
export const CURRENT_SCHEMA_VERSION = '1.0.0';
/** The oldest schema version this client can migrate. */
export const MIN_SUPPORTED_SCHEMA_VERSION = '1.0.0';
/** The newest schema version this client can read. */
export const MAX_SUPPORTED_SCHEMA_VERSION = '1.0.0';

/** A semantic version used by persisted Planning Poker documents. */
export type SchemaVersion = `${number}.${number}.${number}`;
/** The lifecycle state of a story. */
export type StoryStatus = 'Ready' | 'Pointed' | 'Archived';
/** The estimate scale configured for a team. */
export type TeamScaleKind = 'Fibonacci' | 'TShirt' | 'Custom';
/** Whether participant identities are associated with votes. */
export type VotingMode = 'Named' | 'Anonymous';
/** The lifecycle state of a voting session. */
export type VotingSessionStatus = 'Lobby' | 'Active' | 'Ended';
/** The lifecycle state of a voting round. */
export type VotingRoundStatus = 'Voting' | 'Revealed' | 'Finalized' | 'Cancelled';
/** The current state of a voting timer. */
export type TimerStatus = 'Ready' | 'Running' | 'Stopped';
/** Why a voting round moved from Voting to Revealed. */
export type RevealReason = 'Automatic' | 'Manual';
/** The collaborative connection state reported for a participant. */
export type ConnectionState = 'Connected' | 'Disconnected';

/** The canonical Fibonacci estimate values. */
export const FIBONACCI_SCALE = ['0', '0.5', '1', '2', '3', '5', '8'] as const;
/** The canonical T-shirt estimate values. */
export const T_SHIRT_SCALE = ['XS', 'S', 'M', 'L', 'XL', 'XXL'] as const;

/** Identifies a SharePoint user without storing authentication credentials. */
export interface UserReference {
  /** The immutable Entra object identifier. */
  readonly objectId: string;
  /** The display name shown in the Planning Poker UI. */
  readonly displayName: string;
  /** The SharePoint login name used when resolving a site user. */
  readonly loginName: string;
  /** The site-scoped SharePoint user identifier, when resolved. */
  readonly sharePointUserId?: number;
}

/** Defines voting behavior configured for a team or captured by a session. */
export interface TeamSettings {
  /** The kind of estimate scale in use. */
  readonly scaleKind: TeamScaleKind;
  /** The ordered estimate values available to voters. */
  readonly scaleValues: readonly string[];
  /** Whether voting rounds use a countdown timer. */
  readonly timerEnabled: boolean;
  /** The timer duration in seconds when the timer is enabled. */
  readonly timerDurationSeconds?: number;
  /** Whether votes retain participant identities. */
  readonly votingMode: VotingMode;
}

/** Records who created and most recently updated an entity. */
export interface AuditFields {
  /** The ISO timestamp at which the entity was created. */
  readonly createdAt: string;
  /** The user who created the entity. */
  readonly createdBy: UserReference;
  /** The ISO timestamp of the latest update. */
  readonly updatedAt: string;
  /** The user who performed the latest update. */
  readonly updatedBy: UserReference;
}

/** Represents a team that owns stories and voting sessions. */
export interface PlanningPokerTeam extends AuditFields {
  /** The stable team identifier. */
  readonly id: string;
  /** The user-facing team title. */
  readonly title: string;
  /** The user-facing team description. */
  readonly description: string;
  /** Whether the team is available for current work. */
  readonly isActive: boolean;
  /** The users allowed by application policy to host sessions. */
  readonly hosts: readonly UserReference[];
  /** The configured participant roster. */
  readonly configuredMembers: readonly UserReference[];
  /** The team's current voting settings. */
  readonly settings: TeamSettings;
}

/** Records a finalized estimate for a story. */
export interface EstimateHistoryEntry {
  /** The session in which the estimate was finalized. */
  readonly sessionId: string;
  /** The round in which the estimate was finalized. */
  readonly roundId: string;
  /** The estimate assigned to the story. */
  readonly value: string;
  /** The ISO timestamp at which the estimate was finalized. */
  readonly finalizedAt: string;
  /** The user who finalized the estimate. */
  readonly finalizedBy: UserReference;
}

/** Represents a story available for team estimation. */
export interface PointingStory extends AuditFields {
  /** The stable story identifier. */
  readonly id: string;
  /** The user-facing story title. */
  readonly title: string;
  /** The user-facing story description. */
  readonly description: string;
  /** An optional validated HTTPS or SharePoint-relative source link. */
  readonly link?: string;
  /** The current story lifecycle state. */
  readonly status: StoryStatus;
  /** The most recently finalized estimate. */
  readonly currentEstimate?: string;
  /** The immutable sequence of prior finalized estimates. */
  readonly estimateHistory: readonly EstimateHistoryEntry[];
}

/** Describes the last known collaborative connectivity of a participant. */
export interface ParticipantPresence {
  /** The participant's current connection state. */
  readonly connection: ConnectionState;
  /** The ISO timestamp of the participant's last activity. */
  readonly lastSeenAt: string;
}

/** Represents a voting participant whose identity may be shown. */
export interface NamedSessionParticipant {
  /** The discriminant for an identified participant. */
  readonly kind: 'Named';
  /** The session-scoped participant identifier. */
  readonly id: string;
  /** The participant's SharePoint user reference. */
  readonly user: UserReference;
  /** The ISO timestamp at which the participant joined. */
  readonly joinedAt: string;
  /** The participant's collaborative connection state. */
  readonly presence: ParticipantPresence;
}

/** Represents a voting participant whose identity is intentionally omitted. */
export interface AnonymousSessionParticipant {
  /** The discriminant for an anonymous participant. */
  readonly kind: 'Anonymous';
  /** The session-scoped participant identifier. */
  readonly id: string;
  /** The non-identifying label shown during the session. */
  readonly alias: `Participant ${number}`;
  /** The ISO timestamp at which the participant joined. */
  readonly joinedAt: string;
  /** The participant's collaborative connection state. */
  readonly presence: ParticipantPresence;
}

/** A participant stored in a voting session. */
export type SessionParticipant = NamedSessionParticipant | AnonymousSessionParticipant;

/** Captures story text at the start of a voting round. */
export interface StorySnapshot {
  /** The source story identifier. */
  readonly storyId: string;
  /** The story title captured for the round. */
  readonly title: string;
  /** The story description captured for the round. */
  readonly description: string;
  /** The optional story link captured for the round. */
  readonly link?: string;
}

/** Records a participant's current vote in a round. */
export interface VoteRecord {
  /** The session-scoped participant identifier. */
  readonly participantId: string;
  /** The selected estimate value. */
  readonly value: string;
  /** The ISO timestamp at which the vote was cast. */
  readonly castAt: string;
}

/** Stores the collaborative state of a voting countdown. */
export interface VotingTimer {
  /** The configured duration of the timer in seconds. */
  readonly configuredDurationSeconds: number;
  /** The current timer lifecycle state. */
  readonly status: TimerStatus;
  /** The remaining whole seconds. */
  readonly remainingSeconds: number;
  /** The ISO timestamp at which the timer was most recently started. */
  readonly startedAt?: string;
  /** The ISO timestamp at which the timer was most recently stopped. */
  readonly stoppedAt?: string;
  /** The ISO timestamp at which the timer was most recently reset. */
  readonly resetAt?: string;
}

/** Represents one collaborative estimate round for a story. */
export interface StoryVotingRound {
  /** The stable round identifier. */
  readonly id: string;
  /** The story being estimated. */
  readonly storyId: string;
  /** The story text captured when the round began. */
  readonly storySnapshot: StorySnapshot;
  /** The current round lifecycle state. */
  readonly status: VotingRoundStatus;
  /** The current participant votes. */
  readonly votes: readonly VoteRecord[];
  /** The shared countdown state. */
  readonly timer: VotingTimer;
  /** The ISO timestamp at which votes were revealed. */
  readonly revealedAt?: string;
  /** The user who revealed the votes. */
  readonly revealedBy?: UserReference;
  /** Whether every connected voter completed voting or a host revealed early. */
  readonly revealReason?: RevealReason;
  /** Number of valid votes captured when results were revealed. */
  readonly revealedVotedCount?: number;
  /** Number of connected eligible voters missing a vote when results were revealed. */
  readonly revealedMissingCount?: number;
  /** The estimate assigned when the round was finalized. */
  readonly assignedValue?: string;
  /** The ISO timestamp at which the round was finalized. */
  readonly finalizedAt?: string;
  /** The user who finalized the round. */
  readonly finalizedBy?: UserReference;
}

/** Represents a collaborative voting session for a team. */
export interface VotingSession {
  /** The stable session identifier. */
  readonly id: string;
  /** The owning team identifier. */
  readonly teamId: string;
  /** The current session lifecycle state. */
  readonly status: VotingSessionStatus;
  /** The voting settings captured when the session began. */
  readonly settings: TeamSettings;
  /** The participants who joined the session. */
  readonly participants: readonly SessionParticipant[];
  /** The session's ordered voting rounds. */
  readonly rounds: readonly StoryVotingRound[];
  /** The current voting round, when one is in progress. */
  readonly activeRoundId?: string;
  /** The ordered identifiers of finalized rounds. */
  readonly finalizedRoundIds: readonly string[];
  /** The ISO timestamp at which the session ended. */
  readonly endedAt?: string;
  /** The user who ended the session. */
  readonly endedBy?: UserReference;
  /** The ISO timestamp at which the session was created. */
  readonly createdAt: string;
  /** The creating host in Named mode; omitted from Anonymous session state. */
  readonly createdBy?: UserReference;
  /** The ISO timestamp of the latest session update. */
  readonly updatedAt: string;
  /** The updating host in Named mode; omitted from Anonymous session state. */
  readonly updatedBy?: UserReference;
}

/** Defines the serializable root state stored in one Fluid container. */
export interface PlanningPokerDocumentRoot {
  /** The persisted document schema version. */
  readonly schemaVersion: SchemaVersion;
  /** The team represented by this document. */
  readonly team: PlanningPokerTeam;
  /** The team's ordered stories. */
  readonly stories: readonly PointingStory[];
  /** The team's ordered voting sessions. */
  readonly sessions: readonly VotingSession[];
  /** The single lobby or active session, when present. */
  readonly openSessionId?: string;
  /** The ISO timestamp at which the document was created. */
  readonly createdAt: string;
  /** The ISO timestamp of the document's latest meaningful activity. */
  readonly updatedAt: string;
}

/** Describes one lightweight SharePoint metadata column. */
export interface SharePointMetadataField {
  /** The column title displayed by SharePoint. */
  readonly displayName: string;
  /** The supported SharePoint field type. */
  readonly type: 'Text' | 'UserMulti' | 'Boolean' | 'DateTime';
  /** The discovery or indexing reason for persisting the field. */
  readonly purpose: string;
  /** The actual SharePoint internal name after provisioning. */
  readonly internalName?: string;
}

/** The metadata columns required to discover Planning Poker containers. */
export const SHAREPOINT_METADATA_FIELDS: readonly SharePointMetadataField[] = [
  {
    displayName: 'Team ID',
    type: 'Text',
    purpose: 'Stable lookup key independent of title changes.'
  },
  {
    displayName: 'Hosts',
    type: 'UserMulti',
    purpose: 'Discover teams hosted by the current user.'
  },
  {
    displayName: 'Participants',
    type: 'UserMulti',
    purpose: 'Denormalized configured member roster.'
  },
  {
    displayName: 'Is Active',
    type: 'Boolean',
    purpose: 'Filter inactive teams without opening each Fluid file.'
  },
  {
    displayName: 'Schema Version',
    type: 'Text',
    purpose: 'Reject unsupported documents before loading feature UI.'
  },
  {
    displayName: 'Active Session ID',
    type: 'Text',
    purpose: 'Resolve the current Lobby or Active session for deep links.'
  },
  {
    displayName: 'Last Activity',
    type: 'DateTime',
    purpose: 'Sort team documents by meaningful application activity.'
  }
];

/**
 * Determines whether a session participant intentionally omits user identity.
 *
 * @param participant - The participant to inspect.
 * @returns `true` when the participant is anonymous.
 */
export function isAnonymousParticipant(
  participant: SessionParticipant
): participant is AnonymousSessionParticipant {
  return participant.kind === 'Anonymous';
}

/**
 * Determines whether a session can still accept collaborative work.
 *
 * @param status - The session status to inspect.
 * @returns `true` for lobby or active sessions.
 */
export function isOpenSession(status: VotingSessionStatus): boolean {
  return status === 'Lobby' || status === 'Active';
}

/**
 * Determines whether a round is still in progress.
 *
 * @param status - The round status to inspect.
 * @returns `true` for voting or revealed rounds.
 */
export function isUnfinishedRound(status: VotingRoundStatus): boolean {
  return status === 'Voting' || status === 'Revealed';
}
