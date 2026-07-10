# Commit standards

**Status:** Required repository standard
**Last reviewed:** July 3, 2026

## 1. Purpose

Commits should tell a reviewer what changed, why it changed, which project area
was affected, and how the change was verified. Each commit must be independently
understandable and leave the repository in a valid state unless it is explicitly
labeled as work in progress.

A commit may affect one feature area, several related surfaces, shared
repository tooling, or documentation policy. The validation and scope recorded
in the commit must match that impact. Commit-time validation is scoped to the
changed project surfaces in the current worktree. Broad repository validation
runs on git push, pre-push hooks, CI, or by explicit request.

## 2. Commit boundaries

Create a commit after completing an independently testable user story, feature,
bug fix, documentation change, project setup, or requested checkpoint.

A commit must:

- contain one coherent purpose;
- include its directly related implementation, tests, stories, examples, and
  documentation;
- exclude unrelated working-tree changes;
- pass the validation required for its changed scope;
- avoid generated or temporary files unless they are intentional artifacts.

Split work when changes can be reviewed, reverted, and validated independently.
Keep work together when splitting it would create a broken intermediate state or
separate a contract change from the tests and documentation that define it.

Do not create empty "progress" commits. A WIP commit is permitted only when the
user explicitly asks for one; use the `wip` type and state what remains.

## 3. Message format

Use Conventional Commits:

```text
<type>(<scope>): <imperative summary>

<why the change was needed>

<important implementation, compatibility, project-area, or migration details>

Tests:
- <command>: <result>

Refs: <story, issue, or plan identifier>
```

The scope, body sections, and reference are included when useful. The type and
summary are always required.

### 3.1 Allowed types

| Type       | Use                                                           |
| ---------- | ------------------------------------------------------------- |
| `feat`     | New consumer-visible behavior, service, workflow, or component |
| `fix`      | Correction to documented or intended behavior                 |
| `docs`     | Documentation-only change                                     |
| `test`     | Test-only change                                              |
| `refactor` | Internal restructuring without intended behavior change       |
| `perf`     | Measured performance improvement                              |
| `style`    | Formatting-only change with no semantic effect                |
| `build`    | Build system, packaging, or dependency change                 |
| `ci`       | Continuous integration or automation change                   |
| `chore`    | Maintenance not represented by another type                   |
| `revert`   | Reversal of an earlier commit                                 |
| `wip`      | Explicitly requested incomplete checkpoint                    |

### 3.2 Scope

Use a short lowercase scope when it improves scanning. Prefer the owning feature
area, component, service, workflow, or repository area.

Scope examples:

```text
teams
team-list
planning-poker
estimation
planning
webpart
sharepoint
docs
agents
build
ci
release
```

Use the public component, service, workflow, or subsystem name. Do not use ticket
numbers, individual filenames, or vague scopes such as `misc`.

For changes that affect more than one area, use the shared area when one is
clear, such as `build`, `ci`, `docs`, `agents`, or `repo`. If no concise scope
helps, omit the scope and explain the affected areas in the body.

### 3.3 Title

The title must:

- use imperative mood: `add`, `prevent`, `document`, `remove`;
- describe the observable outcome rather than the activity performed;
- begin with a lowercase letter after the colon;
- omit a trailing period;
- remain at or below 72 characters;
- avoid filler such as "changes," "updates," "miscellaneous," or "WIP" unless
  the commit is explicitly type `wip`.

Good:

```text
feat(teams): add semantic validation messages
feat(sharepoint): add list item CRUD client
docs(agents): define repository workflow instructions
```

Avoid:

```text
updated files
feat: changes to forms.
fix(stuff): fixed issue
```

## 4. Commit body

Add a body when the title cannot fully explain motivation, behavior, tradeoffs,
or compatibility impact. Most feature and fix commits should have one.

The body should:

- explain why the change was necessary;
- describe notable behavior and design decisions;
- identify accessibility, security, API, migration, compatibility, or project
  boundary effects;
- name affected areas when the scope does not make them obvious;
- wrap prose at approximately 100 characters;
- avoid narrating every edited file.

Use a `Tests:` block to record verification performed for the committed state:

```text
Tests:
- npm run validate: passed
- npx prettier --check docs/COMMIT_STANDARDS.md: passed
```

Do not claim a command passed unless it ran successfully after the final
relevant change. If the user explicitly requests a commit with a known failure,
record it:

```text
Tests:
- npm run validate: failed - existing test configuration is incomplete
```

Use `Refs:` for user stories, issues, or plans when an identifier exists:

```text
Refs: US-142
```

When a user-story identifier is local to a catalog or could be ambiguous,
include the catalog name:

```text
Refs: user-stories/US-070
```

## 5. Breaking changes

Use `!` in the header and a `BREAKING CHANGE:` footer:

```text
feat(button)!: replace intent with appearance

BREAKING CHANGE: Button consumers must replace the `intent` prop with
`appearance`. See the migration guide for the mapping.
```

A breaking commit must include migration guidance and update relevant
documentation, tests, project metadata, release notes, and user stories.

Breaking changes may include module exports, TypeScript declarations, runtime
behavior, service method contracts, authentication or permission requirements,
design tokens, CSS contracts, browser/runtime support, validation gates, and
repository scripts.

## 6. Validation expectations

Run the smallest authoritative validation gate that covers the current worktree
changes for the commit:

- Use the project validation script when source, build, or runtime behavior is
  changed and the script exists, such as `npm run validate`, `npm test`, or the
  focused script documented for the affected area.
- Use focused root validation for workflow or policy files, lockfiles, shared
  tooling, CI/pre-push behavior, or repository documentation. Examples include
  Prettier checks for changed Markdown/config files, TypeScript or JavaScript
  syntax checks for changed scripts, and focused tests for changed repository
  automation.
- Use focused tests while developing, but record the final gate that validates
  the committed state.
- Reserve broad or slow all-repository gates for git push, pre-push hooks, CI,
  or an explicit user request when a focused gate already covers the commit.

If the change is documentation-only and no source validation is relevant, run a
formatting check for the changed documentation and record that command.

## 7. Staging and commit procedure

Before every commit:

1. Read this document.
2. Inspect `git status` and the complete working-tree diff, including untracked
   files.
3. Identify changes that belong to the current commit and the project or
   repository scope they affect.
4. Identify the affected areas and run the smallest relevant validation
   commands, plus any focused root checks required for changed root/shared
   files.
5. Stage files explicitly; never use `git add .`.
6. Inspect `git diff --cached`.
7. Write the message using this standard.
8. Create the commit.
9. Report the commit SHA, title, included scope, and validation results.

Git hooks are a safety net, not a replacement for this review.

## 8. Examples

```text
feat(teams): add team planning form validation

Keep planning inputs consistent while surfacing accessible validation messages
before a team estimate is saved.

Tests:
- npm run validate: passed

Refs: user-stories/US-207
```

```text
feat(sharepoint): add list item query support

Expose SharePoint list reads through a typed service so the web part can load
planning data without assembling REST URLs in React components.

Tests:
- npm run validate: passed

Refs: user-stories/US-004
```

```text
docs(agents): clarify repository workflow standards

Keep repository guidance focused on this project while agent skills own their
repeatable workflow details.

Tests:
- npx prettier --check AGENTS.md docs/*.md .agents/skills/*/SKILL.md: passed
```

```text
docs(repo): clarify commit-time validation scope

Keep validation focused on changed surfaces during commit creation and reserve
broad repository validation for git push and CI.

Tests:
- npx prettier --check AGENTS.md docs/COMMIT_STANDARDS.md .agents/skills/commit/SKILL.md: passed
```
