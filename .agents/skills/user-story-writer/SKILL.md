---
name: user-story-writer
description: Craft, refine, and index repository-standard user stories for this project. Use when Codex is asked to create a user story, update a story in docs/user-stories, analyze story dependencies, maintain the user story index, or prepare implementation-ready feature documentation.
---

# User Story Writer

## Overview

Create implementation-ready user stories that match this repository's
standards, SPFx React expectations, documentation model, and indexing
conventions. The canonical story catalog currently lives at `docs/user-stories/`
unless a story explicitly identifies a different repository area or catalog.

## Workflow

1. Read `docs/USER_STORY_STANDARDS.md` completely.
2. Read `docs/coding-standards.md`.
3. Read relevant sections of `docs/architecture.md` and any area-specific
   standards that apply to the story.
4. Read `docs/user-stories/index.md` and any related existing story files.
5. Identify the target feature, service, workflow, or repository area.
6. Identify the next `US-###` ID when creating a new story.
7. Before writing, scan the index for assumptions, rules, standards, private
   infrastructure, or dependency notes that the new story may affect.
8. Draft or refine the detailed story in `docs/user-stories/`.
9. If the new or changed story introduces assumptions, rules, standards,
   dependencies, or reuse decisions that affect another component or feature,
   update each impacted story file in the same change.
10. Update the index row with title, brief description, and reuse/dependency
    memory.
11. Run or report a markdown formatting check for changed story docs.

## Story Requirements

Use the required story shape from `docs/USER_STORY_STANDARDS.md`:

- user story;
- description;
- public API;
- acceptance criteria;
- tests;
- documentation and examples;
- dependencies;
- implementation notes.

Make each story decision-complete enough for implementation, but avoid
over-specifying internals that the coding and design standards already govern.

## Index Memory

Treat `docs/user-stories/index.md` as future-agent memory. Record reusable
decisions there, especially:

- private infrastructure that may later become primitives;
- story sequencing dependencies;
- public APIs intentionally deferred;
- shared accessibility, testing, or documentation decisions.

Use the index before drafting to identify impacted stories. When a new story
changes an assumption or standard another story depends on, update that related
story immediately rather than leaving the relationship only in the new story.

Do not renumber existing user stories.
