# Voting Participation

Planning Poker uses the voting mode captured when a session Lobby is prepared.
Changing the team's settings later does not change that open session.

## Named sessions

Joining publishes the minimum authenticated `UserReference` needed to identify
the participant. The session roster shows Fluent UI personas, connection state,
and whether each joined participant has voted in the active round. Vote values
remain hidden until the reveal workflow.

Configured team members and authenticated link invitees use the same join flow.
Only people who join the session are eligible voters; configured members who do
not join are not counted as remaining votes. A host may join as a voter without
changing their separate host capabilities.

## Anonymous sessions

Joining creates a durable opaque participant ID and assigns the next available
session alias, such as `Participant 1`. Shared Fluid session and participant
state does not store the participant's Entra object ID, login name, SharePoint
user ID, authenticated display name, or a mapping back to those values. Hosts
and other clients see joined, voted, and remaining counts rather than alias
rows. A participant sees only their own alias.

The browser keeps an opaque reconnect record in `sessionStorage` for the open
session. Refreshing in the same browser tab reclaims the existing participant
and alias. Closing the tab, clearing browser session data, blocking storage, or
otherwise losing that record creates a new anonymous participant on the next
join. The reconnect record is not placed in the URL or Fluid state.

Anonymous mode is an application data and presentation contract. It does not
provide network-level anonymity from Microsoft 365, SharePoint, tenant
administrators, or service telemetry involved in loading the web part and Fluid
document.

## Presentation examples

- Named roster: `Alex Morgan — Voted · Connected`.
- Anonymous host view: `5 joined · 3 voted · 2 remaining`.
- Anonymous participant view: `Your session alias is Participant 4` plus the
  same aggregate counts.
- Reconnect: the named identity or browser-local anonymous record selects the
  existing durable participant instead of adding a second roster row.
