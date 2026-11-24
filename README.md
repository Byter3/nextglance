# NextGlance

A planner for **Windows, Android and Nextcloud** that combines Calendar, Tasks, Deck, Notes and Collectives. Native data stays in its Nextcloud application; Spaces, groups and cross-app relationships use portable planner metadata. The Web client runs **inside Nextcloud**, using its existing login and requiring a connection.

This is an **early development project**, licensed **AGPL-3.0-or-later** for project-owned code. Source and the Nextcloud server app are intended to be free of charge; store clients may be paid. See [license](LICENSE) and [third-party obligations](NOTICE.md). Automated checks are available, but physical-device performance and real Nextcloud 34/35 acceptance remain in progress.

- **Using the app:** [short illustrated guide](docs/GETTING-STARTED.md).
- **Android home screen:** [illustrated widget examples](docs/WIDGET-EXAMPLES.md).
- **Android 0.6.32** · [Release notes](docs/RELEASE-NOTES-0.6.32.md) and [local package and checksum](docs/RELEASES.md#0632--android).
- **Windows and Nextcloud 0.6.31** · [Release notes](docs/RELEASE-NOTES-0.6.31.md) and [local packages and checksums](docs/RELEASES.md#0631--windows-android-and-nextcloud).
- **Development:** [architecture](docs/PLATFORM-ARCHITECTURE.md), [verification](docs/VERIFICATION.md), [Windows](win/README.md), [Android](android/README.md), [Nextcloud app](web/README.md), [manual server installation](web/DEPLOYMENT.md).
- **Behavior authority:** [specification](specs/BEHAVIOR_SPEC.md), [feature parity](specs/FEATURE_PARITY.md), [shared test vectors](specs/TEST_VECTORS.json). Read [AGENTS.md](AGENTS.md) before changing clients.

## Repository

```text
specs/      Shared behavior and acceptance contracts
win/        Electron host, tests and release output
android/    Capacitor/Java host, tests and release output
web/        Nextcloud session host, tests and manual deployment guide
packages/   Shared contracts, pure core, Vue UI and native protocol
tests/      Shared and Windows fixture/integration tests
docs/       Short guide, architecture, verification and release evidence
scripts/    Development and verification helpers
```

Runtime caches, dependencies, build output, packages and historical/private reports are Git-excluded. Root commands use the canonical client folders; no duplicate client codebase is maintained.

## Development preview

Use Node.js **22.12 or newer** and the pnpm version pinned in `package.json`. Install locked dependencies using `pnpm install --frozen-lockfile`. Native Android setup is documented separately in [android/README.md](android/README.md); generated native dependency paths are not committed. During development:

```powershell
pnpm dev
pnpm typecheck
pnpm --filter @nextspace/android typecheck
```

The Windows browser preview is a presentation surface; native account operations require its host. For Android's browser preview, run `Start-NextGlance-Android-Preview.cmd` from the repository root, keep its terminal open and visit `http://127.0.0.1:5174`. The launcher also supports the provisioned Node runtime. Native Android primarily uses the installed Nextcloud Files account flow; browser authorization is an alternative. The local preview is separate from the Nextcloud-installed Web client.

Full UI/app builds are forbidden during coding iterations. Only after an explicitly requested playable milestone and source freeze:

```powershell
pnpm package:win
pnpm --filter @nextspace/android apk:debug
```

## Data and compatibility

Planner metadata remains at `/Workspace/Nextspace/` (workspace schema 2, folder protocol 1). Existing technical package/application/profile identifiers intentionally retain `nextspace`; display branding is NextGlance. Source records and credentials never belong in planner files. Windows/Android local caches provide saved views and incremental synchronization; cloud freshness and write permissions are separate. The Nextcloud Web app is online-only and uses memory acceleration during the current page session, without a persistent private browser cache.

Use current versions on all clients before editing organization. Physical-device upgrades, live-server behavior and performance require device verification; passing automated checks is not a substitute. See the parity ledger for supported capabilities and remaining acceptance work.

## Before publication

Use fictional data and reserved example domains in fixtures, documentation and screenshots. Keep account exports, diagnostics, credentials, local SDK settings, signing keys and generated packages out of Git. Before committing:

```powershell
pnpm check:repository
node --test tests/repository-hygiene.test.mjs
git diff --cached --check
node scripts/check-repository.mjs --staged
```

The source check inspects Git candidates (or the exact staged blobs), rejects common private/generated paths and secret formats, and reports locations without copying secret values. It complements manual review; it cannot recognize every personal title or credential. Changes to application behavior follow the shared spec and focused checks in [verification](docs/VERIFICATION.md).

Public binary distribution additionally needs a complete dependency notice inventory, appropriate signing and live-platform acceptance. The current Android artifact is a development APK. Source is available at [Byter3/nextglance](https://github.com/Byter3/nextglance); the packages recorded in the release evidence remain local artifacts.
