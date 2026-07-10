import { parsePlanningPokerRoute, writePlanningPokerRoute } from './planningPokerRoute';

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
  });
});
