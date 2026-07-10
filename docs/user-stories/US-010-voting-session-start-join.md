# US-010: Start and Join a Voting Session

## User Story

As a team host, I want to prepare and start one shareable voting session so
authenticated participants can join the correct team experience before voting
begins.

## Description

Build the voting-session lifecycle entry point. A host chooses an active hosted
team and prepares a unique Lobby session. The Lobby provides a share link and
allows participants to join, but no story can receive votes until the host uses
Start Voting to transition the session to Active.

Only one Lobby or Active session may exist per team. Authenticated site users
who can access the web part/library may join through the link whether they are a
configured member or an ad hoc invitee. The direct link opens US-004 focused
mode and contains opaque team/session IDs rather than titles or drive IDs.

## Public API

Provide typed commands and routes for:

- `prepareSession(teamId)` creating a Lobby with a unique session ID;
- `startVoting(sessionId)` transitioning Lobby to Active;
- `resolveSessionLink(teamId, sessionId)`;
- `joinSession(teamId, sessionId)`;
- `shareSessionLink(sessionId)` using supported browser share/copy behavior;
- read-only session context with team summary, settings snapshot, host status,
  participant status, and connection state.

## Acceptance Criteria

- The normal Voting destination lists active teams hosted by the current user
  and identifies any existing Lobby/Active session.
- A host can prepare a Lobby only for an active team and only when no open
  session already exists.
- Lobby creation generates immutable session ID, snapshots mode/scale/timer
  settings, records the host/time, sets Active Session ID metadata, and waits
  for durable save acknowledgement.
- The Lobby clearly states that voting has not started and exposes Start Voting
  as the host's primary action.
- Start Voting is host-only, transitions Lobby to Active exactly once, and is
  synchronized for every joined client.
- A share action is available to hosts and joined participants in Lobby and
  Active states, preferring the browser share API with accessible copy-link
  fallback.
- The link uses validated namespaced team/session query parameters, hides the
  navigation rail, and never exposes tokens, drive IDs, personal data, or
  anonymous reconnect keys.
- Any authenticated site user with underlying library access may resolve the
  link and join; an invalid, deleted, inactive, ended, inaccessible, or schema-
  incompatible target shows an explicit non-destructive state.
- Configured membership is displayed as team context but does not reject an ad
  hoc authenticated invitee.
- Participants cannot select stories, cast votes, control the timer, reveal, or
  end the session. Hosts cannot perform Active-only actions while still in the
  Lobby.
- Concurrent Lobby creation is transactionally guarded so only one open session
  wins and all clients converge on its ID.
- Refresh/reconnect resolves the same open session and preserves focused mode.
- Page headings, session status, share feedback, and transition announcements
  meet US-004 and WCAG 2.2 AA requirements.

## Tests

- Unit-test session transition guards, active-team requirement, unique IDs,
  setting snapshots, route validation, and share URL generation.
- Service-test concurrent prepare attempts, metadata synchronization, durable
  save, refresh, reconnect, invalid link, and ended-session resolution.
- Component-test host and participant Lobby states, Start Voting, share/copy,
  blocked actions, inactive team, existing session, and error recovery.
- Two-client tests verify synchronized Lobby-to-Active transition.

## Documentation and Examples

- Document Prepare Session, participant invitation, Start Voting, focused links,
  and the distinction between configured members and ad hoc invitees.
- Add examples for host Lobby, participant Lobby, invalid link, and reconnect.

## Dependencies

- US-001 defines session states and setting snapshots.
- US-003 resolves direct team/session documents.
- US-004 owns focused-voting routing.
- US-005 supplies active hosted teams and configured members.

## Implementation Notes

- Use the Web Share API only after capability detection and a user gesture;
  always provide a clipboard/manual-copy fallback.
- Do not use the team title as a durable route key.
- Treat Activity/Active Session metadata as an index and verify the session in
  Fluid after loading.
