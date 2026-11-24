# Native Nextcloud account boundary

The host uses [Nextcloud Android SingleSignOn 1.3.4](https://github.com/nextcloud/Android-SingleSignOn/releases/tag/1.3.4), through the installed Nextcloud Files app. This pinned release uses `AccountImporter` and activity-result callbacks. Its `SingleSignOnAccount.userId` is the canonical username. The newer `ImportSsoAccount` API shown in the upstream main-branch README is not assumed to exist in this release.

`MainActivity` opens the Android account picker and the Files app's consent activity. `NextcloudSsoPlugin` exposes only the selected account name, server URL and canonical username to the WebView. App passwords and the SSO token never cross the bridge. The SSO library stores its application-bound token in native private storage; backup and device transfer are disabled for the host's private data. Disconnect clears this host's imported tokens and account selection, without removing the account from the Files app.

The native connection screen presents this flow first as **Continue with Nextcloud Files**. Browser authorization remains an explicit alternative. In Settings & connection, **Use direct connection** opens [Login Flow v2](https://docs.nextcloud.com/server/stable/developer_manual/client_apis/LoginFlow/index.html#login-flow-v2) for the saved Files account, including when Files access needs reconnection. Continue as the same Nextcloud user to preserve the account's cached data and planner changes. The native host then connects directly over HTTPS using the issued app password. Opening the connection screen starts no external handoff. Cancelling sign-in preserves the previous selection. The browser development preview uses browser authorization because it cannot invoke the installed Android provider.

The bridge retains a validated non-secret selected-account descriptor for offline recovery. `getAccount()` can return that descriptor with `reconnectRequired` when the provider cannot restore authorization; it returns `recoveryOnly` when the descriptor itself is incomplete or invalid. These states preserve private caches and pending metadata instead of treating every temporary authorization error as confirmed source revocation. Picker cancellation preserves the previous selection. Provider account names are local locators, while `userId` remains the canonical shared username.

## Transport contract and provider limits

- Requests must match the selected account, origin and Nextcloud installation path. Traversal, embedded credentials, arbitrary authentication headers and writes outside the documented planner/native-operation boundaries are rejected natively as well as by the JavaScript adapter.
- The bridge allows GET, HEAD and PROPFIND, including a bounded custom PROPFIND body, plus the narrowly scoped writes described below. The [Files SSO request handler](https://github.com/nextcloud/android/blob/master/app/src/main/java/com/nextcloud/android/sso/InputStreamBinder.java) does not implement REPORT. Files SSO therefore uses the bounded DAV listing reader. Independent Login Flow v2 authorization supports REPORT and uses the reference server-side calendar queries when no persistent resource-cache port is supplied. With that port, either transport can use fresh inventories and exact strong-ETag cached-body reuse. Read capabilities are returned separately from the public account identity.
- The provider attaches authentication and `OCS-APIREQUEST` itself. The bridge removes the latter caller header because the provider rejects duplicates. URL query parameters are passed separately through `QueryParam`, since the provider replaces the URL's query string.
- The bridge requests `setFollowRedirects(false)`. Redirect error statuses are rejected. `url` identifies the requested URL and `urlSource` is `requested-no-redirects`; the provider does not expose an independently observed final URL.
- Provider V2 exposes successful response headers and a body stream, but no exact success status. The bridge represents a successful 2xx response as `status: 200, statusSource: 'sso-success'`. This is a normalization, not an observed HTTP 200. HTTP failures preserve the provider's status with `statusSource: 'sso-error'`; failure headers and body are unavailable. ETags from successful reads retain their complete original value.
- Native reads stop at the requested byte bound, capped at 24 MiB. DAV query bodies are capped at 1 MiB; planner/native mutation bodies at 8 MiB of UTF-8, with additional operation-specific field limits. The provider controls its own networking timeouts and internal error-response buffering. The JavaScript adapter's cancellation does not cancel a request already running inside the Files app.
- Work is queued off the main thread. Across foreground and background work, at most one Files network call runs at a time, with a queue of two. If an active call times out or the provider reports a transport failure, new Files requests pause for 30 seconds. Direct HTTPS has independent capacity. Leaving the foreground cancels this host's request generation and retires its SSO binding once any active use exits. Lifecycle changes return `CANCELLED`. Removed accounts or invalid SSO tokens use `AUTH`. Late results cannot populate a newly selected account.

Foreground source parsing and cache serialization run in the dedicated module worker. User operations have priority over queued refresh requests, without unbounded request concurrency. Native JobScheduler work checks sources independently of an Activity; on supported API 26+ providers its isolated JavaScriptSandbox runs the same shared parser/reconciliation rules to publish private read and launch generations. On unsupported providers it keeps resource downloads and reports the projection limitation. Account, file-revision and acknowledged-edit fences prevent old background results from replacing newer user edits. Known authorization denials are persisted before cache invalidation and applied on the next restore.

## Planner metadata write boundary

The JavaScript adapter and native bridge independently restrict writes beneath the selected canonical user's Files DAV path, including the Nextcloud installation subpath:

```text
<installation>/remote.php/dav/files/<canonical-user-id>/Workspace/Nextspace/
```

`PUT` accepts only these protocol paths relative to that root:

```text
manifest.json
view-preferences.json
data-<uuid>/core.json
data-<uuid>/organization.json
data-<uuid>/settings.json
data-<uuid>/dependencies.json
data-<uuid>/identities.json
data-<uuid>/legacy-import.json
data-<uuid>/legacy-original.json
data-<uuid>/{links,plans,properties,workflow,arrangements}/<sha256>.json
```

The shared folder client validates protocol documents and obtains the active generation from the manifest. It creates a generation only through its guarded initialization/migration flow. This metadata boundary rejects arbitrary filenames, query strings and legacy root-workspace writes. Each planner PUT requires exactly one of `If-Match: "<strong-etag>"` or `If-None-Match: *`, an `application/json` content type, and a nonempty body no larger than 8 MiB. Weak ETags, unconditioned overwrites and ambiguous conditional headers are rejected. The shared client verifies writes by reading the saved folder state; normalized SSO success statuses alone are not evidence of persistence.

Bodyless `MKCOL` is allowed only for the `Workspace` parent, `Workspace/Nextspace`, a protocol generation directory, and its `links`, `plans`, `properties`, `workflow` or `arrangements` subdirectories. There is no planner DELETE, MOVE, PATCH or general-purpose upload support. Group/Space deletion updates `organization.json`; the required file itself is retained.

The account-local metadata service loads a remote baseline before accepting edits, commits accepted edits durably before synchronization, and preserves conditional-write/three-way-merge conflicts for review. It rechecks account selection before every network mutation. Shared projects, links, plans, manual ordering and canonical identities survive organization edits. Saved semantic page/Space filters synchronize separately in `view-preferences.json` under FILTER-03; geometry and navigation remain local. Release version changes do not change the application identity or storage namespaces.

## Native writes

BEHAVIOR_SPEC 8.6 authorizes the private capability `nativeEdits: 'notes-dates-scheduling'`. Missing/unknown capabilities never enable native writes. The controller exposes only supported operation names through its runtime snapshot; host UI permission and actual method availability are additional requirements.

The current operation gates cover Notes, Tasks, Calendar and Deck editing, scoped attachments and metadata export as recorded in the behavior specification. `NativeRequestPolicy.java`, `source-write-policy.mjs` and the shared native protocol constrain each operation; this is not unrestricted HTTP access. Service validation resolves records and destinations from current account data; a shared calendar's discovered principal may differ from the user's ID. Native source permissions, conditional versions and response verification remain authoritative.

An SSO HTTP 412 may have no current-note body. Notes must retain the draft for explicit review instead of inventing merge data. Scheduling uses a deterministic native UID and durable local `pending`/`created`/`linked` journal: a retry after a lost create response reads and verifies the same event. A successful event is never deleted as rollback for a failed custom-link save. Full live/device acceptance remains separate from isolated tests and native compilation.

`NextcloudSsoPolicyTest` checks native origin, installation path, traversal and scoped conditional-write boundaries without a live account. Isolated transport/metadata tests exercise folder synchronization and Windows interoperability. APK compilation verifies native integration only. Account consent, actual Files-provider reads/writes, ETag behavior, revocation, resume and two-way Windows synchronization still require a device with the Nextcloud Files app installed. See [verification](../VERIFICATION.md) for actual completed checks.
