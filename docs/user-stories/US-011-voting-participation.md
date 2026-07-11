# US-011: Manage Named and Anonymous Participation

## User Story

As a voting participant, I want to join with the privacy behavior selected by
the team so participation is clear without exposing my identity in anonymous
sessions.

## Description

Synchronize the joined roster for Lobby and Active sessions. In Named mode, use
the authenticated M365 identity and Fluent UI personas. In Anonymous mode,
allocate stable session aliases in join order (`Participant 1`, `Participant
2`, and so on), never publish or persist an authenticated identity mapping, and
show other users and hosts only aggregate participation counts.

The eligible voter set is the set of connected participants who have joined the
session, not every configured team member. Fluid Presence supplies ephemeral
heartbeat/attendee state without persisting an identity-to-alias mapping.
Disconnected Named participants remain visible but do not count as waiting;
disconnected Anonymous participants and their active unrevealed votes are
removed because their ephemeral attendee has left.

## Public API

Provide typed operations for:

- named join/rejoin keyed by stable authenticated object ID;
- anonymous join/rejoin keyed by a browser-scoped opaque random token that is
  never stored in shared Fluid state;
- synchronized joined and connection/presence state;
- ephemeral participant binding through Fluid Presence;
- current participant's local display identity;
- aggregate total/voted counts;
- named-mode participant rows with voted/not-voted state but no vote value.

## Acceptance Criteria

- Joining is available in Lobby or Active state and creates at most one logical
  roster entry for the current participant/reconnect identity.
- In Named mode, the app detects the authenticated user, publishes the minimum
  `UserReference`, and renders a persona/display name for each joined voter.
- Named participation shows who has and has not voted on the current round but
  hides every vote value until reveal.
- In Anonymous mode, a transaction assigns the next unused `Participant N`
  alias and prevents duplicate numbers under concurrent joins.
- The anonymous participant sees their own assigned alias; hosts and all other
  clients see only joined, voted, and remaining counts, not alias rows or M365
  identities.
- Anonymous SharedTree participant/vote/session records contain no Entra object
  ID, email, login name, SharePoint user ID, authenticated display name, or
  reversible link to those values.
- A random reconnect token may be kept in browser session storage for this
  session only; it contains no identity, is never placed in the URL or Fluid
  state, and is cleared when the session ends.
- Refresh in the same browser session reuses the opaque participant ID when
  possible; if Presence already removed that attendee, join recreates the
  participant and may allocate a new alias.
- Configured members and ad hoc authenticated link invitees use the same join
  flow; configured members who have not joined do not count as remaining votes.
- Hosts may also join as voters, but host capabilities and voter participation
  are distinct states.
- Audience/Presence heartbeat loss marks a Named participant Disconnected only
  after their last Fluid attendee disconnects. Disconnected Named participants
  remain visible, retain any vote, and do not count as waiting for reveal.
- Audience/Presence heartbeat loss removes an Anonymous participant and their
  active unrevealed vote. The ephemeral binding contains only session,
  participant, and mode identifiers and is never persisted in SharedTree.
- Lobby participants cannot vote; Active participants receive the voting UI
  only when a Ready story round is active.
- Roster/count changes use accessible live announcements without excessive
  interruption and use personas/avatars only in Named mode.

## Tests

- Unit-test named deduplication, anonymous alias allocation, reconnect-token
  behavior, aggregate counts, and eligible-voter derivation.
- Privacy tests recursively inspect anonymous persisted fixtures/snapshots and
  fail if authenticated identity fields or values appear.
- Concurrent-client tests verify unique sequential aliases, named disconnect,
  anonymous attendee removal, and synchronized aggregate participation.
- Component-test named personas, anonymous count-only UI, local alias, Lobby,
  Active, reconnect, disconnected, host-as-voter, and empty roster states.
- Test that vote values remain absent from pre-reveal named participation output.

## Documentation and Examples

- Explain what Named and Anonymous mean, including the anonymous reconnect
  limitation and the fact that anonymity is an application data/UI contract,
  not network-level anonymity from Microsoft 365 services.
- Add examples for named connected/disconnected rows, anonymous host counts,
  anonymous participant removal, and reconnect states.

## Dependencies

- US-001 defines discriminated participant records and privacy constraints.
- US-010 supplies Lobby/Active join and share-link context.

## Implementation Notes

- Never derive an anonymous alias from name, email, object ID, hash of identity,
  connection ID that can be correlated externally, or join-link parameter.
- Publish only the opaque session ID, participant ID, and voting mode through
  Fluid Presence. Keep Presence adapters separate from durable domain records
  and dispose them with the session view.
