# NextGlance 0.6.30

23 November 2026 · Windows, Android and the Nextcloud app

- Android planner sync recognizes earlier uploads that reached Nextcloud before a connection stopped, including partial uploads. For overlapping edits, **Settings → Planner storage → Review planner conflict** shows the affected areas and lets you choose which version to keep.
- Timeline scrolling and date navigation format and lay out Calendar events in the displayed range, reducing repeated work with large calendar histories.
- Android checklist conversion closes once all new tasks and their links are saved on the device. Planner sync publishes the links. Retrying an interrupted conversion reuses its saved requests to avoid duplicate tasks.
- **Delete task** is available in the inspector for writable Nextcloud tasks. The confirmation shows the task and source list. Linked items and their saved relationships are retained.

Build 32 uses Windows file version `0.6.30.32` and Android versionCode `32`. The permanent Windows shortcut target is `win/release/NextGlance-Latest.exe`.

[User guide](GETTING-STARTED.md) · [Local packages and checksums](RELEASES.md#0630--windows-android-and-nextcloud) · [Manual Nextcloud installation](../web/DEPLOYMENT.md)
