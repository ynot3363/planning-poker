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

`castVote(roundId, scaleValue)` is an upsert keyed by the session participant
ID. The mutation boundary accepts a vote only when:

- the session is the open Active session;
- the participant has joined that session;
- the supplied round is the current `Voting` round; and
- the value exactly matches one entry in the session's ordered scale snapshot.

Changing a vote replaces the existing record and leaves the voted participant
count unchanged. Each accepted mutation waits for Fluid save acknowledgement.
Per-vote SharePoint metadata updates are deliberately avoided.

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
indicator. Selecting a card previews complete story details in the center
without changing the active round; host actions remain transactionally guarded.
The center also owns the ordered vote controls for the active story, separated
from the story details by spacing and a horizontal divider.

The right column contains the optional synchronized timer and participation.
Named mode groups Microsoft 365 LivePersona cards under Not voted, Voted, and
Disconnected headings. Anonymous mode shows counts only. The header contains
the team and voting-mode session title plus a `Copy Url` button whose tooltip
exposes the share URL without a persistent text field.
