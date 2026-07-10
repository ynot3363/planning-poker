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
    estimateHistory[] -> sessionId + roundId
  sessions[]
    participants[]
    rounds[]
      storySnapshot
      votes[] -> participantId
      timer
```

The root permits at most one `Lobby` or `Active` session and at most one
unfinished (`Voting` or `Revealed`) round in that session. A session snapshots
team settings at creation time, so later team edits cannot rewrite history.

## Contract decisions

- IDs are immutable opaque UUIDs and timestamps are ISO 8601 UTC strings.
- Scale values are strings. Fibonacci is `0`, `0.5`, `1`, `2`, `3`, `5`, `8`;
  T-shirt is `XS`, `S`, `M`, `L`, `XL`, `XXL`.
- Story state is `Ready`, `Pointed`, or `Archived`. Finalization moves a story
  to `Pointed` and appends history; restore and re-pointing preserve history.
- Votes identify only the session participant and are valid only against the
  session's scale snapshot.
- Named participants contain the minimum `UserReference`. Anonymous participants
  contain only a generated alias and technical participant data. No persisted
  field maps an anonymous alias to an authenticated identity.
- Timer state stores authoritative timestamps and remaining duration, never a
  per-second write. Expiration is informational and cannot reveal or close a
  round.

## Schema versions

The current document schema is `1.0.0`. Additive, explicitly tested migrations
may upgrade older supported roots. A newer or invalid root is a recoverable
compatibility error: it must not be reset, overwritten, or silently migrated.
Schema validation checks compatibility and corruption; it is not an
authorization or tamper-detection mechanism.

## SharePoint discovery metadata

| Display name | Type | Owner |
| --- | --- | --- |
| Title | Built-in text | Team title and `.fluid` file name |
| Team ID | Single line of text | Immutable team lookup key |
| Hosts | Person or Group, multiple | Hosted-team discovery |
| Participants | Person or Group, multiple | Configured roster index |
| Is Active | Yes/No | Active-team filtering |
| Schema Version | Single line of text | Compatibility pre-check |
| Active Session ID | Single line of text | Deep-link session lookup |
| Last Activity | Date and Time | Summary sorting |

Provisioning supplies display names and types only, then reads back and retains
SharePoint's actual `InternalName`. Contribute access to the library means a
technically capable contributor can deliberately alter compatible data; the
host-only UI is not a tamper-proof authorization boundary.

## Example fixtures

`src/domain/planningPokerFixtures.ts` contains deterministic named-team and
anonymous-participant fixtures. The anonymous fixture deliberately has no
authenticated identity fields and is used by privacy regression tests.
