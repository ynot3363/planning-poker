# SPFx React Coding Standards

## Purpose

This document defines the engineering standards for SharePoint Framework (SPFx) projects that use React. Its goals are to produce code that is consistent, secure, accessible, testable, maintainable, and predictable in code review.

These standards apply to web parts, extensions, shared libraries, React components, services, hooks, utilities, tests, styles, and build configuration unless a documented exception is approved.

The terms **MUST**, **SHOULD**, and **MAY** identify required, recommended, and optional practices. A rule may be waived only when the pull request documents the business or technical reason and the reviewer approves the exception.

## Compatibility Comes First

- Select the SPFx version before selecting Node.js, TypeScript, React, Fluent UI, or test-library versions.
- Use the exact React and React DOM versions supported by that SPFx release. Pin them without a range. Microsoft warns that incompatible React versions can cause runtime failures that are not reported during the build. Consult the [SPFx compatibility reference](https://learn.microsoft.com/en-us/sharepoint/dev/spfx/compatibility) before creating or upgrading a project.
- Pin the Node.js major version in `package.json` and in the team's version-manager configuration.
- Keep TypeScript aligned with the version supported by SPFx. Do not independently upgrade TypeScript because a newer compiler is available.
- Commit the package-manager lock file and use the corresponding clean-install command in CI.
- Treat framework upgrades as intentional work. Review release notes, compatibility, bundle output, API permissions, and regression tests before merging.

SPFx projects compile to ES5 unless the selected build profile says otherwise. Transpilation changes JavaScript syntax, but it does not add missing browser APIs. Code that depends on an unavailable API MUST include a reviewed polyfill.

## Project Organization

Use folders to group files by feature or responsibility. A typical web part should resemble:

```text
src/webparts/example/
  ExampleWebPart.ts
  components/
    Example.tsx
    Example.module.scss
    forms/
      ExampleForm.tsx
    shared/
      EmptyState.tsx
  hooks/
    useExample.ts
  models/
    ExampleModels.ts
  services/
    ExampleService.ts
  utilities/
    exampleUtilities.ts
  polyfills/
    arrayAt.ts
  loc/
  test/
```

- Prefer one React component per `.tsx` file.
- A compound component may keep tightly coupled subcomponents in the same file when they form one public API and are not useful independently.
- Keep a component's props and private types in its file. Move a type to `models` or a shared types file only when multiple modules consume it.
- Keep SharePoint, Graph, and external API access in services. Components MUST NOT assemble REST URLs or obtain access tokens directly.
- Keep general pure transformations in utilities. Keep reusable stateful React behavior in custom hooks.
- Avoid barrel files when they hide dependency direction, create circular imports, or increase bundle size.
- Do not depend on SharePoint page DOM structure or global SharePoint CSS selectors. The page DOM is not a supported API and can change independently of the solution.

## SPFx Lifecycle and Data Loading

### Initial web part data

Initial data from SharePoint, Microsoft Graph, or another external source that is required to initialize the web part MUST be requested from the web part's `onInit()` method. Pass the resulting data or initialized service into React through typed props.

- `onInit()` should establish service context, load required configuration, and retrieve data needed for the first meaningful render.
- Do not duplicate initialization requests in the root React component.
- Surface a deliberate loading and error state when initialization cannot complete immediately.
- User-initiated and route-specific requests after initialization may be performed by a service called from an event handler, container component, or custom hook.
- Cache only when the data's ownership, lifetime, invalidation rule, and user scope are understood.

Use the SPFx clients appropriate to the target:

- `SPHttpClient` for SharePoint REST.
- `MSGraphClientV3` for Microsoft Graph.
- `AadHttpClient` for an Entra ID-secured API.
- `HttpClient` for an anonymous or independently authenticated external API.

Do not implement a parallel OAuth flow when an SPFx client already provides the required authenticated access. See Microsoft's [Entra ID-secured API guidance](https://learn.microsoft.com/en-us/sharepoint/dev/spfx/use-aadhttpclient).

### Property pane data

Data used only by property pane controls MUST be loaded when the property pane opens. It MUST NOT be fetched while the web part is in read-only page mode.

- Use `loadPropertyPaneResources()` to dynamically import code or packages used only by the property pane.
- Use `onPropertyPaneConfigurationStart()` to request options or other data needed by property pane controls.
- Show the property pane loading state and call `this.context.propertyPane.refresh()` after asynchronous options are ready.
- Cache the loaded options for the life of the web part when it is safe to do so.
- Handle partial failure without leaving controls permanently disabled.

Microsoft documents this lifecycle in its [cascading property pane example](https://learn.microsoft.com/en-us/sharepoint/dev/spfx/web-parts/guidance/use-cascading-dropdowns-in-web-part-properties) and its [dynamic loading guidance](https://learn.microsoft.com/en-us/sharepoint/dev/spfx/dynamic-loading).

### Disposal

- Unmount the React tree in the web part's `onDispose()` method.
- Dispose service clients, sockets, subscriptions, timers, observers, and dynamic data registrations owned by the web part.
- Cleanup methods MUST be idempotent so that repeated disposal does not fail.

## React Components

### Component style

- Prefer functional components and hooks over class components.
- Presentational components MUST be stateless pure functions of their props. They render semantic UI and raise typed events.
- Container components or custom hooks own orchestration, asynchronous operations, and state transitions.
- Keep state as close as possible to the component that owns it.
- Do not copy props into state unless the copy represents intentionally editable draft state.
- Do not perform side effects during render.
- Use stable domain identifiers for React keys. Array indexes are acceptable only for static lists that cannot reorder, insert, or delete.
- Memoization is a performance tool, not a default. Add `React.memo`, `useMemo`, or `useCallback` after measuring or when referential stability is required by an API.

### Effects

An effect synchronizes React with an external system. It is not the default place for derived values or event-driven business logic. React runs an effect after the component's initial render even when its dependency array is empty.

- Every `useEffect` MUST have an explicit dependency array.
- Every reactive value read by the effect MUST be represented in that dependency array.
- Do not suppress `react-hooks/exhaustive-deps` to force a desired schedule. Restructure the code or document a narrowly scoped exception.
- Every effect that starts work MUST return a cleanup function that reverses or cancels that work.
- Clean up event listeners, subscriptions, observers, sockets, Fluid listeners, timers, and pending requests.
- Use `AbortController` for supported requests and ignore stale results for APIs that cannot be cancelled.
- Do not add a meaningless no-op cleanup merely to satisfy this standard. If there is nothing to synchronize or clean up, reconsider whether an effect is needed.
- Treat each effect as one synchronization process. Split unrelated responsibilities into separate effects or hooks.

```tsx
React.useEffect((): (() => void) => {
  const abortController: AbortController = new AbortController();

  void exampleService.loadItems(abortController.signal).then(setItems).catch((error: unknown) => {
    if (!abortController.signal.aborted) {
      reportError(error);
    }
  });

  return (): void => {
    abortController.abort();
  };
}, [exampleService]);
```

Follow React's official guidance for [`useEffect`](https://react.dev/reference/react/useEffect) and [effect dependencies](https://react.dev/learn/removing-effect-dependencies).

## State Management

Choose the smallest state mechanism that fits the problem:

1. Use local component state for local interaction state.
2. Lift state to the nearest common container when siblings share it.
3. Use a custom hook to reuse stateful behavior.
4. Use React Context to provide stable dependencies or avoid prop drilling.
5. Use a global store only when state is genuinely application-wide and local ownership has become difficult to reason about.

React Context is a dependency-distribution mechanism in these standards. It MUST NOT become an ad hoc mutable global state store.

For projects on an SPFx version that supports React 18, use Redux Toolkit when a global store is justified. Follow the [Redux style guide](https://redux.js.org/style-guide/) and use the React-Redux hooks API. Keep transient component state out of Redux. Projects pinned to an earlier React version require a short architecture decision before introducing global state so that package compatibility is verified.

Reducers and selectors MUST be pure. Store serializable domain state and keep clients, DOM elements, promises, tokens, and callbacks outside the store.

## Navigation, Routing, and Deep Links

SPFx runs inside SharePoint, which already owns the page URL and browser history.

- Prefer query parameters for deep links and view state that users should bookmark or share.
- Namespace query parameter names when collisions with the host page or other web parts are possible.
- Parse and validate all URL values before use. Unknown or invalid values MUST fall back safely.
- Preserve unrelated query parameters when updating the URL.
- Do not use `BrowserRouter` inside an SPFx web part.
- When a routing library is necessary, use `HashRouter` so application routes do not compete with SharePoint server routes.
- A web part placed multiple times on a page MUST have a strategy for route ownership and instance isolation.

## Web Part Properties

- Define a typed interface for every web part property bag.
- Validate property values before saving or using them.
- Do not store secrets, access tokens, or sensitive user data in web part properties. Page authors and page content systems can inspect them.
- Provide safe defaults and support properties created by older solution versions.
- Use `propertiesMetadata` for properties that SharePoint should process:
  - `isSearchablePlainText` for searchable plain text.
  - `isHtmlString` for HTML that SharePoint should sanitize and index.
  - `isImageSource` for image URLs.
  - `isLink` for links, especially SharePoint documents that should continue to resolve after a rename or move.
  - `dynamicPropertyType` for dynamic properties.
- Specify only one server-processed metadata behavior for a property unless the SPFx API explicitly supports the combination.

See [Integrate web part properties with SharePoint](https://learn.microsoft.com/en-us/sharepoint/dev/spfx/web-parts/guidance/integrate-web-part-properties-with-sharepoint).

## Dynamic Data and Always-On Behavior

SharePoint may defer loading a web part until it approaches the viewport. When the solution must initialize regardless of scroll position, such as when it supplies page-level data or coordination:

- Implement the SPFx Dynamic Data source or consumer pattern.
- Initialize a source with `this.context.dynamicDataSourceManager.initializeSource(this)` in `onInit()`.
- Notify consumers only when the exposed value actually changes.
- Keep exposed data small, serializable, stable, and documented.
- Verify always-on behavior in the target SharePoint environment; do not infer it solely from local workbench behavior.
- Document the business requirement because bypassing deferred loading adds page startup cost.

Use Microsoft's [Dynamic Data guidance](https://learn.microsoft.com/en-us/sharepoint/dev/spfx/dynamic-data) as the implementation baseline.

## TypeScript and Naming

- Enable and retain strict TypeScript settings supplied by the selected SPFx profile.
- Do not use `any`. Use a real type or `unknown` with explicit narrowing.
- Prefer `interface` for public object contracts and `type` for unions, intersections, mapped types, and component-local aliases.
- Use `readonly` for values and arrays that callers must not mutate.
- Model finite states with unions or enums rather than loosely related booleans.
- Avoid non-null assertions unless an invariant is established immediately above the use.
- Never ignore a promise accidentally. Await it, return it, or deliberately mark it with `void` and handle rejection.

Names MUST convey domain purpose:

- Components, interfaces, types, enums, and classes use `PascalCase`.
- Functions, variables, hooks, and arguments use `camelCase`.
- Hooks begin with `use`.
- Boolean names begin with `is`, `has`, `can`, `should`, or another predicate.
- Event props begin with `on`; local event handlers begin with `handle`.
- Avoid abbreviations unless they are established domain terms such as `SPFx`, `URL`, or `ID`.
- Function arguments describe the value, not its type: use `teamId`, not `stringValue`.
- Functions use verbs that describe their effect: `loadTeams`, `validateStory`, `formatEstimate`.
- Keep interface-prefix conventions consistent within a project. Do not create review noise solely to add or remove an `I` prefix.

## JSDoc and Comments

Use JSDoc-style comments (`/** ... */`) for:

- Every function and method, including private functions and React components.
- Every interface and exported type.
- Every externally visible property on an interface.
- Public constants, hooks, services, and utility APIs.
- Non-obvious invariants, browser constraints, and integration behavior.

Function documentation MUST include:

- A useful summary of the business purpose.
- Important dependencies, side effects, lifecycle expectations, or authorization assumptions.
- One `@param` tag for each argument.
- An `@returns` tag describing the meaning of the result, including `void` and promises.
- `@throws` when callers are expected to handle an error.
- `@remarks`, `@example`, `@see`, or `@deprecated` when they add material context.

Comments MUST explain purpose, decisions, constraints, or non-obvious behavior. They MUST NOT merely restate the syntax.

```ts
/**
 * Defines the inputs required to render a team summary.
 */
export interface ITeamSummaryProps {
  /** The immutable SharePoint item identifier used to open the team. */
  readonly teamId: string;

  /** Invoked after the user selects the team for active work. */
  readonly onSelectTeam: (teamId: string) => void;
}

/**
 * Loads the teams the current user is authorized to access.
 *
 * @remarks
 * Depends on an initialized SharePoint service and enforces server-returned permissions rather
 * than UI role assumptions.
 *
 * @param sharePointService - The site-scoped service used to query team metadata.
 * @param abortSignal - A signal used to cancel the request when its owner is disposed.
 * @returns A promise containing team summaries ordered by display name.
 * @throws Throws when SharePoint rejects the request or returns an invalid response.
 */
export async function loadAuthorizedTeams(
  sharePointService: SharePointService,
  abortSignal: AbortSignal
): Promise<ReadonlyArray<ITeamSummary>> {
  // Implementation omitted.
}
```

Use ESLint's JSDoc integration to enforce documentation presence and valid tags. The rule configuration should distinguish application source from test files and generated files.

## Reuse and Dependencies

Follow the DRY principle at the level of knowledge and behavior:

- When the same function or transformation is used in multiple modules, extract it to a focused utility or service.
- When repeated logic owns React state or lifecycle, extract a custom hook.
- When repeated markup represents the same interaction and semantics, extract a component.
- Do not merge code that only looks similar but represents different business rules.
- Avoid speculative abstractions. A shared API should have a clear owner and stable purpose.

Prefer a small, well-tested local utility for simple logic. Add a dependency when it removes substantial complexity or implements a difficult domain correctly, such as Luxon for date/time-zone operations.

Before adding a package, review:

- SPFx, React, TypeScript, and ES5 compatibility.
- License and maintenance health.
- Published vulnerabilities and transitive dependencies.
- Bundle-size impact and tree-shaking behavior.
- Whether the package executes remote code, loads external assets, or collects telemetry.
- Whether the same capability already exists in SPFx, Fluent UI, the browser target, or the codebase.

## Fluent UI, Styling, and Themes

- Use the Fluent UI major version supported by the selected SPFx and React versions.
- Import Fluent UI components from specific supported paths because broad package imports are known to retain unnecessary code in SPFx bundles.

```ts
import { PrimaryButton } from '@fluentui/react/lib/Button';
import { Dialog } from '@fluentui/react/lib/Dialog';
```

- Do not import the full component surface from `@fluentui/react`.
- Pass the SharePoint theme from the web part into the React tree or provide it through a stable theme context.
- Use semantic theme slots or CSS custom properties. Do not hard-code colors that fail in dark, high-contrast, or custom tenant themes.
- Scope styles with `.module.scss`. Avoid global selectors and `!important` unless an integration constraint is documented.
- Use logical CSS properties where they improve right-to-left support.
- Test text scaling, narrow web part widths, SharePoint section backgrounds, dark themes, and high-contrast mode.

## ES5 and Polyfills

- Write TypeScript that compiles under the SPFx-provided target and libraries.
- Remember that TypeScript downlevels syntax but does not polyfill runtime APIs.
- Put organization-owned polyfills in a `polyfills` folder and load them once at the web part entry boundary.
- Prefer a narrowly scoped polyfill for the exact missing behavior over a large compatibility library.
- Add tests for the polyfill and document the browsers or host versions that require it.
- Do not modify native prototypes from feature code.
- Do not assume a package is ES5-compatible because its TypeScript declarations compile. Inspect the distributed JavaScript and test the production bundle.

## Accessibility and Semantic HTML

The acceptance target is WCAG 2.2 AA unless a product requirement is stricter. Follow the [W3C WCAG 2.2 guidance](https://www.w3.org/WAI/WCAG22/Understanding/).

- Use native semantic HTML before ARIA.
- Every interactive element MUST be keyboard operable and have a visible focus indicator.
- Use actual `button`, `a`, `input`, `select`, table, heading, landmark, and list elements for their intended purposes.
- Every form control MUST have an accessible name and associated label. Instructions and errors must be programmatically associated.
- Preserve logical heading order and document landmarks inside the web part.
- Do not communicate status, validation, selection, or meaning through color alone.
- Meet contrast requirements using theme-aware colors.
- Announce asynchronous status and validation changes through an appropriate live region without excessive interruption.
- Manage focus when opening and closing dialogs, moving between application screens, or completing destructive actions.
- Respect reduced-motion preferences.
- Decorative images use empty alternative text; informative images receive concise meaningful alternatives.
- Test with keyboard only, browser zoom, automated accessibility checks, and at least one supported screen reader for critical workflows.

ESLint accessibility rules SHOULD catch missing labels, invalid ARIA, click-only controls, and other static issues, but linting does not replace interaction testing.

## Client-Side Security

SPFx code executes in the SharePoint page and in the current user's context. A compromised dependency or unsafe DOM operation can therefore access data and capabilities available to that user. Microsoft's [SPFx enterprise guidance](https://learn.microsoft.com/en-us/sharepoint/dev/spfx/enterprise-guidance) emphasizes that the SharePoint page DOM is not an API, and OWASP identifies DOM XSS and uncontrolled third-party code as primary client-side risks.

### Secrets, tokens, and identity

- Never embed client secrets, certificates, connection strings, API keys with privileged access, or reusable credentials in source, manifests, properties, bundles, or source maps.
- A browser application cannot keep a secret. Put privileged operations behind a secured API.
- Obtain tokens through SPFx-provided clients and request them for the exact resource audience.
- Never log, persist, place in Redux, or expose access tokens to React components.
- Do not store sensitive data in `localStorage`, `sessionStorage`, query parameters, hashes, or web part properties.
- Request the least-privileged delegated API permissions necessary. Document why every `webApiPermissionRequests` scope is required.
- Treat the current user's display name, email, and object ID as personal data.

### Authorization

- UI visibility is not authorization. Hiding a button does not prevent a request.
- Enforce access with SharePoint permissions or the external API on every protected operation.
- Use the current user's delegated context unless a reviewed server-side use case requires otherwise.
- Do not infer permissions from group names, page mode, URL values, or client-maintained role flags.
- Re-check authorization when the protected operation occurs.

### Untrusted input and XSS

- Treat SharePoint fields, Graph responses, external API data, URL values, imported files, web part properties, and user input as untrusted.
- Validate data at the boundary and convert it to a typed domain model before use.
- Render untrusted text through normal React expressions, which escape text by default.
- Do not use `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, `new Function`, string-based timers, inline event handlers, or `javascript:` URLs.
- If a documented business requirement needs HTML, sanitize it with a reviewed allow-list sanitizer immediately before rendering. Sanitization and validation are distinct steps.
- Validate URLs with the `URL` API and allow only required protocols, normally `https:` and approved SharePoint-relative URLs. React escaping alone does not make a URL safe.
- External links opened in a new tab MUST use `rel="noopener noreferrer"`.
- Use `textContent` or safe DOM construction APIs when React cannot own a DOM integration.

Follow the OWASP [XSS Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html) and [DOM XSS Prevention](https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html) cheat sheets.

### Requests and data handling

- Use HTTPS for all external endpoints.
- Allow-list external origins and endpoints. Do not construct an endpoint from unchecked user input.
- Set and validate expected content types. Reject an HTML response when JSON is expected.
- Validate response status and shape before reading nested values.
- Encode SharePoint OData values correctly; do not build filters through unchecked string concatenation.
- Respect throttling and `Retry-After`; use bounded retries with jitter only for retryable operations.
- Set practical timeouts or cancellation for network work.
- Limit imported file type and size, parse defensively, and show row-level validation without executing embedded content.
- Collect and retain only the data needed for the business purpose.
- Redact sensitive values from telemetry and user-facing errors.

### Dependencies and external scripts

- Prefer bundled, version-locked dependencies over runtime scripts from third-party CDNs.
- Do not load remote scripts dynamically without a security review, an approved origin, and a documented failure strategy.
- Review lock-file changes and run dependency vulnerability scanning in CI.
- Address exploitable production vulnerabilities before release. Document risk acceptance when an SPFx build dependency cannot be upgraded independently.
- Remove unused dependencies promptly.
- Treat dependency code as code running with the current user's SharePoint access. OWASP's [third-party JavaScript guidance](https://cheatsheetseries.owasp.org/cheatsheets/Third_Party_Javascript_Management_Cheat_Sheet.html) explains this supply-chain risk.
- Use SharePoint Online Content Security Policy support where tenant governance allows it. CSP is defense in depth and does not replace safe rendering. See Microsoft's [SharePoint Online CSP guidance](https://learn.microsoft.com/en-us/sharepoint/dev/spfx/content-securty-policy-trusted-script-sources).

### Security review triggers

A focused security review is required when a change:

- Adds or expands an API permission.
- Adds a third-party runtime dependency or external script.
- Renders HTML, SVG, rich text, or user-controlled URLs.
- Imports files or processes data from another tenant or origin.
- Stores personal, confidential, regulated, or credential-like data.
- Changes SharePoint permissions or breaks inheritance.
- Introduces cross-window messaging, an iframe, a service worker, or browser storage.

## Performance and Reliability

- Keep first-render work small and avoid duplicate API calls across lifecycle methods.
- Import optional and property-pane-only features dynamically.
- Import Fluent UI from specific paths and inspect production bundle output after adding a substantial package.
- Paginate SharePoint and Graph collections; do not assume one response contains all items.
- Avoid one request per list item when batching, expansion, or a different query can solve the problem.
- Debounce search and other rapid user input, while ensuring pending work is cancelled on cleanup.
- Handle empty, loading, stale, partial, throttled, offline, unauthorized, and failure states explicitly.
- Use optimistic UI only when rollback and conflict behavior are defined.
- Log actionable diagnostic context without leaking tokens, personal data, request bodies, or confidential content.
- Do not swallow errors. Convert technical failures to typed application errors and present useful, non-sensitive messages.

## Testing Standards

Every project MUST maintain at least **80% coverage** for statements, branches, functions, and lines. Configure the test runner to fail the build when any global threshold falls below 80%. Critical authorization, data-loss, security, and business-rule modules SHOULD have higher local thresholds.

```js
coverageThreshold: {
  global: {
    branches: 80,
    functions: 80,
    lines: 80,
    statements: 80
  }
}
```

Use the test framework supported by the selected SPFx toolchain. For React components, prefer React Testing Library because it exercises behavior through user-visible semantics rather than component internals. See the [React Testing Library introduction](https://testing-library.com/docs/react-testing-library/intro/) and [Jest coverage configuration](https://jestjs.io/docs/configuration#coveragethreshold-object).

- Unit test pure utilities, reducers, selectors, validators, parsers, and business rules.
- Component tests MUST cover accessible names, keyboard interaction, loading, empty, error, disabled, and success states.
- Service tests MUST cover request construction, pagination, throttling, cancellation, malformed responses, and authorization failures.
- Test effect cleanup for timers, event listeners, requests, subscriptions, and collaborative clients.
- Add regression tests for every fixed defect when practical.
- Mock at system boundaries, not inside the behavior under test.
- Do not rely on snapshots as the only assertion for business behavior or accessibility.
- Keep tests deterministic; use fake time deliberately and restore it after each test.
- A coverage percentage does not replace meaningful assertions or risk-based integration testing in SharePoint.

## ESLint Standards

ESLint owns correctness, unsafe patterns, TypeScript rules, React hooks, accessibility, and documentation policy. Prettier owns formatting. Do not duplicate Prettier's work with ESLint formatting rules.

Every project MUST:

- Extend the Microsoft ESLint profile supplied for its SPFx version.
- Use typed linting against the project `tsconfig.json` where supported.
- Enable `eslint-plugin-react-hooks` recommended rules.
- Add JSDoc rules that enforce comments and valid `@param`, `@returns`, and `@throws` tags for the APIs covered by this standard.
- Add JSX accessibility rules.
- Reject unsafe constructs such as `eval`, implied eval, `new Function`, script URLs, accidental fallthrough, floating promises, and unsafe `any` use.
- Report unused ESLint-disable comments and require every remaining disable to include a reason.
- Run with zero warnings in CI.
- Ignore generated output such as `lib`, `dist`, `temp`, `release`, `coverage`, and generated localization or SASS type files.

Use these lint packages when they are compatible with the selected SPFx toolchain:

- `@microsoft/eslint-config-spfx` as the base configuration.
- `eslint-plugin-react-hooks` for hook correctness and dependencies.
- `eslint-plugin-jsdoc` for documentation presence, tag names, parameter names, and return documentation.
- `eslint-plugin-jsx-a11y` for statically detectable accessibility defects.
- `eslint-plugin-no-unsanitized` or equivalent reviewed rules for unsafe DOM sinks.
- `eslint-config-prettier` as the final configuration entry.

Pin these packages in `devDependencies`. Do not copy a lint configuration from a newer SPFx project without checking its ESLint major version and flat-config support.

Recommended rule areas include:

| Area | Required behavior |
| --- | --- |
| React hooks | Enforce the Rules of Hooks and exhaustive dependencies. |
| Type safety | Reject explicit `any`, unsafe member access, misused promises, and floating promises. |
| Correctness | Require strict equality, consistent returns, exhaustive switches where practical, and safe promise handling. |
| Security | Reject dynamic code execution, script URLs, unsafe DOM sinks, and unreviewed HTML rendering. |
| Accessibility | Validate ARIA, labels, keyboard support, headings, anchors, and image alternatives. |
| Documentation | Require useful JSDoc and matching parameter/return tags. |
| Imports | Detect cycles and enforce type-only imports where supported without fighting SPFx output. |

At minimum, configure equivalent rules for the following concerns. Exact rule names can differ by the plugin versions supported by the project:

```js
{
  rules: {
    'curly': ['error', 'all'],
    'eqeqeq': ['error', 'always'],
    'no-alert': 'warn',
    'no-console': ['error', { allow: ['warn', 'error'] }],
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'no-new-func': 'error',
    'no-script-url': 'error',
    'prefer-const': 'error',
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'error'
  }
}
```

The Microsoft SPFx profile and TypeScript ESLint rules remain authoritative when a generic rule conflicts with type-aware behavior. Any rule disabled because of an SPFx limitation MUST include a comment explaining that limitation and, where possible, a tracking issue for removal.

Use `eslint-config-prettier` as the final config entry so ESLint does not conflict with Prettier. Do not run Prettier through `eslint-plugin-prettier`; keeping linting and formatting as separate commands is faster and produces clearer failures. This follows the [typescript-eslint formatting guidance](https://typescript-eslint.io/users/what-about-formatting/) and [Prettier installation guidance](https://prettier.io/docs/install.html).

## Prettier Standards

Prettier is mandatory for TypeScript, TSX, JavaScript, JSON, Markdown, YAML, CSS, and SCSS files it supports. The repository configuration is authoritative; developers MUST NOT depend on personal editor settings.

Use this organization baseline in `.prettierrc.json`:

```json
{
  "$schema": "https://json.schemastore.org/prettierrc",
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false,
  "semi": true,
  "singleQuote": true,
  "quoteProps": "as-needed",
  "jsxSingleQuote": false,
  "trailingComma": "none",
  "bracketSpacing": true,
  "bracketSameLine": false,
  "arrowParens": "always",
  "endOfLine": "lf",
  "proseWrap": "preserve"
}
```

Use `.prettierignore` for generated and packaged artifacts:

```text
coverage/
dist/
lib/
node_modules/
release/
solution/
temp/
*.sppkg
```

Use `.editorconfig` to keep basic editor behavior aligned before Prettier runs:

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
indent_style = space
indent_size = 2
trim_trailing_whitespace = true

[*.md]
trim_trailing_whitespace = false
```

Provide scripts with stable names:

```json
{
  "scripts": {
    "lint": "eslint . --max-warnings 0",
    "lint:fix": "eslint . --fix",
    "format": "prettier . --write",
    "format:check": "prettier . --check",
    "test:coverage": "jest --coverage"
  }
}
```

- Run `format` before opening a pull request.
- Run `format:check`, `lint`, tests, coverage thresholds, and the production SPFx build in CI.
- Pin Prettier and `eslint-config-prettier` in `devDependencies` and update them intentionally.
- Configure editor format-on-save to use the workspace Prettier version.
- Formatting-only changes SHOULD be isolated from behavior changes when practical.
- Do not use `prettier-ignore` without a nearby reason. Generated code is ignored at the file or directory level.

## Pull Request Quality Gate

A change is ready for review when:

- The production SPFx build succeeds with the supported Node.js version.
- ESLint succeeds with zero warnings.
- Prettier check succeeds.
- All tests pass and all four coverage metrics remain at or above 80%.
- New or changed behavior has risk-appropriate tests.
- JSDoc describes new and changed APIs, business rules, side effects, and dependencies.
- Keyboard and accessibility behavior has been checked for changed UI.
- Theme, narrow-width, and high-contrast behavior has been considered for changed UI.
- API permissions, external endpoints, storage, and personal-data changes are documented.
- Dependency and lock-file changes have been reviewed.
- No secrets, tokens, confidential data, generated packages, or local environment files are committed.
- The pull request explains any approved exception to these standards.

## Reference Baseline

- [SharePoint Framework overview](https://learn.microsoft.com/en-us/sharepoint/dev/spfx/sharepoint-framework-overview)
- [SPFx compatibility reference](https://learn.microsoft.com/en-us/sharepoint/dev/spfx/compatibility)
- [SPFx dynamic loading](https://learn.microsoft.com/en-us/sharepoint/dev/spfx/dynamic-loading)
- [SPFx Dynamic Data](https://learn.microsoft.com/en-us/sharepoint/dev/spfx/dynamic-data)
- [SPFx web part property integration](https://learn.microsoft.com/en-us/sharepoint/dev/spfx/web-parts/guidance/integrate-web-part-properties-with-sharepoint)
- [React effects](https://react.dev/reference/react/useEffect)
- [Redux style guide](https://redux.js.org/style-guide/)
- [ESLint configuration](https://eslint.org/docs/latest/use/configure/)
- [Prettier installation and integration](https://prettier.io/docs/install.html)
- [WCAG 2.2 understanding documents](https://www.w3.org/WAI/WCAG22/Understanding/)
- [OWASP Client-side Security Risks](https://owasp.org/www-project-top-10-client-side-security-risks/)
- [OWASP XSS Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)
- [OWASP Third-party JavaScript Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Third_Party_Javascript_Management_Cheat_Sheet.html)
