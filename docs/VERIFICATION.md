# Development checks

Read [AGENTS](../AGENTS.md), client instructions and [behavior/parity contracts](../specs/FEATURE_PARITY.md) first. Full builds are forbidden during normal iterations. A final playable build requires an explicit owner request; no emulator or real-account writes are part of the checks below.

From the repository root, using installed dependencies:

```powershell
pnpm typecheck
pnpm --filter @nextspace/android typecheck
pnpm --filter @nextspace/nextcloud typecheck
pnpm --filter @nextspace/nextcloud test
node --test win/tests/spec-vectors.test.mjs android/tests/spec-vectors.test.mjs web/tests/spec-vectors.test.mjs
node --test tests/<changed-feature>.test.mjs
node --test android/tests/<changed-service>.test.mjs
```

All three vector consumers load the exact same `specs/TEST_VECTORS.json` and exercise production pure rules. Add focused protocol/service/UI regressions for changed behavior; vector success alone does not verify host wiring or touch interaction. On a clean checkout, prepare Android's generated plugin configuration with `pnpm --filter @nextspace/android native:prepare` as described in [Android setup](../android/README.md#clean-checkout-setup). Check native Java changes with `:app:compileDebugJavaWithJavac` and targeted `:app:testDebugUnitTest --tests "<fully-qualified-test>"` from `android/android/`, using the provisioned JDK/SDK.

Browser and Electron fixture tests use isolated profiles, fictional records and loopback servers. Keep screenshots/logs under ignored `artifacts/` or `.runtime/`; never copy an account or private source data into fixtures. Some UI scripts start a development server but must not invoke an asset build during iterations. Read a script before running it.

For source hygiene, run `pnpm check:repository` before staging and `node scripts/check-repository.mjs --staged` afterward. The latter reads the actual Git index, including content hidden by later working-tree edits. Also review `git diff --cached --check` and the staged file list. Automated patterns do not replace reviewing examples and images for personal information. Old one-off live-account diagnostic scripts and retired client prototypes are not part of the published source.

Web host PHP fixtures use a PHP 8.2+ CLI (`PHP_BINARY` may point to it). Without PHP, those cases report skips; do not count them as passing. `pnpm --filter @nextspace/nextcloud test:ui` verifies the embedded presentation in a fictional Nextcloud-like shell. These checks do not establish actual Server 34/35 middleware/session or installation compatibility.

## Final packages

After authorized source freeze:

- Windows: `pnpm package:win` writes `win/release/`. Run `node tests/desktop-smoke.mjs --packaged` against that unpacked package with an isolated profile, and compare packaged assets/shared modules with frozen source.
- Android: `pnpm --filter @nextspace/android apk:debug` runs the final asset/native build and JVM tests; output is under `android/release/`. Check manifest version/build, application ID, signature, bundled frontend/worker assets and absence of a development-server URL.
- Nextcloud Web: follow [manual deployment](../web/DEPLOYMENT.md) for the explicit asset build, package layout/source archive, checksum, installation and rollback. No live deployment is implied by creating an archive.
- Record hashes, exact results and known limitations in [release evidence](RELEASES.md). Preserve previous packages and signing/profile identities.

Compilation, fixture parity, packaged smoke and physical-device acceptance are different evidence levels. Device upgrades, Files authorization, real server behavior and sustained frame/thermal performance must be tested separately before claiming them. No publication, upload, signing-certificate purchase or license selection is implied by creating local packages.
