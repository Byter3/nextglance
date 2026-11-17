# NextGlance for Android

The Android client shares its planner interface, portable core and Nextcloud protocol with Windows and the Nextcloud web client. Current package evidence and artifact locations are recorded in [Releases](../docs/RELEASES.md). Generated APKs remain local under `android/release/` and are excluded from source control.

[BEHAVIOR_SPEC.md](../specs/BEHAVIOR_SPEC.md) defines behavior; [FEATURE_PARITY.md](../specs/FEATURE_PARITY.md) records actual verification and remaining acceptance checks. See the root [README](../README.md) for workspace setup.

## Connect and use

On a phone or tablet, **Continue with Nextcloud Files** is the primary account flow. **Sign in using browser** provides independent Nextcloud authorization. The browser development preview uses browser sign-in through its local trusted bridge. Credentials remain in the native host or preview server, never planner metadata.

Overview, Calendar, Timeline, Board, List, Spaces, source/tag groups and status mappings use the shared responsive interface. Native operations include:

- Notes content, Markdown checklists, native Files tags and expanded editing.
- Task/card creation, descriptions, dates, completion and native statuses/stacks.
- Calendar creation, editing, deletion, reminders and supported organizer/attendee operations; linked scheduling preserves its recoverable create-and-link journal.
- Native Deck dependencies, labels, colors, note/file attachments, upload and detach.
- Collectives page text/images, native related-resource recommendations and planner metadata export to a chosen file.

Permissions, complex recurrence and delegated scheduling restrictions remain explicit. Unsupported native behavior opens in Nextcloud instead of creating a different custom representation.

## Storage and synchronization

Native snapshots, pending edit recovery and device preferences live in account-specific private device storage. Shared organization and cross-source links use workspace schema 2 / folder protocol 1 under `/Workspace/Nextspace/`. Source data stays native to Nextcloud. Identifiers, application ID `com.nextspace.app` and signing identity are preserved across upgrades.

The first cached display is separate from authorization and data freshness. Verified current collection permissions enable target-checked edits during a longer source refresh. Reads/parsing/cache work run in the background worker; confirmed edits are persisted before success. Incremental scans reuse exact ETags and certified inventories. Partial reads never claim a complete source or delete unseen data.

Background intervals and Wi-Fi preference are available in Settings. Android controls actual job timing. Native background reads use PROPFIND/GET with ETag reuse; foreground independent authorization also supports REPORT. On API 26+ with a capable JavaScriptSandbox provider, background reads update the usable private read/launch state without opening a WebView. Older or unsupported providers retain downloaded resources and report that projection is unavailable. See [SSO.md](android/SSO.md) for provider limitations.

## Clean-checkout setup

Install the workspace dependencies as described in the root README. Native checks also need JDK 21, Android SDK platform/build-tools 36, `JAVA_HOME`, and `ANDROID_HOME` (or a local, ignored `android/android/local.properties`).

From the repository root, prepare the installed Capacitor plugins:

```sh
pnpm --filter @nextspace/android native:prepare
```

This regenerates ignored Gradle/plugin configuration for the current dependency paths. It creates the empty native asset directory needed by Capacitor's update step; it does not build or copy the application UI, run Gradle, download an SDK, or produce an APK. Run it after installing or changing native plugins. Generated `capacitor.settings.gradle`, `app/capacitor.build.gradle`, native assets, caches, SDK paths and signing files do not belong in the public repository.

## Development checks

During regular iterations, use targeted checks only:

```powershell
pnpm --filter @nextspace/android typecheck
node --test android/tests/spec-vectors.test.mjs
node --test android/tests/native-edit-services.test.mjs android/tests/source-write-policy.test.mjs android/tests/planner-export.test.mjs
node --test android/tests/worker.test.mjs android/tests/startup-sync.test.mjs
```

The provisioned Java/Android toolchain supports targeted `:app:testDebugUnitTest --tests <class>` and `:app:compileDebugJavaWithJavac`. Full frontend/APK builds require explicit final-milestone authorization. Follow [AGENTS.md](AGENTS.md); do not run an emulator, publish or install onto a personal device during automated verification.

For an explicitly requested local debug APK on Windows, `pnpm --filter @nextspace/android apk:debug` builds the UI/headless assets, synchronizes native configuration and packages the app. The helper accepts `-JavaHome` and `-SdkRoot` when invoked directly. Keep release signing credentials outside source control; the debug APK is not a store release.

Fixtures and compilation do not establish physical-device startup time, provider reliability, touch behavior, background timing or thermals. These remain separate phone/tablet acceptance checks in the parity ledger.

## Application icon

BRAND-01 fixes the NextGlance symbol in [canonical artwork](../packages/ui/src/branding/). Android uses the solid blue/white launcher badge, an inset foreground on adaptive launchers, and the same monochrome geometry for supported themed launchers. The existing `nextspace_icon` resource remains the splash icon; application and account identifiers are unchanged. The browser preview uses the canonical badge as its favicon.

`scripts/generate-branding.mjs` converts the canonical assets into Android vectors, density PNGs and the preview favicon. It accepts `--sharp-module=<installed sharp module path>` when the renderer is not available through normal module resolution. This is an asset-only conversion; it does not build or package the application. Resource compilation and image checks do not establish installed launcher or device acceptance.

Future UI builds copy the maintained root notice, project license and Apache license into `dist/legal/`; Capacitor includes them at `assets/public/legal/` in the APK. The artwork's third-party provenance and modifications are recorded in [NOTICE.md](../NOTICE.md). Updating notices does not retroactively alter existing APKs.
