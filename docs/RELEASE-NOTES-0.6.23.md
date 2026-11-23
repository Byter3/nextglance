# NextGlance 0.6.23

23 November 2026 · Windows, Android and the Nextcloud app

Weekend dates now use a lighter background in Calendar, Overview and Timeline, with a matching date cue on Board and List. Choose the days under **Settings & connection → Appearance → Weekend days**. Saturday and Sunday are selected by default. Each installation remembers its choice, including Android’s home screen widgets.

## Android widgets

- Add independently configured Calendar, Overview, Timeline, Board and List widgets. Each has its own title, Space, sources, filters and transparency.
- Calendar offers Today, Week, Month and Agenda. Overview pairs ongoing work ranges with a calendar grid. Timeline shows grouped work against a common date axis.
- Board keeps eligible linked tasks with their parent Deck card, including tasks with a different status. The card and task keep their own statuses.
- Tap an item to open its details in the regular planner. Use **+** to open the editor with the widget’s available destinations. Widget filters stay on the home screen.

[Illustrated widget examples](WIDGET-EXAMPLES.md)

## Android sync and reopening

- The app opens saved planner data while it checks current access. Recent source content stays cached when an allowed connection returns after an offline opening.
- Background Calendar/Tasks and Deck checks use the existing incremental cache. Connection settings show when a download completed and when usable planner data was saved. New sync settings default to hourly. Existing interval choices stay in effect.
- Interrupted application of a background result can be retried on reopening. A widget rendering failure leaves valid source data available to save.

[Background sync and Android scheduling](ANDROID-BACKGROUND-SYNC.md)

## Packages

| Client | Version | Package |
| --- | --- | --- |
| Windows | 0.6.23 · file version 0.6.23.25 | x64 portable EXE |
| Android | 0.6.23 · versionCode 25 | Development APK |
| Nextcloud | 0.6.23 | App archive with matching source |

[Package checksums and verification](RELEASES.md#0623--windows-android-and-nextcloud) · [Manual Nextcloud installation](../web/DEPLOYMENT.md)
