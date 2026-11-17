# Architecture

NextGlance is a private multi-client monorepo. Windows, Android and the Nextcloud Web host reuse the Vue interface, portable planner rules and native Nextcloud protocol. Web implementation resumed under WEB-01; actual server acceptance remains separate from automated fixture checks.

| Directory | Responsibility |
| --- | --- |
| `specs/` | Authoritative behavior, parity ledger and language-neutral test vectors |
| `win/` | Electron host, encrypted credentials, desktop persistence and `release/` output |
| `android/` | Capacitor host, Nextcloud Files SSO/browser authorization, Java services, data worker and `release/` output |
| `web/` | Authenticated Nextcloud PHP host, online-only browser adapter, scoped UI and manual packaging |
| `packages/contracts/` | Shared entities and `WorkspaceApi` boundary |
| `packages/core/` | Pure validation, projection, identity, organization and merge rules |
| `packages/ui/` | Shared Vue presentation; injected platform API |
| `packages/nextcloud/` | Portable native-source protocol |
| `packages/nextcloud-node/` | Node transport and durable persistence used by Windows |
| `tests/` | Protocol, component and isolated integration fixtures |

Dependencies point from clients to shared packages. Core/contracts never import UI or platform hosts. The shared UI receives a `WorkspaceApi`; it does not receive credentials or unrestricted native access. Platform adapters own network/storage effects, authorization, lifecycle and file selection. See [the behavior specification](../specs/BEHAVIOR_SPEC.md) for exact contracts and [verification](VERIFICATION.md) for checks.

## Data and synchronization

Tasks and events stay in CalDAV; cards, stacks, labels and card dependencies stay in Deck; Notes content and file tags/attachments use their native services. Custom organization and cross-app relationships use workspace schema **2**, folder protocol **1**, under `/Workspace/Nextspace/`. Native bodies and credentials are excluded from those planner files. Windows/Android caches provide account-specific acceleration and offline data. Web has memory acceleration for an open page only, without persistent private browser data or an offline write queue.

Android restores a small saved-view checkpoint before complete private stores and authorization. Native requests/projection run through its data worker, with ETag/token reuse, bounded resource transfer, cancellation and durable acknowledged-edit protection. Fresh permission discovery can enable implemented operations while a bulk refresh continues; it does not claim that source data is fresh. Files SSO has different transport capabilities from direct browser-authorized transport, so the protocol selects a validated fallback. Physical startup, thermal behavior and real-server throughput still require device evidence.

## Web plan review

Owner decisions are recorded in WEB-01. The [Web host](../web/README.md) uses app ID `nextglance`, namespace `OCA\Nextglance`, the current Nextcloud session and same-origin installation-qualified API calls. PHP supplies authenticated identity and app routes; the browser adapter reuses portable native protocols and conditional folder writes. No credential proxy or additional authoritative database is introduced.

The shared `sessionHost` presentation option suppresses standalone login/theme controls and document-wide theme changes. Web-only CSS scoping contains shared styles and menus within Nextcloud's app content. An expired or changed account fences requests and hides private content. Ordinary connectivity loss disables writes; already-rendered memory is explicitly stale. No service worker, offline launch or private browser persistence is provided.

Targets are Server 34.x (PHP 8.2–8.5) and 35.x (PHP 8.3–8.5), verified against their official version guards. Actual installation, middleware authentication/CSRF, native edits and source-download acceptance are pending on both majors. Optional applications and unsupported writes remain capability-gated. Atomic create-and-link booking stays disabled until a durable server recovery path exists; normal event creation and subsequent linking remain separate supported operations.

The [manual deployment guide](../web/DEPLOYMENT.md) covers local packaging, installation, updates and rollback. It does not authorize deployment. Signing, a genuine public support/repository URL and App Store publication remain future milestones.

The owner selected AGPL-3.0-or-later for project-owned code. See [LICENSE](../LICENSE) and [NOTICE](../NOTICE.md). The source/server app are intended to be free; store clients may be paid. Dependency licenses still apply, including Nextcloud Android SingleSignOn 1.3.4 (GPL-3.0-or-later) and ical.js 2.2.1 (MPL-2.0). A complete bundled-license inventory is still a public-distribution gate. The manual Web package contains matching source before a public repository exists.
