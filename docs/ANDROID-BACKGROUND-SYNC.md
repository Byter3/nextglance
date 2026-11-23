# Android background sync

Reviewed 2026-11-23. The behavior specification defines foreground connection recovery and durable background results. The feature parity ledger records verification and remaining device checks. [Foreground recovery](../specs/BEHAVIOR_SPEC.md#sync-16-recover-a-deferred-foreground-connection-check-2026-11-23), [background results](../specs/BEHAVIOR_SPEC.md#sync-15-durable-background-results-and-truthful-reopening-2026-11-22), [verification](../specs/FEATURE_PARITY.md#foreground-connection-recovery--sync-16)

## How it works

NextGlance reads its private saved planner when opening. Network checks run separately. A saved successful source read retains its timestamp and is labeled as saved data; it does not establish current authorization. Editing still requires restored durable state, verified access and the operation's conflict checks. Recent cached content need not be downloaded again solely because the process restarted.

If you open offline or when the Wi-Fi-only setting blocks an automatic check, an allowed connection resumes authorization, planner metadata and source access checks while the app stays open. A recent cache can pass these checks without a bulk source refresh. Connection settings show foreground errors alongside the separate Calendar/Tasks and Deck background results.

Android owns two persistent jobs: Calendar/Tasks and Deck. They run bounded native reads, reuse validated collection tokens and resource versions, then use the shared headless projector to publish usable local records and widget snapshots. The supported headless runtime needs no Activity or WebView. On unsupported devices, downloaded resources can be retained without a new usable projection; settings report that distinction. Planner metadata refreshes on opening/resuming; Notes and Collectives are checked while the app is active.

If a widget layout cannot be projected, the background job can still publish valid saved source data. The widget keeps its previous snapshot and timestamp while the next successful projection catches up, subject to account and access restrictions.

Opening gives foreground work priority and can cancel an unfinished background pass. Completed checkpoints and atomically published generations survive. Publication checks account identity, file revisions, denial state and acknowledged edits. If you leave before the app finishes applying a published result, it can pick up that result on the next opening. Registration is reconciled from saved identity and settings even offline.

## Intervals and Android limits

New or invalid preferences use **60 minutes** for Calendar/Tasks and Deck, with Wi-Fi-only off. Valid saved Manual, 15-, 30-, 60- and 240-minute choices are preserved. Existing installations therefore keep their selected interval; change it in **Settings & connection → Background sync** if desired. Manual refresh remains available.

[DAVx's guidance](https://manual.davx5.com/settings.html) recommends moderate intervals such as an hour to reduce battery use, with manual refresh when needed. This is distinct from the four-hour initial default documented for [Managed DAVx](https://manual.davx5.com/managed_davx5.html). Those references inform the default; they do not demonstrate a measured NextGlance battery improvement.

Persistent [JobScheduler jobs](https://developer.android.com/reference/android/app/job/JobInfo.Builder#setPersisted(boolean)) survive normal process termination and reboot. The requested interval is not an exact appointment: connectivity, Wi-Fi policy, battery management and [Doze](https://developer.android.com/training/monitoring-device-state/doze-standby) can delay it. WorkManager is also subject to Doze, so changing scheduler libraries would not remove those restrictions.

[Force-stop](https://developer.android.com/about/versions/15/behavior-changes-all#stopped-state) intentionally suspends background operation until user interaction reactivates the app; Android 15 also disables its widgets until launch. NextGlance does not keep a permanent process/WebView alive or promise instantaneous cold-process startup.

## Reading the status

Calendar/Tasks and Deck keep independent evidence:

| Evidence | Meaning |
| --- | --- |
| Enabled / scheduled | The interval allows automatic work / a matching Android job exists. This is not proof it ran. |
| Last attempt | A native pass started. |
| Downloaded | A native source read completed. |
| Usable read generation | Shared processing durably published a usable local result. |
| Projection unavailable or incomplete | Downloads may exist, but the previous usable planner remains in place. |

An earlier successful timestamp is history, not confirmation of current server access. A later Deck success does not imply Calendar/Tasks succeeded. The compatibility aggregate success timestamp describes downloads, not usable planner publication.

## Why Nextcloud Files is involved

With **Continue with Nextcloud Files**, the native bridge delegates account authorization and HTTP requests to the installed Files service through [Nextcloud Android SSO](https://github.com/nextcloud/Android-SingleSignOn). That service can be used without opening the Files screen. Browser sign-in instead uses NextGlance's native HTTP transport. A reported Files crash needs its own crash trace and provider version; a NextGlance network error alone does not establish its cause.

## Device acceptance still needed

- Compare cached first content, usable interaction, access verification and completed sync separately after a cold open.
- Change a fictional server item while NextGlance is closed; verify background publication and the next open, including widgets.
- Repeat with reboot, temporary loss of connectivity, Wi-Fi-only, Doze and battery saver. Check actual attempt/publication timestamps rather than expecting exact intervals.
- Verify force-stop prevents background work and reopening recovers scheduling without resetting Manual or saved intervals.
- Measure unchanged-sync requests, bytes, job duration, CPU and battery before claiming performance gains. Keep private diagnostics outside published documentation.

Unit tests and native compilation establish specific logic paths. They do not establish physical launch time, launcher appearance, thermal behavior or provider stability. See the [earlier sync investigation](ANDROID-SYNC-REVIEW.md) for historical findings.
