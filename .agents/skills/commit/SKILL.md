---
name: commit
description: Create focused, validated commits for this repository. Use whenever Codex is asked or authorized to stage changes, create a commit, organize completed work into commits, or finish a user story at a commit boundary.
---

# Commit changes

1. Read `docs/COMMIT_STANDARDS.md` completely.
2. Read `AGENTS.md` and preserve its working-tree safety rules.
3. Inspect `git status --short` and the complete diff.
4. Identify changes that belong to the requested commit. Preserve unrelated
   user changes.
5. Identify the owning feature, service, workflow, or repository area for the
   change and preserve unrelated area boundaries in the commit.
6. Run the smallest authoritative validation command for the changed surface,
   such as `npm run validate`, focused tests, Prettier checks for Markdown or
   config files, TypeScript checks, or script syntax checks. Reserve broad
   all-repository validation for git push/pre-push/CI or an explicit user
   request. Do not commit on failure unless the user explicitly requests a WIP
   commit.
7. Stage files explicitly by path or coherent area group. Never
   use `git add .`.
8. Inspect `git diff --cached` and confirm the staged change is coherent.
9. Write a Conventional Commit title and body following
   `docs/COMMIT_STANDARDS.md`.
10. Create the commit without amending or rewriting existing history unless the
    user explicitly authorizes it.
11. Report the commit SHA, title, included files or scope, and validation
    results.

If the task contains multiple independently reviewable changes, propose or
create multiple semantic commits. Keep implementation, tests, stories, and
documentation together when they define one atomic contract.

Root-level workflow, documentation, and policy updates may be committed together
after focused root validation. Feature implementation, tooling, and metadata
should stay with the owning project area unless the change intentionally spans
areas. For cross-area commits, run the relevant validation gate for each changed
surface when separate focused gates exist.
