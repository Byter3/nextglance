# NextGlance Nextcloud Web client instructions

## Current authorization — WEB-01 (2026-11-14)

RELEASE-30 authorizes final local 0.6.30 assets and archive after EDIT-20 and PERF-19 verification and source freeze. Preserve the Nextcloud session, app identity and prior archives. Reviewed source may be pushed to the existing repository. Package uploads and server deployment remain outside this release.

RELEASE-29 authorizes final local 0.6.29 assets and archive after BOARD-07 fast checks and source freeze. Preserve the Nextcloud session, app identity and prior archives. Reviewed source may be pushed to the existing GitHub repository. Package uploads and server deployment remain outside this release.

RELEASE-27 authorizes final local 0.6.27 assets and archive after fast checks and source freeze, followed by a privacy-reviewed source push to the existing GitHub repository. Preserve the session-only HISTORY-02 behavior and native identifiers. Server installation, binary uploads and deployment remain outside this release.

RELEASE-26 adds HISTORY-02 native identity isolation and VIEW-18 quieter weekend shades to the Nextcloud app at 0.6.26. Verify session-only history and customization saves before final packaging.

RELEASE-25 authorizes final local 0.6.25 assets/archive after HISTORY-01 fast checks and orchestrator source freeze/GO. The Web host initially reads the recent Calendar period, then fetches bounded Calendar-only windows as the displayed dates change. Retain the recent projection and at most one additional range in session memory; no private browser persistence. Preserve native edit, denial and session fences and independently load Tasks/Deck. Board completion age and weekend-day appearance are local presentation preferences, not synchronized filters. Preserve the approved BRAND-01 icon, app identity and prior artifacts; no deployment/publication. Native Deck moves use the target stack locator and verified readback; shared dependency and floating Board drag behavior applies to the embedded planner as well. RELEASE-23 at0.6.23 is historical evidence.

The owner has resumed Web implementation; this section supersedes every earlier hold/scaffolding prohibition below. App ID is `nextglance`, visible NextGlance, namespace `OCA\Nextglance`. Target Server 34.x and 35.x; verify each before claiming compatibility. Project-owned code is AGPL-3.0-or-later by explicit owner decision; preserve dependency licenses. No publication/deployment is authorized.

Read WEB-01 in the behavior spec first. Use the current Nextcloud session, same-origin installation-qualified requests and request-token protections. No standalone login, credential vault or generic authenticated proxy. Online-only: no service worker, offline launch, persistent private browser cache or write outbox. In-memory incremental acceleration is allowed. Expiry/account changes fence requests and hide private state. Scope shared UI/styles to the app content region; preserve Nextcloud navigation/theme. Include a concise manual deployment/update/rollback guide. Full builds during coding remain forbidden; use targeted unit, type and PHP syntax checks.

Read root `AGENTS.md`, `specs/BEHAVIOR_SPEC.md` and `specs/FEATURE_PARITY.md` before client changes. Implement phase by phase and never invent fields, statuses, date semantics, identity, persistence, validation or conflict handling. Preserve existing technical package and wire-format identifiers.

## NO FULL BUILDS POLICY — Fast Verification

NEVER run `npm run build`, `pnpm build`, Vite/production builds or packaging during regular coding/sub-agent iterations. Full UI builds are allowed only at the end of a major milestone when the owner explicitly requests a playable build. Never trigger a full build through another script or test hook.

State machines, parsing, validation and business rules live in pure framework-independent modules with zero UI dependencies. Views render state and forward intent. Inject effects; reuse shared core. A fast local test must load `specs/TEST_VECTORS.json` and run the exact expectations against production pure logic.

Use locked local no-emit checks, `node --test web/tests/<target>.test.mjs`, shared vectors and PHP syntax/targeted tests. Do not silently download a test framework just to imitate an example command. Browser fixture success does not establish actual Nextcloud installation/session acceptance.

Scope implementation to `/web`; shared changes require orchestrator ownership and spec-first updates. Use authenticated Nextcloud identity and native permission checks; never ask an already signed-in user for another password. Keep all user data isolated and native permissions enforced server-side.

Use shared contracts/core and portable native protocol where suitable. Implement host APIs explicitly; do not copy Electron/preload, Node account storage or Android SSO into the web client. Adapt styles to Nextcloud's host UI without overriding its global navigation. Match behavior, not host-specific gestures or framework internals.

Document actual commands and evidence. Do not invent a public URL or GitHub repository. Complete parity gates using real evidence; a browser preview is not an installable Nextcloud app. Require an explicit user request before live server installation, publication or store submission.
