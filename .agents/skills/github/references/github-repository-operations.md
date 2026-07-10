# Skill: GitHub Repository Operations

## Purpose

Provide reusable GitHub CLI operations that other skills can call when they need to interact with GitHub repositories.

This skill should be global to the machine or agent environment because the commands are not project-specific.

## Prerequisites

- GitHub CLI installed
- User authenticated with `gh auth login`
- Git installed
- Target repository cloned locally or accessible through `OWNER/REPO`

## Core rules

- Prefer GitHub CLI over raw GitHub REST API calls.
- Never assume the current repo. Confirm it with `gh repo view` or set it explicitly.
- Use issue and PR URLs or numbers in all summaries.
- Do not merge, close, or delete anything unless explicitly instructed.
- When creating PRs, include issue-closing keywords only when the PR fully satisfies that issue.
- Keep one PR focused on one story issue unless instructed otherwise.

## Repository context

Set the active repo:

```bash
gh repo set-default OWNER/REPO
```

View current repo:

```bash
gh repo view
```

## Issues

Create issue:

```bash
gh issue create --title "TITLE" --body-file ./path/to/body.md --label "type: feature"
```

View issue:

```bash
gh issue view ISSUE_NUMBER --comments
```

Edit issue:

```bash
gh issue edit ISSUE_NUMBER --title "NEW TITLE" --body-file ./path/to/body.md
```

Comment on issue:

```bash
gh issue comment ISSUE_NUMBER --body-file ./path/to/comment.md
```

Close issue:

```bash
gh issue close ISSUE_NUMBER --comment "Closing reason."
```

Reopen issue:

```bash
gh issue reopen ISSUE_NUMBER
```

Attach existing sub-issue to parent issue:

```bash
gh issue edit PARENT_ISSUE_NUMBER --add-sub-issue CHILD_ISSUE_NUMBER
```

## Labels

Create label:

```bash
gh label create "type: feature" --description "Feature work" --color "1D76DB"
```

List labels:

```bash
gh label list
```

Apply labels to an issue:

```bash
gh issue edit ISSUE_NUMBER --add-label "type: feature,status: ready"
```

## Pull requests

Create PR:

```bash
gh pr create --title "TITLE" --body-file ./path/to/pr-body.md --base main --head BRANCH_NAME
```

View PR:

```bash
gh pr view PR_NUMBER --comments
```

Check PR status:

```bash
gh pr checks PR_NUMBER
```

Mark draft PR ready:

```bash
gh pr ready PR_NUMBER
```

Merge PR only when explicitly instructed:

```bash
gh pr merge PR_NUMBER --squash --delete-branch
```

## Branches

Create and switch branch:

```bash
git checkout -b feature/ISSUE_NUMBER-short-description
```

Recommended branch format:

```text
feature/42-csv-import
bugfix/57-voting-results-export
docs/63-update-readme
```

## Projects

List projects:

```bash
gh project list --owner OWNER
```

Add issue to project:

```bash
gh project item-add PROJECT_NUMBER --owner OWNER --url ISSUE_URL
```

## Releases

Create release only when explicitly instructed:

```bash
gh release create v1.0.0 --title "v1.0.0" --notes-file ./path/to/release-notes.md
```

## Output format

When this skill completes an operation, return:

```md
## GitHub operation completed

Repository:
- OWNER/REPO

Created/updated:
- Issue/PR/release URL

Next recommended action:
- ...
```
