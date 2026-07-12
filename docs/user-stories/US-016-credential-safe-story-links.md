# US-016: Protect Story Links and Collaborative State from Credentials

## User Story

As a Planning Poker maintainer, I want credential-safe story-link boundaries and
token non-persistence tests so collaboration cannot retain or execute secrets
that belong only to the current browser session.

## Description

Story links are untrusted input from forms, CSV imports, existing Fluid
documents, and round snapshots. The current HTTPS/root-relative check does not
reject URL user information, fragments, or credential-bearing query parameters,
and the Stories screen trusts the persisted value when rendering an anchor.
Those gaps can retain signed URLs in SharedTree and exports or expose stored XSS
through a compatible malformed document.

Create one shared link policy used at input, repository mutation, presentation,
snapshot, and export boundaries. Separately protect the architectural invariant
that AAD, ODSP storage, websocket, refresh, and bearer tokens obtained by the
runtime token provider never become collaborative state.

## Public API

- Expose one typed story-link validator/normalizer for blank, approved
  SharePoint-relative, and HTTPS links.
- Expose a presentation-safe selector that returns either a validated link or
  an unavailable result for legacy/corrupt persisted values.
- Keep token-provider values private to the ODSP transport. Do not add token,
  credential, provider, or authorization fields to domain or SharedTree APIs.
- Keep test-only credential-sentinel inspection private to the security test
  harness.

## Acceptance Criteria

- A story link is accepted only when it is blank, a root-relative path beginning
  with one `/`, or an HTTPS URL. The current product contract continues to allow
  arbitrary HTTPS origins rather than introducing a tenant-origin allow-list.
- URL user names/passwords, fragments, protocol-relative forms, backslashes,
  unchecked protocols, malformed encoding, and credential-like query names are
  rejected case-insensitively before persistence.
- The credential query deny-list covers common bearer, OAuth, signing, API-key,
  and shared-access-signature names and compares decoded parameter names.
- Story create, edit, CSV import, repository writes, voting-round snapshots,
  Stories/Voting rendering, and both CSV exports use the same policy or a
  stricter boundary-specific projection.
- Unsafe legacy links remain repairable as story content but render as
  unavailable text, are not copied into new round snapshots, and are omitted
  from exports until repaired.
- Every rendered safe external link uses `noopener noreferrer`; `javascript:`,
  `data:`, `http:`, protocol-relative, and malformed persisted links never
  produce an anchor.
- Recognizable AAD/ODSP storage and websocket token sentinels supplied by a fake
  runtime token provider never appear in the SharedTree root, serialized plain
  snapshots, Presence payloads, SharePoint metadata projections, exports, or
  diagnostics after create/load/join/vote/save workflows.
- No credential value is logged or included in a user-facing validation error.
- Existing credential-bearing story links are called out in release guidance so
  tenant owners can remove the value and revoke the exposed credential when
  appropriate.

## Tests

- Unit-test valid blank, HTTPS, and root-relative links plus URL user
  information, fragments, mixed-case/encoded credential parameters, malformed
  URLs, script/data/HTTP protocols, protocol-relative forms, and backslashes.
- Component-test Stories and Voting with safe and unsafe persisted links,
  asserting unavailable text and absence of an unsafe anchor.
- Service-test form, import, repository, round-snapshot, story-export, and
  session-export boundaries with credential sentinels.
- Add an integration-style fake-ODSP regression test that returns distinct
  storage and websocket token sentinels, exercises collaborative mutations, and
  recursively proves neither sentinel enters SharedTree or adjacent persisted
  projections.
- Keep security-critical validator and sentinel paths above the repository's
  global coverage threshold.

## Documentation and Examples

- Update story-management, voting, export, data-model, and architecture guidance
  with the accepted link shapes, credential-query policy, legacy repair
  behavior, and runtime-only token invariant.
- Add safe work-item-link and rejected signed/token-bearing-link examples.

## Dependencies

- US-001 owns the SharedTree and story snapshot contracts.
- US-003 owns ODSP token-provider and repository boundaries.
- US-007 through US-009 own story input, rendering, and catalog export.
- US-012 and US-015 own round snapshots and session-result export.

## Implementation Notes

- Parse relative and absolute links through one URL-based utility using a
  trusted base; do not rely on prefix matching alone.
- Construct accepted URL shapes explicitly and apply a reviewed
  credential-parameter deny-list. A future origin allow-list requires a separate
  product decision because arbitrary HTTPS work-item systems remain supported.
- Do not scan or rewrite ordinary story prose for token-shaped text. The
  security contract prevents application-issued token flow and rejects
  credential-bearing URL structures at defined boundaries.
- The accepted broad-Contribute library permission model is unchanged and is
  not part of this remediation.
