# User Story Standards

**Status:** Required repository standard
**Last reviewed:** July 3, 2026

These standards define how agents and maintainers write, refine, and index user
stories in this repository. More-specific agent instructions may add
area-specific story requirements, but they should not weaken the repository-level
requirements in this document.

## Purpose

User stories are implementation contracts. They should give a future engineer or
agent enough context to build, test, document, and validate a feature without
re-litigating product intent.

A good story must be:

- scoped to one feature, a clearly named shared contract, or a repository
  workflow area;
- specific enough to implement;
- small enough to test independently;
- explicit about public API, behavior, accessibility, security, and validation
  expectations where relevant;
- connected to project documentation, examples, demos, or research notes as
  appropriate;
- indexed so future stories can reuse decisions and avoid duplicate
  infrastructure.

## Directory and Index

Store detailed project stories in the repository story catalog:

```text
docs/user-stories/
```

Maintain `docs/user-stories/index.md` as the quick-memory register. If a future
repository area adopts its own catalog, that catalog must follow this same
structure and preserve stable identifiers within the catalog.

Each index row must include:

- `ID`: stable identifier within the catalog, normally using the `US-###`
  format unless a catalog has adopted a documented prefix;
- `Title`: short feature, service, component, or workflow title;
- `Brief description`: one-sentence summary of the deliverable;
- `Reuse and dependency notes`: cross-story memory such as shared primitives,
  deferred APIs, known extraction points, sequencing dependencies, permission
  assumptions, endpoint decisions, or standards that future stories should
  honor.

Assign the next available sequential ID in that catalog. Do not renumber
existing stories. When referencing a story outside its catalog, include the
catalog name, such as `user-stories/US-070`.

Before creating or changing a story, read the owning catalog's index to identify
existing assumptions, rules, standards, private infrastructure, and dependency
notes that the work may affect. If a new or changed story introduces a decision
that impacts another component, service, workflow, or feature, update each
impacted detailed story or index entry in the same change.

## Story Shape

Every detailed user story must include these sections in this order:

1. `# US-###: Title`
2. `## User Story`
3. `## Description`
4. `## Public API`
5. `## Acceptance Criteria`
6. `## Tests`
7. `## Documentation and Examples`
8. `## Dependencies`
9. `## Implementation Notes`

Area-specific standards may rename `Documentation and Examples` to a more
specific required section when the area already has an established story format.
Omit a section only when it truly does not apply, and explain why in the story.

### User Story

Use one concise paragraph in this form:

```text
As a [specific consumer], I want [capability] so I can [outcome].
```

Prefer concrete actors such as SPFx developers, product developers, designers,
maintainers, page authors, team facilitators, or application users. Avoid
generic actors such as "user" when a more precise role is known.

### Description

Explain the current state, the intended change, and the relevant project or
system context. Include existing behavior, standards that shape the work, and
any meaningful product, accessibility, security, or compatibility motivation.

For UI component stories, explicitly call out:

- semantic HTML expectations;
- theme/token styling expectations;
- accessibility and keyboard behavior;
- localization, RTL, or long-content concerns when relevant;
- whether the story introduces private infrastructure or public API.

For service or utility stories, explicitly call out:

- transport or runtime expectations;
- authentication, permission, or tenant assumptions;
- API endpoint families or external system dependencies;
- caching, paging, throttling, error handling, and retry expectations;
- whether the story introduces public contracts, adapters, or private helpers.

### Public API

List public props, service methods, exports, types, slots, data attributes,
configuration options, adapters, or composition patterns that the implementation
must expose. Prefer platform and domain vocabulary already used by this project.

Call out deliberate non-APIs when they prevent future mistakes. For example,
state that a component uses native pointer events instead of a custom `onHover`
callback, or that a service exposes SharePoint REST and Graph methods as
separate namespaces rather than merging them into one ambiguous method.

### Acceptance Criteria

Write acceptance criteria as observable behavior. They should cover:

- public API shape and export behavior when API changes are included;
- semantic roles, accessible names, descriptions, states, and focus behavior for
  UI work;
- variants, sizes, states, and theming behavior for UI work;
- disabled, invalid, loading, empty, long-content, RTL, and keyboard behavior
  when relevant;
- endpoint selection, request shape, response normalization, paging, caching,
  throttling, and error behavior for service work;
- permission, authentication, and security boundaries where relevant;
- callback forwarding and event ordering when consumers may depend on it;
- required validation commands.

Avoid implementation-only criteria unless they protect a public contract,
project boundary, UI standard, security behavior, or compatibility
guarantee.

### Tests

Describe the tests required to protect the changed contract. Include unit,
component, interaction, accessibility, browser, service, serializer, fixture, or
compatibility coverage as appropriate.

Tests should assert behavior and public output rather than broad snapshots,
private DOM structure, generated class names, exact render counts, or incidental
request construction details that are not part of the contract.

For service work, prefer transport fakes, deterministic serializers, and
contract fixtures before live tenant integration tests. Live external-system
tests must be explicitly marked and must not be required for the ordinary local
unit-test loop unless the repository has documented credentials and isolation.

### Documentation and Examples

List the documentation, examples, demos, API notes, research notes, or migration
guidance required for the feature.

For public UI components, documentation or demos should cover:

- primary usage;
- supported appearances, sizes, and important states;
- long content and responsive behavior;
- disabled or unavailable behavior;
- keyboard and focus behavior for interactive components;
- do/don't guidance when misuse can harm accessibility or user experience.

For service work, documentation should cover:

- required setup and permissions;
- example calls for common use cases;
- endpoint or provider differences when multiple backends exist;
- caching and invalidation expectations;
- known API limitations or unsupported scenarios.

### Dependencies

Record dependencies on other stories, primitives, services, transports, theme
tokens, export work, research findings, project setup, tenant configuration, or
documentation decisions.

Distinguish between:

- public dependencies that must exist before implementation;
- private infrastructure that may be built inside the story;
- future extraction points that should be remembered but not published yet.

### Implementation Notes

Capture decisions that keep the story implementable without prescribing every
line of code. Include defaults chosen, rejected alternatives, migration notes,
test seams, project-boundary constraints, or constraints that prevent accidental
scope growth.

## Workflow for Agents

1. Use the repository `$user-story-writer` skill.
2. Read this document.
3. Identify the owning feature area or confirm that the story is repository-wide.
4. Read the root `AGENTS.md` and any more-specific `AGENTS.md` when one exists.
5. Read the coding, design, API, research, or architecture standards relevant to
   the affected area.
6. Read the owning catalog's `index.md` and any related story files.
7. Identify the smallest independently testable boundary.
8. Ask only for product decisions that cannot be inferred from the repo,
   repository standards, area standards, or existing story memory.
9. Scan the index for rules, assumptions, dependencies, or reuse notes that the
   new story may affect.
10. Draft or update the detailed story using the required story shape or the
    area's established compatible story shape.
11. Update any existing story whose assumptions, standards, dependencies, or
    reuse guidance are affected by the new work.
12. Update the owning catalog's `index.md` with the new or changed quick-memory
    entry.
13. Run Prettier on changed markdown files or verify formatting with
    `npx prettier --check`.
