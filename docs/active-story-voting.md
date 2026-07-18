# Active Story Voting

Story selection and voting are synchronized inside the team's existing Fluid
document. They do not create SharePoint list items or write per-vote discovery
metadata.

## Round Selection

Only a current team host can select a story, and the document-store transaction
rechecks that the session is the open Active session and the story is Ready.
Stories finalized earlier in the same session are excluded. Selection creates a
new immutable round identifier, captures the story title, description, and
optional link, sets the round to `Voting`, and updates `activeRoundId` in the
same transaction.

An active round can be replaced only while it is still `Voting` and has no
votes. Replacement marks the earlier round `Cancelled`; it does not change the
source story's Ready status. Once any participant votes, later stories must wait
for the reveal/finalization workflow.

## Vote Contract

`castVote(roundId, scaleValue)` submits an intent keyed by the session
participant ID. Each intent carries a stable operation ID, and a changed vote
names the prior canonical operation it supersedes. The mutation boundary
accepts a vote only when:

- the session is the open Active session;
- the participant has joined that session;
- the supplied round is the current `Voting` round; and
- the value exactly matches one entry in the session's ordered scale snapshot.

Changing a vote replaces the canonical record after reconciliation and leaves
the voted participant count unchanged. Retrying the same operation ID is
idempotent. If two clients submit sibling values for one participant, the
smallest operation ID by code-unit order wins deterministically; the repository
returns a safe conflict result when the submitted intent is not canonical.
Each accepted mutation waits for Fluid save acknowledgement. Per-vote
SharePoint metadata updates are deliberately avoided.

Simultaneous round selection is repaired by stable round ID: the smallest ID is
the active round and other unfinished siblings become `Cancelled`. This rule is
independent of timestamps and network delivery order.

The final connected participant's accepted vote reveals the round in the same
transaction. The same typed eligibility command also runs after Presence
disconnect/removal reconciliation and after converged tree changes, so a final
vote arriving from another client or the departure of the last non-voter cannot
leave an eligible round stuck in `Voting`. It requires at least one connected
participant and one valid, in-scale vote for every connected participant. Later
vote attempts are rejected because a `Revealed` round is frozen. Hosts may
reveal early after at least one vote; estimate assignment is a separate host
action described in `docs/voting-results.md`.

When final required votes were accepted independently before either client saw
the other, reconciliation performs the same Automatic reveal after their vote
slots merge. The reveal audit projection selects its vote by stable operation
ID, so it does not depend on delivery order or client clocks and does not record
a participant as the automatic reveal actor. Reconciliation is idempotent;
later passes recognize the frozen round without reopening it or producing a
second save.

## Pre-Reveal Privacy and Links

The supported UI exposes a participant's own selection and only voted/not-voted
participation state for others. Anonymous sessions expose aggregate counts and
the current browser's alias. Vote values are collaborative state, not
cryptographically secret from a technically capable library contributor, so
presentation selectors must remain the boundary used by application UI.

Story links are treated as untrusted when rendered, even though story-entry
validation already accepts only HTTPS and root-relative SharePoint paths.
Unsafe persisted values render as unavailable text. Safe links open in a new
tab with `noopener noreferrer`.

## Focused Voting Layout

The focused route uses a responsive 30/50/20 desktop grid. The left column is a
keyboard-operable story list with compact two-line description previews,
right-aligned color-coded status pills, and an independent active-round
indicator. The list contains Ready stories plus Pointed stories finalized in
the current session for result review; Pointed work from earlier sessions is
excluded. Selecting a card previews complete story details in the center
without changing the active round; host actions remain transactionally guarded.
The center also owns the ordered vote controls for the active story, separated
from the story details by spacing and a horizontal divider.

The right column contains the optional synchronized timer and participation.
Named mode groups Microsoft 365 LivePersona cards under Not voted, Voted, and
Disconnected headings. Anonymous mode shows counts only. The header contains
the team and voting-mode session title plus a `Copy Url` button whose tooltip
exposes the share URL without a persistent text field.
