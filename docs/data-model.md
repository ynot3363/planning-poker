# Planning Poker Data Model

## Ownership

Each team is represented by one `.fluid` document in `PlanningPokerAppData`.
The `PlanningPokerDocumentRoot` is the authoritative source for the team,
stories, sessions, participants, rounds, votes, timers, and estimate history.
SharePoint fields are a denormalized discovery index and are refreshed only
after mutations that affect discovery or summary data.

```text
PlanningPokerDocumentRoot
  team
    hosts[] / configuredMembers[]
    settings (scale, timer, voting mode)
  stories[]
    estimateHistory[] -> operationId + supersedesOperationId? + sessionId + roundId
  sessions[]
    participants[]
    rounds[]
      storySnapshot
      votes[] -> operationId + supersedesOperationId? + participantId
      timer
```

The root permits at most one `Lobby` or `Active` session and at most one
unfinished (`Voting` or `Revealed`) round in that session. A session snapshots
team settings at creation time, so later team edits cannot rewrite history.
An Ended session is deeply immutable: no roster, Presence, round, vote, timer,
audit, estimate, or index command may modify it after end/departure operations
converge.

## Contract decisions

- IDs are immutable opaque UUIDs and timestamps are ISO 8601 UTC strings.
- Scale values are strings. Fibonacci is `0`, `0.5`, `1`, `2`, `3`, `5`, `8`;
  T-shirt is `XS`, `S`, `M`, `L`, `XL`, `XXL`.
- Story state is `Ready`, `Pointed`, or `Archived`. Finalization moves a story
  to `Pointed` and appends history; restore and re-pointing preserve history.
- Votes identify only the session participant and are valid only against the
  session's scale snapshot. Their operation IDs make retries idempotent and
  their optional supersession links distinguish a changed selection from a
  simultaneous sibling selection.
- Named participants contain the minimum `UserReference`. Anonymous participants
  contain only a generated alias and technical participant data. No persisted
  field maps an anonymous alias to an authenticated identity.
- Named sessions retain host audit references. Anonymous sessions omit session
  user-audit references so their shared session, participant, and vote records
  contain no authenticated identity values.
- Timer state stores authoritative timestamps and remaining duration, never a
  per-second write. Expiration is informational and cannot reveal or close a
  round.
- Round lifecycle normally progresses from Voting to Revealed and then
  Finalized, with cancellation allowed from Voting or Revealed. The sole
  backward transition is `Revealed -> Voting` in the host-authorized
  `undo-reveal` command context; Finalized and Cancelled are terminal.
- Participant connection updates are typed intent commands scoped by both the
  root `openSessionId` and a Lobby/Active session status. End clears local and
  cached Presence bindings; subsequent teardown callbacks cannot rewrite the
  captured participant history.

## Schema versions

The current document schema is `1.1.0`. Additive, explicitly tested migrations
may upgrade older supported roots. A newer or invalid root is a recoverable
compatibility error: it must not be reset, overwritten, or silently migrated.
Schema validation checks compatibility and corruption; it is not an
authorization or tamper-detection mechanism.

US-011 makes session user-audit references optional so Anonymous sessions can
omit authenticated identity values. US-020 adds optional vote and estimate
history `operationId` and `supersedesOperationId` fields plus a round-level
`finalizationOperationId` and optional automatic-reveal suppression key.
Existing `1.0.0` documents remain readable: load first applies the compatible
stored-schema upgrade, assigns deterministic legacy operation identities during
reconciliation, and writes `1.1.0` before new commands use the additive fields.
Persisted configurations advertising `1.0.0` are accepted and refreshed to the
current version; versions below the supported migration floor remain
incompatible.

The root and session pointer/index fields are derived projections. After
convergence, reconciliation selects one open session and one unfinished round,
deduplicates Named identities and participant vote slots, assigns unique
Anonymous aliases, removes replayed finalization operations, and rebuilds the
finalized-round index. Winner selection uses stable ID code-unit ordering and
causal supersession links, never timestamps or delivery order.

## SharePoint discovery metadata

| Display name      | Type                      | Owner                             |
| ----------------- | ------------------------- | --------------------------------- |
| Title             | Built-in text             | Team title and `.fluid` file name |
| Team ID           | Single line of text       | Immutable team lookup key         |
| Hosts             | Person or Group, multiple | Hosted-team discovery             |
| Participants      | Person or Group, multiple | Configured roster index           |
| Is Active         | Yes/No                    | Active-team filtering             |
| Schema Version    | Single line of text       | Compatibility pre-check           |
| Active Session ID | Single line of text       | Deep-link session lookup          |
| Last Activity     | Date and Time             | Summary sorting                   |

Provisioning supplies display names and types only, then reads back and retains
SharePoint's actual `InternalName`. Contribute access to the library means a
technically capable contributor can deliberately alter compatible data; the
host-only UI is not a tamper-proof authorization boundary.

## Example fixtures

`src/domain/planningPokerFixtures.ts` contains deterministic named-team and
anonymous-participant fixtures. The anonymous fixture deliberately has no
authenticated identity fields and is used by privacy regression tests.
