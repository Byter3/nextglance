# Android verification

Use [FEATURE_PARITY.md](../specs/FEATURE_PARITY.md) for dated results and remaining acceptance checks, and [Releases](../docs/RELEASES.md) for packaged versions and checksums. Historical counts are not fresh verification of a changed checkout.

After the [setup steps](README.md#clean-checkout-setup), run checks relevant to the change from the repository root:

```sh
pnpm --filter @nextspace/android typecheck
node --test android/tests/spec-vectors.test.mjs
node --test android/tests/startup-sync.test.mjs android/tests/headless-read-store.test.mjs android/tests/read-denials.test.mjs
node --test android/tests/native-edit-services.test.mjs android/tests/source-write-policy.test.mjs
```

For native Java changes, run the Gradle wrapper from `android/android/` with `:app:compileDebugJavaWithJavac` and targeted `:app:testDebugUnitTest --tests <fully-qualified-class>`. On Windows use `gradlew.bat`; on other hosts use `./gradlew`. These checks do not package an APK. The shared-vector test loads the exact repository vector file and actual production core.

Full builds require an explicitly requested release milestone. Verify the resulting manifest/version, signing continuity, packaged UI/headless assets and approved launcher/splash artwork; preserve earlier APKs. Fixtures, compilation and APK verification do not establish physical-device SSO reliability, touch behavior, cold-start timing, background execution or thermals. Device and real-server checks require separate authorization, and their logs must stay outside public source.
