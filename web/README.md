# NextGlance inside Nextcloud

NextGlance is an app in Nextcloud's own navigation, using the account already signed in. It shares the Windows/Android planner views, rules and metadata. It is **online-only**, with no second login, offline content store or pending-write queue.

**To test on your server:** follow the [manual installation, update and rollback guide](DEPLOYMENT.md). Implementation is underway under WEB-01; target versions are Nextcloud 34.x (including 34.0.5) and 35.x. Real-server acceptance is still required on both majors. No deployment or App Store publication has taken place.

## Architecture

- `appinfo/`, `lib/`, `templates/`: authenticated PHP host and session endpoint. Internal app ID: `nextglance`; namespace: `OCA\Nextglance`.
- `src/`: same-origin session transport, online-only `WorkspaceApi` adapter and entry point. Nextcloud enforces native permissions and request-token protection. No credential proxy or browser password store.
- Shared `packages/`: Vue views, pure core, native Nextcloud protocol and folder metadata client. Native data stays in Calendar/Tasks/Deck/Notes/Files; organization stays in `/Workspace/Nextspace/` (schema 2, folder protocol 1).
- `scripts/`: Web-only CSS scoping and explicit archive packaging. Nextcloud's navigation/theme remain outside the embedded planner.

Browser memory can speed repeated reads while the page is open. Losing connection disables writes; session expiry hides private state. Reloading requires the server. Cookies belong to the existing Nextcloud session, not an offline database.

Filters are shared by account, Space and page, including My overview. They use the separate `/Workspace/Nextspace/view-preferences.json` file; the current page, dates and panel layout remain local presentation choices. The Web app keeps no offline copy or pending-write queue. Conflicting filter edits remain available for review rather than overwriting another device.

## Current boundaries

The adapter covers native source reads, planner organization, task/card/note edits and ordinary event creation/editing/deletion through the shared protocol. Actual enabled operations depend on source permissions and the host capability list. Unsupported recurrence/alarm and concurrency cases retain the shared validation rules.

Deck cards offer task linking, task creation and checklist conversion. Shared creation receipts are confirmed in the planner folder before the native task is created; a retry reuses its native request identity and repairs a failed link. These receipts are stored on the server, not in an offline browser queue.

**Create and link a calendar booking in one operation remains disabled** until the Web host has durable recovery for a booking created before its planner-link write fails. You can create an event normally, then use **Link existing event**. No silent metadata replacement for a failed native write is permitted. Collective content uses the native read path; collaborative editing stays in Nextcloud.

Automated protocol/controller/component fixtures and shared vectors are separate from server installation, real-user session expiry, CSRF middleware, optional-app compatibility and performance acceptance. See [FEATURE_PARITY](../specs/FEATURE_PARITY.md#nextcloud-web-host--web-01-2026-11-14) for the evidence and outstanding gates. This is not yet a claim of full Windows/Android feature parity.

## Fast development checks

From the repository root, after installing the locked workspace dependencies:

```powershell
pnpm --filter @nextspace/nextcloud typecheck
pnpm --filter @nextspace/nextcloud test
pnpm --filter @nextspace/nextcloud test:ui
```

PHP host checks need a PHP 8.2+ CLI (`PHP_BINARY` can point to it). When PHP is unavailable, the native PHP tests report a skip; that is not a passing PHP check.

The UI test uses a fictional Nextcloud host fixture, not a live account. Install its Chromium browser once with `pnpm exec playwright install chromium`; Linux runners may also need [Playwright's system dependencies](https://playwright.dev/docs/browsers#install-system-dependencies). To use an already installed browser instead, set `PLAYWRIGHT_CHANNEL` to a supported channel such as `msedge` or `chrome` before running `test:ui`. No browser is installed automatically by the test.

Do not run full asset builds during iterations; the [deployment guide](DEPLOYMENT.md) gives the one-time milestone build/package commands.

## License and future publication

Project-owned code is [AGPL-3.0-or-later](../LICENSE); dependencies retain their own [license obligations](../NOTICE.md). The manual package includes matching source and a **Source code** settings link. Source and server app are intended to be free of charge; store clients may be paid.

A real public repository/support URL, dependency notice inventory, signing, tested compatibility and explicit publication approval are still needed for an App Store release. No URL or public repository has been invented. See [Nextcloud's publishing requirements](https://docs.nextcloud.com/server/stable/developer_manual/app_publishing_maintenance/publishing.html).
