# Voting Timer

The optional timer belongs to the active voting round and uses the immutable
session settings snapshot. It is informational: expiration does not reveal
votes, lock voting, finalize a story, or end a session.

Hosts can start, stop/resume, and reset the current timer. Every command is
rechecked transactionally against the open Active session, current Voting
round, timer-enabled setting, and current host list. Participants receive the
same read-only time and status without host controls.

Running state persists the remaining-at-start seconds and an ISO start time.
Clients derive countdown display locally and never write per-second Fluid
operations. Stop calculates and persists the remaining whole seconds; reset
restores the configured duration. Reaching zero produces an `Expired`
presentation state and an explicit warning that voting remains open. Duplicate
start, stop, and fully-reset commands are rejected at the transaction boundary
so stale host controls cannot rewind or rebase the synchronized timer.
