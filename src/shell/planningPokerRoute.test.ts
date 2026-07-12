import {
  parsePlanningPokerRoute,
  readPlanningPokerRoute,
  writePlanningPokerRoute
} from './planningPokerRoute';

describe('Planning Poker route handling', () => {
  it('preserves unrelated parameters while writing a focused voting route', () => {
    const result = writePlanningPokerRoute('debug=true', {
      view: 'Voting',
      teamId: 'team-1',
      sessionId: 'session_1',
      focusedVoting: true
    });

    expect(result).toContain('debug=true');
    expect(parsePlanningPokerRoute(result)).toEqual({
      view: 'Voting',
      teamId: 'team-1',
      sessionId: 'session_1',
      focusedVoting: true
    });
  });

  it('rejects malformed identifiers and unknown views', () => {
    const result = parsePlanningPokerRoute(
      'planningPokerView=Admin&planningPokerTeam=%2Fsites%2Fother&planningPokerSession='
    );

    expect(result).toEqual({
      view: 'Teams',
      teamId: undefined,
      sessionId: undefined,
      focusedVoting: false
    });
  });

  it('removes absent identifiers and accepts supported non-voting views', () => {
    const result = writePlanningPokerRoute(
      'planningPokerTeam=old&planningPokerSession=old&keep=true',
      { view: 'About', focusedVoting: false }
    );

    expect(result).toContain('keep=true');
    expect(result).not.toContain('planningPokerTeam');
    expect(parsePlanningPokerRoute(result).view).toBe('About');
    expect(parsePlanningPokerRoute('planningPokerView=Stories').view).toBe('Stories');
    expect(
      readPlanningPokerRoute('planningPokerView=Stories&planningPokerTeam=team-1')
    ).toMatchObject({
      route: { view: 'Stories', teamId: 'team-1', focusedVoting: false },
      notice: undefined
    });
  });

  it('explains invalid and incomplete route fallbacks without exposing untrusted values', () => {
    expect(readPlanningPokerRoute('planningPokerView=Admin').notice).toBe('invalid-view');
    expect(
      readPlanningPokerRoute('planningPokerView=Voting&planningPokerTeam=team-1')
    ).toMatchObject({
      route: { view: 'Voting', teamId: 'team-1', focusedVoting: false },
      notice: undefined
    });
    expect(
      readPlanningPokerRoute('planningPokerView=Voting&planningPokerSession=session-1').notice
    ).toBe('incomplete-voting-link');
    expect(
      readPlanningPokerRoute(
        'planningPokerView=Voting&planningPokerTeam=%2Fbad&planningPokerSession=session-1'
      ).notice
    ).toBe('invalid-identifier');
  });

  it('encodes opaque identifiers and accepts a leading question mark', () => {
    const search = writePlanningPokerRoute('?keep=hello%20world', {
      view: 'Voting',
      teamId: 'team_1',
      sessionId: 'session-1',
      focusedVoting: true
    });

    expect(search).toContain('keep=hello+world');
    expect(parsePlanningPokerRoute(`?${search}`).focusedVoting).toBe(true);
  });
});
