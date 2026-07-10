# US-004: Build the Microsoft 365 Application Shell

## User Story

As a Planning Poker user, I want familiar and accessible navigation so I can move
between team administration, stories, voting, and help without leaving the web
part context.

## Description

Replace the generated SPFx welcome component with a responsive Fluent UI v8
application shell. The shell has a collapsible left navigation rail and a main
content region to its right. Navigation contains Teams, Stories, Voting, and
About destinations.

Voting deep links support a focused experience that hides the rail and gives
the session the available web-part surface. The shell must feel native to
Microsoft 365 and inherit the SharePoint theme rather than resembling an
unrelated standalone application.

## Public API

Define typed shell contracts equivalent to:

- `PlanningPokerView`: `Teams | Stories | Voting | About`.
- `IPlanningPokerRoute` with view, optional team ID, optional session ID, and
  focused-voting flag.
- A route parser/writer using namespaced SharePoint-page query parameters while
  preserving unrelated query parameters.
- `IApplicationShellProps` with route, navigation state, theme, configuration
  status, current user, and typed navigation callbacks.
- Shared layout primitives for page heading, command area, content cards,
  loading/empty/error states, and destructive confirmations.

## Acceptance Criteria

- A configured web part renders a left rail and a semantic main content region;
  an unconfigured web part renders only the US-002 configuration experience.
- The rail contains labeled, keyboard-operable Teams, Stories, Voting, and About
  choices with Fluent UI icons and a visible current selection.
- A labeled control collapses the rail to an icon-only state and expands it
  again; tooltips/accessibility labels preserve destination meaning while
  collapsed.
- Main content remains to the right of the rail, uses the remaining width, and
  does not overlap navigation at supported web-part widths or text zoom.
- A voting URL containing valid team and session identifiers opens Voting in
  focused mode with the rail hidden.
- Focused mode includes an accessible way to leave the session and return to the
  normal shell without corrupting unrelated SharePoint URL parameters.
- Invalid or incomplete route values fall back safely with a useful message;
  the web part does not use `BrowserRouter` or take ownership of SharePoint
  browser history.
- The About screen explains configuration, team setup, story management,
  session joining, named versus anonymous voting, results, exports, and the
  host/participant capability distinction.
- Fluent UI v8 components are imported from supported specific paths. The shell
  uses theme slots/CSS variables, CSS modules, and SharePoint theme variants.
- Visual treatment uses rounded cards, light borders, subtle shadows, blue
  primary actions, purple configuration/callout accents, green success, red
  destructive actions, amber warnings, and gray secondary controls without
  using color alone to communicate meaning.
- Primary actions are limited to the most important action in the current
  context; secondary actions use default/subtle button treatment.
- Navigation, focus changes, loading, errors, and route changes meet WCAG 2.2 AA
  keyboard, visible-focus, heading, landmark, contrast, zoom, and screen-reader
  expectations.
- Layout is validated in SharePoint, Teams tab/personal app, full-page app, dark
  theme, high contrast, narrow sections, and right-to-left rendering.

## Tests

- Component-test navigation selection, collapse/expand behavior, focused voting
  entry/exit, configuration gate, and invalid routes through accessible names.
- Unit-test route parsing/writing, validation, encoding, and preservation of
  unrelated query parameters.
- Run automated accessibility checks and keyboard tests for the shell and About
  screen.
- Add visual examples for expanded, collapsed, focused-voting, narrow, dark,
  loading, empty, and error states.

## Documentation and Examples

- Document the navigation map and namespaced deep-link contract.
- Provide component examples for shared page, card, command, status, and
  confirmation patterns so later stories reuse the same visual language.
- Add usage guidance distinguishing one primary action from supporting actions.

## Dependencies

- US-002 provides configured/unconfigured application state.
- `docs/coding-standards.md` governs SPFx routing, Fluent UI imports, theming,
  semantic HTML, and accessibility.

## Implementation Notes

- Keep route parsing in a pure utility and navigation ownership in one shell
  container.
- Prefer Fluent UI `Nav`, `CommandBar`, buttons, panels, dialogs, pivots, cards
  composed from layout primitives, and status/message components supported by
  v8; do not introduce a second design system.
- Do not hard-code theme colors solely to match the palette description. Map
  intent to semantic theme slots and verify custom tenant themes.
