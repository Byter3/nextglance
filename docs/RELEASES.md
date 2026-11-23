# Local release evidence

These are dated records of local builds, not public download links. Artifact paths below exist only on the build machine; packages are excluded from Git. Later source changes do not retroactively change these binaries or their recorded checksums.

Packages listed here are local development artifacts. Outputs stay in `win/release/`, `android/release/` and `web/release/`, outside source control. The reviewed source is published in [Byter3/nextglance](https://github.com/Byter3/nextglance); source publication does not publish these binary packages. Application/account/storage identities remain unchanged.

## 0.6.27 — Windows, Android and Nextcloud

Built on **2026-11-23** for WIDGET-09 / RELEASE-27. Windows file version is `0.6.27.29`, Android versionCode is `29`, and Nextcloud app version is `0.6.27`.

| Package | Size | SHA-256 |
| --- | ---: | --- |
| `win/release/NextGlance-0.6.27-Windows.exe` | 101,267,511 bytes | `41969160f2c60cdeb217ac7f4b943358a4bec447a1137f730a867a040d3abb7c` |
| `android/release/NextGlance-0.6.27-Android-debug.apk` | 13,244,151 bytes | `840ab0addc88dad4860764403d4430ddedaa90bfb1985de2a8d6da563d48078f` |
| `web/release/NextGlance-0.6.27-Nextcloud.tar.gz` | 2,022,610 bytes | `5c2e710d742afba01f5dad084aae5f1a3bc0095f573197e729e7348b681e7015` |

Overview and Timeline widgets use denser rows and connect scheduled bars with arrows inside the date grid. See the [release notes](RELEASE-NOTES-0.6.27.md) and [illustrated examples](WIDGET-EXAMPLES.md).

Windows passed isolated unpacked and portable launch checks. The stable shortcut target `win/release/NextGlance-Latest.exe` matches the versioned package byte for byte. The Android APK retains its signing identity and passed 216 JVM tests. The Nextcloud archive contains matching production assets and 492 files from the frozen workspace. The 946 shared and 1,840 client JavaScript tests passed. All 778 frozen source paths and 50 previous packages matched their prebuild checksums. Physical Android launcher and live Nextcloud server checks remain open.

## 0.6.26 — Windows, Android and Nextcloud

Built on **2026-11-23** for HISTORY-02, VIEW-18 and WIDGET-05. Windows file version is `0.6.26.28`, Android versionCode is `28`, and Nextcloud app version is `0.6.26`.

| Package | Size | SHA-256 |
| --- | ---: | --- |
| `win/release/NextGlance-0.6.26-Windows.exe` | 101,268,026 bytes | `20ff464a08ec4590d8d0a835c5cc70a40089191fb78b49c97a23d3f7a64a255f` |
| `android/release/NextGlance-0.6.26-Android-debug.apk` | 13,197,178 bytes | `e9bd32c944556bbf7e91ca9226daabb1240aa43319b6479a96621ac7119b7e83` |
| `web/release/NextGlance-0.6.26-Nextcloud.tar.gz` | 2,015,444 bytes | `f5d04f3f882893c64ed45a41074fea94dd04532b8ca75738610ff40a6142bc6c` |

Reading Calendar history no longer registers every occurrence in cloud planner metadata. Verified source data can be saved independently when planner metadata validation fails. Weekend shading is softer. Android widgets use clearer chart surfaces and show linked tasks under their parent Deck card. [Widget presentation and launcher limits](ANDROID-WIDGET-PLAN.md#reading-widgets-over-wallpaper)

Windows passed the unpacked and portable launch checks. The shortcut target `win/release/NextGlance-Latest.exe` matches the versioned package byte for byte. Android passed 185 JVM tests and the APK retains its signing identity. The Nextcloud archive contains the verified assets and 492 files matching the frozen source. The Web archive privacy scan found only previously reviewed fictional and security fixtures. All 762 frozen source paths and 47 previous packages matched their prebuild hashes. Physical Android launcher and live-account sync checks remain open.

## 0.6.25 — Windows, Android and Nextcloud

Built on **2026-11-23** for HISTORY-01 / RELEASE-25. Windows file version is `0.6.25.27`, Android versionCode is `27`, and Nextcloud app version is `0.6.25`.

| Package | Size | SHA-256 |
| --- | ---: | --- |
| `win/release/NextGlance-0.6.25-Windows.exe` | 101,269,437 bytes | `b31ad459178952c546f176cc3369c6854a41e984922fef282b13e9ba77e5e0a7` |
| `android/release/NextGlance-0.6.25-Android-debug.apk` | 13,185,582 bytes | `331f90e466d228a03eb5dd73847bbb6a463872071bcb0d96c9b4301942246cd2` |
| `web/release/NextGlance-0.6.25-Nextcloud.tar.gz` | 2,009,477 bytes | `2ac488bb320b46bba79bc4044d54873c1d412f4c7869acab20bb8c9787ef6002` |

Board filters show the past 14 days of completed work by default. Windows and Android let you choose how much Calendar history to sync, with All history selected by default. Both reuse unchanged files between refreshes. The Nextcloud app loads a bounded Calendar range on date navigation. [Usage guide](GETTING-STARTED.md)

`win/release/NextGlance-Latest.exe` was updated and matches the versioned package byte for byte. The Android build passed 181 JVM tests and retained its signing identity. The Nextcloud archive includes the current assets and 491 matching source files. All 752 frozen source paths and 44 prior packages matched their prebuild hashes.

## 0.6.24 — Android build 26

Built on **2026-11-23** for WIDGET-04 / RELEASE-24. Android versionCode is `26`. The application ID and signing certificate match 0.6.23.

| Package | Size | SHA-256 |
| --- | ---: | --- |
| `android/release/NextGlance-0.6.24-Android-debug.apk` | 13,180,966 bytes | `9e8d7061ef0f09bcd4da1be419b6a39114f2441b0a0e06ec3ee31faf1dcf7c2c` |

Charts retain their proportions during rasterization and launcher sizing. Calendar and Overview use clearer dates and event blocks. Overview aligns work ranges and bookings on one date axis. Board, Timeline, Agenda and List have clearer labels and spacing. The widget picker has a separate fictional preview. [Widget presentation notes](ANDROID-WIDGET-PLAN.md#responsive-presentation-in-0624)

The final build passed **180** JVM tests in **20** suites. The APK contains both launcher layouts, the revised native widget classes, and matching UI and headless assets. All 478 frozen source files and 23 prior APKs matched their prebuild hashes. Physical launcher visual and touch checks remain open.

## 0.6.23 — Windows, Android and Nextcloud

Built on **2026-11-23** for VIEW-17 / RELEASE-23. Windows file version is `0.6.23.25`, Android versionCode is `25`, and the Nextcloud app version is `0.6.23`. The Android APK uses the same application ID and signing certificate as 0.6.22. [Release notes](RELEASE-NOTES-0.6.23.md)

| Package | Size | SHA-256 |
| --- | ---: | --- |
| `win/release/NextGlance-0.6.23-Windows.exe` | 101,260,792 bytes | `8e7369d8697bd10a6d531b9639f6b56ab9d1ef51aa12bd615c8cc176b4e19490` |
| `android/release/NextGlance-0.6.23-Android-debug.apk` | 13,166,437 bytes | `392e14b5770e27b8681c803288e91ac494db8e52c381e82cd515ee2f4a3bd775` |
| `web/release/NextGlance-0.6.23-Nextcloud.tar.gz` | 1,991,959 bytes | `e0ba819c520e92543305b591685df49b760560ecc521e822155f3dea2cb2f978` |

Fast verification passed **1,386** targeted tests including **424** shared vectors per client, three no-emit checks, PHP syntax and the mounted Nextcloud fixture. The fixture exercised weekend shading in all five planner views and verified contrast in both themes. Final Android packaging passed **169** JVM tests. Android signature, UI, headless assets and widget resource checks passed. Windows passed **24** packaged checks, including an isolated portable launch and weekend settings persistence. Windows executable versions, packaged assets, runtime code, notices and icons were verified. The Nextcloud package includes its built UI, manifests, licenses and byte-matched source. The 731 frozen paths and four baseline packages matched their prebuild hashes. Launcher appearance and installation on Nextcloud Server 34 or 35 still require device and server checks.

## 0.6.22 — Android build 24

Built on **2026-11-23** for WIDGET-03 and SYNC-16. Android versionCode is `24`. The application ID and signing certificate match 0.6.21. Windows remains 0.6.18/build20 and Nextcloud remains 0.6.17.

| Package | Size | SHA-256 |
| --- | ---: | --- |
| `android/release/NextGlance-0.6.22-Android-debug.apk` | 13,161,733 bytes | `8ed75eba066c840f2b4fc0e29e97f394257678dbf1d09b5ee35662ac2842dfc9` |

Calendar widgets offer Today and Week time grids alongside Agenda and Month. Overview shows ongoing work ranges above a calendar grid. Board keeps eligible linked tasks with visible cards when their unified status differs. Board project grouping and Timeline planner hierarchy use the shared membership rules. Widget items open their details in the ordinary planner with its saved page filters. The native layout uses a separate item strip for narrow or crowded charts. [Widget behavior and platform limits](ANDROID-WIDGET-PLAN.md)

Reopening offline can recover its access and metadata checks when an allowed network returns. Fresh source bodies stay cached. An interrupted application of saved background data leaves the generation eligible for another attempt. Widget presentation failures leave valid source publication intact. Connection settings show foreground errors beside background job results. [Android sync review](ANDROID-BACKGROUND-SYNC.md)

Verification passed for **1,498** consolidated checks including **416** exact vectors per client, all client no-emit checks, the mounted widget route fixture, and **162** final JVM tests across **19** suites. The packaged native charts, widget layouts, icon assets, headless projection, UI files and licenses were inspected. The APK signature is valid and **398** frozen files and six prior artifacts match their prebuild hashes. One UI appearance, touch and device startup or sync timing await physical verification.

## 0.6.21 — Android build 23

Built on **2026-11-22** for SYNC-15 / WIDGET-02 / RELEASE-21. Android versionCode is `23`; application ID and APK signing certificate match the prior build. Windows remains 0.6.18/build20 and Nextcloud remains 0.6.17. The earlier interrupted packaging attempt produced no APK; this is the completed package.

| Package | Size | SHA-256 |
| --- | ---: | --- |
| `android/release/NextGlance-0.6.21-Android-debug.apk` | 13,127,502 bytes | `b456879df4778d3bc5073a0833e71e42589077222bf1011847672960da39c43b` |

Saved sources retain their historical status while current access is checked separately. This avoids unnecessary first-sync presentation and recent-content scans. Jobs are reconciled even when opening offline. Foreground signaling and sandbox cancellation no longer wait on background disk publication/teardown on the Activity thread. Calendar/Tasks and Deck report independent download and usable-data timestamps. New/malformed interval settings default to one hour; valid saved choices, including Manual, remain unchanged. See [background sync](ANDROID-BACKGROUND-SYNC.md) for Android constraints and the source references.

Widget presentation now has distinct Calendar time columns, Board cards and linked tasks, Overview summaries, List work rows and a shared Timeline date axis. Compact headers, project icons and transparency remain configurable. Existing widgets and accounts keep their settings.

Fresh checks: **1,236** shared assertions including **402 exact vectors per client**, **227** targeted Android regressions, all-client no-emit checks, native compilation and **56** targeted JVM tests passed. Final packaging freshly passed **147 JVM tests across 18 suites**. All **387** frozen production/configuration files and five previous artifacts remained unchanged. The packaged 51 UI assets, shared headless code, 15 launcher PNGs, adaptive/themed icon layers, splash and manifest bindings match the frozen sources; there is no development-server URL.

These are compiler, fixture, concurrency and package checks. Physical launcher appearance, reboot/Doze execution, cold-launch timing, provider stability and battery behavior still require device acceptance. Android can release the process and defer jobs; no permanently resident UI or exact-minute synchronization is promised. No emulator, device installation, live-account write, deployment or push occurred.

## 0.6.20 — Android build 22

Built on **2026-11-22** for WIDGET-01 / RELEASE-20. Android versionCode is `22`; application ID and signing identity are unchanged. Windows remains 0.6.18/build20 and Nextcloud remains 0.6.17.

| Package | Size | SHA-256 |
| --- | ---: | --- |
| `android/release/NextGlance-0.6.20-Android-debug.apk` | 13,100,785 bytes | `788ba82fda350e526f6c654874e12ac6b15c96a081c1b95b998ff71de2c3734c` |

Adds native Overview, Calendar, Timeline, Board and List home widgets. Each instance has its own name, Space, sources, filters, creation destinations and transparency. Calendar supports an agenda and a month grid when space permits; Board includes linked tasks. Launcher rendering reads small private snapshots. **+** opens the existing app editor with eligible destinations; the full page uses temporary widget filters without replacing saved planner preferences. See the [short setup guide](../android/README.md#home-widgets).

Fresh checks: **1,186** shared-vector/widget/planner assertions, **89** targeted Android regressions, all-client no-emit checks and the mounted shared-UI route fixture passed. Final packaging freshly ran **123 JVM tests across 15 suites**, all passing. The 366 frozen production/configuration files are unchanged. The APK's version, signing continuity, 50 UI assets, headless code, widget resources/classes/manifest entries, 15 launcher PNGs and adaptive/themed/splash bindings were verified. No development-server URL is included; previous 0.6.19 and 0.6.17 APKs remain intact.

Install over the existing development APK, open NextGlance, then add **Widgets → NextGlance** from the home screen. Each widget can be reconfigured through its settings button. Background source updates use the existing account scheduler; planner metadata refreshes on normal app entry. API24/25 and unsupported background JavaScript providers retain their last valid widget snapshot. Physical launcher appearance, accessibility, cold-start and battery behavior remain unmeasured. No emulator, device installation, live-account writes, deployment, push or publication occurred.

## 0.6.19 — Android build 21

Built on **2026-11-22** for SYNC-14 / RELEASE-19. Android versionCode is `21`; the application ID and signing identity are unchanged. Windows remains 0.6.18/build20 and Nextcloud remains 0.6.17.

| Package | Size | SHA-256 |
| --- | ---: | --- |
| `android/release/NextGlance-0.6.19-Android-debug.apk` | 13,025,808 bytes | `f6ed7e29052dc19f6d33030fbbc9b596697cc55134a470c6126bf214769c31ab` |

Android checks Tasks/Calendar/Deck access independently of bulk source refresh, respects recent saved content timestamps, adopts newer guarded background data on resume and reads only the newest valid cache slot when possible. Native background CalDAV now compares collection tokens and reuses a certified unchanged inventory. Corrupt/partial/denied data, changed resource revisions and newer acknowledged edits still invalidate unsafe reuse. Final headless validation/publication remains; this is not a claim that unchanged sync has zero processing cost.

Fresh verification includes 187 Android regressions, 170 protocol checks, 366 shared cases per client and all-client no-emit checks. The final native test task executed, with **103 tests across 13 suites passing**. Packaged manifest/version, signing continuity, all 50 UI assets, the headless bundle, 15 launcher PNGs, adaptive/themed vectors and splash bindings were checked. No development-server URL is packaged. All 322 frozen production files and the prior 0.6.17 APK retained their hashes.

Install over the existing development APK; no data reset is required. Physical-device cold-start time, thermal behavior, background scheduling and actual-account acceptance remain unmeasured. The tests use fictional local fixtures and do not diagnose a particular Nextcloud Files crash. See the [investigation](ANDROID-SYNC-REVIEW.md) for causes, research and bounded measurements. No emulator, installation, live-account writes, deployment, push or binary publication was performed.

## 0.6.18 — Windows build 20

Built on **2026-11-18** for SYNC-13 / RELEASE-18. Windows file version is `0.6.18.20`. Android and Nextcloud packages remain at 0.6.17/build19.

| Package | Size | SHA-256 |
| --- | ---: | --- |
| `win/release/NextGlance-0.6.18-Windows.exe` | 101,243,784 bytes | `88d7d33f2b62599b24238a40f1da977b2e21f1da4a4c346267d108a116037b85` |

This fixes collection-token discovery incorrectly switching Windows into downloading the full historical calendar inventory. Windows retains server-filtered calendar queries and complete task queries, including old completed and undated tasks. Failed refreshes retain the previous successful timestamp without advancing it or granting edit access.

The package version and exact packaged protocol/Windows security fixes were verified against source, including extraction of the actual portable wrapper. Its eight isolated startup checks passed: extraction/startup, product title, private test profile, empty disconnected state, schema 2, sandboxed renderer, navigation and no renderer errors. All three license/notice files and nine approved icon payloads match. The previous 0.6.17 executable retains its recorded checksum. Close the previous Windows app before opening this portable executable; the existing account/profile location is unchanged. Actual synchronization against the affected account remains user acceptance, separate from fixture and package checks.

## 0.6.17 — build 19

Built and verified on **2026-11-17** for BRAND-01 / RELEASE-17. Windows file version is `0.6.17.19`; Android versionCode is `19`; the Nextcloud app version is `0.6.17`.

| Package | Size | SHA-256 |
| --- | ---: | --- |
| `win/release/NextGlance-0.6.17-Windows.exe` | 101,238,527 bytes | `1e194565a3455ef5b29365acd5e5eb056bccbd8d74c7ed04ed6903e2e2a6875f` |
| `android/release/NextGlance-0.6.17-Android-debug.apk` | 13,116,493 bytes | `138d456104e2e58f8ad88fdf229191b1b853492247bb75aac38e4e7de231f170` |
| `web/release/NextGlance-0.6.17-Nextcloud.tar.gz` | 1,903,568 bytes | `7176397c22a8ccbecbc11491e5e8c8e661baebe2caa32aed5ff1613042a3ee68` |

These packages incorporate the [approved project icon](BRANDING.md): blue/white launchers and favicons, Android adaptive/themed/splash variants, host-appropriate Nextcloud navigation artwork and the shared in-app mark. Existing planner behavior and stored data formats are unchanged.

Windows portable and unpacked executables contain all nine approved ICO frame payloads; the packaged window icon, favicon and visible header/welcome/navigation marks were verified. Packaged smoke passed and 41 UI assets match. Android retains its signing identity: all 15 launcher PNGs, compiled adaptive/themed/splash references, 47 UI assets and headless bundle match source/build, with no development URL. All 93 JVM tests freshly passed across 13 suites. Nextcloud packages the exact approved white and host-foreground navigation icons and an embedded shared SVG mark; 14 runtime/documentation files and 464 corresponding-source files match. All 374 frozen production/resource files remain unchanged.

All prior 0.6.16 artifacts retain their checksums, and technical application, account, signing and storage identities are unchanged. Physical launcher/taskbar behavior and live Nextcloud Server 34/35 acceptance remain separate from automated package verification. Install Android over the existing test app and close the previous Windows executable before opening the new one. Use the [manual Nextcloud deployment guide](../web/DEPLOYMENT.md) for server testing. No device installation, emulator, live-account writes, deployment or publication occurred.

## 0.6.16 — build 18

Built and verified on **2026-11-17** after VIEW-16 fast checks and source freeze. Windows file version is `0.6.16.18`; Android versionCode is `18`; the Nextcloud app version is `0.6.16`.

| Package | Size | SHA-256 |
| --- | ---: | --- |
| `win/release/NextGlance-0.6.16-Windows.exe` | 101,208,148 bytes | `cde91c371670cdeba0e251ca8d54bc1fa87a0b04f530f51282414d1f526a1b7f` |
| `android/release/NextGlance-0.6.16-Android-debug.apk` | 13,139,389 bytes | `8cc3f2e16159392c5b123f2f1963533c86be63451989821ce94829f2c8b3c7c5` |
| `web/release/NextGlance-0.6.16-Nextcloud.tar.gz` | 1,810,485 bytes | `0fab554045fb3d4e33ce8e7052814b3be8da92644b7675abea7eedcc6df38126` |

The Timeline Unscheduled sidebar now opens beside the chart on wide layouts and as a bounded side overlay on narrow layouts. **Hide unscheduled items in timeline** controls only chart rows; opening or closing the sidebar does not change that choice. Existing saved visibility, width and row-placement choices remain compatible. Calendar and Overview retain their existing dated-pane behavior.

Before packaging, **357 shared vectors per client**, all-client no-emit checks, responsive geometry/interaction tests, actual Electron checks and the embedded Web fixture passed. Final package verification: Windows packaged smoke and actual sidebar/checkbox/resize/reload checks passed; 40 UI assets, changed host modules and 134 portable-core/protocol files match frozen output/source. Android retains its application/signing identity, all 45 UI files and its headless projector match, and no development-server URL is present. Gradle reused the unchanged 93 passing JVM results across 13 suites; those tests were not freshly executed for this packaging run. The Nextcloud archive contains 13 matching runtime/documentation files plus a nested archive of 450 matching source files, with the correct app ID, version and license.

All previous 0.6.15 artifact checksums remain unchanged. Application, account, signing and storage identities are preserved. Physical Android and live Nextcloud Server 34/35 acceptance remain separate from these automated results. Install Android over the existing test app; close the previous Windows executable before opening the new one. Follow the [manual Nextcloud deployment guide](../web/DEPLOYMENT.md) for server testing. No emulator, live-account writes, deployment or publication occurred.

## 0.6.15 — build 17

Built and independently verified on **2026-11-17**. Windows file version is `0.6.15.17`; Android versionCode is `17`; the Nextcloud app version is `0.6.15`.

| Package | Size | SHA-256 |
| --- | ---: | --- |
| `win/release/NextGlance-0.6.15-Windows.exe` | 101,208,510 bytes | `7f0ad3e724fb183dc7bb134a318803394624141e792e1065ff50a0d477a01de9` |
| `android/release/NextGlance-0.6.15-Android-debug.apk` | 13,139,117 bytes | `dbe0baa8a5275b22271611387f4523ce98ba5596505dc16e22f6a749f28b7659` |
| `web/release/NextGlance-0.6.15-Nextcloud.tar.gz` | 1,805,639 bytes | `852ef3c264a3827647bdc412645177370f8d61da8fd68841980947a4df3fbfa9` |

This release reduces repeated synchronization and rendering work. Android uses revision-aware caches, prioritized edits, metadata checks and a guarded shared-core projector that refreshes usable saved data without an Activity or WebView. Correction on 2026-11-22: native background token comparison was previously claimed here but was missing; SYNC-14 addresses it. Unsupported JavaScript providers retain an explicit raw-cache-only fallback. Capable transports use DAV deltas and batched resource reads; Files SSO retains its supported request fallback. The link picker renders a bounded list, and checklist task creation uses one cloud reservation plus one final publication while saving each successful receipt durably.

Semantic filters now sync independently for each page and Space, including My overview, with conflict handling. Overview has a hideable/resizable Unscheduled sidebar; Timeline can keep undated rows inline or move them to the sidebar; Calendar shares the sidebar controls. Empty sidebars consume no space. Checklist selection now leads to a compact editable task form with touch-capable date controls.

Verification: **348 shared vectors per client**, **62** independently rerun core/host regressions, protocol delta/cache tests, shared browser interaction fixtures and all-client no-emit checks passed. Android focused suites cover startup, denial, background publication, prioritization and recovery; the final complete native suite freshly passed **93 tests across 13 suites**. Counts from overlapping suites are not additive. The 4,000-item picker fixture renders 18 rows and mounted in about 128 ms on the development PC; this is not a phone measurement.

Windows packaged smoke and actual Electron event-control tests passed; **40 UI assets, 3 changed host modules and 132 portable-core/protocol files** match frozen outputs/source. Android retains its application/signing identity, all **45 UI files** and its headless projector match the build, and no development-server URL is present. The Nextcloud archive contains matching compiled assets, metadata, license and corresponding source. Previous 0.6.14 artifacts retain their checksums.

The Windows title/calendar obstruction was **not reproduced in actual Electron**, including range-created events with the inspector open; no correction of that reported issue is claimed. Physical-device cold-start, thermal, background delivery and Files-provider crash acceptance remain outstanding, as does real Nextcloud Server 34/35 acceptance. Read the [sync review](ANDROID-SYNC-REVIEW.md) for the transport explanation and remaining measurements.

Install Android over the existing test app and close the old Windows app before opening the new executable. For Nextcloud, use the [manual deployment guide](../web/DEPLOYMENT.md). No emulator, live-account writes, deployment or publication occurred. The existing [Web boundaries](../web/README.md#current-boundaries) remain.

## 0.6.14 — build 16

Built and independently verified on **2026-11-14**. Windows file version is `0.6.14.16`; Android versionCode is `16`; the Nextcloud app version is `0.6.14`.

| Package | Size | SHA-256 |
| --- | ---: | --- |
| `win/release/NextGlance-0.6.14-Windows.exe` | 101,193,697 bytes | `5b8c5db6f9ffb8972f1505d798a82820975b17829f8ee3d8b585d1f9be25acad` |
| `android/release/NextGlance-0.6.14-Android-debug.apk` | 11,672,654 bytes | `d09730db57ad5d8e2168056870abaf1dd922dbaa22e83960522706b670781c8e` |
| `web/release/NextGlance-0.6.14-Nextcloud.tar.gz` | 1,760,760 bytes | `3f892bd50fba61f05e49853cbe4dae7d583b5a054e6e29d17f61faec47851076` |

Deck status changes now address the destination stack in the native reorder request, then read back the saved card. The adopted stack, snapshot and revision stay together for subsequent edits. Genuine concurrent changes still require review. Board dragging displays a floating card at the original grab offset, subdues its original position and highlights the eligible destination. Tasks and cards now share one incoming/outgoing Dependencies grid; **Link task**, **Create task**, **From checklist** and **Jump to** remain available.

All **339 shared vectors** pass through each client. Protocol and actual Windows IPC/Web controller fixtures cover native array acknowledgements, readback, consecutive move/edit operations and conflicts. Android service/Worker checks pass **78** cases and request guards **10**. Shared browser fixtures cover desktop native/mapped moves, optimistic placement, one write, failed-save retry, within-column order, tablet scrolling and phone touch hold/drop/cancel, plus mixed dependency and task creation/navigation flows. All client no-emit checks pass. These are fixture results; overlapping suite counts are not additive.

Windows passed eight isolated unpacked-app checks and **172** packaged-file comparisons. Android freshly ran **88 passing JVM tests**, retains its signing identity, and all **45** frontend files match; no development-server URL is present. The Nextcloud archive contains matching metadata/license, **9** runtime files and **430** corresponding source files. All previous 0.6.13 artifacts remain unchanged.

Install Android over the existing test app and close the old Windows app before opening the new executable. For Nextcloud, follow the [manual installation guide](../web/DEPLOYMENT.md). Physical-device and live Server 34/35 acceptance remain unverified. No live-account writes, deployment or publication occurred. The existing [Web boundaries](../web/README.md#current-boundaries) still apply.

## 0.6.13 — build 15

Built and independently verified on **2026-11-14**. Windows file version is `0.6.13.15`; Android versionCode is `15`; the Nextcloud app version is `0.6.13`.

| Package | Size | SHA-256 |
| --- | ---: | --- |
| `win/release/NextGlance-0.6.13-Windows.exe` | 101,190,217 bytes | `d2771a2f9641b974b8790f8f046d8d6a148ad866ea1c5b99f454ba81f7070341` |
| `android/release/NextGlance-0.6.13-Android-debug.apk` | 11,671,726 bytes | `8dfa24ce65dfa2f21301f22a2bc771483266cd2b0b0e05e91d4a4f3e77e10f1f` |
| `web/release/NextGlance-0.6.13-Nextcloud.tar.gz` | 1,749,317 bytes | `34bab03ae5c1a8af3a289be7fd330de98e073d0043fa8c16a8185978a1886643` |

Deck cards now have an explicit Tasks section for linking, native task creation and checklist conversion. Conversion previews existing matches and uses synchronized creation receipts plus native request identities to avoid duplicates after retries. Checked checklist rows create completed tasks; the original card checklist remains independent. Jump controls reveal linked work/events in the current date view, or offer Calendar/Timeline from Board and List.

All **337 shared vectors** pass through each client, with **20** focused creation/recovery/protocol tests, **3** navigation tests, **76** Android native-edit/Worker tests and **48** Web host/protocol/PHP/package checks. Desktop/phone shared UI fixtures verify scoped linking, drafts, date/Markdown inputs, canonical-reference remapping during failed creation, retry/deduplication, completed task stacks, incoming/outgoing placement, repeated reveal and retained filters. Actual Windows IPC/native-editing and embedded Web session UI regressions also pass. All three no-emit checks pass; suite counts overlap.

Windows passed eight isolated unpacked-app checks; **170** packaged files match source/assets. Android retains its application ID and signing certificate, and all **45** frontend files match; Gradle reused **88 passing JVM tests**, rather than executing them again. The Nextcloud archive's **9** runtime files and **426** corresponding source files match, with the correct app ID/license/version and checksum. Previous 0.6.12 Windows/Android artifacts retain their hashes.

Install Android over the existing test app and close the old Windows app before opening the new executable. For Nextcloud, follow the [manual installation guide](../web/DEPLOYMENT.md). Real Server 34/35 and physical-device acceptance remain unverified; no live deployment or publication occurred. Web still requires separate event creation plus **Link existing event** instead of one-step create-and-link booking; see its [current boundaries](../web/README.md#current-boundaries).

## 0.6.12 — build 14

Built and independently verified on **2026-11-14**. Both clients use version **0.6.12**, common build **14**: Windows executable file version `0.6.12.14`, Android version code `14`.

| Package | Size | SHA-256 |
| --- | ---: | --- |
| `win/release/NextGlance-0.6.12-Windows.exe` | 101,179,929 bytes | `3a9497a010b9b401298f764498b168ad1880302065074ede177afad8550c4af6` |
| `android/release/NextGlance-0.6.12-Android-debug.apk` | 11,869,428 bytes | `b1445742cdabf9b5206ae607fae38e78878d55f645a055018325ba0995fffa5b` |

Mobile dependency removal now uses the native Deck operation in both directions, with failed removals retained and retried inside the inspector. The audit also completed Android native stack/status moves, item colors/tags, Deck label creation, related-resource/Collective-image reads and planner metadata export. File export waits for the user's save/cancel action instead of expiring on a network timeout. Native authentication, source ownership and cloud formats are unchanged.

Verification evidence:

- All **329 shared vectors** run through Windows, Android and reserved Web consumers. Root no-emit and Android no-emit checks passed.
- Root independently passed **83** Android/shared-touch cases, **81** protocol/capability cases, and **18** final Worker/export cases. Android's broader targeted run passed **466** cases. Suites overlap; these are not additive unique totals.
- Actual phone/tablet-sized touch fixtures verified native incoming/outgoing add/remove, planner links, failure/retry, endpoint updates, statuses and tags. Windows desktop→IPC→HTTP and native-editing UI fixtures passed.
- Focused Android-capability UI acceptance also passed for personal columns, planner block creation/editing/deletion and generic related-item links. These operations wrote only planner metadata and left native records unchanged.
- Windows passed **eight unpacked-package checks** and **eight portable-wrapper checks** with isolated profiles. All **164** packaged frontend/host/shared files matched frozen source. Executable version/build and retained application identity verified.
- Android manifest, unchanged signing certificate, worker and all **43** frontend files verified; no development-server URL. **88 JVM tests** passed freshly in the first packaging run. A corrected frontend-only rebuild reused those unchanged Java results after the delayed file-picker fix; the final 18 Worker/export checks passed before that rebuild.
- All **27** relocated prior Windows executables and the prior Android 0.6.11 APK retain their hashes. Known private-content/generated-artifact and documentation-link checks passed for the source candidates; this is preparation, not a comprehensive security certification.

Windows retains its desktop credential/file dialogs; Android uses Files/browser authorization and the platform document picker. Legacy convenience/migration methods are not separate user features. Shared native limitations, including unsupported recurring/delegated event edits, remain explicit in both clients. Physical-device upgrade, Files authorization, live-server edits and sustained performance still require device acceptance; automated fixtures do not establish those results.

Install the APK over the existing test app; close the old Windows copy before opening the portable executable. No personal-device installation, live-account write, publication or Web implementation was performed. Historical reports were preserved locally outside the publishable docs; the [Web review](PLATFORM-ARCHITECTURE.md#web-plan-review) records decisions needed before development.

## Earlier milestones

These are historical results, not newly executed tests. Detailed acceptance history remains in [FEATURE_PARITY](../specs/FEATURE_PARITY.md); obsolete individual reports are excluded from publishable sources.

| Milestone | Packages | Main change |
| --- | --- | --- |
| 2026-11-14 | Android 0.6.11/code13 | Verified write readiness independent of bulk refresh, native Deck creation/descriptions, Board creation and tablet layering |
| 2026-11-13 | Windows 0.6.5; Android 0.6.10/code12 | Cache repair, event/invitation controls, independent Overview groups |
| 2026-11-13 | Windows 0.6.4; Android 0.6.9/code11 | Space deletion, per-page filters, scoped dependency choices and booking details |
| 2026-11-13 | Windows 0.6.3; Android 0.6.8/code10 | Native attachments, event deletion, sync diagnostics and performance fixes |
| 2026-11-12–13 | Android 0.6.3–0.6.7 | Incremental cache, worker transport, native editing and scheduling recovery iterations |
| 2026-11-12 | Windows/Android 0.6.2 | Whole-item drag, linked highlights, compact timelines and fictional guide |
| 2026-11-12 | Windows/Android 0.6.1 | Stable ordering and linked-task stacks |
| 2026-11-11–12 | 0.6.0 development packages | Shared planner presentation and initial native integration |

The 0.6.11 Android APK had 85 freshly passing JVM tests and 43 matched frontend assets. The previous Windows 0.6.5 package had eight isolated packaged smoke checks and 164 matched files. These did not establish physical-device or live-server acceptance.

Preserved reference checksums (SHA-256):

```text
Android 0.6.11  90718ceddc7319e52dff7d7a7f49b11558b2fffad3b6714dd5037b30c91c87f0
Windows 0.6.5  164e5561f852936f8aab8c056dedb78242496124ec34cd82e2413d77498b17a5
```
