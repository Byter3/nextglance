# NextGlance Windows client instructions

Read root `AGENTS.md`, `specs/BEHAVIOR_SPEC.md`, and `specs/FEATURE_PARITY.md` first. Shared behavior belongs in the spec before implementation. This client is the behavior reference, not permission to perpetuate an undocumented defect. Report divergence.

Visible branding is **NextGlance**. A display-name change must preserve the existing account profile and credential storage location, native app ID and cloud protocol paths; do not let a host's default user-data path change implicitly with productName.

## Stack and boundaries

Current milestone RELEASE-17 targets 0.6.17/build19 with the approved BRAND-01 icon after fast checks and source freeze, superseding historical version references below. Use the canonical assets and treatments documented in `docs/BRANDING.md`; preserve native/package identities and previous releases. Native Deck moves use the target stack locator and fresh readback; shared UI owns floating Board drag feedback, unified dependency presentation and the independent Timeline Unscheduled sidebar.

Private pnpm workspace package `@nextspace/windows`, version 0.6.17, build 19. Electron 44, Vue 3.5, TypeScript 5.9, Vite 7, electron-builder 26. Shared UI uses Tiptap, Markdown-it, DOMPurify and Lucide. Use installed/locked versions; do not upgrade frameworks as incidental cleanup.

`electron/main.cjs` owns host operations; the preload exposes the typed WorkspaceApi. The sandboxed renderer must not receive Node access, credentials or unrestricted IPC. The host owns secure credential storage, networking, account-local durable storage and scheduling recovery. Operation lanes coordinate background reads, native mutations and account changes.

Use `packages/contracts` for interfaces, `packages/core` for portable projections/validation/merge, `packages/nextcloud` for native protocol, `packages/nextcloud-node` for the Node persistence adapter and `packages/ui` for shared presentation. Mount the interface through its exported injected WorkspaceApi entry. Do not import Android/Web host code or duplicate business rules inside components.

## NO FULL BUILDS POLICY — Fast Verification

Never run full application builds, installer/portable packaging, `pnpm build`, `pnpm start` (it builds), or packaging helpers during coding/sub-agent iterations. Full UI builds require an explicit owner request for a playable build at the end of a major milestone. Do not satisfy a check by running an existing full-build helper indirectly.

Overview groups use category owner `all`, independent of real Spaces. Native invitation controls use fresh principal/owner/outbox evidence and explicit event operations; generic invitation date/content writes remain protected. Preserve acknowledged creation identities and warnings if readback fails. Follow the exact shared spec and tests when changing these paths.

Keep state machines, validation, parsing and all business rules in pure framework-independent core modules/classes or ViewModels with zero UI dependencies. Views render state/forward actions; inject effects. Reuse shared core logic and load `specs/TEST_VECTORS.json` in a targeted local compliance test. Never duplicate or simplify the expectations.

Allowed fast checks from repository root for the actual Electron/TypeScript stack:

```powershell
node --test win/tests/spec-vectors.test.mjs
node --test tests/<specific-test>.test.mjs
node --check win/electron/<changed-file>.cjs
pnpm typecheck
```

`dotnet test --no-restore --filter "..."` is the owner's example for a .NET client; this client is not .NET. Use the targeted Node tests above rather than introducing .NET. Keep fixture profiles isolated; never use the owner's live account. Both root aliases and client packaging commands target `win/release/`; final portable executables and unpacked verification output stay there. Knowing that path is not authorization to run a build.

## UI conventions

Follow the connected user's Nextcloud palette/background and the shared accessible styles. Keep source color distinct from item fill, tag color and mapped-status color. Favor clear labels and readable controls; tooltips supplement accessible names.

Maintain one aligned Overview date axis, persistent routed dependencies, equivalent Calendar/Overview behavior, resizable detail panel and protected editor drafts. Native status and optional personal planning are different concepts. Preserve optimistic per-item edits, nonblocking background work and truthful freshness indicators.

Do not rewrite shared selectors to simplify a screen. FILTER-03 synchronizes semantic page filters; page/date navigation and panel geometry remain device-local. Touch only this host unless the orchestrator explicitly delegates shared changes. Keep exact platform-neutral behavior in the spec; host/framework details belong here.
