# Skill: Release Version

## Purpose

Prepare and create a GitHub release from merged PRs and completed issues.

This skill should be used only when explicitly instructed.

## Inputs

Required:

- Repository owner/name
- Version number or release name
- Target branch

Optional:

- Milestone
- Date range
- Include closed issues
- Include merged PRs
- Build/test commands
- Release notes format

## Workflow

### 1. Confirm repo and branch

```bash
gh repo view
git branch --show-current
git status
```

### 2. Collect merged PRs

Use GitHub CLI to collect merged PRs since the last release or from the target milestone.

```bash
gh pr list --state merged
```

### 3. Collect completed issues

Collect issues closed by merged PRs or assigned to the milestone.

```bash
gh issue list --state closed
```

### 4. Draft release notes

Recommended format:

```md
## Highlights

- ...

## Features

- ...

## Fixes

- ...

## Documentation

- ...

## Internal changes

- ...

## Validation

- ...
```

### 5. Validate

Run relevant build/test/lint commands.

### 6. Create tag/release only when explicitly instructed

```bash
gh release create VERSION --title "VERSION" --notes-file ./tmp/release-notes.md
```

## Output

Return:

- Release URL
- Version
- Included PRs
- Included issues
- Validation results
