# US-015: End Sessions and Export Result Summaries

## User Story

As a voting-session host, I want to end the session and export its finalized
story summaries so the team retains a portable record without exposing
individual voting data.

## Description

Complete the lifecycle by allowing a host to end a Lobby or Active session.
Ending makes the session immutable history, clears the team's open-session
metadata, and prevents future joins or voting. If finalized stories exist, offer
an export containing one summary row per finalized round. Individual votes,
names, aliases, and participation details are never exported.

## Public API

Provide typed operations for:

- host `endSession(sessionId)`;
- confirmation and cancellation of an unfinished current round;
- session-summary projection containing finalized rounds only;
- CSV serialization/download using
  `<Team Title>-session-<Session ID>-results.csv`;
- read-only ended-session history.

Export these ordered columns:

- `Session ID`
- `Team ID`
- `Team Title`
- `Story ID`
- `Story Title`
- `Story Link`
- `Assigned Point Value`
- `Total Votes`
- `Vote Breakdown`
- `Finalized On`

## Acceptance Criteria

- End Session is available only to a current host in Lobby or Active state and
  is styled as a consequential/destructive action without competing with the
  current primary voting action.
- Confirmation explains whether the session has no results, finalized results,
  or an unfinished Voting/Revealed round.
- Ending with an unfinished round requires explicit confirmation, changes that
  round to Cancelled, assigns no estimate, and leaves its story Ready.
- Ending records actor/time, changes the session to Ended, clears the Fluid open
  session pointer and Active Session ID metadata, stops the timer, and waits for
  durable save acknowledgement.
- Ended sessions reject join, vote, timer, reveal, assignment, and repeated-end
  commands and remain available as read-only history to hosts.
- Every finalized result remains associated with the immutable session ID and
  its story remains Pointed, excluding it from future sessions unless a host
  explicitly returns it to Ready through US-007.
- When at least one finalized result exists, the completion experience offers
  Export Results CSV as its primary follow-up. A session with no finalized
  results does not produce a misleading results export.
- Export contains exactly one row per finalized round and uses the assigned
  point value and a scale-ordered aggregate breakdown.
- Named and Anonymous exports use the same summary shape and contain no
  participant name, email, object ID, SharePoint ID, anonymous alias,
  participant ID, or individual vote record.
- CSV uses UTF-8 BOM, correct escaping, multiline handling, formula-injection
  protection, and safe file-name generation.
- Export may be repeated from ended-session history without mutating state.
- Concurrent end attempts converge on one idempotent result and do not lose
  finalized rounds or clear a newer session's metadata.
- Completion, export, errors, and focused-mode exit meet US-004 accessibility
  and navigation behavior.

## Tests

- Unit-test end guards, unfinished-round cancellation, session-summary
  projection, finalized-only filtering, breakdown formatting, file naming,
  escaping, and formula protection.
- Privacy tests fail if any identity, alias, participant ID, or individual vote
  field enters an export row.
- Service-test atomic end state, metadata clearing, stale/concurrent requests,
  save failure, retry, and read-only history.
- Multi-client component tests verify synchronized ending, blocked later
  actions, Pointed story exclusion, export offer, and focused-mode exit.

## Documentation and Examples

- Document ending consequences, cancelled unfinished rounds, Pointed story
  behavior, re-pointing, result columns, privacy exclusions, and repeated export
  from history.
- Add examples for empty Lobby end, active unfinished end, successful result
  export, and ended-session history.

## Dependencies

- US-010 defines the session lifecycle and active-session metadata.
- US-012 defines unfinished voting rounds.
- US-014 creates finalized results and Pointed stories.
- US-009 supplies reusable safe CSV serialization patterns where appropriate.

## Implementation Notes

- Compare-and-clear Active Session ID so an old client cannot erase a newer
  session's metadata.
- Derive export rows from immutable finalized round/story snapshots so later
  story edits do not rewrite session history.
- Revoke object URLs after download and clear anonymous reconnect tokens when
  ending is observed.
