---
name: github
description: Operate GitHub repositories with the GitHub CLI, including issue and pull-request work, research-to-feature planning, implementing a single story through a focused PR, reviewing a PR against its linked issue, and preparing releases. Use when Codex is asked to inspect or change GitHub repository state, turn repository research into GitHub issues or plans, implement a GitHub issue, review a PR, or draft or create a release.
---

# GitHub Workflows

Use `gh` for GitHub operations and Git for local repository work. Confirm the
target repository before acting; never infer it solely from the current
directory.

## Prepare

1. Read the repository's `AGENTS.md` files and applicable standards completely.
2. Confirm that `gh` is installed and authenticated.
3. Confirm the target with `gh repo view` or use an explicit `OWNER/REPO`.
4. Inspect the local branch and working tree before any implementation,
   release, or pull-request operation.
5. Identify which workflow below matches the request and read its reference
   completely before acting. Load only the references needed for the request.

## Select a Workflow

- For repository context, issues, labels, branches, pull requests, projects, or
  shared CLI commands, read
  [references/github-repository-operations.md](references/github-repository-operations.md).
- To convert research into independently implementable story issues and parent
  plans, read
  [references/research-to-github-feature-plan.md](references/research-to-github-feature-plan.md)
  and the repository-operations reference.
- To implement one GitHub story and prepare or open its focused pull request,
  read [references/implement-github-story.md](references/implement-github-story.md)
  and the repository-operations reference.
- To evaluate a pull request against its linked issue and acceptance criteria,
  read [references/review-pr-against-issue.md](references/review-pr-against-issue.md)
  and the repository-operations reference.
- To draft or create a versioned release, read
  [references/release-version.md](references/release-version.md) and the
  repository-operations reference.

## Preserve Authorization Boundaries

- Treat read-only inspection as distinct from changes to GitHub or Git state.
- Do not create or edit issues, labels, projects, pull requests, comments, tags,
  or releases unless the user's request authorizes the corresponding action.
- Do not merge pull requests or close, reopen, or delete GitHub objects unless
  the user explicitly asks for that operation.
- Do not create a local branch, commit, push, or rewrite history unless the
  user's request and repository instructions authorize it.
- In this repository, implementing a GitHub issue does not itself authorize a
  commit. Follow `AGENTS.md` and use `$commit` only after explicit commit
  authorization in the current request.
- Include an issue-closing keyword in a pull request only when the pull request
  fully satisfies that issue.
- Keep one pull request focused on one story unless the user explicitly requests
  a broader boundary.

## Execute and Report

Follow the selected reference while applying repository-specific validation,
commit, and working-tree rules. Prefer URLs or unambiguous issue and pull-request
numbers in the final report. State:

- the confirmed repository;
- the GitHub objects inspected, created, or changed;
- validation performed and its result;
- any action not taken because it lacked authorization;
- the next meaningful action when work remains.
