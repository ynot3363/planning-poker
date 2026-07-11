import { SchemaFactory, type TreeNodeSchema } from '@fluidframework/tree';

const factory = new SchemaFactory('planning-poker');
const stringList = factory.array(factory.string);

/** SharedTree schema for a persisted user reference. */
export const UserReferenceSchema = factory.object('UserReference', {
  objectId: factory.string,
  displayName: factory.string,
  loginName: factory.string,
  sharePointUserId: factory.optional(factory.number)
});

/** SharedTree schema for captured team settings. */
export const TeamSettingsSchema = factory.object('TeamSettings', {
  scaleKind: factory.string,
  scaleValues: stringList,
  timerEnabled: factory.boolean,
  timerDurationSeconds: factory.optional(factory.number),
  votingMode: factory.string
});

/** SharedTree schema for entity audit fields. */
export const AuditFieldsSchema = factory.object('AuditFields', {
  createdAt: factory.string,
  createdBy: UserReferenceSchema,
  updatedAt: factory.string,
  updatedBy: UserReferenceSchema
});

/** SharedTree schema for the team represented by one container. */
export const TeamSchema = factory.object('PlanningPokerTeam', {
  id: factory.string,
  title: factory.string,
  description: factory.string,
  isActive: factory.boolean,
  hosts: factory.array(UserReferenceSchema),
  configuredMembers: factory.array(UserReferenceSchema),
  settings: TeamSettingsSchema,
  createdAt: factory.string,
  createdBy: UserReferenceSchema,
  updatedAt: factory.string,
  updatedBy: UserReferenceSchema
});

/** SharedTree schema for one finalized estimate history entry. */
export const EstimateHistoryEntrySchema = factory.object('EstimateHistoryEntry', {
  sessionId: factory.string,
  roundId: factory.string,
  value: factory.string,
  finalizedAt: factory.string,
  finalizedBy: UserReferenceSchema
});

/** SharedTree schema for one estimable story. */
export const StorySchema = factory.object('PointingStory', {
  id: factory.string,
  title: factory.string,
  description: factory.string,
  link: factory.optional(factory.string),
  status: factory.string,
  currentEstimate: factory.optional(factory.string),
  estimateHistory: factory.array(EstimateHistoryEntrySchema),
  createdAt: factory.string,
  createdBy: UserReferenceSchema,
  updatedAt: factory.string,
  updatedBy: UserReferenceSchema
});

/** SharedTree schema for participant presence. */
export const PresenceSchema = factory.object('ParticipantPresence', {
  connection: factory.string,
  lastSeenAt: factory.string
});

/** SharedTree schema for an identified session participant. */
export const NamedParticipantSchema = factory.object('NamedSessionParticipant', {
  kind: factory.string,
  id: factory.string,
  user: UserReferenceSchema,
  joinedAt: factory.string,
  presence: PresenceSchema
});

/** SharedTree schema for a participant without persisted identity. */
export const AnonymousParticipantSchema = factory.object('AnonymousSessionParticipant', {
  kind: factory.string,
  id: factory.string,
  alias: factory.string,
  joinedAt: factory.string,
  presence: PresenceSchema
});

/** SharedTree schema for story text captured by a round. */
export const StorySnapshotSchema = factory.object('StorySnapshot', {
  storyId: factory.string,
  title: factory.string,
  description: factory.string,
  link: factory.optional(factory.string)
});

/** SharedTree schema for one participant vote. */
export const VoteSchema = factory.object('VoteRecord', {
  participantId: factory.string,
  value: factory.string,
  castAt: factory.string
});

/** SharedTree schema for the collaborative voting timer. */
export const TimerSchema = factory.object('VotingTimer', {
  configuredDurationSeconds: factory.number,
  status: factory.string,
  remainingSeconds: factory.number,
  startedAt: factory.optional(factory.string),
  stoppedAt: factory.optional(factory.string),
  resetAt: factory.optional(factory.string)
});

/** SharedTree schema for one story voting round. */
export const RoundSchema = factory.object('StoryVotingRound', {
  id: factory.string,
  storyId: factory.string,
  storySnapshot: StorySnapshotSchema,
  status: factory.string,
  votes: factory.array(VoteSchema),
  timer: TimerSchema,
  revealedAt: factory.optional(factory.string),
  revealedBy: factory.optional(UserReferenceSchema),
  assignedValue: factory.optional(factory.string),
  finalizedAt: factory.optional(factory.string),
  finalizedBy: factory.optional(UserReferenceSchema)
});

/** SharedTree schema for a team voting session. */
export const SessionSchema: TreeNodeSchema = factory.object('VotingSession', {
  id: factory.string,
  teamId: factory.string,
  status: factory.string,
  settings: TeamSettingsSchema,
  participants: factory.array([NamedParticipantSchema, AnonymousParticipantSchema]),
  rounds: factory.array(RoundSchema),
  activeRoundId: factory.optional(factory.string),
  finalizedRoundIds: stringList,
  endedAt: factory.optional(factory.string),
  endedBy: factory.optional(UserReferenceSchema),
  createdAt: factory.string,
  createdBy: UserReferenceSchema,
  updatedAt: factory.string,
  updatedBy: UserReferenceSchema
});

/** Root SharedTree schema stored in each Planning Poker Fluid container. */
export const PlanningPokerDocumentRootSchema: TreeNodeSchema = factory.object(
  'PlanningPokerDocumentRoot',
  {
    schemaVersion: factory.string,
    team: TeamSchema,
    stories: factory.array(StorySchema),
    sessions: factory.array(SessionSchema),
    openSessionId: factory.optional(factory.string),
    createdAt: factory.string,
    updatedAt: factory.string
  }
);
