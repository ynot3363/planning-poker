import { CURRENT_SCHEMA_VERSION } from './planningPokerDomain';
import type { PlanningPokerDocumentRoot, UserReference } from './planningPokerDomain';

/** A deterministic identified user for domain tests. */
export const fixtureUser: UserReference = {
  objectId: '00000000-0000-0000-0000-000000000001',
  displayName: 'Host User',
  loginName: 'host@example.com'
};

/** A minimal valid Planning Poker document for domain tests. */
export const fixtureDocument: PlanningPokerDocumentRoot = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  team: {
    id: '00000000-0000-0000-0000-000000000010',
    title: 'Example Team',
    description: 'A deterministic fixture team.',
    isActive: true,
    hosts: [fixtureUser],
    configuredMembers: [],
    settings: {
      scaleKind: 'Fibonacci',
      scaleValues: ['0', '0.5', '1', '2', '3', '5', '8'],
      timerEnabled: true,
      timerDurationSeconds: 300,
      votingMode: 'Named'
    },
    createdAt: '2026-07-10T00:00:00.000Z',
    createdBy: fixtureUser,
    updatedAt: '2026-07-10T00:00:00.000Z',
    updatedBy: fixtureUser
  },
  stories: [],
  sessions: [],
  createdAt: '2026-07-10T00:00:00.000Z',
  updatedAt: '2026-07-10T00:00:00.000Z'
};

/** A deterministic anonymous participant that contains no identity fields. */
export const anonymousParticipantFixture = {
  kind: 'Anonymous' as const,
  id: 'participant-1',
  alias: 'Participant 1' as const,
  joinedAt: '2026-07-10T00:01:00.000Z',
  presence: { connection: 'Connected' as const, lastSeenAt: '2026-07-10T00:01:00.000Z' }
};
