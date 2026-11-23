# NextGlance orchestration and global rules

## Authority

`specs/BEHAVIOR_SPEC.md` is the single source of truth for shared application behavior. `specs/FEATURE_PARITY.md` is the phased implementation and verification ledger. Read both before changing any client. Existing historical documentation and reference-client code are evidence, not authority over the specification. Report discrepancies rather than silently choosing a convenient behavior.

Any global behavior change MUST be written into `specs/BEHAVIOR_SPEC.md` FIRST, before client implementation. Record changed acceptance criteria in FEATURE_PARITY. Never invent fields, enums, completion semantics, identities, storage formats, defaults or failure handling in a client. A compile success is not behavioral parity.

## Monorepo boundaries

The canonical layout is:

```
specs/       Platform-neutral behavior and parity contract
win/         Windows host and packaging; current reference client
android/     Android host, native SSO, platform services and tests
web/         Nextcloud-installed session host; implementation authorized by WEB-01
packages/    Shared contracts, portable core, UI and native-source protocol
tests/       Shared and Windows integration/regression evidence
docs/        Supporting and historical documentation
```

The previous paths `apps/windows`, `apps/android`, `apps/nextcloud` are migration inputs, not additional clients. Repository path relocation is mechanical: preserve source, repair workspace/build/test references, and verify with fast targeted checks. Do not maintain duplicate live codebases. Existing shared packages remain in place. Do not rewrite a working portable contract just to move a host directory.

## NO FULL BUILDS POLICY — Fast Verification Policy

This owner policy supersedes earlier instructions asking agents to run full builds after changes. During regular coding and sub-agent iterations, full app/UI builds are strictly FORBIDDEN: `assembleDebug`, other assemble/bundle/release tasks, installer/portable packaging, `npm run build`, `pnpm build`, Vite builds and helper commands which invoke them (including the current Android sync/APK helpers). Do not launch an emulator unless the owner explicitly asks. Do not hide a full build inside another task name, script, test or lifecycle hook.

Full UI/app builds are permitted ONLY at the end of a major milestone when the owner explicitly requests a playable build. Earlier generic verification requests do not override this newer restriction. Stop planned builds when a task changes to this policy. Record fast-check success honestly; do not claim an APK, installer or playable build was produced.

**Humble View Pattern:** all state machines, validation, data parsing and business rules from BEHAVIOR_SPEC MUST live in pure, framework-independent core modules/classes or ViewModels with zero UI dependencies. Views render state and forward intent; they do not own business decisions. Inject clocks, ID generation, storage/network ports and platform effects so logic tests use deterministic data and fakes without mounting UI or building assets. Preserve tested shared rules rather than copying them into another framework. When touching existing UI-owned business logic, extract it into the pure layer before extending it; do not expand unrelated phase scope for a broad rewrite.

**Shared test vectors:** `specs/TEST_VECTORS.json` contains language-agnostic initial-state → input/event → expected-output/state cases derived from BEHAVIOR_SPEC. Every client MUST have a fast local unit test which loads that exact file and runs its actual pure core against it. Do not copy expectations into client files, skip unknown vector operations, recalculate expected values from production code or implement a second fake business engine inside tests. A changed global behavior updates the spec first, then the vectors, then client implementations. Test adapters may translate fixture shape into production calls, never decide the expected business outcome.

Use targeted unit tests and no-emit/syntax checks only during iterations. Examples such as `dotnet test --no-restore --filter ...`, `compileDebugKotlin`, `tsc --noEmit` and targeted Vitest apply when that stack is actually present. This repository currently uses TypeScript/JavaScript plus a Java Android bridge, not a .NET Windows client or Kotlin Android core; use the equivalent targeted checks documented per client. Do not add a new framework or download a runner merely to imitate an inapplicable example command.

## Orchestrator responsibilities

1. Read the request, current spec, parity ledger and applicable client instructions.
2. Resolve shared behavior or contract changes in the spec first. If an actual decision is missing, ask the owner; continue independent work without guessing.
3. For an authorized global implementation, spawn isolated sub-agents scoped to `win/`, `android/`, and `web/` to implement/test in parallel. Explicit owner limits override this default: a client on hold receives no implementation work, and a Phase 1-only request cannot enable later phases.
4. Assign shared-package, root configuration and spec edits to a separately named owner. Client agents must report shared fixes to the orchestrator instead of racing edits in shared files.
5. Require each client agent to report changed paths, exact verification commands/results, artifacts and outstanding ambiguities. Independently inspect the results before claiming completion.
6. Update parity only for evidence actually obtained. Tests using fixtures, native compilation, emulator checks and physical-device checks are different evidence levels.

## Current owner decisions

- RELEASE-29 authorizes BOARD-07 and final local Windows, Android and Nextcloud packages at **0.6.29/build31** after focused checks and source freeze. Use Windows file version **0.6.29.31** and Android versionCode **31**. Preserve prior packages, technical identities and the permanent Windows shortcut. After privacy review, push source to the existing GitHub repository. Don't upload packages, deploy or install on user devices.

- RELEASE-28 authorizes EDIT-19 and final Windows and Android packages at **0.6.28/build30** after focused verification and source freeze. Preserve previous packages and technical identities and update `NextGlance-Latest.exe`. Run the shared protocol checks across all client harnesses. No push, deployment or device install is authorized for this milestone.

- RELEASE-27 authorizes WIDGET-09 and final local Windows, Android and Nextcloud packages at **0.6.27/build29**, with Windows file version **0.6.27.29** and Android versionCode **29**. Freeze after fast checks, preserve existing identities and prior builds, refresh `NextGlance-Latest.exe`, then push reviewed source to the existing GitHub repository. Do not install, deploy, or upload binaries.

- RELEASE-26 authorizes HISTORY-02, VIEW-18 and WIDGET-05 and final local Windows, Android and Nextcloud packages at **0.6.26/build28** after fast checks and source freeze. Preserve prior artifacts, storage/signing identities and the stable Windows shortcut target. No deployment, push or real-account writes.

- RELEASE-25 authorizes HISTORY-01 and final local Windows, Android and Nextcloud packages at **0.6.25/build27** after fast checks and source freeze. Windows file version is 0.6.25.27 and Android versionCode is 27. Preserve prior packages, identities and the stable Windows shortcut target. No push, deployment or live account writes.

- Windows portable packaging must update `win/release/NextGlance-Latest.exe` after every successful build. Use this stable shortcut target and retain all versioned release executables. If the target is in use, close the running copy and retry the update from the built versioned executable.

- RELEASE-24 (2026-11-23) authorizes the WIDGET-04 native presentation correction and a final local Android APK at **0.6.24/versionCode26** after fast verification and source freeze. Preserve prior artifacts and technical/signing/storage identities. No emulator, installation, deployment or push.

- RELEASE-23 (2026-11-23) packages VIEW-17 weekend appearance for all three clients at **0.6.23/build25** after fast checks and source freeze. Windows file version 0.6.23.25, Android versionCode 25, Nextcloud app 0.6.23. Preserve prior packages and technical/signing/storage identities. No deployment or push.

- RELEASE-22 (2026-11-23) packages Android **0.6.22/versionCode24** with WIDGET-03 grouping, time grids, readability and navigation plus SYNC-16 foreground connectivity recovery. Complete fast checks and freeze the source before packaging. Preserve earlier APKs and current Windows/Web packages. No installation, emulator, deployment or push.

- SYNC-15 (2026-11-22): audit/fix Android background restore, preserve historical cached source outcomes without write authority, reconcile jobs offline, expose per-family publication evidence and use hourly fallback defaults while retaining saved choices. Include with WIDGET-02 in the pending RELEASE-21 Android 0.6.21/versionCode23 after fast checks and a fresh source freeze. Earlier packaging was stopped before producing an APK. Windows/Web packages unchanged; no installation, emulator, publication or push.

- RELEASE-21 / WIDGET-02 (2026-11-22): the owner explicitly requested the corrected widget APK. Package Android **0.6.21/versionCode23** after the completed fast checks and source freeze. Preserve prior APKs, signing/application/account/storage identities and Windows/Web packages. Verify the distinct native widget layouts, packaged shared projection, icon notices and existing assets. No installation, emulator, publication, deployment or push is authorized.

- RELEASE-20 / WIDGET-01 (2026-11-22): implement independently configurable Android home widgets from the approved research/design, with transparent surfaces, cached native rendering and contextual creation. Package Android **0.6.20/versionCode22** only after fast verification/source freeze. Preserve prior APKs and Windows/Web versions/packages. No installation, emulator, publication, deployment or push. The existing shared composer is the initial safe creation path; a separate native capture write runtime remains follow-up work.

- RELEASE-19 (2026-11-22): after SYNC-14 investigation, implementation, fast checks and source freeze, package Android **0.6.19/versionCode21**. Preserve the prior APK, technical/signing/account/storage identities and current Windows/Web packages. This authorizes the requested final local APK, not device installation, publication, deployment or a new GitHub push.

- RELEASE-18 (2026-11-18): after SYNC-13 fast checks, the owner explicitly requested a corrected Windows build and GitHub push. Package Windows **0.6.18/build20** (file version0.6.18.20), preserve prior artifacts and technical identities, then push the reviewed source to `Byter3/nextglance`. Android and Web packages remain 0.6.17/build19. This authorizes the final Windows package and source push, not store submission, server deployment or publishing binary release assets.

- RELEASE-17 (2026-11-17): rebuild all clients with the approved BRAND-01 project icon at 0.6.17/build19 after source freeze. Windows file version0.6.17.19, Android versionCode19, Web app0.6.17. Preserve prior artifacts and technical/signing/storage identities. No deployment/publication.

- BRAND-01 (2026-11-17): the owner approved the stacked Calendar/rear-card, two timeline bars and foreground Tasks tick as the app icon. Canonical assets are in `packages/ui/src/branding/`; use the solid blue/white badge for launchers and appropriate monochrome glyphs for host/in-app surfaces. Gradient badges are approved alternatives. See `docs/BRANDING.md`. This authorizes source integration and fast checks, not a new release build or identity/version change.

- RELEASE-16 (2026-11-17): package the verified VIEW-16 sidebar correction across all clients at 0.6.16/build18 after source freeze. Windows file version0.6.16.18, Android versionCode18, Web app0.6.16. Preserve previous artifacts and identities. No publication/deployment is authorized.

- RELEASE-15 (2026-11-17): implement PERF-18/FILTER-03/VIEW-15/EDIT-18, then package all clients at0.6.15/build17 after fast verification and source freeze. Saved semantic filters now synchronize under FILTER-03; older device-local-only filter rules are superseded. Navigation/geometry remain local. No publication/deployment is authorized.

- RELEASE-14 supersedes older packaging targets: all clients use 0.6.14/build16 after EDIT-17/BOARD-06 fast checks and source freeze (Android versionCode16; Windows file version0.6.14.16; Nextcloud app0.6.14). Final packaging is requested; deployment/publication is not.

- The product's visible name is **NextGlance**. Preserve existing technical package/application/account/storage/protocol identifiers (including `/Workspace/Nextspace/`) so display renaming cannot lose profiles or break interoperability. See BEHAVIOR_SPEC Product identity before changing branding.
- The application remains an early private product. The owner authorized gradual patch increments. RELEASE-12 requests both Windows and Android 0.6.12, build 14 after EDIT-15, repository organization, parity checks and source freeze. Windows executable file version is 0.6.12.14; Android versionCode is 14. Prior packaged versions remain available. Increment once per requested release milestone, not during agent iterations. Do not publish, push to GitHub, deploy, or pick a license without an explicit request.
- Android implementation is delegated. The main orchestration context does not write Android application code.
- Native Android's primary connection method is the installed Nextcloud Files account/authorization flow; independent browser sign-in remains available. The browser preview uses browser sign-in. Saved account identity without authorization must expose working reconnection, preserving cached planner data and drafts (BEHAVIOR_SPEC 8.7).
- Following Phase 1, the owner authorized alternative browser sign-in and the Windows-equivalent Android planner presentation (BEHAVIOR_SPEC 8.4). The old SSO-only and foundation-screen-only constraints are superseded for this work; unimplemented native operations remain capability-gated and the no-full-build policy remains in force.
- The owner subsequently authorized native Notes content/tags, contextual date editing and linked calendar scheduling on Android/its browser preview (BEHAVIOR_SPEC 8.6). Implement these reference flows with per-operation gates and native concurrency safeguards; the old blanket mobile read-only restriction does not apply to these completed operations.
- The Web client is a Nextcloud-installed app, ID `nextglance`, visible NextGlance. The owner authorized implementation under WEB-01 on 2026-11-14, superseding prior hold instructions. Use existing session, native sources/shared planner metadata, online-only operation and scoped native theming. No private offline browser cache/outbox. Initial targets are Server 34.x and 35.x, each requiring real-server acceptance. Include a manual deployment guide; no production deployment or publication is authorized.
- The owner selected AGPL-3.0-or-later for project-owned code on 2026-11-14. Preserve dependency licenses/notices. Intended public source/server app are free of charge; paid Google Play/Microsoft Store distribution may follow. Do not publish or submit to stores without a separate request.
- Preserve native interoperability: use native Tasks/Calendar/Deck/Notes/Files operations where supported; custom metadata fills actual native gaps. No silent custom fallback after a native write fails.
- No real-account writes are needed for automated tests. Use isolated fixtures/profiles; never expose credentials, copy a Windows account into Android, reset account data, or replace missing source data with samples.

## Working safely and honestly

Treat publishable documentation, fixtures and examples as public GitHub content: use fictional names/items and reserved example domains, never personal account URLs, real work titles, machine paths, credentials or private screenshots. Keep runtime evidence, caches and historical private generated documents in Git-excluded paths. Do not copy account data into tests or guides.

Preserve unrelated user work. Clean only verified broken/generated boilerplate within the delegated scope; do not wipe working features or account data. Before recursive filesystem moves/deletes, resolve absolute paths and confirm they stay inside this workspace. Do not chain deletion through a second shell.

Keep schemas and protocols separate: workspace schema 2, folder protocol 1, local envelopes/platform caches have their own versions. Client-specific storage may differ physically while preserving contract semantics and security. FILTER-03 semantic preferences synchronize in their independent document; device-local navigation/geometry must not enter cloud organization.

Run relevant checks after changes. A web asset build is not an Android APK build; an APK build is not a successful device SSO test. Historical results must be dated and never reported as newly run. Do not mark an entire phase complete when required rows remain unverified.
