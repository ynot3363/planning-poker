# US-028: Share Session Links Safely and Accessibly

## User Story

As a voting-session participant, I want a clean invitation link with several
accessible sharing options so I can invite teammates without copying unrelated
or sensitive page state.

## Description

Session sharing currently starts with the complete browser URL and changes only
Planning Poker parameters. Unrelated query parameters and fragments—including
OAuth codes, tokens, signatures, personal state, or another web part's values—
can therefore be copied into an invitation. The UI also relies on Clipboard API
success and provides no Web Share path or persistent selectable fallback.

Create a dedicated invitation-link builder separate from in-page route writing.
Build from trusted page origin/path plus validated Planning Poker IDs, discard
unapproved query/fragment state, and always render a manual-copy surface while
offering capability-detected Web Share and Clipboard conveniences.

## Public API

- Expose `buildSessionShareUrl(pageUrl, teamId, sessionId)` or an equivalent pure
  utility distinct from the route writer that preserves host-page state.
- Define a reviewed allow-list for any host query parameters that an invitation
  truly requires; default to carrying none from the current URL.
- Provide typed share, copy, manual-selection, success, unavailable, cancelled,
  and non-sensitive failure presentation states.

## Acceptance Criteria

- The invitation URL uses the trusted HTTPS origin and pathname plus validated
  `planningPokerView=Voting`, team ID, and session ID values.
- Arbitrary current query parameters and the complete fragment are excluded;
  common access/id/refresh tokens, OAuth codes, signatures, SAS/API-key values,
  personal identifiers, and encoded/mixed-case variants never survive.
- In-page route navigation continues preserving unrelated SharePoint parameters
  as documented; only the dedicated share builder applies the stricter policy.
- The focused session always displays a labeled read-only/selectable URL that
  remains available when browser share and clipboard capabilities are absent or
  denied.
- A user-gesture share action uses `navigator.share` after capability detection;
  cancellation is quiet and failure preserves the selectable fallback.
- A Copy link action uses Clipboard API when available, reports accessible
  success/failure without raw browser errors, and never removes the manual-copy
  option.
- Keyboard users can reach, focus, select, and copy the visible URL. Status
  announcements are concise and do not cause repeated live-region noise.
- Invalid or stale IDs never produce a shareable link.

## Tests

- Unit-test trusted URL construction and removal of unrelated, credential-like,
  encoded, duplicated, mixed-case query parameters and token-bearing fragments.
- Test valid/invalid bounded IDs, HTTPS enforcement, malformed page URLs, and
  any explicitly allow-listed host parameter.
- Component-test Web Share success/cancel/failure, Clipboard success/rejection/
  absence, manual selection, keyboard operation, and persistent fallback.
- Render share state in Lobby, Active, focused, and ended/invalid session views
  and run automated accessibility checks.

## Documentation and Examples

- Update application-shell and session-start guidance with the difference
  between route preservation and invitation construction, supported sharing
  capabilities, and manual fallback.
- Add examples proving sensitive page parameters and fragments are removed.

## Dependencies

- US-004 owns page routing and focused shell behavior.
- US-010 owns session-link creation and sharing.
- US-016 supplies the application token/credential handling policy.
- US-029 supplies multi-instance ID and form-control conventions used by the
  sharing surface.

## Implementation Notes

- Use the URL API with trusted base components; never sanitize by string
  replacement or copy `window.location.href` wholesale.
- Capability checks and Web Share calls must occur from the user gesture.
- Do not add a package or permission for browser sharing.
