# US-023: Preserve Ended-Session Immutability and Round Transition Consistency

## User Story

As a team host reviewing session history, I want ended state to remain deeply
immutable and valid recovery transitions to be represented consistently so
later Presence cleanup cannot rewrite history.

## Description

Presence connection setters can currently update any matching session, including
an Ended session, and session close/disposal can invoke those setters after end
acknowledgement. This mutates participant connection data and `lastSeenAt` in a
record documented as immutable. Separately, the public round transition guard
rejects `Revealed` to `Voting`, even though Undo reveal implements that path.

Close both lifecycle gaps by gating Presence writes to the authoritative open
Lobby/Active session, tearing down bindings at end, and aligning the shared
transition model with the documented host recovery command.

## Public API

- Keep `setParticipantConnection` or its replacement scoped to the current open
  Lobby/Active session and return a typed no-op/rejection for Ended history.
- Preserve `undoReveal(roundId)` as a host-authorized command for the active
  Revealed round.
- Update the public round-transition validator to allow only the documented
  `Revealed -> Voting` recovery in the appropriate command context.

## Acceptance Criteria

- End atomically records the final snapshot and tears down or disables local
  Presence bindings before later disconnect/disposal callbacks can write.
- Ended sessions reject join, participant connection, vote, timer, reveal,
  reopen, finalize, correction, and repeated-end mutations as documented.
- Disconnect, reconnect, page visibility changes, navigation, and idempotent
  disposal leave an Ended session deeply unchanged and do not create a new dirty
  Fluid operation after end save acknowledgement.
- Named participant connection history and Anonymous aggregate history remain
  exactly as captured at end.
- The shared transition guard permits `Revealed -> Voting` for Undo reveal and
  continues rejecting transitions from Finalized, Cancelled, or Ended history.
- Generic document validation and command-specific guards agree on the valid
  Undo reveal path.

## Tests

- Capture an Ended snapshot and assert deep equality after disconnect,
  reconnect, page hide/show, navigation, subscription cleanup, and repeated
  disposal.
- Test connection setters against Lobby, Active, and Ended sessions and against
  stale/non-open session IDs.
- Unit-test every round transition, including valid Undo reveal and invalid
  transitions from Finalized/Cancelled states.
- Use two clients to verify ending races with Presence departure without a
  post-end mutation.

## Documentation and Examples

- Update session-completion, participation, results, and data-model transition
  guidance with teardown ordering and immutable-history behavior.

## Dependencies

- US-011 owns Presence bindings and disconnect behavior.
- US-014 owns Undo reveal.
- US-015 owns end acknowledgement and immutable history.
- US-019 supplies focused session commands that cannot replace ended history.
- US-020 supplies deterministic concurrent end behavior.

## Implementation Notes

- Gate writes using authoritative session status and root pointer inside the
  transaction, not only a service-side closed flag.
- Make teardown idempotent and safe when end, navigation, and web-part disposal
  happen close together.
