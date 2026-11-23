# NextGlance 0.6.27

23 November 2026 · Windows, Android and the Nextcloud app

## Android home screen

- Overview and Timeline fit more work into the same widget height. Each row aligns the item’s name and details with its dates. Arrows run across the date grid from prerequisites to the work waiting on them. Narrow widgets show dependency counts and compact item rows.
- Overview pairs dated work with an aligned Calendar grid. Timeline keeps its date headings visible while you scroll. Both advance the displayed time window as the local date changes.
- Calendar offers Agenda, Today, Week and Month. Month shows the selected day’s itinerary. Today, Week and Overview give that space to the schedule itself.
- Each widget has its own name, Space, sources, filters and appearance. Board keeps eligible linked tasks under their Deck card, even when the task and card have different statuses. Tap an item for its details in the planner or use **+** to create within the widget’s allowed destinations.

[Illustrated widget examples](WIDGET-EXAMPLES.md)

## Planner and sync

- Board can hide older completed tasks and Deck cards. In **Board → Filters**, choose how many days to retain. The default is 14 days.
- Choose how far back Calendar sync looks under **Settings & connection** on Windows and Android. **All history** is the default. The Nextcloud app requests older Calendar ranges as you navigate to them.
- Reading historic events uses the native source cache. This keeps large Calendar histories out of planner metadata. The source and planner data entries in **Settings & connection** report their status independently.
- Android reopens saved planner data while it checks current access. Incremental background checks reuse saved source data. New settings default to hourly checks, and existing interval preferences are preserved.
- Weekend shading is subtle and configurable under **Settings & connection → Appearance → Weekend days**. Saturday and Sunday are selected by default.

[Illustrated user guide](GETTING-STARTED.md) · [Android background sync](ANDROID-BACKGROUND-SYNC.md)

## Packages

| Client | Version | Package |
| --- | --- | --- |
| Windows | 0.6.27 · file version 0.6.27.29 | x64 portable EXE |
| Android | 0.6.27 · versionCode 29 | Development APK |
| Nextcloud | 0.6.27 | App archive with matching source |

Use `win/release/NextGlance-Latest.exe` as the permanent Windows shortcut target. See the local release record for checksums and verification.

[Package checksums](RELEASES.md#0627--windows-android-and-nextcloud) · [Manual Nextcloud installation](../web/DEPLOYMENT.md)
