# NextGlance feature parity and phased implementation

## Windows calendar refresh regression — SYNC-13

Reported 2026-11-18 on Windows 0.6.17/build19. The owner subsequently requested RELEASE-18: a corrected Windows 0.6.18/build20 package and source push. Android/Web packages remain unchanged; live-account acceptance is separate.

- [x] REPORT readers without a durable cache keep bounded calendar queries even when discovery returns collection tokens; task queries retain all native tasks.
- [x] Durable-cache and PROPFIND/GET readers retain incremental scanning, cancellation and checkpoint safeguards.
- [x] Windows retains the last successful source timestamp across transient/partial failures without fabricating fresh data or write eligibility.
- [x] Targeted protocol/Windows regressions and relevant shared-vector checks pass.
- [ ] Confirm successful refresh against the affected account using the new Windows build.
- [x] Build and verify the Windows 0.6.18/build20 portable package, retaining the previous release.

Fresh **2026-11-18** fixture evidence: both sync-token and ctag reproduced Tasks/Calendar TIMEOUT through the actual Windows Node wrapper with 512 fictional historical events and a simulated network clock. After the repair, each pass uses two component-filtered REPORT queries, preserves old completed and undated tasks, returns the current booking, and retains exact native raw documents/ETags. **163** targeted protocol checks, **60** Windows/core checks, **27** Android controller/Worker/headless checks, **43** Web session/controller/transport checks and **1,072** shared-vector assertions across all three clients passed. Root independently reran **22** relevant protocol/Windows checks; counts overlap. Delta fixtures now explicitly supply their cache port; a pre-existing projection-limit fixture supplies the identity required by the real projector, with the same expected limits. No account access, full build, new artifact, version increment or live-device acceptance was performed.

Subsequent **RELEASE-18 packaging, 2026-11-18**: Windows **0.6.18/build20**, file version0.6.18.20, built after the explicit owner request. Actual portable extraction and all eight isolated startup checks passed; packaged protocol/security fixes, three legal notice files and all nine approved icon payloads match source. The 0.6.17 executable is unchanged. Android/Web were not rebuilt and no live account was accessed. [Artifact and checksum](../docs/RELEASES.md#0618--windows-build-20).

Authority: [BEHAVIOR_SPEC.md](BEHAVIOR_SPEC.md). Baseline audited 2026-11-11; current all-client release milestone 0.6.17/build 19. Workspace schema 2; folder protocol 1. Web implementation is authorized under WEB-01; historical hold notes below describe earlier milestones.

## Approved application icon — BRAND-01

Authorized **2026-11-17**. The selected stacked Calendar/rear-card, two timeline bars and foreground Tasks tick is the fixed NextGlance symbol. Color treatment follows the environment; see [BRANDING.md](../docs/BRANDING.md). The initial source/asset integration used fast checks only. The owner subsequently requested final rebuilt clients under RELEASE-17 at **0.6.17/build19**.

- [x] Canonical editable artwork, launcher badge, contrast-aware monochrome glyphs and approved alternative treatments recorded.
- [x] Shared product branding uses the approved symbol; functional source/status icons retain their meanings.
- [x] Windows native/window/packaging icon references and browser favicon updated; fast checks recorded.
- [x] Android legacy/adaptive/themed launcher, splash and preview assets updated; fast resource checks recorded.
- [x] Nextcloud white/dark app navigation artwork updated; fast host/asset checks recorded.
- [x] RELEASE-17: final 0.6.17/build19 packages with approved native/shared/host icons verified and prior artifacts preserved.
- [ ] Physical-device installation and real-server icon acceptance (separate evidence).

Fresh **2026-11-17** evidence: root `pnpm typecheck`, `pnpm --filter @nextspace/android typecheck`, and `pnpm --filter @nextspace/nextcloud typecheck` pass. The shared sidebar, product header and welcome mark inherit their existing foreground color. Canonical approval/hash checks cover ten assets; flattened delivery geometry matches the approved badge silhouette at greater than 99.99% overlap, with true transparent tick clearance. The root independently verified host asset equality, native path reuse and icon bindings.

Windows `node --check win/electron/main.cjs` and `node --test win/tests/profile.test.mjs` pass (**4/4**); the ICO contains validated alpha-enabled 16/20/24/32/40/48/64/128/256px frames and its existing package inclusion remains valid. Android isolated `aapt2` resource compilation and native asset validation pass; all fifteen density PNGs and the exact canonical foreground path are verified. Its foreground stays within the 66dp safe circle (maximum radius 30.44dp); legacy, adaptive-circle/squircle and themed previews were inspected. Web `node --test web/tests/php-host.test.mjs` passes (**3/3**), with canonical white/dark path/viewBox validation and 20/32/48px render inspection. The existing native packaging includes both app icon variants.

No planner behavior or shared test vectors changed. The initial BRAND-01 checks did not build, install or publish applications. RELEASE-17 packaging evidence follows separately; physical-device installation and live-server acceptance remain unverified.

RELEASE-17, **2026-11-17**: Windows **0.6.17.19** embeds all nine approved ICO frame payloads in both portable and unpacked executables; packaged window/favicon and visible header/welcome/navigation marks pass checks, as does packaged smoke. Its 41 UI assets match the build. Android **0.6.17/code19** retains its signing identity; all 15 launcher PNGs, compiled adaptive/themed/splash bindings, 47 UI assets and headless bundle match the approved source/build; **93 JVM tests freshly passed** across 13 suites. Nextcloud **0.6.17** packages the exact white and host-foreground icons, plus a self-contained shared SVG mark in its compiled JavaScript; runtime and corresponding source files match. All 374 frozen production/resource files and prior 0.6.16 artifacts remain unchanged. [Artifacts and checksums](../docs/RELEASES.md#0617--build-19). No emulator, device installation, live-account writes, deployment or publication occurred.

## Timeline sidebar correction — VIEW-16

Authorized 2026-11-17 after release 0.6.15. Following the fast checks, the owner requested final rebuilt applications under RELEASE-16: **0.6.16/build18**, preserving prior artifacts.

- [x] Timeline sidebar stays beside the grid on wide layouts and uses a bounded side overlay on narrow layouts.
- [x] Independent sidebar visibility and **Hide unscheduled items in timeline** checkbox preserve local saved placement/width and do not alter Calendar/Overview classification.
- [x] Pure transitions/shared vectors, geometric browser regressions and all-client fast checks; physical-device acceptance remains separate.
- [x] Final 0.6.16/build18 Windows, Android and Nextcloud packages verified after freeze, with prior artifacts preserved.

Fresh **2026-11-17** evidence: all **357 shared vectors** run through each client (nine new VIEW-16 cases); all-client no-emit checks pass. The shared UI fixture checks side-by-side/overlay bounds at 1600×980, 1180×720, 390×844 and 844×390, independent checkbox/sidebar actions, keyboard resize and persistence, plus existing Calendar/Overview/empty-tray behavior. Actual Windows Electron reproduced the old vertical layout from the unchanged package and verifies the corrected horizontal layout from current source. Android launch/account-preference checks and Web session/transport/preferences/scoped-CSS checks pass. The embedded Web fixture also verifies sidebar bounds and independent controls at 1360px, 900px and 430px, preserving session expiry and zero private browser-storage writes. No host-specific production code changes were needed. At completion of development checks, existing 0.6.15 packages were unchanged and the correction was source-only. Subsequent RELEASE-16 package evidence is recorded separately; physical-device acceptance remains unverified.

RELEASE-16 package evidence, **2026-11-17**: Windows portable **0.6.16.18** passed isolated packaged smoke and actual packaged sidebar/checkbox/resize/reload checks. All 40 UI assets, changed host files and 134 portable-core/protocol files match frozen source/output. Android **0.6.16/code18** retains its application/signing identity; 45 UI assets plus the headless projector match, with no development-server URL. Gradle reused the unchanged 93 passing JVM results across 13 suites (not a fresh execution). Nextcloud **0.6.16** includes matching app metadata, compiled assets, license and corresponding source. All 310 frozen production files and previous 0.6.15 artifacts remain unchanged. [Artifacts and checksums](../docs/RELEASES.md#0616--build-18). No emulator, physical-device installation, live-account writes, deployment or publication occurred.

## Responsive sync and planning — PERF-18 / FILTER-03 / VIEW-15 / EDIT-18 / RELEASE-15

Authorized 2026-11-17; target all clients **0.6.15/build17**. Spec section above older local-filter rules is authoritative. Fresh fixture evidence is recorded below; physical-device and live-server acceptance remain separate:

- [x] Indexed/bounded link picker, stable progress publications and large fictional-record performance evidence.
- [x] Safe shorter checklist creation transactions, partial-success recovery and compact touch-capable task editor.
- [x] Actual Windows Electron title/calendar control regression. Both tested creation paths passed; the reported obstruction was not reproduced, so no correction is claimed.
- [ ] Reproduce the reported Windows obstruction in the affected window/display state if it persists.
- [x] Android cheap cached restoration, metadata-only/token background checks, bounded prioritized requests, resumable retry and failure classification.
- [x] Headless shared projector updates usable account-fenced Android read generations; unsupported runtime fallback is explicit.
- [x] REPORT delta/multiget with expired-token/cancellation/deletion safeguards and SSO fallback.
- [x] Per-account/scope/page synchronized filters, local migration, conflict handling, startup retention and legacy folder compatibility across three hosts.
- [x] Shared Unscheduled semantics and hideable/resizable trays in Overview/Calendar/Timeline, optional undated Timeline rows.
- [x] Shared vectors, targeted protocol/host/UI/native checks and all-client no-emit checks.
- [x] Final 0.6.15/build17 Windows, Android and Nextcloud packages after source freeze; earlier releases preserved.
- [ ] Physical-device startup/thermal/background/provider acceptance and live Nextcloud34/35 acceptance (separate evidence).

Fresh **2026-11-17** evidence: **348 shared vectors** run in each client (**1,045** assertions including harness validation). Root independently passed **62** targeted preference/recovery/folder/dependency tests. Android reports **437** targeted JavaScript tests plus **36** additional Worker/edit/denial checks (overlapping suites), **49** freshly executed native JVM tests and successful Java compilation. All three no-emit checks passed. Shared browser fixtures cover two-device per-page/per-Space filters, partial startup, account isolation, no automatic default publication, Web offline no-replay, task title editing/touch dates/deduplication, and hide/resize/reveal across Calendar modes, Overview and Timeline. Empty trays reserve no space; a far-down jump in 2,000 unscheduled items renders at most 40 rows.

The link picker renders **18** rows for a **4,000-item** fixture, measured at about **128 ms** mount time on the development PC; this is not an Android timing claim. The new protocol tests verify incremental deltas/multiget and real shared headless parsers with cancellation/account/denial safeguards. Eight-row checklist creation uses two explicit cloud synchronizations while persisting all eight receipts durably. Actual Electron tests exercise title typing, visible native calendar popups and range-created events with an inspector open. Runtime evidence and private test profiles are excluded from source control.

Final packaging evidence, **2026-11-17**: Windows portable file version **0.6.15.17**, isolated packaged smoke checks and actual Electron production-asset event controls passed. Android **0.6.15/code17** retains its application and signing identity; all **45 UI files** and the headless projector match the build, no development-server URL is present, and **93 JVM tests across 13 suites freshly executed and passed**. The Nextcloud archive has matching app metadata, compiled assets, license and corresponding source. Prior 0.6.14 artifact hashes are unchanged. [Artifacts and checksums](../docs/RELEASES.md#0615--build-17). No emulator, physical-device installation, live-account writes, deployment or publication occurred.

## Native stack moves and dependency presentation — EDIT-17 / BOARD-06 / RELEASE-14

- [x] Native Deck stack moves verified against supported endpoint semantics; fresh destination acknowledgement and subsequent-edit baselines preserved across hosts.
- [x] Board drag floats with pointer/touch, indicates eligible target, commits once, cancels cleanly and retains scrolling/keyboard/status mapping behavior.
- [x] One incoming/outgoing Dependencies panel includes cards and tasks; task linking/creation/checklist actions and Jump to remain available.
- [x] Targeted protocol, host and shared UI checks; all three no-emit checks and shared vectors.
- [x] Final 0.6.14/build16 Windows, Android and Nextcloud app artifacts verified after source freeze.
- [ ] Physical-device touch/native Deck acceptance and live Nextcloud server acceptance (separate evidence).

Fresh 2026-11-14 evidence so far: **339 shared vectors** pass through Windows, Android and Web. The native move fixture models Nextcloud route-parameter precedence and Deck array/empty acknowledgements, with fresh readback, subsequent edit/move and real conflicts (**5** cases). The actual Web controller/native protocol and Windows preload/IPC/HTTP fixture verify consecutive move/edit operations. Android native-edit services/Worker pass **78** cases, source-write guards **10**, and **22** targeted native JVM cases run freshly; host adoption and restart retain the verified stack and revision. These tests use fictional data and do not establish physical-device or live-account acceptance.

Shared browser fixtures pass for desktop native/mapped Board drops, original grab offset, scoped inert preview, optimistic placement before acknowledgement, one native write, invalid targets, Escape/cancel, rollback/explicit retry and same-column manual order. Actual browser touch events verify tablet early-pan and phone hold/drop/cancel. The unified inspector fixture verifies mixed Task/Deck incoming/outgoing links, task actions, checklist recovery and navigation. **15** targeted gesture/window/keyboard/render cases pass; independent review ran **22** gesture/window/dependency cases. Root inspected fictional drag and inspector screenshots. All client no-emit checks pass. Counts overlap; physical-device and real-server acceptance remain separate.

Final packages: Windows executable **0.6.14.16**, **172** packaged files byte-matched and eight isolated unpacked-app checks passed. Android **0.6.14/code16** retains its application/signing identity; **45** frontend files match and **88 JVM tests freshly executed and passed**. Nextcloud **0.6.14** archive contains the matching app ID, license, **9** runtime files and **430** corresponding source files. All three previous 0.6.13 artifact hashes remain unchanged. [Artifacts and checksums](../docs/RELEASES.md#0614--build-16). No physical-device install or live-server deployment was performed.

## Deck tasks and linked navigation — EDIT-16 / NAV-02 / RELEASE-13

- [x] Explicit scoped task linking and contextual native task creation from Deck; incoming/outgoing Board stack semantics preserved.
- [x] Checklist preview and bulk selection, checked-state creation, duplicate/missing/ambiguous matching, synchronized reservations, same-request recovery and partial-failure handling.
- [x] Windows, Android and Web pass request identity/completion through guarded native VTODO creation; no unrelated native changes or private Web persistence.
- [x] Explicit jump controls reveal events/tasks in current date views, or offer Calendar/Timeline from Board/List; draft/scope/filter/undated safeguards.
- [x] Updated shared vectors, meaningful pure/native/host/UI checks and no-emit checks with fresh evidence.
- [x] Final Windows, Android and Nextcloud app 0.6.13/build15 packages with identity/version/content verification; no deployment/publication.
- [ ] Physical device and real Nextcloud 34/35 acceptance.

Fresh 2026-11-14 evidence: all **337 shared vectors** pass through each client consumer. **20** coordinator/native/recovery cases cover conditional retries, concurrent devices, changed reservations, canonical identity remapping, partial batches, missing targets, deliberate unlinking and empty labels; **3** pure navigation cases pass. Android native-edit/Worker tests pass **76/76**; Web controller/transport/native/PHP/package/CSS checks pass **48/48**. Actual Windows preload→IPC→fixture-DAV tests verify completed native creation, count/identity stability, lost-response recovery and preservation of later native edits. The shared desktop/phone UI fixture verifies scoped linking, dates/Markdown, unsaved-draft guards, canonical remap plus failed-write retry, checklist completion/deduplication, Calendar/Timeline/Overview reveal, preserved filters and actual incoming/outgoing Board placement without settled overlap. Windows native-editing and embedded Web session UI regressions pass. All three no-emit checks and package-boundary checks pass. Source-candidate scan found no known private markers or broken documentation links. These are isolated-fixture results, not live-account or physical-device acceptance; counts overlap with wider suites.

Final packages: Windows file version **0.6.13.15**, **170** packaged files byte-matched, eight isolated unpacked-app startup/persistence/guard checks passed. Android **0.6.13/code15**, retained application/signing identity and **45** matching frontend files; no development-server URL. Gradle reused its **88 passing JVM tests** (UP-TO-DATE, not newly executed). Nextcloud **0.6.13** compiled assets/archive contain the matching app ID, license and corresponding source; **9** runtime files and **426** source files matched. Previous Windows/Android 0.6.12 package hashes remain unchanged. [Artifacts and checksums](../docs/RELEASES.md#0613--build-15). No physical-device installation or live Nextcloud server deployment was performed.

## Nextcloud Web host — WEB-01, 2026-11-14

- [x] Authenticated PHP shell/session controller, internal ID `nextglance`, visible NextGlance; no separate sign-in or credential storage. Native PHP syntax and controller/template fixtures pass; real middleware acceptance is below.
- [x] Same-origin/base-path/request-token transport, expiry/account fences, HTTP304 validators and online-only behavior with no persistent private browser cache/outbox. Failed session verification disables writes even if the browser still reports online.
- [x] Shared five-view presentation, portable native source client and existing folder metadata protocol; no sample-data fallback. Pure source-refresh merge/validation is shared with Android, preserving its public exports.
- [x] Explicit native editing/attachment gates reuse shared validation/concurrency paths. Regressions cover first-note creation/category adoption, invite-specific permissions, late optional reads, targeted permission withdrawal, old-scan fencing and identity persistence during concurrent organization/native creation. Create-and-link booking remains omitted pending durable server recovery.
- [x] Web-only CSS scoping and `sessionHost` preserve host navigation/theme and suppress standalone login/theme controls. Actual desktop/phone fixture checks include contained menus, offline read-only controls, no private browser-storage writes and session-expiry view removal.
- [x] Fast unit/shared-vector/type/PHP syntax/isolated UI checks; results recorded individually below.
- [x] [Manual deployment/update/rollback guide](../web/DEPLOYMENT.md), requirements and missing acceptance stated. Packaging helper validates IDs/versions, includes matching source, excludes generated/private paths and never invokes a build; tested with artificial compiled assets only.
- [ ] Actual Nextcloud 34.x and 35.x installation/session/native-write acceptance. Local fixture success does not check this row.

Owner selected AGPL-3.0-or-later for project-owned code; third-party notices remain. Public source and free server app with optional paid store clients is the intended model. Publication/deployment is not authorized.

Fresh WEB-01 evidence: `node --test web/tests/*.test.mjs` passed **371 tests**, including all 329 shared vectors, PHP 8.3 syntax/controller/template checks, the actual default session/native/folder integration, transport/concurrency cases and fixture archive checks. Root, Android and Web no-emit checks passed. Root independently ran 20 source-refresh/Android foundation/cache cases; the shared owner also ran the broader Android regression sets. `node web/tests/session-ui.mjs` passed desktop/phone five-view, host containment, offline and expiry checks; root inspected both fictional screenshots. `node win/tests/native-editing-ui.mjs` passed the actual Windows entry's native task/note/scheduling and default-option regressions. Source-candidate scan: 632 files, no known private markers, generated candidates or broken documentation links. These counts overlap with separately reported component runs.

Two broader existing UI scripts were attempted but did **not** pass: `tests/ui-smoke.mjs` stopped at a contrast assertion (`link: 1`, `button: 10.48`); `tests/inspector-ui.mjs` stopped at an ambiguous “Search this view” locator after resize/Markdown/cancel/save checks. No renderer errors were reported. The contrast cause is not established; neither failure is counted as passing evidence. Shared styles were not changed by WEB-01. Full Web production assets/archive, real Nextcloud middleware/install/update/native-account acceptance, App Store schema/publication and performance acceptance remain unverified. No Windows/Android packages were rebuilt in this pass.

The earlier Web preparation hold was superseded by the owner's WEB-01 implementation and license decisions above. Historical Windows/Android milestone notes below retain their original scope; they do not put Web back on hold. Neither Server 34 nor 35 has real-server Web acceptance yet.

## Native parity and release preparation — 2026-11-14

EDIT-15 and RELEASE-12 specified before implementation. Both final clients target **0.6.12, build 14** after source freeze; Web plan review only.

- [x] Incoming/outgoing native Deck and planner dependency removal works in actual shared-App touch fixtures at 480×920 and 900×1200; failed writes preserve the relation with inspector-local retry and successful writes update both endpoints. Add dependency in both directions also verified.
- [x] Exact Android operation paths for dependency edits, card/status moves, native colors/tags/label creation, related-resource/page-asset reads and metadata-only export; no blanket mutation capability or custom fallback. Native file export handles cancel/write failure; path, origin, MIME, size and authorization guards cover Collective assets.
- [x] Fresh target/destination permissions, concurrency/readback, durable adoption and stale-refresh fences have focused regression evidence. Unknown permission evidence and stale destination stacks cannot authorize native writes.
- [x] P2-18 actual shared-App acceptance at phone/tablet touch sizes with Android capabilities: personal columns, planner block create/edit/delete and generic related-item add/remove save only metadata, with native records unchanged and no browser errors (`tests/personal-planning-mobile-ui.test.mjs`).
- [x] All 329 vectors through all three client consumers; Android owner 466 Node tests and 24 targeted JVM tests; shared owner 102 protocol/UI and 21 Board/status/readiness cases; root independently 83 Android/touch and 81 protocol/capability cases plus no-emit. Windows actual desktop→IPC→HTTP and native-editing UI fixtures passed. Counts overlap. Android intentionally uses Files/browser auth instead of direct-password `connect`; legacy `setTaskDue` uses the date editor and historical `migrateDeckNoteLinks` is not exposed. New attachments are native. Physical acceptance remains separate below.
- [x] All 27 prior Windows executables moved into `win/release/` with hashes unchanged; Android output stays `android/release/`. Root aliases and smoke paths repaired. Four maintained docs plus three fictional guide images replace public historical reports; original reports remain in ignored local archives. Source-candidate scan found no known personal-content markers, generated binary candidates or broken documentation links.
- [x] Web plan reviewed against current architecture; session lifecycle/CSRF, user-scoped browser persistence, host CSS integration, supported versions/app ID and license-before-installable-metadata decisions recorded in [architecture](../docs/PLATFORM-ARCHITECTURE.md#web-plan-review). No Web implementation or publication.
- [x] Final aligned **0.6.12/build 14** packages independently verified for manifests/file versions, content and retained identities. Windows eight packaged checks plus eight portable-wrapper checks passed; 164 packaged files matched. Android 43 assets matched, signature unchanged; 88 JVM tests passed in the first packaging run and unchanged results reused by the final frontend-only export-timeout correction. Root's final 18 Worker/export boundary tests passed. [Release evidence and hashes](../docs/RELEASES.md#0612--build-14).
- [ ] Physical-device upgrade, native account authorization, live-server edits and sustained performance acceptance.

## Android sync readiness, Deck editing and Board access — 2026-11-14

SYNC-12/EDIT-14/PRESENT-18 specified before implementation. RELEASE-11 authorizes final Android 0.6.11/code13 after checks and source freeze; Windows fast checks only, Web remains on hold.

- [x] Verify collection/board permissions independently of bulk projection; allow guarded native writes during refresh without falsely marking cached data fresh. Fresh denial disables the affected destination, fences older reads and preserves unrelated writable destinations and readable data.
- [x] Measured startup/sync improvements, incremental reuse, cancellation and concurrent-edit regression coverage. A 4,000-resource single-edit fixture uses one inventory, one changed-body download and two projections; unchanged resources are reused. Day rollover reuses certified inventory. Authorization overlaps private restoration; first cached publication precedes both. These are fixture results, not device timings.
- [x] Native Deck creation and Markdown description/checklist editing on Android with acknowledged recovery and explicit capabilities. Restricted native/preview transport guards, current destination checks and no automatic creation replay.
- [x] Scoped Board Create card action, correct tablet inspector layering and responsive controls. Actual 900×1200 touch browser fixture verifies creation during partial refresh, selected board context, Markdown save, inspector hit-testing and Close. Root inspected the fictional screenshot; physical WebView acceptance remains below.
- [x] All 329 shared vectors run through each client consumer. Root vector/helper/preflight run: 999 passed; independent protocol run: 189 passed, then protocol owner final 190 passed after scoped-denial evidence. Root Android startup/fingerprint/native-edit/Worker run: 94 passed; final denial/startup check: 51 passed. UI/transport/service owner: 91 Node, one browser fixture and 21 targeted JVM tests passed. Shared and Android no-emit checks passed. Counts overlap and are not additive unique-test totals.
- [x] Final Android **0.6.11/code13** APK built; all **85 JVM tests** freshly passed. Root independently verified manifest, unchanged signing identity, all **43** packaged frontend files, no development-server URL and unchanged prior Android/Windows artifact hashes. [Build evidence](../docs/RELEASES.md#earlier-milestones).
- [ ] Physical-device startup, sync throughput, concurrent editing, scrolling and portrait panel acceptance.

## Cache interoperability, calendar editing and Overview groups — 2026-11-13

SYNC-11/EDIT-13/ORG-07 specified before implementation. The owner requests final Windows and Android packages after fast checks; Web remains on hold.

- [x] Numeric-value native cache bridge decoding with actual JSON/PluginCall regression; recover intact caches without reset.
- [x] Existing-event details and explicit Edit/Delete availability; successful deletion invalidates resource/checkpoint caches.
- [x] Native ordinary organizer invitations, attendee responses and personal reminders, verified identity/privileges, guarded recurrence/delegation and fresh readback.
- [x] Formatted Markdown task creation/editing with native Android operation paths and durable recovery.
- [x] Independent source/tag groups in My overview, synced organization, protected drafts, Space isolation and unchanged ungrouped behavior.
- [x] Updated shared test vectors, targeted client/protocol/component regressions and no-emit checks. All 313 vectors run through each client consumer. Independent root protocol/group/vector verification passed 992 tests; final protocol/Windows suite passed 181 tests; Android service/cache/Worker/startup suite passed 182 tests plus a final 47-test native-edit rerun. Targeted native compilation and 27 actual JVM bridge/cache/policy tests passed. Shared UI/core suite passed 100 tests plus a compiled-render attendee draft-switch regression. Root independently reran 10 actual form/App/group tests and shared no-emit after source freeze. Suites overlap; these are not additive unique-test counts or physical-device evidence.
- [x] Final Windows **0.6.5** and Android **0.6.10/code12** packages built and independently verified. Windows passed eight isolated packaged smoke checks and 164 file comparisons. Android freshly passed 84 JVM tests; 43 assets, manifest and unchanged signature verified. Prior artifact hashes remain unchanged. [Build evidence](../docs/RELEASES.md#earlier-milestones).
- [ ] Physical-device and live-server acceptance, including cache upgrade and invitation delivery (not implied by automated checks).

## Direct manipulation and public guide — 2026-11-12

PRESENT-13 is specified before implementation. Final Windows/Android 0.6.2 builds are explicitly requested; Web remains on hold.

- [x] Whole-card and Timeline-label/group dragging without visible grips; click/tap preserved through deferred capture, touch pan/hold and keyboard supported. Native status moves retain existing rules and visible-target hit testing; overlays and offscreen columns cannot receive drops.
- [x] Distinct primary solid versus linked dashed Board highlights, including task stacks; primary state takes precedence through shared pure projection.
- [x] Denser aligned Timeline/Overview geometry: 44-pixel desktop and 40-pixel compact rows, with shared header/center values used by bars, dependencies, floating events and hit tests.
- [x] Short public-safe guide with three before/after grouping diagrams, independently inspected. Personal references removed from publishable docs/specs/test examples; legacy generated documentation/output stays local and Git-excluded after deletion was blocked by automatic approval review.
- [x] **511 targeted tests pass**, including all 146 shared vectors through three consumers, actual Board/Timeline SSR, pointer adapter and fixture regressions; shared no-emit and changed fixture syntax checks pass. Android's independent no-emit/input/render/vector run passes 159 cases. These overlap; device acceptance remains separate.
- [x] Final **0.6.2** Windows portable and Android code-4 APK built. Windows packaged isolated smoke passes eight checks; four assets, 51 shared modules and host entries match ASAR. Android signature/manifest and seven fresh assets verified; JVM test task was up-to-date, not newly executed. Both artifact hashes independently confirmed. [Build evidence](../docs/RELEASES.md#earlier-milestones).
- [ ] Physical touch/scroll responsiveness, browser visual comparison and live-account sync acceptance.

## Stable ordering and linked task stacks — 2026-11-12

PRESENT-12 was specified before implementation. The owner then authorized final Windows/Android packages and one gradual patch increment to 0.6.1; Web remains on hold.

- [x] Stable date/link timeline ordering independent of scrolling; no automatic attention buckets. Shared pure grouping is the sole source for sibling ordering.
- [x] Synced per-scope custom row/group/Board order with pure validation, identity remapping, conditional folder round-trip, independent merge and conflicting-order tests. Android path policy/checkpoint supports arrangement files; actual controller save/restart/offline restoration is covered.
- [x] Mouse, keyboard and touch reorder handles; reset; unchanged membership/status/date semantics. Actual Vue hook fixtures cover long press, early pan, no-op release, cancellation, non-primary second touch, permission loss and horizontal/group boundaries. Physical touch remains unverified.
- [x] Board link highlighting, optional directional task stacks, expansion and completion treatment. Actual Vue component SSR verifies one copy per item, incoming/outgoing placement, selected expansion, filtered completion, empty columns and grouping off. This is structural rendering, not browser/device visual acceptance.
- [x] Practical Markdown guide: about 700 words, three existing diagrams, no regenerated HTML/wiki.
- [x] Final shared no-emit check and **433 targeted tests** pass: 135 shared vectors through all three consumers, strict harness, ordering, pointer adapter, empty columns and Board rendering. Core/Windows folder/identity/preference regression run passes **209 tests**; Android controller/transport/native policy runs pass **24/13/18 tests**. Suites overlap; totals are not additive unique-test counts.
- [x] Fresh final **0.6.1** Windows portable and Android code-3 APK produced; prior 0.6.0 artifacts retained. Packaged Windows isolated startup/persistence smoke passed, frontend/shared ASAR files match. Android freshly executed **46 JVM tests**, APK signature/identity and all seven frontend files verified; background service/cache classes are packaged. Both hashes independently confirmed. [Build evidence](../docs/RELEASES.md#earlier-milestones). Includes preceding PRESENT-10/11 and SYNC-03 source changes.
- [ ] Physical-device scrolling/dragging, real-account cross-device order sync, and visual responsive acceptance. No account writes were used for verification.

## Android cache-first startup and incremental background sync — 2026-11-12

SYNC-03 records the owner's cold-start/long-refresh report before implementation. Development source and fast verification only; no APK build requested in this round.

- [x] Cached appearance/planner is returned before authorization, network, or full private hydration; edits stay guarded until durable restore completes. Synthetic launch fixture preserves all 2,274 records with authorization/private hydration blocked. Physical first-frame time is not claimed.
- [x] Persistent per-resource DAV/Deck validators survive process restart; fresh inventories handle changed/new/deleted/revoked resources and partial scans safely. Raw source documents are deduplicated in the private snapshot and charged once per resource in the projection budget.
- [x] Selective native refresh, independent once-per-entry planner download, finite request/pass deadlines and lightweight progress. Timeout/cancellation clears activity, including stalled post-read cache/reconciliation. Same-account reauthorization cannot orphan the restoring lock.
- [x] Device/account-local CalDAV and Deck intervals (manual/15/30/60/240 minutes) plus Wi-Fi option, implemented with persisted native jobs. Browser preview and Android scheduling limitations are explicit. Native scheduling execution on an actual device remains below.
- [x] Board/List reuse the compact top toolbar row with full content width. Calendar Day/Week pinch supports independent horizontal/vertical focal scales; Overview keeps its shared date axis aligned. Pure gesture and no-emit checks pass; rendered/multitouch acceptance remains below.
- [x] FLOW-03 keeps every defined Board column, including zero-count columns, after search/assignment/Show done/source filtering. Native source catalogs follow Space/group/project scope independently of filtered records; empty Deck boards stay selectable. Unified Unmapped and personal-planning Cancelled stay visible. 39 targeted Board/planner/status/selector tests pass; independent review found no scope leak.
- [x] 127 shared vectors through all three consumers plus harness and sync/gesture/date/incremental suites: **411 tests passed**. Android service regression run: **110 passed**, with final independent startup/resource run **18 passed**. Native compile and **45 targeted JVM tests** pass; root/Windows/Android no-emit checks pass. Protocol owner additionally verified **144 targeted tests**. These suites overlap; counts are not additive unique-test totals.
- [ ] Fresh rendered desktop/tablet/phone acceptance, physical multi-touch, measured device cold start/FPS, real-server incremental traffic, and OS background/Files SSO execution. No new APK/EXE or full app build was produced this round. The external Files SDK cannot cancel a pre-response Binder operation; caller deadlines, bounded threads and late-result rejection protect app state, but a wedged provider may retain a capped transport slot.

## Timeline floating context and navigation responsiveness — 2026-11-12

PRESENT-11/PERF-02 specify this follow-up before implementation. Fast verification only; no new full app builds requested.

- [x] Compact Timeline legend/band toggle moved into Page options; footer removed. The earlier Board/List corner-gutter arrangement is superseded by SYNC-03: use the shared compact top toolbar row, with Page options at the right and full-width content below. Shared source implementation; rendered acceptance remains below.
- [x] Fine-pointer desktop Board/List retains inline search and a visible options trigger when the inspector narrows the workspace. One control tree preserves the query, filters and Board settings through layout changes.
- [x] Mobile scroll-away Timeline headings and visible-event floating chips implemented; optional locally remembered desktop mode, native-interval intersection and three-lane cap. Drag/resize ghosts remain visible without removing the captured chip. Scroll measurements are isolated from the work-row projection.
- [x] Local view changes avoid full planner saves; pending saves retain newer view fields. Pure selector/count work is reduced, and Android reuses unchanged identity reconciliation with account/revision/record invalidation and no duplicate automatic-sync notification. [CPU measurements](../docs/RELEASES.md#earlier-milestones) use isolated 2,274-record fixtures; 36 complete selector-output comparisons and Android final-state equivalence pass.
- [x] Final 112 shared vectors pass all three consumers plus harness (**337 tests**). Targeted planner/navigation/background/canvas/gesture/projection run passed 61 tests, then the added floating-preview regression passed with all six projection tests. Android's 84 controller/metadata/native-edit/cache tests passed. Shared/root, Windows and Android no-emit checks pass; changed layout CSS parses. No app builds or account writes. Guide HTML regenerated with six embedded figures and verified internal anchors.
- [ ] Fresh rendered desktop/tablet/phone acceptance, floating-event mouse/long-press feedback, mobile Board toolbar spacing, and physical-device frame rate. Browser-origin restriction remains respected. The development server received HMR updates; existing EXE/APK files remain the preceding milestone.

## Overview cleanup, calendar periods and first-use guide — 2026-11-12

PRESENT-10 records the new owner request before implementation. Shared presentation/core changes apply to Windows and Android; Web remains on hold. This round uses fast checks; the preceding build artifacts do not yet contain these changes.

- [x] Removed Overview's bottom Dates row; its divider is visually 4 pixels with an overlapping pointer target and keyboard resizing. Existing shared date-canvas navigation remains. Updated two old UI fixtures for the removed footer; those fixtures were syntax-checked, not browser-run.
- [x] Board controls respond to the actual workspace width beside an inspector, with the prior column-layout override corrected. Timeline event chips omit subtitles while retaining accessible time/source details and the detailed event picker.
- [x] Calendar Day/Week/Month modes implemented with local per-account/scope preference, pure period arithmetic, month item projection and existing edit/creation/gesture guards. Month retains source stripes at clipped visible edges. This is implementation evidence, not rendered or physical-device acceptance.
- [x] Final root/shared, Windows and Android no-emit checks passed. All 104 shared vectors pass through each of the three consumers, plus one harness check; 23 calendar/preference, 10 canvas/gesture and 25 Android native-edit tests pass: 371 tests in total, zero failures/skips in final runs. Android's scheduling fixture was corrected to return the reconciled metadata revision, matching production; no runtime behavior was changed or assertions weakened. Web remains a test harness only.
- [x] Historically created an illustrated offline guide with 18 sections and six explanatory diagrams; superseded by the [short public Markdown guide](../docs/GETTING-STARTED.md). Old generated documents are local-only and excluded from Git. The historical browser/print rendering was not verified.
- [ ] Fresh rendered desktop/tablet/phone acceptance, Month mouse/long-press interactions, source-stripe clipping and physical-device performance. The saved browser-origin restriction remains respected. Development server received the changes; EXE/APK artifacts remain the preceding milestone.

## Unified controls and requested client builds — 2026-11-12

PRESENT-09 was written before implementation. It supersedes the earlier demo-only limit for this explicitly requested final Windows/Android packaging; fast checks remain the iteration rule and Web stays on hold.

- [x] Implemented one tablet/phone Page options control tree, including Board source/mapping controls; desktop search is left, applicable dates centered and filters right.
- [x] Implemented a phone current-page dropdown and compact global-actions overflow with directly visible cloud status. Board/List Page options use the existing header corner without a reserved toolbar row or content overlay. Same state and handlers are retained across breakpoints.
- [x] Final shared/Windows and Android no-emit checks passed; four layout stylesheets parse. Code review covers mutual menu dismissal, Escape/native Back, focus return, the 320-pixel header budget and bounded date-label overflow. Android's 95 shared-vector cases passed. These are not rendered responsive acceptance.
- [ ] Current desktop/tablet/phone rendered acceptance and physical-device gesture verification. The saved browser-origin restriction remains respected; no current visual pass is claimed.
- [x] Fresh same-version Windows portable package and Android APK produced. Windows packaged disconnected startup/persistence smoke passed; four Windows dist files and seven Android frontend files match bundled assets. Android signature/application identity and both artifact hashes independently verified. Native JVM results were up-to-date, not newly executed. See [current build evidence](../docs/RELEASES.md#earlier-milestones).

## Previous placement preview — 2026-11-12

PRESENT-08 records the owner's desktop/tablet/phone placement feedback before implementation. Development demo only; no APK, installer or production asset build.

- [x] Implemented upper scope/view navigation and contextual sidebar Space/project menus. Explicit editor context is a pure projection; six new shared vectors plus three isolated helper tests cover unrelated selected groups, stale targets and detached drafts.
- [x] Implemented shared Board toolbar and one narrow-layout Page options menu. One control tree/state owner preserves search, filters, range and Board mode across resizing; Escape, Android Back and modal focus return were reviewed in code.
- [x] Implemented shared spacing tokens and one Overview Dates scrollbar; retained vertical scrolling, date axis and gesture adapter. Removed forced phone canvas height and corrected header/inspector offsets and menu stacking.
- [x] Fast verification: 95 shared cases through all three consumers plus harness and three helper tests passed **289 assertions**; ten canvas/gesture tests passed separately. Final Windows/shared and Android no-emit checks pass. Four layout stylesheets parse. No app builds or live-account writes.
- [ ] Current rendered desktop/tablet/phone acceptance and physical-device gesture checks. Demo process is running and receiving updates; its saved browser-origin restriction prevents automated visual review. Historical browser tests are not current placement evidence.

## Previous development preview — compact surfaces, continuous canvas and sync cost, 2026-11-12

Owner feedback and the later phone screenshots supersede week-paging touch behavior and nearly opaque inspector shells. PRESENT-04, PRESENT-06, PRESENT-07 and PERF-01 were revised before implementation. This milestone is a development preview only: **no new APK, installer or production asset build**. The installed APK described below remains the previous milestone.

- [ ] Visual acceptance pending: one shared glass-shell rule, opaque content, compact controls and one actionable sync notice are implemented. Pure helper/merge tests and no-emit checks pass; updated glass browser fixtures have not run because browser origin access was declined.
- [ ] Final touch acceptance pending: continuous pixel panning, bounded shared date buffer, frame-coalesced gestures, bounded inertia and no week snap are implemented. Ten pure/adapter tests pass. The earlier 19-group browser run passed; an expanded phone precision test exposed lost pre-threshold motion, now fixed but not browser-rerun. See the plan for exact evidence boundaries.
- [x] Android public snapshots omit private raw payloads before cloning; metadata-only operations avoid serializing unchanged native source caches; lifecycle cancellation does not become a source failure. Included in the final 102-test Android/protocol run; 2,274-record host microbenchmark improved from roughly 20–21 ms to 4 ms median.
- [x] Correct DAV transfer-reservation accounting for known failed responses; conservative unknown-transfer accounting and the 256 MiB bound remain. Diagnostics include safe failure-code counts and explicitly shared Tasks/Calendar scan totals; targeted regressions pass.
- [x] Fast conformance: 89 shared JSON cases through three consumers plus harness and ten canvas/gesture tests passed 278 assertions. Windows/shared and Android no-emit checks pass. No full app builds were run.
- [ ] Development demo visual review, complete post-fix browser rerun, physical Android performance and live-account resolution. The loopback review server is available; its in-app-browser opening was declined and was not bypassed.

Plan and evidence: [Development preview plan](../docs/RELEASES.md#earlier-milestones).

## Previous correction — Android calendar refresh and touch, 2026-11-12

The physical-tablet report exposed repeat-prefix starvation in the Files SSO fallback: every refresh downloaded the same first 250 files. Section 8.5 now specifies a complete logical scan using bounded cooperative batches and transient strong-ETag reuse, preserving native authorization and truthful completion/deletion semantics. Native source snapshots remain device-private. The two visible Personal tasks are a per-list count, with overdue/out-of-period rows collapsed, not the total source count. The owner withdrew the Notes-formatting issue after confirming it works; Notes formatting is unchanged. PRESENT-06 specifies two-axis touch navigation, focal pinch zoom and deliberate long-press editing before implementation.

- [x] Implement and verify complete Files-SSO calendar/task scans and cancellation without changing REPORT behavior. The 30 targeted shared-reader/Android-controller tests passed, including 303-resource completion, fair dispatch, exact-revision reuse, deletion/revocation, malformed root inventories, genuine limits, and cancellation. Separate Android controller/auth/metadata/native-edit regressions passed 76 tests; native write barriers and local cache formats are preserved.
- [x] Implement and verify two-axis touch panning, anchored pinch zoom and deliberate long-press item dragging in both calendar layouts and timelines. Real browser touch input through the Android entry passed 19 check groups at phone/tablet sizes with zero renderer errors, including icon hits, stationary holds, immediate retaps, third-finger suppression, resize handles and permission/cancellation guards. Existing mouse/trackpad regressions passed 26 checks. Both client no-emit checks passed; 79 shared vectors across three consumers plus harness validation and four gesture unit tests passed 242 assertions.

Evidence and cache/count explanation: [Android touch and sync correction](../docs/RELEASES.md#earlier-milestones). The owner subsequently requested an Android build: fresh production assets, APK assembly, signature/application identity and full bundled-asset verification passed. The Android release APK now contains this correction. Windows was not repackaged; emulator, physical-device and real-account acceptance remain unverified.

## Previous milestone — native Notes tagging, 2026-11-12

The owner requested one native Notes tagging control and new Windows/Android builds. Section 6.4 was updated before implementation: native Files tags are the single classification control; existing-note editors no longer expose an editable category field, title/content/checklist saves omit desired category, and new-note destinations use Folder terminology. Existing native folders and concurrency baselines remain intact. The same mounted native tag selector follows expanded editing, including pending/failed selections. Expanded Notes/conflict windows are opaque to prevent underlying text ghosting. No folder migration or custom-tag fallback was added.

- [x] Shared implementation and no-emit checks for Windows/Android; Web remains on hold.
- [x] 235 targeted native Notes/tag/content and shared-vector tests passed (69 vectors through three consumers, including test-only Web).
- [x] Windows entry and Android phone/tablet UI fixtures passed single-control, native save, failed-draft retry, folder preservation and capability-guard checks; final desktop/phone screenshots independently inspected.
- [x] Fresh authorized Windows portable and Android APK packaging, packaged Windows startup/persistence and final bundled-asset/signature/hash checks passed. Evidence and verification limits are recorded in [the Notes tags build report](../docs/RELEASES.md#earlier-milestones). Version remains 0.6.0; no live-account or physical-device acceptance is claimed.

## Previous material milestone — approved glass treatment

PRESENT-04 was specified before implementation. The owner approved the three glass mockups with a stricter requirement that every side panel remain nearly opaque and readable, and explicitly requested new Windows/Android builds at the existing version. Web remains on hold.

- [x] Shared glass surfaces, dense side panels and solid accessibility fallbacks implemented.
- [x] Desktop dark/light and mobile/tablet fixture presentation verified; existing layout and color identities preserved.
- [x] Fresh Windows portable and Android debug APK built and inspected; artifact details recorded in [the 2026-11-12 glass build report](../docs/RELEASES.md#earlier-milestones).

Evidence: shared no-emit check and four targeted theme/cache tests passed; 66 shared vectors across the three consumers plus harness validation passed 199 tests. Desktop dark/light and Android phone/tablet visual fixtures passed after correcting overlay ghosting and toolbar contrast. Existing Android native-edit UI flows and 29 freshly executed JVM tests passed. Windows production-asset visual checks, packaged desktop persistence/restart and actual portable-wrapper smoke passed. Android signature, identity and seven bundled asset hashes verified. See [visual QA](../docs/RELEASES.md#earlier-milestones). This is isolated fixture/build evidence, not physical-device or live-account acceptance. Web remains on hold; no versions or account/storage identities changed.

## Reading this ledger

Follow-up defect corrected on 2026-11-12: omitted Boolean host options were coerced to false at the shared presentation boundary, disabling native editing/scheduling in Windows despite healthy loaded sources. Pure capability tests and disconnected packaging smoke did not exercise that boundary; the earlier glass visual fixtures also used unavailable-write states and therefore missed it. PRESENT-05 explicitly preserves the intended defaults. The real Windows-entry regression `win/tests/native-editing-ui.mjs` failed before the fix at disabled Task status and passes after explicit prop defaults: task-status write, native-attached note save, Back navigation and create-and-link calendar booking, including version/revision payloads and readonly/unverified-source guards. Shared no-emit checking passed. Android's phone/tablet native-edit regression and runtime/offline/readonly guards also passed with its explicit false flags unchanged; no Android rebuild is needed for this Windows omission defect. The shared default vector now omits the host write flag; the three consumers plus harness and capability unit tests passed 202 tests. Replacement Windows packaging evidence is in the current build report.

- `[x]` means the feature is implemented in that client; evidence and limitations below still apply. `[ ]` means not yet accepted for this milestone, including existing code awaiting audit. Do not infer absence of all code from an unchecked row.
- Windows checks below are based on source and regression-test inspection, not a newly executed test run. Keep source inspection, fixture tests, native compilation and physical-device tests distinct.
- Android starts unchecked deliberately. Prior Android code and historical build success do not prove the new Phase 1 gate. The delegated agent must inspect it, reuse sound foundations, add missing checks and record new results.
- Finish a phase before enabling the next. Shared data integrity, account isolation and conflict protection are Phase 1 requirements, not optional Phase 3 polish. The owner's NO FULL BUILDS policy supersedes the original native-build gate: use targeted unit/type checks now; full app/APK/UI builds wait for an explicit playable-build request at a major milestone.
- Update only the assigned client's rows. Never check a row merely because its type exists, a stub returns success, a browser build passes, or a later-phase screen already exists.

## Phase 1 — Core, authentication and data foundations ONLY

Owner follow-up: the initial Phase 1 evidence below remains historical foundation evidence. BEHAVIOR_SPEC 8.4 now authorizes independent browser sign-in and responsive reference-client presentation. Verify the additional boundaries separately; do not infer full Phase 2/3 completion from a shared screen.

Allowed user-facing surface: a minimal connection/reconnection and read-only source/status shell needed to exercise services. Existing richer editors may remain in source but must not be enabled as part of this milestone. Phase 1 must not create native Tasks, events, cards, notes, dependencies or attachments. Metadata storage/synchronization services may be implemented and verified with isolated fixtures; no new Space/group/planning editor is authorized in this phase.

| ID | Requirement / acceptance boundary | Windows | Android | Web |
|---|---|---|---|---|
| P1-01 | Buildable host with explicit platform adapter, package boundaries, injected capability contract and no imports from another client's implementation | [x] | [x] | [ ] |
| P1-02 | Exact shared models/enums/schema validation; native/runtime/persisted representations distinguished; reject invalid limits/unsafe JSON without new cloud fields | [x] | [x] | [ ] |
| P1-03 | Stable account-qualified identities, canonical username, aliases/remapping, missing-reference retention and duplicate Deck-mirror exclusion | [x] | [x] | [ ] |
| P1-04 | Secure platform-auth lifecycle, cancellation/denial/reconnect/recovery/account isolation; established Android Files SSO foundation (alternative login tracked separately below) | [x] | [x] | [ ] |
| P1-05 | Safe authenticated transport with explicit capabilities/errors/timeouts/limits; Android bounded DAV fallback is declared; no fabricated HTTP/ETag guarantees | [x] | [x] | [ ] |
| P1-06 | Read native Tasks, Calendar, Deck, Notes and Collectives into exact shared records/collections; preserve completion, dates, dependencies, colors/tags and per-source failure/partial status | [x] | [x] | [ ] |
| P1-07 | Private durable per-account cache and metadata baseline, safe restart/recovery, revision validation, transient-failure retention and confirmed-revocation purge | [x] | [x] | N/A: online-only WEB-01; no durable private browser cache |
| P1-08 | Read/write services for schema 2 / folder 1, manifest generations, conditional writes/readback, tombstones and first-sync adoption; a clean client never overwrites cloud metadata | [x] | [x] | [ ] |
| P1-09 | Three-way merge, independent edits, conflicts, identity alignment and in-flight local-edit protection; dirty metadata is preserved on restart/failure | [x] | [x] | [ ] Merge/conflict behavior required; offline/restart persistence excluded by WEB-01 |
| P1-10 | Scope-independent metadata storage and device-local preferences kept separate; retain Spaces/groups/projects/relations/plans/status mappings without lossy normalization | [x] | [x] | [ ] |
| P1-11 | Lifecycle refresh, account barriers, truthful offline/syncing/error/stale/pending/synced projection and background-safe service behavior | [x] | [x] | [ ] |
| P1-12 | Capability gating: cached/unverified/read-only or unsupported operations cannot fake success; disconnected state never inserts sample data; Phase 2/3 write flows remain disabled on the Phase 1 client | [x] | [x] | [ ] |
| P1-13 | Shared JSON vector compliance, relevant targeted foundation/JVM tests and no-emit/native type checks pass; report commands/counts and distinguish deferred full builds/device testing | [x] | [x] | [ ] |

P1-12's phase restriction applies to a newly staged client, not removal of already accepted Windows functionality. A platform adapter may deliberately omit optional native-write capabilities during Phase 1; its implemented reads and persistence must still obey the full spec. Core pure business functions can be reused without exposing later-phase flows.

Required isolated Phase 1 scenarios: account A/B separation and stale replies; unavailable/cancelled auth; offline cached start and permission revocation; malformed/oversized documents; existing-cloud first login with zero writes; no-op synchronization; restart with pending metadata; independent concurrent changes; same-field and delete-versus-edit conflict; identity remapping; unknown source references; source partial failure and truthful freshness; local view/filter changes generating no cloud organization edits.

## Phase 2 — Main user flows

**2026-11-14 audit:** Android P2-01 through P2-18 are implemented with shared-core, native-host and isolated-UI fixture evidence, including the current EDIT-15 closures and focused P2-18 metadata-only interactions at phone/tablet sizes. Earlier milestone results are historical, not newly rerun. These checks do not establish physical-device/live-server acceptance. Original phase-scoping instructions apply to newly staged clients, not a rollback of the current Android client.

Do not implement or enable these while assigned Phase 1 only. The owner has now authorized the planner presentation and alternative login follow-up; native mutation rows still require their own working capability and evidence.

### Current follow-up acceptance

- [x] Android reconnection and native Files-first entry (BEHAVIOR_SPEC 8.7): saved unauthorized startup opens sign-in with the saved server; Reconnect enters sign-in instead of repeating refresh; native Files is primary, browser remains available; cancellation/session expiry preserve data and never claim connection success. Verified with targeted service, shared-vector and isolated phone/tablet UI fixtures below; physical Files handoff remains separate device acceptance.
- [x] Android Notes/date/scheduling parity (BEHAVIOR_SPEC 8.6): native Notes save/conflict review, assigned Files tags and tag creation, expanded shared draft and return navigation; contextual native date editing; durable create-and-link calendar scheduling. Verified with protocol/service fixtures, native compilation/JVM tests and isolated phone/tablet UI checks below; actual device/live-write acceptance remains pending. Unrelated unfinished writes remain gated.

- [x] Owner live-calendar correction: direct/browser authorization advertises REPORT and uses reference server-side queries; Files SSO remains bounded fallback. Same-account transport changes retain cache/planner state; partial/empty refresh warnings are truthful and authorized restored accounts refresh in the background. Targeted protocol/native/isolated-browser evidence recorded below; signed-in post-fix server confirmation remains pending.

- [x] Android alternative Login Flow v2: server authorization, bounded polling, cancel/replace/expiry barriers, canonical account selection, protected native credential persistence and targeted native checks. Fast native compilation/JVM evidence only; actual Keystore and browser-return device checks remain pending.
- [x] Local browser preview sign-in: loopback-only credential-isolated host bridge, no cross-origin credential proxy, source/metadata services and account separation; isolated protocol/browser checks plus anonymous live-server authorization handshake. Full signed-in live-source verification requires the owner to authorize on their server and remains pending.
- [x] Android entry uses the reference shared planner presentation and theme, including five views, Spaces and details; phone/tablet layout checks, explicit unsupported-action gates and truthful disconnected status. Native/device interaction parity remains separately pending.

| ID | Requirement / acceptance boundary | Windows | Android | Web |
|---|---|---|---|---|
| P2-01 | Independent My overview; saved Space source selections and per-Space groups; same source grouped differently in different Spaces | [x] | [x] | [ ] |
| P2-02 | Optional starter groups, atomic drafts, custom group creation, unavailable references, source moves/removal review and safe group/Space deletion | [x] | [x] | [ ] |
| P2-03 | Projects by sources and explicit records, linked context, membership/grouping precedence and stable retry IDs | [x] | [x] | [ ] |
| P2-04 | Assignment/source/search/attention filters, precise counts/order, scope-local preferences and per-layout Show done | [x] | [x] | [ ] |
| P2-05 | Overview shared date axis, Timeline, Calendar, Board and List with correct source and scope membership | [x] | [x] | [ ] |
| P2-06 | Native Tasks/card/event/note creation, explicit destination resolution, all-day/date conversion and partial membership-save retry | [x] | [x] | [ ] |
| P2-07 | Native task status/completion/progress and independent Deck completion/stack movement; exact readonly/unsupported gates | [x] | [x] | [ ] |
| P2-08 | Unified custom status mapping with zero/one/multiple native targets; no guessing; optional metadata-only Personal planning remains separate | [x] | [x] | [ ] |
| P2-09 | Item dates and descriptions editing, optimistic queues, latest-acknowledged versions, protected drafts and retry/discard | [x] | [x] | [ ] |
| P2-10 | Native Deck dependencies, cross-source custom dependencies, directed incoming/outgoing views and cycle prevention | [x] | [x] | [ ] |
| P2-11 | Create-and-link bookings, existing event linking, availability/conflict explanation and durable interrupted-booking recovery | [x] | [x] | [ ] |
| P2-12 | Global reviewed event matching with full ambiguity/scoring rules; only accepted pairs are saved | [x] | [x] | [ ] |
| P2-13 | Read/edit Notes, native category handling, note conflict review, return navigation and shared expanded-editor draft | [x] | [x] | [ ] |
| P2-14 | Safe Markdown rendering/rich-source modes, read-mode checklist toggles and card checklist projections | [x] | [x] | [ ] |
| P2-15 | Attach dialog: multiselect Notes, create-and-select note, Other files last, native Deck sharing/upload/detach and partial retry | [x] | [x] | [ ] |
| P2-16 | Native/source/item/status colors, native Deck labels and Task/Event categories, native Files note tags, inline tag creation and bounded suggestions | [x] | [x] | [ ] |
| P2-17 | Collective page content/authorized assets, open-native actions and related resources correctly separate from saved links | [x] | [x] | [ ] |
| P2-18 | Personal planning assignments/sessions and generic custom relationships without changing native source state | [x] | [x] | [ ] |

## Phase 3 — Interaction parity, polish and edge-case verification

The behavior below already exists to varying verified extents in the reference client; each new platform must adapt input/accessibility while preserving semantics. General integrity checks are required earlier and are expanded here, not first introduced here.

| ID | Requirement / acceptance boundary | Windows | Android | Web |
|---|---|---|---|---|
| P3-01 | Responsive readable layout, resizable details/split/editor where appropriate, keyboard/back navigation and protected drafts | [x] | [ ] | [ ] |
| P3-02 | Pointer/touch input appropriate to host: move/resize/create preview, cancel, snapping, no accidental click-after-drag | [x] | [ ] | [ ] |
| P3-03 | Date zoom and horizontal movement; Calendar hour scaling; preserved pointer/date anchors; Overview and Calendar parity | [x] | [ ] | [ ] |
| P3-04 | Persistent routed end-to-start dependencies, unscheduled anchors, bidirectional linked hover/focus and event-column highlight | [x] | [ ] | [ ] |
| P3-05 | Continuous multi-day boxes, clipped leading source stripe, all-day breathing room, accessible full-day calendar scroll and no duplicate plan interval | [x] | [ ] | [ ] |
| P3-06 | Nextcloud theme/background, explicit theme fallback, color contrast/readable status options, tags and accessible action names | [x] | [ ] | [ ] |
| P3-07 | Measured nonblocking selection/edit/refresh; structural state reuse, bounded note results/asset loads, no-op reads avoid unnecessary persistence | [x] | [ ] | [ ] |
| P3-08 | DATE/DST/millisecond/half-open-boundary regressions, canceled prerequisite behavior, missing endpoints and complex recurrence limitations | [x] | [ ] | [ ] |
| P3-09 | Interrupted native writes, partial attachment/tag success, post-create metadata failure and reviewed note conflict-again paths | [x] | [ ] | [ ] |
| P3-10 | Multi-client fixtures: organization independence, identity convergence, restart/concurrent sync/tombstones and field conflict retention | [x] | [ ] | [ ] |
| P3-11 | Real host/device lifecycle, provider authentication, permissions, keyboard/insets/large fonts and physical cross-device synchronization | [ ] | [ ] | [ ] |

## Known exclusions: do not mark as parity features

No general durable offline native-write outbox; ordinary optimistic native edits remain in memory. No automatic dependency-chain rescheduling or group dragging. No server-wide free/busy guarantee. No comprehensive complex recurrence/invitation editor. No universal atomic Deck write guarantee. No full timeline virtualization. No complete generic planner conflict-resolution editor. Standalone Calendar currently scrolls existing horizontal overflow but does not pan to adjacent weeks at the edge; Timeline/Overview do support accumulated edge date-panning. Web is online-only under WEB-01, with no offline private cache/outbox. Durable create-and-link booking recovery and actual Nextcloud 34/35 acceptance remain outstanding for Web; normal creation followed by explicit linking is a separate supported path.

Existing compatibility import/migration code is documented in BEHAVIOR_SPEC separately. It is not a license to invent legacy formats or new migration UI. Shared readers must preserve supported current wire formats; ask the orchestrator before expanding compatibility scope.

## Evidence ledger

### Specification baseline — 2026-11-11

Read-only inspection of shared contracts/core/protocol, reference host/UI and regression tests. No new test pass is claimed by this baseline. Existing docs/VERIFICATION.md and client verification records are historical evidence; retain their dates and limitations.

### Android Phase 1 — fast foundation gate accepted, 2026-11-11

Android P1-01..P1-13 are implemented and verified at the currently authorized fast-test/type-check level. The entry point mounts only a connection/source-status/read-only item shell; existing Phase 2/3 editor components remain unmounted. Native source mutations and automatic Deck conversions are unavailable. Product display name is NextGlance; existing application/package/account/cache/protocol identifiers and version 0.6.0 are retained.

The commands and results below are historical Phase 1 evidence. The superseded standalone report is archived locally; current instructions are in [Android verification](../android/VERIFICATION.md). Historical helper names below are not current setup commands.

- Targeted controller/cache/metadata/foundation/lifecycle/vector run: **112 passed**, no failures or skips, including all **36** cases loaded directly from `specs/TEST_VECTORS.json`.
- Focused rerun after physical cache-key preservation and display renaming: **54 passed**, including **11** transport tests; overlapping tests are not additional unique coverage. These two runs cover **123 distinct Android Node tests**.
- Shared native-source/mobile-DAV/portable-connector fixtures: **98 passed**. Windows/Android/second-Windows/restart interoperability: **2 passed** after the single sandbox atomic-rename failure was rerun with required approval. Fixtures only; no live account writes.
- `pnpm --filter @nextspace/android typecheck`: **passed**, `vue-tsc --noEmit`, no asset build.
- `powershell -NoProfile -ExecutionPolicy Bypass -File android/scripts/check-native-foundation.ps1`: actual Java bridge/activity/test source compilation **passed** with provisioned JDK 21, SDK 36 and pinned cached dependencies; **6 JVM policy tests passed**. This direct compile does not verify resource/manifest/APK packaging.

The final focused review verified semantic cache fallback survives a subsequent failed write, local timestamps/identifiers are injectable, cached themes are normalized/restored per account, and the established physical cache key is retained. Account barriers, auth recovery, private/native versus public representations, partial failures, first-sync zero writes, durable local baselines/revisions, merge/conflict/restart preservation, 1,200 ms cloud-only debounce and local-only preferences have fixture coverage.

**Deferred by owner policy:** full Vite/UI/Gradle app/APK builds, packaging and emulator runs. No newly built APK is claimed. Physical Files-app SSO, real provider conditional writes, phone/tablet lifecycle/accessibility and actual cross-device synchronization remain unverified. Phase 2/3 Android rows remain unchecked. Provider-normalized HTTP successes and in-flight cancellation limits remain explicit contract limitations; no unresolved Phase 1 specification decision is concealed.

### Web — on hold

Nextcloud-installed application; no UI/server implementation, build or device claims. The owner explicitly authorized a test-only local harness reading TEST_VECTORS.json; a passing harness does not mark Web app functionality implemented.

### Cross-client fast conformance and reference-host safety — 2026-11-11

The orchestrator independently ran `node --test win/tests/spec-vectors.test.mjs android/tests/spec-vectors.test.mjs web/tests/spec-vectors.test.mjs`: **109 passed, zero failed/cancelled/skipped, 226.1748 ms test duration**. This is the same 36 fixed JSON cases executed through each client's local harness, plus one harness-validation test. Expectations are loaded from `TEST_VECTORS.json`; the shared test adapter calls production pure functions. This establishes those core examples, not complete UI/transport/device parity.

Additional focused checks: root no-emit typecheck passed; 41 reference-host account/scheduling/background/page/link-migration tests passed; three package-boundary tests passed after path relocation; six shared theme-cache tests passed; twelve Windows profile/auth-restore tests passed after NextGlance branding. Windows explicitly retains its original account/session data directory despite the visible-name change. Fixture filesystem restrictions required approved reruns where recorded; no live account was used.

All client instruction files enforce the Humble View Pattern and NO FULL BUILDS policy. No full UI/app build, new APK/installer, emulator launch or publication was performed. Existing release artifacts remain historical and are not outputs of this milestone.

### Android authorization and reference presentation follow-up — 2026-11-11

Owner review explicitly superseded the foundation-screen-only and Files-SSO-only restrictions. BEHAVIOR_SPEC 8.4 and agent instructions were updated before implementation. The Android entry now mounts the same shared planner as Windows, with host capability gates, native Files account selection and independent server-browser authorization. Phone Overview dates have a minimum readable width and synchronized horizontal scrolling across timeline, all-day items and timed calendar. Details use the full phone width; tablet retains the aligned split layout. No sample records are inserted into real accounts; screenshot fixtures are isolated tests.

- Independent orchestrator run: `node --test --test-reporter=spec android/tests/controller-login.test.mjs android/tests/controller.test.mjs android/tests/controller-metadata.test.mjs android/tests/browser-host.test.mjs android/tests/preview-bridge.test.mjs android/tests/transport.test.mjs` — **74 passed**, zero failed/cancelled/skipped. Includes pending/single-use/expired/cancelled authorization, canonical account/cache retention, session restart, metadata barriers, origin/header/write bounds and host-only secrets.
- Native agent: `powershell -NoProfile -ExecutionPolicy Bypass -File android/scripts/check-native-foundation.ps1` — actual native sources compiled; **18 JVM tests passed** (request policy, pure authorization state machine and failed selection persistence). No resource/APK build.
- Independent shared regression run: the three client vector consumers plus `tests/package-boundaries.test.mjs` — **112 passed**, zero failed/cancelled/skipped. Existing 36 language-neutral vectors unchanged because record/planner rules did not change.
- UI browser verification: `node android/tests/shared-planner-ui.mjs` — real disconnected surfaces at phone/tablet/wide sizes and isolated sign-in, five-view, detail, host-subscription, native Files option, account-separated browser cache and aligned phone scrolling checks. Unsupported Deck-to-Deck dragging is rejected during preview/drop; supported Task-to-Deck metadata linking remains available. Screenshots under `artifacts/android-reference/`; fixture screenshots are not user account data.
- Final Android and root `vue-tsc --noEmit` checks both passed. Focused browser-host, Deck dependency and background-state regression run: **19 passed** (overlaps the 74-test run above; not 19 additional unique cases). Browser automation needed an approved rerun outside the sandbox to start Edge; no UI asset build ran.
- Final read-only review confirmed the pair-aware dependency gate applies to both Overview and standalone Timeline and found no further high-confidence authentication/cache issue.
- Anonymous live-server handshake through the actual preview host: begin authorization on a private test server (address omitted), verify login origin, poll pending, cancel with no account selected — **passed** after the network-restricted attempt was rerun with approval. No credentials obtained, account login, source edits or planner writes occurred.

The preview bridge is a local development helper, excluded from production configuration. Its credentials/poll tokens are memory-only; browser storage holds validated nonsecret account identity and account-qualified cached data. Native direct credentials use Android Keystore-backed encryption; device verification of that storage and return lifecycle remains pending. Native source creation/editing/dependency/attachment writes remain unavailable on this host. These acceptance checks do not mark all Phase 2/3 rows complete. No full build, APK, installer, emulator run or publication was performed.

### Android calendar transport and refresh feedback correction — 2026-11-11

The owner reported Tasks/Calendar hitting the bounded fallback's 250-file safety limit. An isolated signed-in preview read reproduced the failure before this correction; Notes, Deck and Collectives loaded. The controller had applied the Files SSO fallback to every transport, including direct browser authorization. BEHAVIOR_SPEC 8.5 now makes the capability distinction explicit. Direct native/browser authorization advertises REPORT and uses the reference reader's server-side queries; Files SSO retains its honest bounded fallback. Unknown capabilities never grant REPORT. Same-account transport changes preserve the private cache locator, metadata store, baseline, checkpoint and pending changes.

- Android/shared protocol agent: `node --test --test-reporter=spec tests/dav-query-policy.test.mjs android/tests/controller-dav.test.mjs android/tests/controller-metadata.test.mjs android/tests/transport.test.mjs android/tests/preview-bridge.test.mjs android/tests/controller-login.test.mjs android/tests/controller.test.mjs android/tests/browser-host.test.mjs` — **85 passed**, zero failures/skips. The actual preview-host/controller/shared-reader fixture with 300 historical files performs two REPORTs and zero individual file GETs; its SSO counterpart still stops at the documented cap and reports partial results. No live source or planner writes.
- Native agent: `powershell -NoProfile -ExecutionPolicy Bypass -File android/scripts/check-native-foundation.ps1` — actual native sources compiled; **24 JVM tests passed**, including six added capability/query-policy cases. No APK/resource build or device claim.
- Orchestrator: `node --test --test-reporter=spec tests/source-refresh.test.mjs win/tests/spec-vectors.test.mjs android/tests/spec-vectors.test.mjs web/tests/spec-vectors.test.mjs` — **147 passed**, zero failures/cancellations/skips: 46 shared JSON cases through each client's consumer, one harness-validation case and eight source-feedback/eligibility cases. The Web consumer remains test-only.
- Shared presentation agent: eight source-feedback tests plus eleven existing background/draft regressions — **19 passed** (overlaps the run above). Root and Android no-emit type checks both passed. `node android/tests/shared-planner-ui.mjs --refresh-only` passed isolated browser scenarios for authorized cached/cold startup, failed/partial sources, reconnect/recovery/offline guards and unsupported Notes editing. The approved browser run took 6.23 seconds; no live-account requests or asset build. Cold/partial/empty phone screenshots under `artifacts/android-reference/` were inspected by the agent; the orchestrator also inspected partial/empty results.
- Independent read-only cross-layer review found no high-confidence regression in production query acceptance, native/preview boundaries, same-account method switching or pending metadata preservation.

Authorized restored accounts now start background refresh despite an initially unverified source snapshot. Empty failures show a retry panel; available-source counts determine partial warnings; no cache is claimed when no records are present. Authorization, source freshness and actual network-offline states are presented separately. Notes remains read-only because native source mutation support has not yet been implemented on Android; this fix does not expand that capability.

The final live check found the running preview without an active authorization. The owner must sign in again before post-fix live-source success can be confirmed. The 300-history-file regression is fixture evidence, not a claim that the owner's corrected signed-in refresh or a physical Android device was tested. No full build, APK, installer, emulator, publication or account-data reset was performed.

### Android Notes, dates and linked bookings — 2026-11-11

The owner authorized native editing for the previously disabled Notes, date and scheduling controls. BEHAVIOR_SPEC 8.6 and root/Android agent instructions were updated before implementation. The Android controller now implements native Notes create/read/update, assigned Files tag read/save, native task/card/event date updates and durable create-and-link bookings. Shared UI uses per-operation host/runtime/API checks; unknown or revoked native-edit capability does not enable writes. Other unfinished native operations remain disabled.

The shared Notes interface now provides formatted/source Markdown editing, read-mode checklist saves, assigned/contextual tags with inline creation, safe native category data, the expanded editor and protected Back navigation. Dates use the existing contextual mini timeline; booking uses the existing week calendar and source-aware destination/conflict rules. No Android-only replacement editor was introduced. Note titles in the shared expanded editor/picker now respect the specified 500-character limit.

Native edits adopt their acknowledged result without refreshing every source. Separate record and tag-metadata clocks preserve acknowledged changes while allowing a newer note body/category/version to arrive during tag reads. Identical assigned-tag reads do not rewrite source cache or organization. Scheduling keeps its own account-local journal, persists intent before creating the native event, and preserves request fingerprints across identity aliases. Lost responses, failed custom links, restart, changed-payload retries and deletion of a known-created event cannot silently create a second booking. Confirmed mutation authorization revocation clears cached source data and requires reconnection.

Evidence (overlapping runs are not additive unique-test counts):

- Service agent: `node --test --test-reporter=spec android/tests/native-edit-services.test.mjs android/tests/controller.test.mjs android/tests/controller-login.test.mjs android/tests/controller-metadata.test.mjs android/tests/controller-dav.test.mjs android/tests/foundation.test.mjs` — **73 passed**. A final targeted native-edit service run after adding concrete HTTP 401/revocation coverage passed **20/20**. The orchestrator independently ran the earlier **19/19** version and reviewed the final auth-cleanup change/test. Fixtures exercise the actual controller → transport → preview host → shared Nextcloud client with a fake server and metadata port; they do not merely assert UI payloads.
- Transport agent: scoped native-write/transport/preview/DAV checks **41 passed**; actual native source compilation and **29 JVM tests passed** using `powershell -NoProfile -ExecutionPolicy Bypass -File android/scripts/check-native-foundation.ps1`. An independent read-only cross-layer review found no additional high-confidence issue.
- Orchestrator: `node --test --test-reporter=spec android/tests/source-write-policy.test.mjs tests/package-boundaries.test.mjs` — **10 passed**. Shared-vector consumers plus `tests/native-operations.test.mjs` — **166 passed**: 54 JSON cases through three consumers, one harness validation and three capability-helper tests. Existing reference Notes-save/native-tags/date-editor/calendar-scheduler regressions — **38 passed**.
- UI agent: `node android/tests/native-edit-ui.mjs` — passed full phone (384 px) and tablet (900 px) linked-note/tag/checklist/editor/Back/date/scheduling/create-note flows plus six permission/runtime/offline scenarios, including dynamic capability revocation. `node android/tests/shared-planner-ui.mjs --refresh-only` — passed in 6.71 seconds. Both use isolated fixtures and no live-account requests. Screenshots `fixture-{note,date,schedule}-editor-{384,900}.png` under `artifacts/android-reference/` were inspected; the orchestrator independently inspected phone/tablet notes, phone dates and tablet scheduling.
- Final `pnpm typecheck` and `pnpm --filter @nextspace/android typecheck` both passed (no emit, no asset build).

P2-11/P2-13 are checked at the fast-test/isolated-browser/native-compile evidence level. Broader rows covering status editing, ordinary descriptions, Deck attachment mutations, other sources' tag editing and general creation remain unchecked. No full UI/APK/installer build, emulator, publication or real-account mutation was performed. Physical Android keyboard/touch/lifecycle and real Notes/Files/Deck/CalDAV writes remain separate device acceptance. Restart the development preview and sign in again to load the new host capabilities if using an existing preview process.

### Android reconnection and Files-first authorization correction — 2026-11-11

BEHAVIOR_SPEC 8.7 was recorded before implementation. A saved unauthorized mobile/preview startup now opens the connection dialog with the saved server; Reconnect opens that dialog rather than looping through refresh. Native Android presents Continue with Nextcloud Files first and keeps browser sign-in as an alternative. The preview uses browser sign-in. No external authorization is launched automatically, dismissed prompts stay closed during background updates, and runtime authorization loss leaves editors/drafts intact. Existing failed-edit/account-change safeguards remain; reconnection does not bypass or silently discard pending work.

The controller distinguishes preview session expiry/missing authorization from confirmed server authorization revocation. Expiry preserves caches, pending planner metadata and retry content, immediately gates writes, and invalidates late state adoption. Actual HTTP 401 is observed before source readers can turn it into ordinary partial-source status. Native picker cancellation preserves the previous account without refreshing or claiming success. Same-account reauthorization remains valid even if subsequent sources cannot all refresh.

Evidence (overlapping runs are not additive unique-test counts):

- Service agent: `node --test --test-reporter=spec android/tests/controller-login.test.mjs android/tests/browser-host.test.mjs android/tests/native-edit-services.test.mjs android/tests/controller-metadata.test.mjs` — **64 passed**. Existing controller and DAV regression files — **22 passed**. Android no-emit typecheck passed.
- Orchestrator independently reran the controller-login/browser-host files — **23 passed**; targeted actual-reader/session-expiry/HTTP-401/interrupted-note/metadata cases in native-edit-services — **6 passed**. These include the real shared client through fixture transport, not just mocked UI success.
- Shared `TEST_VECTORS.json` now contains **63 cases**, including nine fixed authorization-entry/confirmation cases. `node --test --test-reporter=dot win/tests/spec-vectors.test.mjs android/tests/spec-vectors.test.mjs web/tests/spec-vectors.test.mjs` passed **190 tests** (three consumers plus harness validation). The production auth-entry helper's four targeted unit tests also passed.
- `node android/tests/reconnect-ui.mjs` — **passed**, six isolated browser contexts covering native phone/tablet Files-first entry, preview sign-in, cancellation/unavailable/disconnected replies, partial-source authorization, startup/dismissal, saved retry versus Reconnect, and runtime draft preservation. Screenshots `fixture-native-reconnect-{384,900}.png` and `fixture-preview-reconnect-384.png` under `artifacts/android-reference/`. The orchestrator inspected phone/tablet layout; the UI agent inspected the final corrected source-status fixture.
- Final orchestrator `pnpm typecheck` passed (`vue-tsc --noEmit`). Independent read-only native wiring and final cross-layer review found no remaining high-confidence issue.

No full build, APK, emulator, live-account mutation or publication. Actual Files-app consent/lifecycle and native phone/tablet acceptance remain device checks. Reload the existing preview tab to receive the repaired sign-in entry; no cache reset or credential copying is required.

### Explicitly authorized playable-build milestone — 2026-11-11

The owner then requested full Windows and Android builds. This authorizes this milestone's packaging; the fast-verification policy remains unchanged for later ordinary iterations. Both artifacts were produced at **0.6.0**, with existing application/account/cloud identifiers preserved. See [build report and checksums](../docs/RELEASES.md#earlier-milestones).

- Windows: `release/NextGlance-0.6.0-Windows.exe`, **101,112,460 bytes**. Frontend/type checks and Electron portable packaging passed; ASAR runtime dependencies/current assets inspected. Packaged desktop smoke passed with isolated metadata persistence/restart, followed by actual portable-wrapper startup/navigation/sandbox smoke with exit code 0. The wrapper test was added at `win/tests/portable-smoke.mjs`; no app source/configuration repairs were needed.
- Android: `android/release/NextGlance-0.6.0-Android-debug.apk`, **11,348,176 bytes**. Production frontend, Capacitor sync, `:app:assembleDebug` and `:app:testDebugUnitTest` completed; **29 native JVM tests passed**. Debug APK v2 signature, `com.nextspace.app`, version 0.6.0/code 2, label NextGlance, min API 24/target 36 and seven bundled asset hashes verified. No development-server URL or preview Node host is packaged; no source/configuration repair was needed.
- The orchestrator independently verified both artifact hashes. Build dependency network access and Gradle's daemon connection required approved sandbox escalation. The nonblocking bundle-size/tooling/resource warnings are recorded in the build report.

These builds supersede historical statements that no current APK/executable exists; they do not mark unfinished features or physical-device/live-server acceptance complete. No emulator, physical installation, owner-profile mutation, version bump, publication or Web-client implementation occurred.

## Android startup/sync and compact timeline context — 2026-11-12

SYNC-04/PRESENT-14 specified before implementation. Final Android 0.6.3/code5 APK authorized; no Windows packaging, Web stays on hold.

- [x] Cache-first first paint independent of full hydration/authorization; bounded provider/auth/planner work with accurate independent completion/error states. Implemented; injected-clock/queue/cache tests, not phone timing evidence.
- [x] Planner data has a peer source-status row with folder, last success and actionable status/error. Independent successful planner passes remain distinguishable from native-source failures; restart cannot restore a live verification proof.
- [x] All-day touch pan/pinch and visible-cutoff labels implemented in both calendar surfaces. Actual input-adapter and component tests pass; physical gesture acceptance remains below.
- [x] Local left-list collapse, bar titles and filtered collapsed-group schedule previews preserve aligned dates and stable order in pure/component tests.
- [x] Targeted pure/vector/component/native tests and no-emit checks: 521 shared checks including 169 vectors through three client consumers; 274 Android host checks (overlapping vectors); 139 protocol/projection/native-edit tests; 57 native JVM tests. Root, Windows and Android no-emit checks pass. These overlapping totals are not a unique-test sum.
- [x] Android 0.6.3/code5 packaged and independently verified after source freeze. Build helper succeeded (154 Gradle tasks, 30 executed), 57 JVM tests reran with zero failures. Manifest, unchanged signature and all eight frontend asset hashes verified. See [artifact, checksum and limits](../docs/RELEASES.md#earlier-milestones).
- [ ] Physical phone/tablet cold startup, Files SSO, incremental large-calendar sync and gestures verified by device testing (separate from builds).


## Android diagnostics, Space organization and compact calendar — 2026-11-12

DIAG-01/SYNC-05/ORG-05/PRESENT-15 specified before implementation. Android0.6.4/code6 final packaging authorized.

- [x] Opt-in bounded sanitized diagnostic recording, shared controls, native copy/document export and UI/network/cache instrumentation implemented. Recorder privacy/session and actual control/fallback tests pass; native export on a phone remains separate below.
- [x] Large-source cache/retry work improved; independently completed sources survive another source timing out. The 4,962-resource fixture uses 159 batched cache reads and zero unchanged downloads; this measures bridge-call reduction, not phone latency.
- [x] Per-Space status map inheritance/override and unified status filtering in every layout, with synced maps and local filters. Core/editor/Board rendering, merge/folder and preference checks pass.
- [x] Tag-based Space project/group membership, source constraints, deterministic placement and editor match feedback. Candidate tags include all loaded native sources while membership stays source-constrained.
- [x] Visible-day all-day sizing/resizing, denser date headers and themed accessible phone page dropdown. Pure geometry, real input adapters and rendered-component fixtures pass; Android Back is wired into the shared modal priority.
- [x] Root/Android no-emit checks pass; all 183 vectors pass through three consumers. The final Android diagnostics/cache/DAV/controller/native-edit/vector subset passes 355 tests; native compile and 22 targeted JVM checks pass. Independent review reran 100 host and 53 protocol/cache/projection tests. Eight two-slot cache regressions cover partial revocation followed by timeout/background. Counts overlap and are not a unique-test sum.
- [x] Android0.6.4/code6 built after source freeze: 154 Gradle tasks, 25 executed; 63 JVM tests reran with zero failures. APK hash, manifest, unchanged signature and all eight frontend assets independently verified. See [build evidence and compatibility](../docs/RELEASES.md#earlier-milestones). Installed Windows0.6.2 safely rejects the new organization fields until updated; no Windows package was produced.
- [ ] Physical-device diagnostic export, long calendar sync and touch/performance acceptance (requires device evidence).

## Diagnostic-led sync and rendering repair — 2026-11-13

SYNC-06/DIAG-02/PRESENT-16 specified before implementation. Fast checks only; no new package/version requested.

- [x] Native cache maintenance cannot cancel sibling source reads; real account/mutation invalidation remains protected. Native compilation and 22 targeted JVM checks passed, including the runtime entry used by the bridge; orchestrator independently reran the four epoch/cache cases.
- [x] Source pass terminal diagnostics and complete cache-persistence timing; less redundant serialization with unchanged recovery behavior. Source/controller/auth tests cover exact-once cancellation, reconnect and late completions. Independent cache/DAV/startup run: 60 tests passed. Fresh-disk semantic checks, cancelled-write cleanup and raw-document fidelity remain tested.
- [x] Bounded calendar event rendering, cached date/tag projections and vertical-scroll geometry reuse. Calendar/layout/gesture/scheduling subset: 53 tests passed. Independent render/layout/touch subset: 14 passed. A 2,210-item fixture mounts 8 of 2,000 all-day controls and 90 of 210 timed controls while preserving full geometry; focused/editing controls survive window changes.
- [x] Immediate inspector shell, cancellable deferred auxiliary work and lazy closed organization content. Actual compiled setup/lifecycle fixtures verify obsolete selection/account responses, no-op tag updates, disposal and interrupted resource loading. Independent inspector/presentation/diagnostic subset: 9 tests passed.
- [x] Wallpaper-only glass treatment and safe compact landscape spacing implemented. Six imported CSS files parsed and rules independently reviewed; no active live backdrop blur remains. Landscape appearance and safe-area behavior on a physical phone remain unverified below.
- [x] Root, Windows and Android no-emit checks passed. All 189 shared vector cases pass through all three client harnesses. Cache and UI code independently reviewed; fixture measurements summarized in this ledger. Test subsets overlap and are not a unique-test sum. Existing Android0.6.4 APK SHA-256 is unchanged; no full build/version increment this round.
- [ ] Physical phone sync completion, thermal/battery and interaction acceptance on updated app (pending later build/device test).

### Android 0.6.5 packaging — 2026-11-13

Owner explicitly requested the final APK after the source fixes above.

- [x] Android incremented once to 0.6.5/versionCode7; application/signing/storage identities preserved.
- [x] Final frontend/native package succeeded: 154 Gradle tasks, 30 executed; all 67 JVM tests reran with zero failures/errors/skips. Manifest, unchanged signature, eight bundled asset hashes, no development server and APK checksum independently verified. See [build evidence](../docs/RELEASES.md#earlier-milestones).
- [ ] Physical-device sync completion, thermal behavior and gestures verified (not established by packaging).

## Tablet-led execution and incremental-sync redesign — 2026-11-13

SYNC-07/SYNC-08/DIAG-03/PRESENT-17 specified before implementation. Final Android0.6.6/code8 is authorized after source freeze; no Windows package or Web implementation.

- [x] Android controller/parsing/cache work isolated from presentation; bounded allowlisted platform RPC, account/sequence guards, explicit crash recovery and no main-thread fallback. Issued journal writes survive worker replacement; uncertain edits are never replayed automatically.
- [x] Cache restoration starts before full interface imports; launch checkpoint appears independently of private hydration/authorization, with native writes still gated. Actual worker tests cover background entry during blocked cold hydration with zero authorization calls.
- [x] Durable verified DAV checkpoints and missing-resource-first resumption avoid repeated complete scans/projection. Fresh permission/token checks and native write invalidation remain mandatory. Actual discovery XML, parser spies and host-recreation fixtures verify reuse.
- [x] Native batch cache guards/conversions reduced without weakening revocation, corruption, account isolation or byte bounds. Native compilation and 28 targeted JVM checks pass.
- [x] Latest-only supplied-snapshot adoption, bounded Board rendering and lazy editor loading retain drafts, selection, linking, ordering and gestures. Native acknowledgement baselines prevent stale remote adoption and avoid incorrectly protecting already-saved content as a draft.
- [x] Real worker-thread, cache/checkpoint, controller/native edit, UI adoption/window, shared-vector and no-emit tests pass; fixture measurements recorded separately from device results. See evidence below.
- [x] Final Android0.6.6/code8 APK built and independently verified: 154 Gradle tasks, 31 executed; all 69 native JVM tests reran with zero failures/errors/skips. Manifest, unchanged certificate, all 39 frontend asset hashes, dedicated worker, no development-server URL and APK checksum verified. The generated worker also booted in a Node Worker fixture. See [build evidence](../docs/RELEASES.md#earlier-milestones).
- [ ] Physical tablet/phone cold-start, large-calendar sync completion, interaction/temperature and repeated reopen acceptance.

Fast evidence before packaging (overlapping runs, not a unique-test total):

- Android owner: 277 Node tests across worker/cache/DAV/native edits/browser host/vectors; 28 targeted native JVM tests and Java compile; Android no-emit check. The worker file contains 11 tests against the actual worker runtime/controller, not a second implementation.
- Shared UI owner: 58 targeted queue/App/Board/lazy-editor/inspector/diagnostic/editing tests; root no-emit check.
- Orchestrator: all 206 shared vectors through all three client consumers plus six recorder tests (625 tests including harness validation); 75 DAV/cache/projection cases; 43 startup/DAV/actual-App cases; 11 final worker cases; seven UI/Board/diagnostic cases. Root no-emit passed independently.
- Independent read-only integration review: worker/account/publication/crash recovery and 34 focused controller regressions; no remaining concrete blocker.
- Worker fixture restores 7,000 records / 9.7 MB while the presentation heartbeat continues. A 1,000-resource unchanged collection performs zero resource body reads and zero repeated calendar parsing after fresh discovery. A 2,000-card Board mounts seven complete stacks; 100 supplied state notifications produce one adoption without extra state fetches. These are desktop fixtures, not physical-device performance measurements. See [performance notes](../docs/RELEASES.md#earlier-milestones).

## 0.6.6 device follow-up: completion, booking touch and sync tails — 2026-11-13

EDIT-09/SYNC-09 specified before implementation. Fast verification only; no new APK requested this iteration.

- [x] Android native task/Deck completion/reopen, exact native semantics and operation-specific UI gates; stale/read-only/account/retry guards tested.
- [x] Scheduling preview touch body/start/end manipulation, early swipe scroll and cancellation without writes; mouse/keyboard parity retained. Actual component fixtures cover cancellation, immutable submitted payloads, stale-source draft editing and DST gap rejection.
- [x] Repeated large planner document reads and redundant source-cache persistence reduced with fresh validators and durable edit/journal recovery intact. Regressions include damaged archive/overlay recovery, both-generation retirement, missing archive followed by newer server data, and freshness-only restart.
- [x] Planner diagnostics and indicators reflect returned error/conflict/offline/pending outcomes accurately; provider failures preserve cache and do not replay uncertain edits. Individual native deadlines cancel only owned request resources.
- [x] Targeted protocol, native/controller, actual input-adapter, shared-vector and no-emit checks pass; evidence recorded without claiming physical acceptance.
- [ ] Physical phone/tablet scheduling duration, completion controls, preview touch and sync stability verified on a later packaged build.

Fresh evidence (overlapping runs, not a unique-test total): orchestrator reran 207 Android controller/cache/native-edit/worker/startup tests, 194 shared protocol and metadata tests, and 671 shared-vector/preview/actual-touch tests. All 219 language-neutral vectors ran through Windows, Android and the reserved Web test harness. Actual App/completion/touch adapter regression set passed 19 tests before the additional DST regressions. Root and Android no-emit checks passed after changes. Targeted Java compilation and 13 local JVM cancellation/deadline tests passed with zero failures/errors/skips. No APK/assets/installer build or version change occurred.

Independent review found and closed a DST preview interval bug and two acknowledged-edit recovery bugs. Final frozen Android edit/recovery subset independently reran 44/44 tests. Synthetic I/O fixture: a single edit in a 7,000-record / 9,243,967-byte archive wrote a 1,589-byte overlay without archive reads. Warm unchanged planner fixture: zero document GETs and five PROPFINDs. These establish reduced work, not device saving latency or the cause of the reported external Files crash.

## Android 0.6.7 package — 2026-11-13

The owner explicitly requested the APK after the EDIT-09/SYNC-09 fast checks and source freeze. RELEASE-07 permits the final Android asset/native package, version 0.6.7/code9; previous packages and identities remain intact.

- [x] Final asset build, native sync, APK assembly and local JVM tests completed. Gradle: 154 tasks, 30 executed; all 73 JVM tests freshly passed with zero failures/errors/skips.
- [x] APK version/signature/checksum and all 39 fresh frontend asset hashes independently verified; prior 0.6.6 APK checksum unchanged. See [0.6.7 build evidence](../docs/RELEASES.md#earlier-milestones).
- [ ] Physical phone/tablet completion, booking touch, save latency and repeated-sync acceptance.
## 0.6.7 follow-up: native attachments, deletion and cache transfer — 2026-11-13

EDIT-10/SYNC-10 specified before implementation. RELEASE-08 authorizes final Android 0.6.8/code10 and Windows 0.6.3 after fast checks.

- [x] Recoverable sync failures use accessible cloud indicator; actionable recovery/conflict/save failures remain prominent; details/retry remain available while syncing. Production-helper vectors and actual App setup fixtures pass.
- [x] Android Notes/Files attachment selection, immutable note lookup, native share/readback, detach and explicit bounded upload support both authorization transports with exact operation gates. Protocol/controller/bridge fixtures and native compile pass; physical Files picker/provider acceptance remains below.
- [x] Confirmed ordinary calendar event deletion in Windows and Android, conditional writes, complex-event rejection, safe cache removal and stale-refresh resistance. Recovery fixtures include deleted events with both source archives unreadable and an older launch checkpoint.
- [x] Bounded native cache transfer preserves slot validation/account/cancellation/recovery rules without multi-megabyte presentation bridge strings. Actual worker, chunk adapter and native cache tests cover stale worker ownership, staged-write cleanup, stable read generations and atomic replacement.
- [x] Settings/selector idle work reduced; targeted production-helper, protocol, controller/native and no-emit checks recorded. Refresh-only connection changes do not rebuild planner selectors; stopped diagnostics has no polling clock and closed calendar-color sections do not mount their controls.
- [x] Both final packages independently verified with previous artifacts preserved: Android 0.6.8/code10, 80 freshly passing JVM tests, all 38 frontend asset hashes, manifest/signature/checksum; Windows 0.6.3, eight packaged smoke checks, all 150 packaged-file comparisons and version/checksum. See [build evidence](../docs/RELEASES.md#earlier-milestones).
- [ ] Physical phone/tablet attachments/deletion, sync responsiveness, warm/cold latency and thermal acceptance.

Fresh fast evidence (overlapping runs, not a unique-test total): all 246 shared vectors run through Windows, Android and the reserved Web test harness; 56 targeted protocol/Windows deletion/native-operation tests; 20 targeted actual-App/after-paint/diagnostic/publication tests; 142 Android cache/edit/worker/startup tests; final 28 preview-bridge/source-policy tests. Root and Android no-emit checks pass. Android Java compile plus 25 targeted JVM tests pass: NativeCacheFile (4), NativeMultipart (2), NextcloudSsoPolicy (19). No live-account writes, emulator, or physical-device performance measurements were performed.

## Space controls, per-page filters and event details — 2026-11-13

ORG-06/FILTER-02/EDIT-11/EDIT-12 specified before implementation; fast checks only.

- [x] Delete Space directly from its navigation menu, protected drafts, confirmation and safe synced organization removal.
- [x] Dependency choices limited to the current owning Space's sources, with complete-graph validation and submit-time recheck.
- [x] Per-page/account/scope filter persistence, bounded v1 migration and Android marker round-trip, without cloud leakage.
- [x] Board retains done Deck cards and directly linked completed tasks while hiding unrelated completed tasks; explicit filters and other layouts retain their rules.
- [x] Event deletion accepts unchanged REPORT/GET line-ending/folding differences and rejects real content/ETag changes.
- [x] Editable event title/location/description/reminders, linked-work defaults and durable scheduling retry payload parity. Android supports linked scheduling and editing ordinary events; its separate generic New event operation remains capability-gated.
- [x] Updated shared vectors and targeted client/protocol/UI tests; no-emit verification.
- [ ] Physical-device and live-server acceptance (not claimed by fixture tests).

Fresh orchestrator verification: 1,010 protocol/Windows/shared-vector checks passed (283 vectors on each client harness, including the reserved Web harness), 162 Android service/cache/worker/startup checks passed, and 45 core/actual-component/setup checks passed. Root and Android no-emit checks both passed. Actual input-adapter tests cover filter switching/reset, retained inspector drafts, stale dependency selection, event edit failure/success, native reminder preservation and frozen booking retries. Protocol tests reproduce REPORT LF versus GET CRLF using the same strong ETag; unsupported alarms and legacy pending-request digests remain preserved. No live-account writes, visual/device acceptance, APK, installer or version increment occurred. The previously packaged Windows 0.6.3 and Android 0.6.8 artifacts do not contain these development changes.

## Windows 0.6.4 and Android 0.6.9 packages — 2026-11-13

RELEASE-09 records the owner's explicit request for both final apps after the fixes above.

- [x] Windows portable 0.6.4, version check, 162 packaged-file comparisons and eight isolated smoke checks passed.
- [x] Android APK 0.6.9/code11, unchanged signing certificate, 44 packaged assets and 80 freshly rerun local JVM tests verified.
- [x] Independent artifact hashes and preserved previous packages documented in [build evidence](../docs/RELEASES.md#earlier-milestones).
- [ ] Physical-device/live-server acceptance (separate from packaging).
