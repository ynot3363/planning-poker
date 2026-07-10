# Repository Agent Instructions

These instructions apply to the entire repository. A more-specific `AGENTS.md`
inside a package or directory may add requirements for that area but must not
weaken the repository-wide standards in this file.

## Required Reading

Before planning or changing implementation code, read these files completely:

1. `docs/architecture.md` for system boundaries, runtime flow, storage,
   permissions, Fluid synchronization, and production-hardening expectations.
2. `docs/coding-standards.md` for compatibility, project organization, React,
   TypeScript, accessibility, security, testing, linting, and formatting rules.

Do not rely on summaries or prior-session memory in place of reading the current
files. Re-read the relevant standards when the task scope changes. Also read any
more-specific `AGENTS.md` and package documentation that governs the files being
changed.

Before creating or changing a user story, read these files completely:

1. `docs/USER_STORY_STANDARDS.md`.
2. The applicable user-story catalog index and related stories.
3. The standards and agent instructions for the owning package or repository
   area.

The current canonical story catalog is `docs/user-stories/`. Package-owned
stories may live at `packages/<workspace>/docs/user-stories/` when that package
has its own catalog, as described by `docs/USER_STORY_STANDARDS.md`. Treat each
catalog's `index.md` as project memory: preserve stable IDs and update reuse,
dependency, and sequencing notes when decisions change.

Before staging or committing any change, read
`docs/COMMIT_STANDARDS.md` completely and follow the Commit Policy below.

## Repository Skills

Reusable agent workflows live in `.agents/skills/`. Read the applicable skill
file completely before using it and follow repository standards when a generic
workflow conflicts with repository-specific guidance.

### `$commit`

Location: `.agents/skills/commit/SKILL.md`

Creates focused, validated Conventional Commits. Use it whenever the user
explicitly asks to stage or commit changes. It requires inspecting the complete
worktree and staged diffs, preserving unrelated changes, validating only the
affected package or focused root surface, staging explicit paths, and reporting
the resulting commit.

### `$user-story-writer`

Location: `.agents/skills/user-story-writer/SKILL.md`

Creates, refines, and indexes implementation-ready user stories. Use it for any
request to create or update user stories, analyze story dependencies, or
maintain a user-story index. It requires reading the story standards and
relevant catalog memory, preserving story IDs, updating affected dependency
notes, and checking changed Markdown formatting.

### `$github`

Location: `.agents/skills/github/`

Provides GitHub CLI workflows for repository operations, research-to-feature
planning, single-issue implementation, pull-request review, and releases. Use it
when a request requires inspecting or changing GitHub repository state. Its
`SKILL.md` routes agents to these focused references:

- `references/github-repository-operations.md` provides shared `gh` workflows for
  repositories, issues, labels, pull requests, projects, branches, and releases.
  It requires confirming the repository and prohibits merging, closing,
  deleting, or releasing without explicit instruction.
- `references/research-to-github-feature-plan.md` converts research into independently
  implementable story issues and parent implementation-plan issues.
- `references/implement-github-story.md` implements one GitHub issue at a time, validates
  it, and opens a focused pull request that closes the issue. A request to
  implement a story does not override this repository's commit authorization
  policy; obtain explicit current-request authorization before committing.
- `references/review-pr-against-issue.md` checks a pull request against its linked issue,
  acceptance criteria, scope, tests, and documentation. It does not authorize a
  merge.
- `references/release-version.md` prepares release notes and creates a GitHub release only
  when explicitly instructed.

## Definition of Done

Work is done only when all applicable conditions are satisfied:

- The delivered change matches the requested scope and all applicable user-story
  acceptance criteria; unrelated user changes remain untouched.
- The implementation follows `docs/architecture.md`,
  `docs/coding-standards.md`, applicable package guidance, and established local
  patterns. Any necessary exception is documented with its reason.
- Public contracts, types, exports, permissions, security boundaries,
  accessibility behavior, and compatibility requirements are handled where the
  change affects them.
- Tests are added or updated for changed behavior and emphasize observable
  contracts rather than implementation details.
- Changed components, services, scripts, and package contracts pass an
  appropriate smoke test and the smallest authoritative validation gate for the
  affected surface.
- Required documentation, examples, user stories, indexes, migration notes, and
  dependency or reuse memory are updated with the implementation.
- Generated artifacts, temporary diagnostics, secrets, credentials, and
  unrelated formatting churn are not included.
- The final diff is reviewed for correctness, scope, and accidental changes.
- Known limitations, unrun checks, and validation failures are reported clearly;
  work with an unresolved required gate is not represented as complete.
- A commit is created only when the user explicitly authorizes it under the
  Commit Policy. Commit creation is not otherwise part of the definition of
  done.

## Commit Policy

Read `docs/COMMIT_STANDARDS.md` before staging or committing changes.

Use the repository `$commit` skill whenever the user explicitly asks to commit.

Do not create commits unless the user explicitly asks for a commit in the
current request. Implementation tasks framed as a user story, feature, or
implementation plan do not authorize commits by default. Completing a
component, service, bug fix, implementation boundary, or validation run is not
enough by itself to create a commit.

When the user explicitly authorizes a commit, create a commit:

- after an independently testable user story is complete;
- after a coherent feature or bug fix is complete;
- at an explicitly requested checkpoint;
- whenever the user explicitly asks for a commit.

Do not create a commit:

- for incomplete or failing work unless the user explicitly requests a WIP
  commit;
- before changed components, services, scripts, or package contracts have been
  smoke tested;
- while the required package-scoped or focused root commit-time validation gate
  is failing;
- with unrelated user changes;
- by staging the entire worktree without first inspecting each changed file.

Keep commits focused and reviewable. A user story may use more than one commit
when it contains independently meaningful changes, but do not fragment one
atomic change merely to increase commit frequency.

When a commit is authorized:

1. Inspect `git status --short`, all relevant tracked and untracked changes, and
   the complete diff.
2. Identify the owning package or coherent root scope and preserve unrelated
   user work.
3. Run the smallest authoritative package-scoped or focused root validation
   gate. Do not run the full monorepo validation gate unless explicitly
   requested; reserve it for push, pre-push, or CI workflows.
4. Stage only explicit paths. Never use `git add .`.
5. Inspect `git diff --cached` before committing.
6. Use a Conventional Commit title and body that follow
   `docs/COMMIT_STANDARDS.md`. Do not amend or rewrite history without explicit
   authorization.
7. Report the commit SHA, title, included scope or files, and validation results.

## Working-Tree Safety

- Treat pre-existing tracked and untracked changes as user-owned unless the
  current task clearly created them.
- Do not discard, overwrite, stage, or commit unrelated work.
- Avoid destructive Git and filesystem operations unless the user explicitly
  requests them and their impact has been verified.
- Prefer focused changes and validation. Do not perform opportunistic refactors
  outside the requested scope.

## Lessons Learned

Use this section as durable repository memory for lessons discovered during
coding sessions. Add an entry only when it is specific, verified, and likely to
help future work. Prefer actionable guidance over a chronological work log.

Each lesson should include:

- the date and affected area;
- the observed symptom or context;
- the verified lesson or root cause;
- the action future contributors should take;
- links to relevant files, stories, issues, or tests when available.

If a lesson establishes a lasting mandatory rule, update the authoritative
architecture, coding, user-story, or commit standard as well. Do not let this
section silently override those documents. Remove or revise lessons when the
underlying constraint no longer applies.

### Entries

<!--
#### YYYY-MM-DD - Area: concise lesson title

- Context: What happened or what symptom was observed.
- Lesson: The verified root cause or reusable insight.
- Action: What future contributors should do.
- References: Relevant paths, story IDs, issue/PR links, or validation commands.
-->
