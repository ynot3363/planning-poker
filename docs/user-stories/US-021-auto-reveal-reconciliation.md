# US-021: Reconcile Automatic Reveal After Collaborative Changes

## User Story

As a voting participant, I want an eligible round to reveal after the connected
voter set and submitted votes converge so results do not remain stuck merely
because the final state arrived through Presence or another client.

## Description

Automatic reveal is currently evaluated only while casting a vote. A Named
non-voter disconnect, Anonymous attendee removal, or simultaneous final votes
can leave every remaining connected participant voted while the round remains
Voting indefinitely.

Introduce one idempotent eligibility/reveal operation invoked after all relevant
vote, Presence, and convergence changes. It must preserve the at-least-one-voter
rule, freeze the round once, and cooperate with the deterministic concurrency
model from US-020.

## Public API

- Provide `tryAutoReveal` or an equivalent typed command that evaluates the
  authoritative open session, current round, connected eligible participants,
  and current votes.
- Return applied, already-revealed, not-eligible, stale, or rejected results
  without requiring a host gesture.
- Keep manual host reveal as a separate command and contract.

## Acceptance Criteria

- Automatic reveal requires an Active open session, a current Voting round, at
  least one connected eligible participant, and a valid vote from every
  connected eligible participant.
- The operation runs after an accepted vote, Named final-attendee disconnect,
  Anonymous attendee removal, Presence reconciliation, and converged tree
  changes that may satisfy eligibility.
- Simultaneous final votes and simultaneous reconciliation attempts reveal
  exactly once and produce deterministic non-personal Automatic audit state.
- Disconnecting the last non-voter reveals when every remaining connected voter
  has voted; removing the only participant does not reveal a zero-participant
  round.
- Anonymous attendee removal still removes that attendee's active unrevealed
  vote before eligibility is evaluated.
- Reconnect or late join cannot reopen an already Revealed round or add a vote
  to it.
- Reconciliation avoids feedback loops, repeated save churn, and per-Presence
  metadata writes.

## Tests

- Use two independent Fluid clients to test simultaneous final votes, delayed
  vote convergence, Named disconnect, Anonymous removal, reconnect, and
  multiple clients attempting reconciliation.
- Unit-test zero participants, zero votes, one eligible voter, disconnected
  voters, stale round IDs, already-revealed state, and invalid/out-of-scale
  votes.
- Assert reveal status, reason, voted/missing counts, timer stop, and save
  behavior are identical on all clients after reload.

## Documentation and Examples

- Update participation, active-voting, results, and architecture guidance with
  every automatic-reveal trigger and the convergence behavior.

## Dependencies

- US-011 defines connected eligibility and Anonymous removal.
- US-012 defines vote acceptance.
- US-013 defines timer stop behavior.
- US-014 defines reveal output.
- US-020 supplies deterministic multi-client idempotence.

## Implementation Notes

- Reuse one pure eligibility calculation at every trigger.
- Schedule reconciliation from change notifications without mutating during a
  read callback or creating an unbounded self-triggering loop.
- Manual reveal with zero votes is explicitly outside this story and this audit
  remediation scope.
