import { anonymousParticipantFixture, fixtureDocument, fixtureUser } from './planningPokerFixtures';
import { isAnonymousParticipant, isOpenSession, isUnfinishedRound } from './planningPokerDomain';
import type { TeamSettings, VotingSession } from './planningPokerDomain';
import {
  canTransitionRound,
  canTransitionSession,
  canTransitionStory,
  getSchemaCompatibility,
  validateDocumentInvariants,
  validateScale
} from './planningPokerValidation';

describe('Planning Poker domain validation', () => {
  it('accepts the current schema and classifies unsupported versions', () => {
    expect(getSchemaCompatibility('1.1.0')).toBe('supported');
    expect(getSchemaCompatibility('1.0.0')).toBe('migratable');
    expect(getSchemaCompatibility('0.9.0')).toBe('invalid');
    expect(getSchemaCompatibility('2.0.0')).toBe('newer-unsupported');
    expect(getSchemaCompatibility('not-a-version')).toBe('invalid');
  });

  it('validates built-in and custom scales without accepting question marks', () => {
    const valid: TeamSettings = {
      scaleKind: 'Fibonacci',
      scaleValues: ['0', '0.5', '1', '2', '3', '5', '8'],
      timerEnabled: false,
      votingMode: 'Named'
    };
    expect(validateScale(valid)).toEqual([]);
    expect(validateScale({ ...valid, scaleValues: ['0', '?'] })).not.toEqual([]);
    expect(validateScale({ ...valid, scaleKind: 'Custom', scaleValues: ['XS', 'xs'] })).not.toEqual(
      []
    );
  });

  it('enforces story, session, and round transitions', () => {
    expect(canTransitionStory('Ready', 'Pointed')).toBe(true);
    expect(canTransitionStory('Archived', 'Pointed')).toBe(false);
    expect(canTransitionSession('Lobby', 'Active')).toBe(true);
    expect(canTransitionSession('Ended', 'Active')).toBe(false);
    expect(canTransitionRound('Voting', 'Revealed')).toBe(true);
    expect(canTransitionRound('Finalized', 'Voting')).toBe(false);
  });

  it('accepts a valid document and rejects multiple open sessions', () => {
    expect(validateDocumentInvariants(fixtureDocument)).toEqual([]);
    const session = (id: string, status: 'Lobby' | 'Active'): VotingSession => ({
      id,
      teamId: fixtureDocument.team.id,
      status,
      settings: fixtureDocument.team.settings,
      participants: [],
      rounds: [],
      finalizedRoundIds: [],
      createdAt: fixtureDocument.createdAt,
      createdBy: fixtureUser,
      updatedAt: fixtureDocument.updatedAt,
      updatedBy: fixtureUser
    });
    const invalid = {
      ...fixtureDocument,
      sessions: [session('one', 'Lobby'), session('two', 'Active')]
    } as unknown as typeof fixtureDocument;
    expect(validateDocumentInvariants(invalid)).toContain(
      'A team may have at most one valid open session.'
    );
  });

  it('keeps anonymous participant fixtures free of identity fields', () => {
    expect(isAnonymousParticipant(anonymousParticipantFixture)).toBe(true);
    expect(isOpenSession('Lobby')).toBe(true);
    expect(isOpenSession('Ended')).toBe(false);
    expect(isUnfinishedRound('Revealed')).toBe(true);
    expect(isUnfinishedRound('Finalized')).toBe(false);
    expect(anonymousParticipantFixture).not.toHaveProperty('objectId');
    expect(anonymousParticipantFixture).not.toHaveProperty('displayName');
    expect(JSON.stringify(anonymousParticipantFixture)).not.toContain('example.com');
  });

  it('rejects malformed semantic versions and invalid timer settings', () => {
    expect(getSchemaCompatibility('1..0')).toBe('invalid');
    expect(
      validateScale({
        scaleKind: 'Custom',
        scaleValues: ['1', '2'],
        timerEnabled: true,
        votingMode: 'Named'
      })
    ).toContain('Enabled timers must be whole seconds from 1 through 3,600.');
    expect(
      validateScale({
        scaleKind: 'Custom',
        scaleValues: ['1', '2'],
        timerEnabled: false,
        timerDurationSeconds: 30,
        votingMode: 'Named'
      })
    ).toContain('Disabled timers must not persist a duration.');
  });
});
