# US-006: Deactivate and Delete Teams

## User Story

As a team host, I want to deactivate a team for temporary retention or delete it
when it is no longer needed so obsolete teams do not remain in active workflows.

## Description

Keep deactivation and deletion intentionally different. Deactivation is the
reversible `isActive` setting from US-005 and preserves the Fluid file in place.
Deletion is destructive from the application perspective and sends the team's
`.fluid` file, including all stories and session history, to the SharePoint site
recycle bin so site administrators retain SharePoint's normal recovery path.

## Public API

Provide a host-only `deleteTeam(teamId)` repository operation returning the
SharePoint recycle-bin item identifier when available. Expose typed outcomes
for confirmation cancelled, open session, not found, access denied, recycle
failure, and success.

## Acceptance Criteria

- Every hosted team exposes Deactivate/Activate as a normal configuration action
  and Delete as a visually destructive secondary/menu action.
- Delete opens an accessible confirmation dialog naming the team and explaining
  that stories, votes, and session history will leave the app and be recoverable
  only through the SharePoint recycle bin while retained there.
- The confirmation requires an explicit destructive action and restores focus
  appropriately on cancel or completion.
- Only a current Fluid-record host can invoke deletion through the UI/service
  guard.
- A team with a Lobby or Active session cannot be deleted; the host must end the
  session first.
- Confirmed deletion uses SharePoint's recycle operation for the `.fluid` file;
  it does not permanently delete the file or merely remove metadata.
- Successful deletion removes the team from the local list/selection and safely
  routes away from stale team, story, or voting views.
- Failed deletion retains the team in UI state and offers a useful retry path
  without claiming success.
- Deactivation never recycles or deletes data, and inactive teams remain visible
  to their hosts for reactivation and story/history review.
- The accepted library permission model and SharePoint recycle-bin retention
  behavior are documented; the app does not promise that only hosts could call
  SharePoint APIs outside the UI.

## Tests

- Unit-test host guard, open-session guard, and error normalization.
- Component-test confirmation, cancel, keyboard/focus behavior, blocked session,
  success navigation, failure, and retry.
- Service-test that deletion calls recycle rather than permanent delete and
  returns/records the recycle-bin identifier.

## Documentation and Examples

- Explain when to deactivate versus delete and how a site administrator can use
  the recycle bin for recovery.
- Document that restoring a recycled file outside the app may require metadata
  and configuration validation before it reappears.

## Dependencies

- US-003 provides the recycle repository operation.
- US-005 provides team activity and host management.
- US-010 defines the open-session states that block deletion.

## Implementation Notes

- The open-session guard creates a forward dependency on US-010; until that
  story exists, treat any non-empty open-session ID as blocking.
- Do not cascade separate deletes because team-owned data lives in the same
  Fluid document.
