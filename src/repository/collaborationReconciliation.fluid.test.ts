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
  StoryVotingRound,
  VoteRecord,
  VotingSession
} from '../domain/planningPokerDomain';
import { PlanningPokerDocumentRootSchema } from '../domain/planningPokerSchema';
import { validateDocumentInvariants } from '../domain/planningPokerValidation';
import { reconcileCollaborativeDocument } from './collaborationReconciliation';

const treeConfiguration = new TreeViewConfiguration({
  schema: PlanningPokerDocumentRootSchema,
  enableSchemaValidation: true
});

type PlanningPokerTreeView = TreeView<typeof PlanningPokerDocumentRootSchema>;

interface MutableRoot {
  readonly sessions: readonly VotingSession[];
  readonly stories: readonly PointingStory[];
  openSessionId?: string;
}

interface MutableSession {
  readonly participants: readonly SessionParticipant[];
  readonly rounds: readonly StoryVotingRound[];
  readonly finalizedRoundIds: readonly string[];
  activeRoundId?: string;
}

interface MutableRound {
  readonly id: string;
  status: StoryVotingRound['status'];
  readonly votes: readonly VoteRecord[];
  assignedValue?: string;
  finalizedAt?: string;
  finalizedBy?: typeof fixtureUser;
  finalizationOperationId?: string;
}

interface MutableStory {
  readonly estimateHistory: readonly EstimateHistoryEntry[];
}

/**
 * Converts a hydrated SharedTree root to the application read model.
 *
 * @param root - Hydrated SharedTree root.
 * @returns A detached document snapshot.
 */
function readSnapshot(root: unknown): PlanningPokerDocumentRoot {
  return JSON.parse(JSON.stringify(root)) as PlanningPokerDocumentRoot;
}

/**
 * Appends a detached value through a hydrated SharedTree sequence.
 *
 * @param values - Hydrated sequence receiving the value.
 * @param value - Detached value to append.
 */
function appendTreeValue<T>(values: readonly T[], value: T): void {
  (values as readonly T[] & { insertAtEnd(item: T): void }).insertAtEnd(value);
}

/**
 * Reorders pending mock operations while preserving each client's submission order.
 *
 * @param factory - Mock orderer containing pending messages.
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
 * Creates a valid Lobby candidate for concurrent insertion.
 *
 * @param id - Stable session identity.
 * @returns A valid detached Lobby session.
 */
function createSession(id: string): VotingSession {
  return {
    id,
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
}

/**
 * Creates a valid Voting round candidate for concurrent insertion.
 *
 * @param id - Stable round identity.
 * @param story - Story snapshot source.
 * @returns A valid detached Voting round.
 */
function createRound(id: string, story: PointingStory): StoryVotingRound {
  return {
    id,
    storyId: story.id,
    storySnapshot: {
      storyId: story.id,
      title: story.title,
      description: story.description
    },
    status: 'Voting',
    votes: [],
    timer: {
      configuredDurationSeconds: 300,
      status: 'Ready',
      remainingSeconds: 300
    }
  };
}

/**
 * Runs one reconciliation transaction against a hydrated client view.
 *
 * @param view - Client view to reconcile.
 */
function reconcile(view: PlanningPokerTreeView): void {
  Tree.runTransaction(view, (root) => {
    reconcileCollaborativeDocument(root as unknown as PlanningPokerDocumentRoot, {
      getConnectedParticipantIds: (session) =>
        session.participants
          .filter((participant) => participant.presence.connection === 'Connected')
          .map((participant) => participant.id)
    });
  });
}

describe('collaboration reconciliation with independent Fluid clients', () => {
  it('converges delayed keyed conflicts, retries, corrections, and summary reload', async () => {
    const story: PointingStory = {
      id: 'story-convergence',
      title: 'Convergent story',
      description: 'Exercises deterministic collaborative winners.',
      status: 'Ready',
      estimateHistory: [],
      createdAt: fixtureDocument.createdAt,
      createdBy: fixtureUser,
      updatedAt: fixtureDocument.updatedAt,
      updatedBy: fixtureUser
    };
    const initialDocument: PlanningPokerDocumentRoot = {
      ...fixtureDocument,
      stories: [story]
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

    const transact = (view: PlanningPokerTreeView, update: (root: MutableRoot) => void): void => {
      Tree.runTransaction(view, (root) => update(root as unknown as MutableRoot));
    };
    transact(first.view, (root) => {
      appendTreeValue(root.sessions, createSession('session-z'));
      root.openSessionId = 'session-z';
    });
    transact(second.view, (root) => {
      appendTreeValue(root.sessions, createSession('session-a'));
      root.openSessionId = 'session-a';
    });
    reversePendingMessages(runtimeFactory);
    runtimeFactory.processAllMessages();
    reconcile(first.view);
    reconcile(second.view);
    runtimeFactory.processAllMessages();
    reconcile(first.view);
    runtimeFactory.processAllMessages();

    const namedUser = {
      objectId: 'same-named-user',
      displayName: 'Same Named User',
      loginName: 'same@example.com'
    };
    const participant = (kind: 'Named' | 'Anonymous', id: string): SessionParticipant =>
      kind === 'Named'
        ? {
            kind,
            id,
            user: namedUser,
            joinedAt: fixtureDocument.createdAt,
            presence: { connection: 'Connected', lastSeenAt: fixtureDocument.updatedAt }
          }
        : {
            kind,
            id,
            alias: 'Participant 1',
            joinedAt: fixtureDocument.createdAt,
            presence: { connection: 'Connected', lastSeenAt: fixtureDocument.updatedAt }
          };
    const addRoundAndParticipants = (
      root: MutableRoot,
      roundId: string,
      namedId: string,
      anonymousId: string
    ): void => {
      const session = root.sessions.find((candidate) => candidate.id === 'session-a') as unknown as
        | MutableSession
        | undefined;
      if (session === undefined) {
        throw new Error('Expected the canonical session after reconciliation.');
      }
      appendTreeValue(session.participants, participant('Named', namedId));
      appendTreeValue(session.participants, participant('Anonymous', anonymousId));
      appendTreeValue(session.rounds, createRound(roundId, story));
      session.activeRoundId = roundId;
    };
    transact(first.view, (root) =>
      addRoundAndParticipants(root, 'round-z', 'named-z', 'anonymous-z')
    );
    transact(second.view, (root) =>
      addRoundAndParticipants(root, 'round-a', 'named-a', 'anonymous-a')
    );
    reversePendingMessages(runtimeFactory);
    runtimeFactory.processAllMessages();
    reconcile(first.view);
    reconcile(second.view);
    runtimeFactory.processAllMessages();
    reconcile(second.view);
    runtimeFactory.processAllMessages();

    const castVotes = (root: MutableRoot, votes: readonly VoteRecord[]): void => {
      const session = root.sessions.find((candidate) => candidate.id === 'session-a') as unknown as
        | MutableSession
        | undefined;
      const round = session?.rounds.find((candidate) => candidate.id === 'round-a') as unknown as
        | MutableRound
        | undefined;
      if (round === undefined) {
        throw new Error('Expected the canonical round after reconciliation.');
      }
      votes.forEach((vote) => appendTreeValue(round.votes, vote));
    };
    transact(first.view, (root) =>
      castVotes(root, [
        {
          operationId: 'vote-z',
          participantId: 'named-a',
          value: '8',
          castAt: '2026-07-17T10:00:00.000Z'
        },
        {
          operationId: 'vote-anonymous-a',
          participantId: 'anonymous-a',
          value: '5',
          castAt: '2026-07-17T10:00:00.000Z'
        }
      ])
    );
    transact(second.view, (root) =>
      castVotes(root, [
        {
          operationId: 'vote-a',
          participantId: 'named-a',
          value: '5',
          castAt: '2026-07-17T10:00:01.000Z'
        },
        {
          operationId: 'vote-anonymous-z',
          participantId: 'anonymous-z',
          value: '13',
          castAt: '2026-07-17T10:00:01.000Z'
        }
      ])
    );
    reversePendingMessages(runtimeFactory);
    runtimeFactory.processAllMessages();
    reconcile(first.view);
    reconcile(second.view);
    runtimeFactory.processAllMessages();
    reconcile(first.view);
    runtimeFactory.processAllMessages();

    const revealedSnapshot = readSnapshot(first.view.root);
    expect(
      revealedSnapshot.sessions
        .find((session) => session.id === 'session-a')
        ?.rounds.find((round) => round.id === 'round-a')
    ).toMatchObject({
      status: 'Revealed',
      revealReason: 'Automatic',
      revealedVotedCount: 3,
      revealedMissingCount: 0
    });

    const finalize = (
      root: MutableRoot,
      operationId: string,
      value: string,
      supersedesOperationId?: string
    ): void => {
      const session = root.sessions.find((candidate) => candidate.id === 'session-a') as unknown as
        | MutableSession
        | undefined;
      const round = session?.rounds.find((candidate) => candidate.id === 'round-a') as unknown as
        | MutableRound
        | undefined;
      const mutableStory = root.stories.find(
        (candidate) => candidate.id === story.id
      ) as unknown as MutableStory | undefined;
      if (session === undefined || round === undefined || mutableStory === undefined) {
        throw new Error('Expected canonical entities before finalization.');
      }
      round.status = 'Finalized';
      round.assignedValue = value;
      round.finalizedAt = '2026-07-17T10:01:00.000Z';
      round.finalizedBy = fixtureUser;
      round.finalizationOperationId = operationId;
      appendTreeValue(session.finalizedRoundIds, round.id);
      appendTreeValue(mutableStory.estimateHistory, {
        operationId,
        ...(supersedesOperationId === undefined ? {} : { supersedesOperationId }),
        sessionId: 'session-a',
        roundId: 'round-a',
        value,
        finalizedAt: '2026-07-17T10:01:00.000Z',
        finalizedBy: fixtureUser
      });
    };
    transact(first.view, (root) => finalize(root, 'finalize-initial', '5'));
    transact(second.view, (root) => finalize(root, 'finalize-initial', '5'));
    reversePendingMessages(runtimeFactory);
    runtimeFactory.processAllMessages();
    reconcile(first.view);
    reconcile(second.view);
    runtimeFactory.processAllMessages();

    transact(first.view, (root) => finalize(root, 'correction-z', '8', 'finalize-initial'));
    transact(second.view, (root) => finalize(root, 'correction-a', '13', 'finalize-initial'));
    reversePendingMessages(runtimeFactory);
    runtimeFactory.processAllMessages();
    reconcile(first.view);
    reconcile(second.view);
    runtimeFactory.processAllMessages();
    reconcile(first.view);
    runtimeFactory.processAllMessages();

    const firstSnapshot = readSnapshot(first.view.root);
    const secondSnapshot = readSnapshot(second.view.root);
    expect(secondSnapshot).toEqual(firstSnapshot);
    expect(validateDocumentInvariants(firstSnapshot)).toEqual([]);
    expect(firstSnapshot.openSessionId).toBe('session-a');
    expect(firstSnapshot.sessions.find((session) => session.id === 'session-z')?.status).toBe(
      'Ended'
    );
    const canonicalSession = firstSnapshot.sessions.find((session) => session.id === 'session-a');
    expect(canonicalSession?.activeRoundId).toBeUndefined();
    expect(canonicalSession).toMatchObject({
      finalizedRoundIds: ['round-a'],
      participants: expect.arrayContaining([
        expect.objectContaining({ id: 'anonymous-a', alias: 'Participant 1' }),
        expect.objectContaining({ id: 'anonymous-z', alias: 'Participant 2' }),
        expect.objectContaining({ id: 'named-a' })
      ])
    });
    expect(canonicalSession?.rounds.find((round) => round.id === 'round-z')?.status).toBe(
      'Cancelled'
    );
    expect(canonicalSession?.rounds.find((round) => round.id === 'round-a')).toMatchObject({
      status: 'Finalized',
      assignedValue: '13',
      finalizationOperationId: 'correction-a',
      votes: expect.arrayContaining([
        expect.objectContaining({ participantId: 'anonymous-a' }),
        expect.objectContaining({ participantId: 'anonymous-z' }),
        expect.objectContaining({ participantId: 'named-a', operationId: 'vote-a', value: '5' })
      ])
    });
    expect(firstSnapshot.stories[0]).toMatchObject({
      status: 'Pointed',
      currentEstimate: '13'
    });
    expect(
      firstSnapshot.stories[0].estimateHistory.filter(
        (entry) => entry.operationId === 'finalize-initial'
      )
    ).toHaveLength(1);

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
