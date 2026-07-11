import { TreeViewConfiguration } from '@fluidframework/tree';
import { createIndependentTreeBeta } from '@fluidframework/tree/beta';
import { fixtureDocument } from './planningPokerFixtures';
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

  it('initializes the persisted schema from the public document contract', () => {
    const tree = createIndependentTreeBeta();
    const view = tree.viewWith(
      new TreeViewConfiguration({
        schema: PlanningPokerDocumentRootSchema,
        enableSchemaValidation: true
      })
    );

    view.initialize(fixtureDocument as never);

    expect(JSON.parse(JSON.stringify(view.root))).toEqual(fixtureDocument);
    view.dispose();
  });
});
