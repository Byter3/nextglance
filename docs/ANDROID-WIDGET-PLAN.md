# Android widgets: design and implementation

Updated 2026-11-23. WIDGET-09 tightens work rows and places dependency arrows in the date grid in Android 0.6.27. WIDGET-03 defines the underlying widget behavior. [Behavior specification](../specs/BEHAVIOR_SPEC.md) · [Verification](../specs/FEATURE_PARITY.md#denser-widget-work-timelines--widget-09--release-27)

For setup instructions, see [Android home widgets](../android/README.md#home-widgets). This document explains the current correction and remaining limits. Examples use fictional data.

## Work list and schedule grid

Overview and Timeline show work names and groups in a left column, with the corresponding bars on the same rows in the date grid. Wider widgets also have Status and Due cells. Today and weekend cues follow the date columns. Narrow or enlarged-text layouts keep the compact rows to give names and dates enough space.

Overview lines up the timed Calendar with the work grid above. Timeline keeps its dates visible while the work rows scroll. Tighter rows and headings fit more work at the same size. Each row opens its item. [Widget verification status](../specs/FEATURE_PARITY.md#denser-widget-work-timelines--widget-09--release-27)

## Dependencies and rolling timeframes

Overview and Timeline draw arrows across the date grid, from the visible end of each prerequisite’s bar toward the start of the work waiting on it. Lines pass behind bars and stay within the plot. Compact layouts and links that cannot be drawn show a dependency count beside the affected row.

Both widgets show scheduled work that overlaps the dates on their axes. A range already underway remains visible when it crosses the first day. One overnight widget job advances the window from saved data, and a time or timezone change recalculates it. Android can defer the job while the device is idle. [Android job scheduling](https://developer.android.com/reference/android/app/job/JobInfo.Builder)

## Calendar itinerary and Overview timeline

Calendar Today, Calendar Week and Overview devote the grid area to the chart. Tap a sufficiently large event block for details on supported launchers, or tap the widget title to open the planner for small or overlapping items. Overview uses more of that area for groups and dated work, with work context alongside the date ranges where it fits.

Calendar Month shows the itinerary for one selected date. It starts on today. On a widget with room for both regions, tap a date to change the itinerary and use **Open day** for the full Calendar. On a grid-only widget, tapping a date opens that day in the app. [Verification status](../specs/FEATURE_PARITY.md#calendar-itinerary-and-overview-timeline--widget-06)

## Reading widgets over wallpaper

Board groups each card and its linked tasks on a continuous surface. A shared color rail and the parent name identify the connection, and each task keeps its own action and status. Calendar, Timeline and Overview have stronger chart surfaces inside the translucent widget shell. Overview keeps its first work range visible even at compact heights.

Actual wallpaper blur requires the launcher to composite the wallpaper behind the widget. Android exposes cross-window blur to apps for their own windows. App widgets are rendered as `RemoteViews` in a window owned by the launcher. WIDGET-05 keeps the existing adjustable shell and uses more opaque local surfaces to preserve contrast. [Android window blur](https://source.android.com/docs/core/display/window-blurs) · [Android app widgets](https://developer.android.com/develop/ui/views/appwidgets/overview)

## Responsive presentation in 0.6.24

WIDGET-04 addresses stretched text and makes each page easier to scan. The chart and its launcher image use proportional scaling. Where the launcher supplies sizes, the chart and its tap targets use the same viewport and fit calculation. Smaller or crowded charts retain individual record actions in native rows. [Android layout guidance](https://developer.android.com/develop/ui/views/appwidgets/layouts)

Calendar and Overview use stronger date labels and quieter grid lines. Timeline groups use a common date axis. Board gives Deck cards a distinct surface and keeps linked tasks visually connected. Agenda and List separate the title, date and secondary details with clearer spacing. The shell follows the selected light or dark theme and transparency. [Android widget style guidance](https://developer.android.com/design/ui/mobile/guides/widgets/style)

## What changes after 0.6.21

Device feedback exposed three functional issues: a Board status filter removed linked tasks whose own status differed from their parent; Overview could spend its entire item allowance on bookings; and opening a widget installed a temporary filtered app view. Calendar and Overview also remained list presentations rather than the requested time grids.

WIDGET-03 preserves each widget's independent title, Space, sources, filters, creation destinations and appearance, while changing the following behavior:

| Page | Intended presentation |
| --- | --- |
| Calendar | Agenda, Today, Week or Month. Today/Week show actual time grids, overlap lanes and a bounded all-day strip. Agenda retains compact date headings and subtle row separators. |
| Overview | Dated work and multi-day/all-day ranges above a timed calendar, sharing the date axis. Both regions receive space and a bounded allocation of items. |
| Timeline | Real planner/project/source headings, compact labels, one common date axis and aligned ranges. |
| Board | Configured grouping with Deck card surfaces and linked prerequisite/follow-up task rows. Children retain their real status and completion styling. |
| List | Compact work rows with due dates, source context and individual detail actions. |

New Calendar/Overview widgets default to Week; explicit saved Calendar Agenda/Month choices remain. Overview renders an older Agenda/Month choice as Week without rewriting it. New Overview/Timeline widgets use planner grouping; existing explicit choices remain. Display layout and date-range filtering are separate settings.

When linked grouping is enabled, a visible Deck card carries eligible linked tasks even if their status, date or completion would hide them as standalone tasks. Account, Space, source, kind, project/tag, assignment and search exclusions still apply. This does not change the task's status or complete its parent. A task without a visible parent follows normal filters.

Tapping **Open** navigates to the real configured Space and page with that page's saved app preferences. An item opens its exact details, even when ordinary page filters hide it; a date opens normal Calendar day. Widget filters never replace app filters, and there is no temporary “Return to planner” mode. **+** opens the guarded shared composer with only the widget's allowed destinations and creation defaults. A successful creation opens the new item even if it falls outside widget filters.

## Appearance and practical interaction

Keep the app's translucent surfaces, restrained blue accents, source colors and fully opaque text. Transparency remains adjustable from 0–50%, default 32%. Local card fills and quieter dividers provide contrast over busy wallpaper. Header, create and settings actions retain at least 44dp targets.

Android widgets support taps and vertical collection scrolling. Horizontal swipes belong to the launcher. On Calendar grids, positioned actions depend on the launcher size and event geometry. The widget title opens the normal planner on all supported Android versions. [Android widget constraints](https://developer.android.com/develop/ui/views/appwidgets/overview)

Use at most four launcher-provided size variants on API31+, with orientation-aware fallback on older versions. Sizes use available dp. Both Overview regions and the header must remain usable at minimum size. [Responsive widget layouts](https://developer.android.com/develop/ui/views/appwidgets/layouts)

## Architecture and performance limits

Keep the existing Java/minSDK24 RemoteViews host. Shared pure core owns membership, status mapping, grouping, calendar overlap/date rules, action resolution and bounded projection. Native views render the result; they do not create another planner engine. The widget config remains account-bound and device-local, separate from synchronized app filters.

The update path is **validated shared state → widget projection → atomic compact snapshot → native launcher view**. Reuse the existing source/background jobs. Launcher rendering must not start a WebView, inspect full source archives, fetch network data or ask for authorization. Repaint only changed snapshots/configuration or actual size/theme changes; do not poll per widget.

Rendering is bounded to 25 record identities, with full-selection totals and explicit overflow. Overview allocates records to both regions. The calendar payload also caps timed segments at 175 and all-day ranges at 25; truncation preserves the real overlap lanes. Charts may use cached bitmaps, while native labels/actions provide accessible detail access. Across all size variants, chart allocations must stay below 2MiB per widget and the Android screen-buffer limit. Cache by snapshot, size and theme; replace image content with full updates rather than accumulating image actions through partial updates. [Widget update guidance](https://developer.android.com/develop/ui/views/appwidgets/advanced)

Small API31+ collections use RemoteCollectionItems; older devices keep their compatible adapter. Every emitted row layout must be included in the view-type count. [Collection widgets](https://developer.android.com/develop/ui/views/appwidgets/collections)

Source and planner-metadata freshness remain distinct. Existing supported background projection updates snapshots; API24/25 and unsupported JavaScriptSandbox providers retain their last valid snapshot. Remote planner metadata still refreshes through the normal app path. Widget rendering grants no current source authorization and no write permission. See [Android background sync](ANDROID-BACKGROUND-SYNC.md).

## Lifecycle and remaining work

Deleting one widget removes only its settings, snapshot and presentation state. Preserve other widgets, Nextcloud records, drafts, mutation journals and acknowledgements. Configuration cancellation saves nothing for a new instance and preserves an existing instance. Missing sources/Spaces fail closed with a settings action. Account changes, denials and stale generations cannot expose old rows or execute old intents.

The shared composer remains the creation path. A separate native capture form, direct completion commands and bounded background planner-metadata checks are future work requiring their own shared contract and guarded runtime. No per-widget sync jobs, permanently resident process or universal offline write queue are implied.

Reference patterns remain useful: OpenTasks stores selection per widget and exposes contextual creation; Deck offers focused stack/upcoming/card widgets; Tasks.org exposes filters and appearance settings. These were source/documentation reviews, not hands-on acceptance on every launcher. [OpenTasks](https://github.com/dmfs/opentasks/blob/master/opentasks/src/main/java/org/dmfs/tasks/homescreen/TaskListWidgetProvider.java), [Deck stack widget](https://github.com/stefan-niedermann/nextcloud-deck/blob/master/app/src/main/java/it/niedermann/nextcloud/deck/ui/widget/stack/StackWidget.java), [Tasks.org preferences](https://github.com/tasks/tasks/blob/main/app/src/main/java/org/tasks/widget/WidgetPreferences.kt)

## Verification

- Shared exact vectors: parent/child status differences and hard exclusions; planner/project grouping; unchanged normal filters after navigation; day/week overlap, all-day ends, midnight and DST.
- Real shared-UI routing with fake native ports: independent page preferences, exact hidden item details, scoped creation, dirty drafts, account changes, stale actions and source denial.
- Native tests/compilation: settings compatibility, size/orientation geometry, chart memory/cache limits, safe action bounds, dense-item fallback and footer containment.
- Separately authorized physical checks: phone/tablet launchers, resize/rotation, large fonts, TalkBack, light/dark wallpaper, transparency, touch accuracy and cold/background behavior.

Fixture results, Java compilation, package contents and browser concepts are different evidence levels. None alone proves launcher visual fidelity or measured battery/latency improvements. Current evidence belongs in FEATURE_PARITY; the existing 0.6.21 APK must not be presented as containing these new fixes.
