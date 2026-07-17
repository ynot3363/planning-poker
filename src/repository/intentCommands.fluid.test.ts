import { Tree, TreeViewConfiguration } from '@fluidframework/tree';
import type { TreeView } from '@fluidframework/tree';
import { SharedTree } from '@fluidframework/tree/legacy';
import {
  createIdCompressor,
  createSessionId,
  deserializeIdCompressor,
  serializeIdCompressor
} from '@fluidframework/id-compressor/internal';
import {
  MockContainerRuntimeFactory,
  MockFluidDataStoreRuntime,
  MockStorage
} from '@fluidframework/test-runtime-utils/internal';
import { fixtureDocument, fixtureUser } from '../domain/planningPokerFixtures';
import type {
  EstimateHistoryEntry,
  PlanningPokerDocumentRoot,
  PointingStory,
  SessionParticipant,
  UserReference,
  VotingSession
} from '../domain/planningPokerDomain';
import { PlanningPokerDocumentRootSchema } from '../domain/planningPokerSchema';
import {
  applyStoryCreate,
  applyStoryEdit,
  applyStoryImport,
  applyTeamEdit,
  applyVotingSessionStart
} from './intentCommands';
import type { IntentDocumentRoot } from './intentCommands';
import type { IntentCommandResult } from './teamRepository';

const treeConfiguration = new TreeViewConfiguration({
  schema: PlanningPokerDocumentRootSchema,
  enableSchemaValidation: true
});

type PlanningPokerTreeView = TreeView<typeof PlanningPokerDocumentRootSchema>;

/**
 * Reorders the official mock orderer's pending operation queue for deterministic delivery tests.
 *
 * @param factory - Shared mock orderer holding undelivered operations.
 * @returns `void` after reversing the queue.
 */
function reversePendingMessages(factory: MockContainerRuntimeFactory): void {
  const queue = factory as unknown as {
    readonly messages: Array<{ readonly clientId?: string }>;
  };
  const clientOrder: string[] = [];
  const messagesByClient = new Map<string, Array<{ readonly clientId?: string }>>();
  queue.messages.forEach((message) => {
    const clientId = message.clientId ?? '';
    const messages = messagesByClient.get(clientId);
    if (messages === undefined) {
      clientOrder.push(clientId);
      messagesByClient.set(clientId, [message]);
    } else {
      messages.push(message);
    }
  });
  const reordered: Array<{ readonly clientId?: string }> = [];
  clientOrder.reverse().forEach((clientId) => {
    const messages = messagesByClient.get(clientId);
    if (messages !== undefined) {
      reordered.push(...messages);
    }
  });
  queue.messages.splice(0, queue.messages.length, ...reordered);
}

/**
 * Creates a detached story for multi-client command coverage.
 *
 * @param id - Stable story identifier.
 * @param title - Story title.
 * @returns A valid Ready story.
 */
function createStory(id: string, title: string): PointingStory {
  return {
    id,
    title,
    description: `${title} description`,
    status: 'Ready',
    estimateHistory: [],
    createdAt: fixtureDocument.createdAt,
    createdBy: fixtureUser,
    updatedAt: fixtureDocument.updatedAt,
    updatedBy: fixtureUser
  };
}

/**
 * Converts a hydrated SharedTree root to the application's plain read model.
 *
 * @param root - Hydrated root value.
 * @returns A detached serializable document snapshot.
 */
function readSnapshot(root: unknown): PlanningPokerDocumentRoot {
  return JSON.parse(JSON.stringify(root)) as PlanningPokerDocumentRoot;
}

/**
 * Appends a detached value through a hydrated SharedTree sequence.
 *
 * @param values - Hydrated sequence.
 * @param value - Detached value to append.
 * @returns `void` after insertion.
 */
function appendTreeValue<T>(values: readonly T[], value: T): void {
  (values as readonly T[] & { insertAtEnd(item: T): void }).insertAtEnd(value);
}

describe('intent commands with independent Fluid clients', () => {
  it('preserves accepted work after delayed, reordered convergence and summary reload', async () => {
    const existingStory = createStory('story-existing', 'Existing');
    const endedSession: VotingSession = {
      id: 'session-ended',
      teamId: fixtureDocument.team.id,
      status: 'Ended',
      settings: fixtureDocument.team.settings,
      participants: [],
      rounds: [],
      finalizedRoundIds: [],
      endedAt: fixtureDocument.updatedAt,
      endedBy: fixtureUser,
      createdAt: fixtureDocument.createdAt,
      createdBy: fixtureUser,
      updatedAt: fixtureDocument.updatedAt,
      updatedBy: fixtureUser
    };
    const lobby: VotingSession = {
      id: 'session-lobby',
      teamId: fixtureDocument.team.id,
      status: 'Lobby',
      settings: fixtureDocument.team.settings,
      participants: [],
      rounds: [],
      finalizedRoundIds: [],
      createdAt: fixtureDocument.createdAt,
      createdBy: fixtureUser,
      updatedAt: fixtureDocument.updatedAt,
      updatedBy: fixtureUser
    };
    const initialDocument: PlanningPokerDocumentRoot = {
      ...fixtureDocument,
      stories: [existingStory],
      sessions: [endedSession, lobby],
      openSessionId: lobby.id
    };
    const sharedTreeFactory = SharedTree.getFactory();
    const runtimeFactory = new MockContainerRuntimeFactory();
    const createClient = (): {
      readonly runtime: MockFluidDataStoreRuntime;
      readonly tree: ReturnType<typeof sharedTreeFactory.create>;
      readonly view: PlanningPokerTreeView;
    } => {
      const runtime = new MockFluidDataStoreRuntime({
        idCompressor: createIdCompressor(),
        registry: [sharedTreeFactory]
      });
      runtimeFactory.createContainerRuntime(runtime);
      const tree = sharedTreeFactory.create(runtime, 'appTree');
      tree.connect({
        deltaConnection: runtime.createDeltaConnection(),
        objectStorage: new MockStorage()
      });
      return { runtime, tree, view: tree.viewWith(treeConfiguration) };
    };
    const first = createClient();
    const second = createClient();
    first.view.initialize(initialDocument as never);
    runtimeFactory.processAllMessages();

    const runCommand = (
      view: typeof first.view,
      apply: (document: IntentDocumentRoot) => IntentCommandResult
    ): IntentCommandResult => {
      let result: IntentCommandResult = { status: 'stale', reason: 'team-not-found' };
      Tree.runTransaction(view, (root) => {
        result = apply(root as unknown as IntentDocumentRoot);
      });
      return result;
    };
    const secondHost: UserReference = {
      objectId: 'second-host',
      displayName: 'Second Host',
      loginName: 'second@example.com'
    };
    expect(
      runCommand(first.view, (document) =>
        applyTeamEdit(document, {
          teamId: fixtureDocument.team.id,
          expectedUpdatedAt: fixtureDocument.team.updatedAt,
          hosts: [fixtureUser, secondHost],
          currentUser: fixtureUser,
          updatedAt: '2026-07-16T15:00:00.000Z'
        })
      )
    ).toEqual({ status: 'applied' });
    expect(
      runCommand(second.view, (document) =>
        applyTeamEdit(document, {
          teamId: fixtureDocument.team.id,
          expectedUpdatedAt: fixtureDocument.team.updatedAt,
          settings: {
            ...fixtureDocument.team.settings,
            timerEnabled: true,
            timerDurationSeconds: 120
          },
          currentUser: fixtureUser,
          updatedAt: '2026-07-16T15:00:01.000Z'
        })
      )
    ).toEqual({ status: 'applied' });

    const firstImport = createStory('story-first', 'First client');
    const secondImport = createStory('story-second', 'Second client');
    const concurrentCreate = createStory('story-created', 'Created while importing');
    expect(
      runCommand(first.view, (document) =>
        applyStoryCreate(document, {
          story: concurrentCreate,
          currentUser: fixtureUser,
          updatedAt: '2026-07-16T15:00:02.000Z'
        })
      )
    ).toEqual({ status: 'applied' });
    expect(
      runCommand(first.view, (document) =>
        applyStoryImport(document, {
          stories: [firstImport],
          currentUser: fixtureUser,
          updatedAt: '2026-07-16T15:00:02.500Z'
        })
      )
    ).toEqual({ status: 'applied' });
    expect(
      runCommand(second.view, (document) =>
        applyStoryImport(document, {
          stories: [secondImport],
          currentUser: fixtureUser,
          updatedAt: '2026-07-16T15:00:03.000Z'
        })
      )
    ).toEqual({ status: 'applied' });

    expect(
      runCommand(first.view, (document) =>
        applyStoryEdit(document, {
          storyId: existingStory.id,
          expectedUpdatedAt: existingStory.updatedAt,
          title: 'Edited while finalizing',
          description: existingStory.description,
          currentUser: fixtureUser,
          updatedAt: '2026-07-16T15:00:04.000Z'
        })
      )
    ).toEqual({ status: 'applied' });
    Tree.runTransaction(second.view, (root) => {
      const document = root as unknown as IntentDocumentRoot;
      const story = document.stories.find((candidate) => candidate.id === existingStory.id) as
        | (PointingStory & {
            status: PointingStory['status'];
            currentEstimate?: string;
            readonly estimateHistory: readonly EstimateHistoryEntry[];
            updatedAt: string;
            updatedBy: UserReference;
          })
        | undefined;
      if (story === undefined) {
        throw new Error('Expected the story under concurrent finalization.');
      }
      story.status = 'Pointed';
      story.currentEstimate = '5';
      appendTreeValue(story.estimateHistory, {
        sessionId: lobby.id,
        roundId: 'round-finalized',
        value: '5',
        finalizedAt: '2026-07-16T15:00:05.000Z',
        finalizedBy: fixtureUser
      });
      story.updatedAt = '2026-07-16T15:00:05.000Z';
      story.updatedBy = fixtureUser;
      document.updatedAt = story.updatedAt;
    });

    expect(
      runCommand(first.view, (document) =>
        applyVotingSessionStart(document, lobby.id, fixtureUser, '2026-07-16T15:00:06.000Z')
      )
    ).toEqual({ status: 'applied' });
    Tree.runTransaction(second.view, (root) => {
      const document = root as unknown as IntentDocumentRoot;
      const session = document.sessions.find((candidate) => candidate.id === lobby.id);
      if (session === undefined) {
        throw new Error('Expected the Lobby under concurrent participant join.');
      }
      const participant: SessionParticipant = {
        kind: 'Named',
        id: 'participant-concurrent',
        user: fixtureUser,
        joinedAt: '2026-07-16T15:00:07.000Z',
        presence: {
          connection: 'Connected',
          lastSeenAt: '2026-07-16T15:00:07.000Z'
        }
      };
      appendTreeValue(session.participants, participant);
    });

    expect(runtimeFactory.outstandingMessageCount).toBeGreaterThan(0);
    reversePendingMessages(runtimeFactory);
    runtimeFactory.processAllMessages();

    const firstSnapshot = readSnapshot(first.view.root);
    const secondSnapshot = readSnapshot(second.view.root);
    expect(secondSnapshot).toEqual(firstSnapshot);
    expect(firstSnapshot.team.hosts).toEqual([fixtureUser, secondHost]);
    expect(firstSnapshot.team.settings).toMatchObject({
      timerEnabled: true,
      timerDurationSeconds: 120
    });
    expect(firstSnapshot.stories.map((story) => story.id)).toEqual(
      expect.arrayContaining([
        existingStory.id,
        concurrentCreate.id,
        firstImport.id,
        secondImport.id
      ])
    );
    expect(firstSnapshot.stories.find((story) => story.id === existingStory.id)).toMatchObject({
      title: 'Edited while finalizing',
      status: 'Pointed',
      currentEstimate: '5',
      estimateHistory: [expect.objectContaining({ roundId: 'round-finalized', value: '5' })]
    });
    expect(firstSnapshot.sessions[0]).toEqual(endedSession);
    expect(firstSnapshot.sessions[1]).toMatchObject({
      status: 'Active',
      participants: [expect.objectContaining({ id: 'participant-concurrent' })]
    });

    const summarizable = first.tree as unknown as {
      summarize(): Promise<{
        readonly summary: Parameters<typeof MockStorage.createFromSummary>[0];
      }>;
    };
    const summary = await summarizable.summarize();
    if (first.runtime.idCompressor === undefined) {
      throw new Error('Expected the source runtime to expose its ID compressor.');
    }
    const reloadRuntime = new MockFluidDataStoreRuntime({
      idCompressor: deserializeIdCompressor(
        serializeIdCompressor(first.runtime.idCompressor, false),
        createSessionId()
      ),
      registry: [sharedTreeFactory]
    });
    runtimeFactory.createContainerRuntime(reloadRuntime);
    const reloadedTree = await sharedTreeFactory.load(
      reloadRuntime,
      'appTree',
      {
        deltaConnection: reloadRuntime.createDeltaConnection(),
        objectStorage: MockStorage.createFromSummary(summary.summary)
      },
      sharedTreeFactory.attributes
    );
    const reloadView = reloadedTree.viewWith(treeConfiguration);
    expect(readSnapshot(reloadView.root)).toEqual(firstSnapshot);

    reloadView.dispose();
    first.view.dispose();
    second.view.dispose();
    reloadRuntime.dispose();
    first.runtime.dispose();
    second.runtime.dispose();
  });
});
