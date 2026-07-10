# Skill: Implement GitHub Story

## Purpose

Implement one GitHub user story issue at a time and create a focused pull request that closes that issue.

This skill is intended for Codex or another coding agent.

## Inputs

Required:

- Repository owner/name
- Story issue number

Optional:

- Parent implementation-plan issue number
- Target branch
- Additional research doc paths
- Test command
- Build command

## Workflow

### 1. Read the story issue

```bash
gh issue view ISSUE_NUMBER --comments
```

Capture:

- User story
- Acceptance criteria
- UX requirements
- Implementation notes
- Out-of-scope items
- Linked parent issue

### 2. Read parent implementation-plan issue if available

```bash
gh issue view PARENT_ISSUE_NUMBER --comments
```

Use parent issue only for shared context.

Do not implement sibling sub-issues unless required by the current story.

### 3. Read referenced docs

Read any linked research, decisions, or implementation notes.

### 4. Inspect the codebase

Identify:

- Relevant files
- Existing patterns
- Test setup
- Naming conventions
- UI/component conventions
- API/data conventions

### 5. Create a branch when authorized

Do not treat a request to implement an issue as automatic authorization to
create a branch. Follow the repository's `AGENTS.md` and the user's requested
workflow boundary.

```bash
git checkout -b feature/ISSUE_NUMBER-short-description
```

### 6. Implement the smallest complete change

Rules:

- Satisfy the story acceptance criteria.
- Avoid unrelated refactoring.
- Preserve existing architecture.
- Follow repo guidance such as AGENTS.md.
- Add or update tests when appropriate.
- Update docs only when the issue requires it.

### 7. Validate

Run the relevant build/test/lint commands.

If commands fail because of pre-existing issues, document that clearly in the PR.

### 8. Commit

Commit only when the user explicitly authorizes a commit in the current request.
Follow the repository's commit standards and use its `$commit` skill when one is
available. Do not treat this implementation workflow as commit authorization.

Example Conventional Commit title:

```text
feat(SCOPE): implement ISSUE_TITLE
```

### 9. Create PR when authorized

Create a pull request only when the requested workflow authorizes changing
GitHub state and the branch contains the complete validated implementation.

PR body format:

```md
## Summary

- ...

## Issue

Closes #ISSUE_NUMBER

## Validation

- [ ] npm test
- [ ] npm run build
- [ ] Manual validation

## Notes

- ...
```

Create the PR:

```bash
gh pr create --title "ISSUE_TITLE" --body-file ./tmp/pr-body.md
```

## Output

Return:

- PR URL
- Issue number closed by the PR
- Validation completed
- Any limitations or follow-up issues
