import { FIBONACCI_SCALE, T_SHIRT_SCALE } from '../domain/planningPokerDomain';
import { fixtureDocument, fixtureUser } from '../domain/planningPokerFixtures';
import type { HostedTeamSummary } from '../repository/teamRepository';
import {
  createInitialTeamForm,
  createTeamFormFromTeam,
  createTeamFormSubmission,
  createTeamSettings,
  validateTeamForm
} from './teamForm';
import type { TeamFormValues } from './teamForm';

const existingTeams: readonly HostedTeamSummary[] = [
  { teamId: 'existing-team', driveItemId: 'item-1', title: 'Existing Team', isActive: true }
];

function createValidValues(overrides: Partial<TeamFormValues> = {}): TeamFormValues {
  return {
    ...createInitialTeamForm(fixtureUser),
    title: 'Delivery Team',
    ...overrides
  };
}

describe('team form', () => {
  it('starts with the current user as host and canonical Fibonacci defaults', () => {
    const values = createInitialTeamForm(fixtureUser);

    expect(values.hosts).toEqual([fixtureUser]);
    expect(values.isActive).toBe(true);
    expect(createTeamSettings(values)).toMatchObject({
      scaleKind: 'Fibonacci',
      scaleValues: FIBONACCI_SCALE,
      timerEnabled: false,
      timerDurationSeconds: undefined,
      votingMode: 'Named'
    });
  });

  it('normalizes built-in and custom scales without persisting disabled timer values', () => {
    expect(
      createTeamSettings(
        createValidValues({
          scaleKind: 'TShirt',
          customScaleValues: ['ignored'],
          timerDurationMinutes: 5
        })
      ).scaleValues
    ).toBe(T_SHIRT_SCALE);
    expect(
      createTeamSettings(
        createValidValues({ scaleKind: 'Custom', customScaleValues: [' Small ', 'Large '] })
      )
    ).toMatchObject({
      scaleValues: ['Small', 'Large'],
      timerDurationSeconds: undefined
    });
  });

  it('validates titles, people, custom scales, and timer boundaries', () => {
    const duplicateHost = { ...fixtureUser };
    const errors = validateTeamForm(
      createValidValues({
        title: 'existing team',
        hosts: [fixtureUser, duplicateHost],
        configuredMembers: [fixtureUser, duplicateHost],
        scaleKind: 'Custom',
        customScaleValues: ['One', ' one '],
        timerEnabled: true,
        timerDurationMinutes: 61
      }),
      existingTeams
    );

    expect(errors).toEqual({
      title: 'A team already uses that title.',
      hosts: 'Each host can be selected only once.',
      configuredMembers: 'Each configured member can be selected only once.',
      scaleValues: 'Scale values must be unique without regard to case.',
      timerDurationMinutes: 'Enabled timers must be whole minutes from 1 through 60.'
    });
  });

  it('requires at least one host and valid SharePoint file-name syntax', () => {
    expect(validateTeamForm(createValidValues({ title: 'bad/name', hosts: [] }), [])).toEqual({
      title: 'The title is not a valid SharePoint file name.',
      hosts: 'Select at least one host.'
    });
  });

  it('preserves identity and creation audit while applying an edit', () => {
    const values = {
      ...createTeamFormFromTeam(fixtureDocument.team),
      title: ' Renamed Team ',
      description: ' Updated description '
    };
    const result = createTeamFormSubmission(values, {
      currentUser: fixtureUser,
      existingTeam: fixtureDocument.team,
      existingTeams: [
        {
          teamId: fixtureDocument.team.id,
          driveItemId: 'item-id',
          title: fixtureDocument.team.title,
          isActive: true
        }
      ],
      createId: () => 'unused',
      now: () => '2026-07-10T02:00:00.000Z'
    });

    expect(result).toMatchObject({
      isValid: true,
      team: {
        id: fixtureDocument.team.id,
        title: 'Renamed Team',
        description: 'Updated description',
        createdAt: fixtureDocument.team.createdAt,
        updatedAt: '2026-07-10T02:00:00.000Z'
      }
    });
    expect(values.timerDurationMinutes).toBe(5);
    if (result.isValid) {
      expect(result.team.settings.timerDurationSeconds).toBe(300);
    }
  });

  it('returns field errors without allocating a team identity', () => {
    const createId = jest.fn(() => 'new-team');
    const result = createTeamFormSubmission(createValidValues({ title: '' }), {
      currentUser: fixtureUser,
      existingTeams: [],
      createId,
      now: () => '2026-07-10T02:00:00.000Z'
    });

    expect(result).toEqual({ isValid: false, errors: { title: 'Enter a team title.' } });
    expect(createId).not.toHaveBeenCalled();
  });
});
