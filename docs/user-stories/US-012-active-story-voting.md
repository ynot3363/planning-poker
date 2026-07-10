# US-012: Select Stories and Cast Synchronized Votes

## User Story

As a voting-session participant, I want the host-selected story and allowed
point choices synchronized for everyone so I can review the same work item and
cast or change my vote before results are revealed.

## Description

In an Active session, let a host select one Ready story at a time. Create a
voting round and move the complete story into the primary session content for
every client. Joined participants vote with the session's scale snapshot and
may change their vote while the round remains Voting.

The UI may hide values before reveal, but the accepted shared-client security
model is not cryptographic secrecy: a technically capable library contributor
could inspect or alter compatible Fluid state. The application must still never
display pre-reveal values through supported UI or ordinary snapshots intended
for presentation.

## Public API

Provide typed commands/selectors for:

- list eligible Ready stories;
- host `selectStory(storyId)` creating one voting round;
- optional host `replaceStory(storyId)` only before the current round has votes;
- participant `castVote(roundId, scaleValue)` as an upsert;
- current active story snapshot and link;
- current participant's selected value;
- pre-reveal participation projection without other vote values.

## Acceptance Criteria

- Only a host may select a story and only while the session is Active.
- The selector contains Ready stories only and excludes Pointed, Archived, and
  any story already finalized in the current session.
- Selecting creates an immutable round ID, story snapshot, Voting state, and
  synchronized active-round pointer in one transaction.
- The active story's title, description, status/context, and optional link move
  into the primary content area for every host and participant.
- A validated story link opens in a new tab with `noopener noreferrer`; invalid
  persisted links are rendered as unavailable text rather than unsafe anchors.
- Before any vote, the host may replace the active story after confirmation,
  cancelling the earlier round and leaving its story Ready. Once any vote
  exists, the round must be revealed/finalized or cancelled by ending the
  session.
- Joined participants see one accessible selection control per ordered scale
  value from the immutable session snapshot.
- Built-in scales exactly match US-001; custom scale order is preserved.
- Casting creates one vote for the current participant. Casting again replaces
  that participant's value and does not increase the voted count.
- Votes are accepted only from joined participants for the current round and
  only while its state is Voting; invalid, stale, or out-of-scale values are
  rejected at the mutation boundary.
- A participant can see and change their own selected value before reveal.
  Other participants' values and aggregate breakdown are not rendered.
- Named mode exposes voted/not-voted participation from US-011; Anonymous mode
  exposes only aggregate joined/voted/remaining counts.
- Hosts who joined as voters use the same vote contract; host capability alone
  does not create a vote.
- Round selection and votes synchronize across clients, survive refresh, and
  report connection/dirty/save state without claiming unsaved votes are durable.
- Long descriptions, links, scale wrapping, narrow layouts, keyboard selection,
  focus, and live vote-status announcements meet US-004 accessibility/design
  requirements.

## Tests

- Unit-test eligibility, round creation/replacement guards, scale validation,
  vote upsert semantics, stale round rejection, and pre-reveal projections.
- Component-test host selection, participant story view, safe/unsafe link,
  built-in/custom scales, initial vote, changed vote, blocked states, and
  named/anonymous participation.
- Multi-client tests verify active-story synchronization, vote-count updates,
  changed votes, reconnect, and concurrent votes.
- Assert through public presentation selectors that another participant's
  pre-reveal value is unavailable.

## Documentation and Examples

- Document story selection, voting/change behavior, scale display, and the
  difference between UI result hiding and a security boundary.
- Add examples for no active story, active story, long content, selected vote,
  disconnected vote, and both privacy modes.

## Dependencies

- US-007 supplies Ready stories and lifecycle guards.
- US-010 supplies Active session state.
- US-011 supplies joined voters and privacy-specific participation projections.

## Implementation Notes

- Render from plain read-model selectors designed for the current reveal state;
  do not pass the raw votes collection into pre-reveal presentation components.
- Use stable story, round, participant, and scale-value keys.
- Do not update SharePoint metadata for each vote.
