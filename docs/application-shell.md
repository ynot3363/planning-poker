# Planning Poker Application Shell

The Microsoft 365 application shell is the shared presentation boundary for all
Planning Poker feature screens. It uses Fluent UI v8, SharePoint semantic theme
slots, CSS modules, logical layout properties, and native page landmarks. The
outer application frame uses rounded corners, a light semantic border, and
subtle elevation; its overflow is clipped so the rail and content backgrounds
follow the same silhouette.

## Navigation Map

| Destination | Purpose                                                  | Implemented feature story |
| ----------- | -------------------------------------------------------- | ------------------------- |
| Teams       | Create and manage teams and settings.                    | US-005 and US-006         |
| Stories     | Maintain Ready, Pointed, and Archived stories.           | US-007 through US-009     |
| Voting      | Join and participate in the current session.             | US-010 through US-015     |
| About       | Explain workflows, privacy, roles, results, and exports. | US-004                    |

The configured shell owns one semantic `main` region and a labeled navigation
rail. The rail can collapse to icon-only buttons; every collapsed button retains
an accessible label and tooltip. Route changes move focus to the main region so
keyboard and screen-reader users receive the new page context.

The rail footer renders the current user's SharePoint profile photo and display
name with Fluent UI Persona. In SharePoint Online, the Persona is enhanced with
the Microsoft 365 live persona card. That card is an internal SharePoint
component and may change independently; if it cannot load, the photo/name
Persona remains available without affecting navigation.

## Deep-Link Contract

Planning Poker shares the SharePoint page URL instead of using `BrowserRouter`.
The shell recognizes these namespaced query parameters:

| Parameter              | Values                                   |
| ---------------------- | ---------------------------------------- |
| `planningPokerView`    | `Teams`, `Stories`, `Voting`, or `About` |
| `planningPokerTeam`    | A bounded opaque team identifier         |
| `planningPokerSession` | A bounded opaque session identifier      |

A focused voting link contains `planningPokerView=Voting` plus valid team and
session identifiers. Focused mode hides the rail and provides a **Leave session**
action that removes the identifiers while preserving unrelated SharePoint query
parameters.

Unknown, malformed, and incomplete values fall back to a safe shell state with
a user-facing explanation. All web-part instances on a page observe the same
page-level Planning Poker route; deployments that require independent routes
should place the instances on separate pages.

## Visual State Examples

Expanded shell:

```text
┌────────────────────┬─────────────────────────────────────┐
│ Planning Poker  «  │ Teams                               │
│ Teams              │ Create and manage teams together.  │
│ Stories            │                                     │
│ Voting             │ ┌─────────────────────────────────┐ │
│ About              │ │ Empty, loading, error, or page │ │
│                    │ │ content card                   │ │
│ Current user       │ └─────────────────────────────────┘ │
└────────────────────┴─────────────────────────────────────┘
```

Collapsed and narrow shell:

```text
┌────┬──────────────────────────┐
│ »  │ Stories                  │
│ 👥 │ Prepare and organize...  │
│ ▤  │ ┌──────────────────────┐ │
│ ☑  │ │ Responsive content   │ │
│ ⓘ  │ └──────────────────────┘ │
└────┴──────────────────────────┘
```

Focused voting:

```text
┌─────────────────────────────────────────┐
│ Focused voting          [Leave session] │
│ Collaborate on the current story.       │
│ ┌─────────────────────────────────────┐ │
│ │ Synchronized session surface        │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

Dark and high-contrast modes use the same layout and meaning. Colors come from
SharePoint semantic slots; selected navigation, warnings, success, and errors
also include text, icons, borders, or `aria-current` rather than relying on color
alone. Narrow layouts keep the main region beside the rail, wrap commands below
the heading, and prevent content overlap. Right-to-left hosts are supported by
logical CSS properties.

## Shared Component Patterns

- `PageHeading` supplies one page `h1`, supporting guidance, and optional
  contextual commands.
- `CommandArea` groups supporting actions. Use at most one `PrimaryButton` for
  the most important action in the current context.
- `ContentCard` provides default, accent, success, warning, and danger tones.
- `StatusState` provides accessible loading, empty, success, warning, and error
  treatment. Errors use an assertive alert; routine status remains polite.
- `DestructiveConfirmation` uses a blocking dialog with an explicit consequence,
  destructive confirmation, and quieter cancellation.

Later feature stories should compose these primitives instead of recreating
navigation, cards, status messages, focus behavior, or confirmation treatment.

## Validation Matrix

Before release, exercise the expanded, collapsed, focused, loading, empty, and
error states in SharePoint, a Teams tab or personal app, and the SPFx full-page
host. Repeat critical navigation checks in dark theme, forced colors, a narrow
section, 200% text zoom, keyboard-only operation, and right-to-left rendering.
