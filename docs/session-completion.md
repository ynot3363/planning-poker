# Session Completion and Result Export

Only a current team host may end the open Lobby or Active voting session. The
end command runs as one Fluid transaction: it cancels an unfinished Voting or
Revealed round, stops its timer, records the end actor and time, changes the
session to Ended, clears `activeRoundId`, and compare-and-clears the root
`openSessionId`. SharePoint Active Session ID metadata is refreshed only after
Fluid acknowledges the mutation. Retrying after a metadata failure is safe.

Ended sessions are immutable. Participants cannot rejoin them, while current
hosts may open an ended-session link or select an entry under a team's Ended
sessions list to view the read-only completion screen. Finalized stories remain
Pointed; cancelled unfinished stories remain Ready.

The Voting team card shows the two most recent ended sessions with timestamps
through minute precision. **View session history** opens a dedicated,
bookmarkable team route containing every ended session available to the current
host; selecting an entry opens its read-only completion screen.

The focused session screen shows a privacy-safe Voted stories table as soon as
rounds are finalized. The table remains available on the completion screen and
includes the captured story title, assigned points, total vote count, and
finalization time for quick reference.

## Export

The completion screen offers **Export Results CSV** only when the session has at
least one finalized round. The export uses the round's immutable story snapshot
and contains exactly these columns:

- Session ID
- Team ID
- Team Title
- Story ID
- Story Title
- Story Link
- Assigned Point Value
- Total Votes
- Vote Breakdown
- Finalized On

Vote Breakdown contains scale-ordered aggregate counts. The export never
contains participant names, emails, object or SharePoint IDs, aliases,
participant IDs, or individual vote records. CSV output uses a UTF-8 BOM,
quoted escaping, multiline support, spreadsheet-formula protection, and the
filename `<Team Title>-session-<Session ID>-results.csv`. Object URLs are
revoked immediately after the browser download begins.
