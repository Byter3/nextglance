# NextGlance Windows client

This is the working Electron client. `electron/` contains the main process, preload and operating-system integration. `src/main.ts` supplies the desktop or browser-preview adapter to the shared Vue UI. `dist/` is generated frontend output; `release/` is generated packaging output when packaging directly from this client.

The client consumes `@nextspace/contracts`, `@nextspace/core`, `@nextspace/ui` and `@nextspace/nextcloud-node` through package exports. UI dependencies are bundled during the frontend build. The Node connector and core runtime dependencies are included by Electron packaging.

## Work from the repository root

Install the workspace once with `pnpm install` at the repository root. The established commands remain aliases for this client. Build, start and packaging commands below are reference instructions for an explicitly authorized playable-build milestone; regular coding uses targeted tests and no-emit type checks under [AGENTS.md](AGENTS.md).

| Root command | Result |
| --- | --- |
| `pnpm dev` | Starts the Windows frontend's browser development server on `127.0.0.1:5173`. |
| `pnpm build` | Checks and builds the Windows frontend into `win/dist`. |
| `pnpm desktop` | Opens Electron using the existing frontend build. |
| `pnpm start` | Builds the frontend, then opens Electron. |
| `pnpm package:win` | Builds the portable executable into `win/release`. |
| `pnpm package:win:dir` | Builds an unpacked app into `win/release/win-unpacked` for verification. |
| `pnpm test` | Runs the workspace unit suite. |
| `pnpm typecheck` | Checks the workspace TypeScript/Vue sources. |

`Start-Nextspace.cmd` at the root still runs `pnpm start`. The browser preview contains no native account data and does not sign in to Nextcloud; use the Electron application for connected work.

## Work with the client package

From the root, use `pnpm --filter @nextspace/windows <script>`, or enter this directory and run its scripts directly. For example:

```powershell
pnpm --filter @nextspace/windows dev
pnpm --filter @nextspace/windows build
pnpm --filter @nextspace/windows start
pnpm --filter @nextspace/windows package:win
pnpm --filter @nextspace/windows package:dir
```

Both filtered packaging commands and root aliases use `win/release`. After an authorized package build, run `node tests/desktop-smoke.mjs --packaged`; the smoke test uses `win/release/win-unpacked`. Generated output is Git-excluded and is not part of source publication.

The relevant integration commands run from the root:

```powershell
pnpm test:desktop
pnpm test:connected
pnpm test:ui
```

UI fixture tests need the development server running. The connected desktop test uses an isolated HTTP fixture and a separate app profile. See the root [verification notes](../docs/VERIFICATION.md) for recorded results; the commands here are instructions, not a claim that a newly changed checkout has already passed.

## Profile and identity

The visible application name is **NextGlance**. The host explicitly keeps `%APPDATA%/Nextspace` for account files, Windows-encrypted credentials and Chromium preferences; `NEXTSPACE_DATA_DIR` still selects an isolated profile when supplied. The `local.nextspace.workspace` app ID remains unchanged. The current release target is **0.6.17/build 19**, aligned with Android; the Windows executable's numeric file version is `0.6.17.19`. It includes the approved [project icon](../docs/BRANDING.md) in the executable, window, favicon and shared interface. Final packages follow `win/release/NextGlance-<version>-Windows.exe`. Close any running copy before opening a newer portable executable. Previous artifacts are retained. Do not reset the user's profile, delete encrypted credentials, move cloud metadata or introduce a different schema to accommodate display naming or source relocation.
