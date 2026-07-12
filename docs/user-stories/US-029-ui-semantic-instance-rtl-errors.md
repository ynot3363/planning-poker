# US-029: Make the UI Multi-Instance, Semantic, RTL, and Form-Error Safe

## User Story

As a Planning Poker user in any supported SharePoint layout or assistive
technology, I want unambiguous landmarks, labels, direction, and validation
associations so every web-part instance is understandable and operable.

## Description

Focused Voting currently renders a `main` landmark inside the shell's `main`.
The shell, voting panels, results/timer headings, and CSV input also use fixed or
view-derived IDs that collide when two web parts share a page. The shell forces
`dir="auto"`, which can override an RTL host, and some Team form errors are
visually/live announced without a durable programmatic relationship to their
controls.

Introduce one stable per-instance ID namespace, preserve the shell's landmark
ownership, inherit host direction with logical styling/icons, and associate
every custom validation error with its control.

## Public API

- Add a stable `instanceId`/ID-prefix contract at the web-part-to-shell boundary
  and pass it to components that create DOM IDs or ARIA references.
- Keep exactly one shell-owned `main` landmark for a configured instance;
  feature layouts use labeled sections/regions beneath it.
- Reuse a private ID helper/context rather than exposing generated DOM IDs as
  feature business APIs.
- Preserve typed Team form validation while exposing stable control/error IDs,
  `aria-invalid`, and `aria-describedby` relationships.

## Acceptance Criteria

- Rendering the complete focused shell produces one non-nested `main` landmark;
  Voting uses an appropriately headed/labeled section or neutral container.
- Two configured web-part instances in one document have no duplicate IDs and
  every `aria-labelledby`, `aria-describedby`, label `for`, and layer/panel
  reference resolves within the correct instance.
- The instance namespace covers shell/page headings, story details/list,
  participation, results, timer, CSV upload, panels, and all current fixed IDs.
- The application inherits SharePoint's `dir` instead of forcing `auto` or LTR.
  Selected indicators use logical inline sides and collapse/expand icons reflect
  the effective direction.
- Layout and reading order remain correct in LTR and RTL at narrow widths, 200%
  text zoom, high contrast, and supported SharePoint/Teams hosts.
- People-picker, custom-scale, and timer errors have stable IDs and are linked to
  the relevant control with invalid state; returning focus to the control makes
  its current error discoverable.
- Dynamic error updates use an appropriate live region without relying on that
  one-time announcement as the only association.
- No change weakens accessible names, keyboard behavior, visible focus, or
  theme-token styling.

## Tests

- Render the full shell in normal and focused routes, assert landmark structure,
  and run automated accessibility validation.
- Render two complete instances together, assert globally unique IDs and
  instance-correct accessible names/descriptions, then run axe.
- Component-test inherited RTL direction, logical selected indicator,
  direction-aware controls, keyboard navigation, and narrow/zoom behavior.
- Test Team form validation with screen-reader queries for people, scale, and
  timer controls before, during, and after error correction.
- Include manual keyboard, supported screen-reader, RTL host, forced-colors, and
  200% zoom checks in the release validation matrix.

## Documentation and Examples

- Update application-shell, team-management, CSV import, and voting UI guidance
  with landmark ownership, instance ID namespacing, RTL inheritance, and error
  association patterns.
- Add two-instance, focused-voting, RTL, invalid-form, narrow, and high-contrast
  examples.

## Dependencies

- US-004 owns shell landmarks, theming, focus, and layout patterns.
- US-005 owns Team form controls and validation.
- US-008 owns the CSV file input.
- US-010 through US-014 own focused Voting panels and headings.
- US-028 owns the accessible sharing surface.

## Implementation Notes

- SPFx supplies a stable web-part instance identifier; normalize it for DOM use
  rather than relying on React 18-only APIs in this React 17 project.
- Use CSS logical properties and the effective host direction instead of
  hard-coded left/right assumptions.
- Prefer native semantic elements and labels before adding ARIA.
