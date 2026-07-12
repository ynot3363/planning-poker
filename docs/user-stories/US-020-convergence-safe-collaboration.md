# US-020: Make Collaborative Commands Convergence-Safe and Idempotent

## User Story

As a multi-client Planning Poker team, I want concurrent commands to converge on
one valid result so duplicated sessions, rounds, votes, or history cannot appear
when clients act before receiving one another's operations.

## Description

`Tree.runTransaction` atomically batches one client's local edits but is not a
distributed lock. Find-then-append and check-then-set logic can therefore let
independent clients create two open sessions, two active rounds, duplicate vote
records, duplicate finalized history, or conflicting pointers before merge.

Define a CRDT-compatible uniqueness and reconciliation strategy for each keyed
domain fact. Use stable operation identity and deterministic conflict outcomes,
then validate those contracts with separate Fluid containers whose operations
are deliberately delayed and reordered.

## Public API

- Give retryable collaborative commands a stable operation/command ID or
  equivalent idempotency key.
- Return typed canonical-winner, already-applied, reconciled-conflict, stale,
  and rejected results where callers need recovery behavior.
- Provide private or public selectors that derive the one canonical open
  session, active round, participant vote slot, finalized-round index, and
  history event after convergence.
- Do not expose local transaction success as proof of distributed uniqueness or
  durable convergence.

## Acceptance Criteria

- Concurrent Lobby preparation converges on exactly one Lobby/Active session and
  one matching `openSessionId`; losing attempts have a deterministic
  non-open outcome and remain recoverable/auditable as documented.
- Concurrent story selection converges on one active Voting/Revealed round and
  one matching `activeRoundId`; no second unfinished round remains eligible.
- A participant has exactly one authoritative vote slot per round after
  concurrent submissions from multiple attendees; the deterministic value rule
  is documented and consistently presented.
- Concurrent Anonymous joins preserve every accepted participant and converge
  on unique sequential aliases; Named rejoins remain deduplicated by stable
  authenticated object ID.
- Replayed finalization and correction operations cannot duplicate estimate
  history or finalized-round indexes, while distinct intentional corrections
  remain append-only.
- Pointer, status, sequence, and history invariants hold both immediately after
  convergence and after document reload.
- Conflict reconciliation is deterministic across clients and does not depend
  on wall-clock ordering or which browser performs cleanup first.
- Schema or storage changes required for keyed state have an explicit additive
  migration and compatibility policy.

## Tests

- Build an authoritative two-container Fluid test harness with independent
  views, delayed/reordered operation delivery, convergence waits, and reload.
- Cover simultaneous Lobby creation, active-round selection, Anonymous join,
  Named rejoin, same-participant vote upsert, final required votes,
  finalization retry, distinct correction, finalized index insertion, and
  reconnect.
- Assert domain invariants recursively after convergence on both clients and on
  a newly loaded client.
- Keep deterministic unit tests for reconciliation and idempotency-key parsing,
  but do not substitute a shared synchronous fake root for multi-client tests.

## Documentation and Examples

- Add an architecture decision describing the keyed-state/reconciliation model,
  stable operation identity, winner rules, and user-visible conflict recovery.
- Document that local SharedTree transactions batch local intent rather than
  providing distributed locks.

## Dependencies

- US-001 owns single-open-session, single-active-round, vote, and history
  invariants.
- US-019 supplies focused live-node commands.
- US-010, US-012, and US-014 define the concurrent lifecycle behavior.

## Implementation Notes

- Prefer keyed collaborative state or deterministic derived canonical records
  over append-then-best-effort cleanup.
- Stable IDs must identify an intentional operation, not be regenerated for a
  retry of the same operation.
- Avoid last-writer-wins rules based solely on client clocks.
