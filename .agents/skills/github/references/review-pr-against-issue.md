# Skill: Review Pull Request Against GitHub Issue

## Purpose

Review a pull request against the GitHub issue it claims to close.

This skill is intended to check whether a PR satisfies the issue acceptance criteria before merge.

## Inputs

Required:

- Repository owner/name
- Pull request number

Optional:

- Issue number, if not discoverable from PR body
- Parent implementation-plan issue number
- Test/build commands

## Workflow

### 1. Read the PR

```bash
gh pr view PR_NUMBER --comments
```

Capture:

- Summary
- Linked issue
- Files changed
- Validation notes
- Known limitations

### 2. Read the linked issue

```bash
gh issue view ISSUE_NUMBER --comments
```

Capture:

- Acceptance criteria
- UX requirements
- Implementation notes
- Out-of-scope items

### 3. Inspect diff

```bash
gh pr diff PR_NUMBER
```

Review:

- Whether the implementation matches the issue scope
- Whether acceptance criteria are covered
- Whether unrelated changes were included
- Whether tests/docs were updated as needed

### 4. Validate locally if possible

Run relevant commands, for example:

```bash
npm test
npm run build
npm run lint
```

### 5. Produce review

Recommended output:

```md
## PR Review

PR:
- #...

Linked issue:
- #...

## Acceptance criteria check

| Criteria | Status | Notes |
|---|---|---|
| ... | Pass/Fail/Partial | ... |

## Scope check

- In scope:
- Out of scope concerns:

## Validation

- ...

## Recommendation

Approve / request changes / needs clarification

## Suggested comments

...
```

## Rules

- Do not approve changes that fail the stated acceptance criteria.
- Flag unrelated refactoring.
- Flag missing tests when the issue implies testable behavior.
- Do not merge unless explicitly instructed.
