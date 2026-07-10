# Planning Poker

## Summary

Planning Poker is a SharePoint Framework web part for collaborative planning poker
and agile story estimation. It is designed to help team hosts create teams,
manage stories, run voting sessions, reveal estimates, and retain planning
history inside SharePoint.

The project uses SPFx, React, Fluent UI, and Fluid Framework patterns so live
estimation state can be synchronized between participants while SharePoint
provides hosting, permissions, and durable storage.

## SharePoint Framework Version

![version](https://img.shields.io/badge/SPFx-1.23.2-green.svg)

## Applies To

- [SharePoint Framework](https://aka.ms/spfx)
- SharePoint Online
- Microsoft 365 tenants
- Microsoft Teams tabs, where SPFx host support is enabled

## Project Goals

- Provide a SharePoint-hosted planning poker experience for agile teams.
- Store one collaborative Fluid document per team in SharePoint-backed storage.
- Keep SharePoint metadata lightweight for discovery while Fluid owns live team,
  story, voting, and session state.
- Support hosted team administration, story lifecycle management, voting
  sessions, estimate history, and export workflows.

## Prerequisites

- Node.js `>=22.14.0 <23.0.0`
- npm
- A Microsoft 365 tenant with SharePoint Online
- SharePoint Framework development prerequisites for SPFx 1.23.2

## Solution

| Solution         | Author(s)      |
| ---------------- | -------------- |
| `planning-poker` | Anthony Poulin |

## Version History

| Version | Date       | Comments                    |
| ------- | ---------- | --------------------------- |
| 0.0.1   | 2026-07-10 | Initial project scaffolding |

## Minimal Path To Awesome

1. Clone this repository.
2. Open a terminal at the repository root.
3. Install dependencies:

   ```bash
   npm install
   ```

4. Start the local SPFx workbench:

   ```bash
   npm start
   ```

5. Build a production package:

   ```bash
   npm run build
   ```

## Useful Commands

```bash
npm run start
npm run build
npm run clean
```

## Features

The planned Story Points experience includes:

- team setup and host-managed team settings;
- story creation, import, export, archiving, and estimate history;
- shareable voting sessions for authenticated SharePoint users;
- anonymous or named voting modes;
- synchronized session state backed by Fluid Framework and SharePoint storage;
- SharePoint metadata for team discovery without opening every Fluid document.

See [docs/user-stories/index.md](docs/user-stories/index.md) for the current
implementation story catalog.

## Architecture And Standards

- [Architecture](docs/architecture.md)
- [Application shell and deep links](docs/application-shell.md)
- [Coding standards](docs/coding-standards.md)
- [User story standards](docs/USER_STORY_STANDARDS.md)
- [Commit standards](docs/COMMIT_STANDARDS.md)

## Disclaimer

This project is provided as-is without warranty of any kind, either express or
implied, including any implied warranties of fitness for a particular purpose,
merchantability, or non-infringement.

## References

- [SharePoint Framework overview](https://learn.microsoft.com/sharepoint/dev/spfx/sharepoint-framework-overview)
- [SharePoint Framework compatibility](https://learn.microsoft.com/sharepoint/dev/spfx/compatibility)
- [Build Microsoft Teams tabs with SPFx](https://learn.microsoft.com/sharepoint/dev/spfx/build-for-teams-overview)
- [Fluid Framework](https://fluidframework.com/)
