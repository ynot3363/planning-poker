import {
  AnonymousParticipantSchema,
  PlanningPokerDocumentRootSchema,
  SessionSchema,
  TeamSchema
} from './planningPokerSchema';

describe('Planning Poker SharedTree schema', () => {
  it('exports the root and nested schemas required by Fluid containers', () => {
    expect(PlanningPokerDocumentRootSchema).toBeDefined();
    expect(TeamSchema).toBeDefined();
    expect(SessionSchema).toBeDefined();
    expect(AnonymousParticipantSchema).toBeDefined();
  });
});
