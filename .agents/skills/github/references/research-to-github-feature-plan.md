# Skill: Research to GitHub Feature Plan

## Purpose

Convert research documents into GitHub user story issues and implementation-plan parent issues.

This skill supports the user's preferred workflow:

1. Research first
2. User story development second
3. Implementation planning third
4. GitHub Issues as execution tracking
5. PRs linked back to story issues

## Inputs

Required:

- Repository owner/name
- Research document paths
- Feature or product area name

Optional:

- Existing GitHub Project
- Target milestone or release
- Labels
- Personas
- Desired MVP boundary
- Constraints
- Non-goals
- Existing related issues

## Workflow

### 1. Read research docs

Read all referenced research files.

Extract:

- User needs
- Feature ideas
- Constraints
- Open questions
- UX requirements
- Technical considerations
- Risks
- MVP boundaries
- Future enhancements

### 2. Identify logical feature groups

Group the research into coherent feature areas.

For each feature group, define:

- Feature name
- Goal
- User value
- Included user stories
- Out-of-scope items
- Suggested implementation order

### 3. Draft user stories

Create one user story per independently implementable unit.

Story format:

```md
## User story

As a [persona], I want [capability], so that [benefit].

## Acceptance criteria

- [ ] ...
- [ ] ...
- [ ] ...

## Research / references

- docs/research/...

## UX / design requirements

- ...

## Implementation notes

- ...

## Codex scope

Implement only this story.
Do not make unrelated architecture changes.
Create a PR that closes this issue.

## Out of scope

- ...
```

Rules:

- Keep stories small enough for one focused PR.
- Prefer several small stories over one large story.
- Add clear acceptance criteria.
- Include links back to research docs.
- Avoid architectural decisions unless the research already requires them.

### 4. Create story issues first

Use the GitHub Repository Operations skill.

Recommended labels:

```text
type: feature
status: ready
```

For unclear stories, use:

```text
status: needs-refinement
```

### 5. Create parent implementation-plan issue second

After story issues are created, create one parent issue per logical feature group.

Parent issue format:

```md
## Goal

...

## Research / references

- ...

## User story sub-issues

- #...
- #...
- #...

## Suggested implementation order

1. #...
2. #...
3. #...

## Shared UX / design requirements

- ...

## Shared technical constraints

- ...

## Full feature acceptance criteria

- [ ] All sub-issues are complete
- [ ] All linked PRs are merged
- [ ] Docs are updated
- [ ] Manual validation is complete

## Codex instructions

Use this parent issue for shared feature context.
Implement one sub-issue at a time unless explicitly instructed otherwise.
Each PR should close the specific story issue it implements.

## Out of scope

- ...
```

Recommended labels:

```text
type: plan
status: planning
```

### 6. Attach stories as sub-issues

Use:

```bash
gh issue edit PARENT_ISSUE_NUMBER --add-sub-issue STORY_ISSUE_NUMBER
```

### 7. Add to GitHub Project if requested

If a project is supplied, add all created issues to the project.

### 8. Return final summary

Return:

```md
## Feature planning created

Parent plans:
- #...

Story issues:
- #...
- #...

Recommended first implementation:
- #...

Codex prompt:
...
```

## Codex prompt template

```text
Implement GitHub issue #ISSUE_NUMBER.

Use the issue body as the source of truth.
Read parent feature plan issue #PARENT_ISSUE_NUMBER for shared context.
Read these docs:
- docs/research/...

Create a PR that closes #ISSUE_NUMBER.
Do not implement unrelated sub-issues.
Do not make architecture changes outside this issue scope.
```
