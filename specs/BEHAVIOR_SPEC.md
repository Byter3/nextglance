# NextGlance behavior specification

Status: authoritative shared behavior baseline, established 2026-11-11 from the current reference implementation, regression tests and owner decisions. This is the single source of truth for all clients. Workspace schema 2 and cloud folder protocol 1 remain separate version domains.

## Product identity

The owner-selected product name is **NextGlance**, with that exact capitalization. Use it in visible application names, headings, window titles and current product documentation. This is a display-name change, not a storage/account/protocol migration. Existing `@nextspace/*` package names, native application IDs, credential namespaces, local account-profile location, `/Workspace/Nextspace/`, serialized `nextspace-*` format markers and historical artifact names remain technical identifiers until a separately specified migration. Never silently create a new account profile or cloud metadata directory because the display name changed. Do not bump product/schema/protocol versions or publish as part of naming.

### WIDGET-09. Denser work rows and date-grid dependencies (2026-11-23)

Reduce work-row spacing across the Overview and Timeline widgets so more useful rows fit at the same launcher size. Use tighter work rows, section headings and date headings with shared font-aware sizing. Keep useful title, source, status, date and fallback dependency context. Combine short secondary labels when space is limited. Keep text legible at increased system font sizes. Work rows remain individually actionable with disjoint hit areas, and primary header actions retain their existing target sizes. Preserve Overview's aligned Calendar grid, Timeline's scrolling rows and the compact presentation.

Draw dependency connectors inside the date plot, using the existing projected prerequisite-to-dependent relations. Route a visually distinguishable arrow from a prerequisite's visible range end toward the dependent's visible range start, similar to the in-app work timeline. Use bounded turns and draw behind bars where their areas cross. Clip all connector pixels to the work plot. Match row-segment endpoints across the separate scrolling Timeline rows. This supersedes the left-gutter route in WIDGET-07 for both layouts. Use the existing per-row dependency count when a range cannot be plotted, an endpoint is absent or the connector cannot fit. Keep assistive descriptions, item actions, timeframes, ordering and the local date rollover. Do not change other widget pages or planner screens.

RELEASE-27 authorizes final Windows, Android and Nextcloud packages at **0.6.27/build 29** after focused checks and source freeze. Windows file version is **0.6.27.29**, Android versionCode is **29**, and Nextcloud app version is **0.6.27**. Refresh the permanent Windows shortcut target after packaging and preserve prior artifacts and technical identities. The owner authorizes publication of the reviewed project source to the existing GitHub repository after privacy checks. Binary release artifacts stay local.

### WIDGET-08. Match the in-app work timeline layout (2026-11-23)

Use the in-app work timeline's visual structure in the Android Overview and Timeline widgets. On sizes that can fit it, put a compact work list on the left and the matching date grid and schedule bars on the right, with each label and range on the same horizontal row. Use indented group headings and counts, source-colored work symbols, a quiet divider, and clearly visible Today and weekend cues. Keep the labels independent of the plotted ranges so an item remains identifiable when its bar starts late or extends beyond the window. Use separate Status and Due cells when space allows. On smaller widgets or large text settings, combine secondary details below the title and retain the compact full-width row when a split would make either pane unusable.

Overview aligns the work dates and the timed Calendar to the same vertical grid. The timed region can use the work-list width for its existing booking count and time labels. Keep event details and date actions in their corresponding cells. Timeline retains native vertical scrolling and a fixed, matching date heading. Match the in-app appearance with restrained filled ranges edged in source color and centered in their rows. Keep dependency arrows, omitted-link counts, exact item actions, and assistive descriptions. Where native launcher sizing does not support the adaptive split, use the compact layout. Other widget modes and planner screens retain their existing layout.

Retain the projected timeframes, item/section order, status and date semantics, account scopes and refresh behavior defined in WIDGET-06 and WIDGET-07. This changes presentation only. Keep bitmap and widget size limits and verify compact, large text, tall and landscape cases plus an illustrative preview.

### WIDGET-07. Dependency arrows on Android work timelines (2026-11-23)

Show thin, directional connectors in the left gutter of the Overview work timeline and the standalone Timeline widget. An arrow points from a prerequisite row toward the dependent row that waits for it. Anchor connectors to the work rows so they preserve the date scale, readable status and source labels, and the existing item actions. The standalone Timeline remains a scrolling list with a common date axis. Calendar's time grid and other widget pages stay outside this change.

Use real `depends_on` relations from the shared planner graph, including native relations already supported by the planner. Deduplicate ordered pairs, reject self-edges, and use only Tasks and Deck cards that are eligible for the current widget after its account, Space, source, status, date and other filters. Preserve the existing direction: in stored `depends_on`, `fromId` is the dependent and `toId` is its prerequisite. The optional widget-only snapshot field `dependencies` supplies `edges: [{prerequisiteId, dependentId}]` for pairs whose endpoints are both projected work rows, capped at 60 in deterministic order, and `counts: [{recordId, prerequisites, dependents}]` for projected work rows with an eligible dependency. Counts cover eligible endpoints beyond the current row budget. Snapshots without the field render without dependency indicators.

Route only between rows available in the presented layout, with at most three non-overlapping lanes. Use a compact count such as `1 prerequisite` or `1 waiting` on an eligible row when a connector cannot be drawn at that size, is crowded out, or its partner is outside the presented rows. Accessible row descriptions include the direction and totals even when arrows are drawn. Keep arrowheads distinct from source colors, never draw into the timed Calendar pane or through an item touch target, and preserve the widget’s existing bitmap budget and refresh policy. Opening a row still opens the exact item in the regular planner. This authorizes widget source changes, focused checks and an illustrative preview.

Timeline and Overview include only items with a scheduled civil interval intersecting their displayed time axis, including ranges that began before the first displayed date and continue into it. Perform the intersection before counts, grouping and row caps. An event that ends at the first date’s midnight or starts at the exclusive end is outside the window. Keep the terminal axis tick for geometry without labeling that excluded date. Use the exact existing widget timeframes: Timeline Today is one day, Week seven days, Month 31 days, and the existing All/Overdue layouts use their labeled seven-day preview. Overview retains Today or Week. Existing filters continue to apply within those dates. When a linked session or work plan is the only interval that intersects, show that actual interval instead of an out-of-range native date span. Reuse the same current selection in guarded widget actions.

Advance both timeframe widgets with the local civil date using a single persistent, network-free Android widget preparation job scheduled for the next local midnight while either widget is configured for the current account. Recalculate after device time or timezone changes and after the launcher recreates or updates an instance. Coalesce equal schedule targets and cancel when no eligible instance remains. Reproject only saved data under the existing access/account rules. Use Android’s ordinary background scheduling and existing headless capability. No exact-alarm permission or new source polling is needed. Actual delivery can be later under Android background restrictions. Verify local day boundaries including DST and offline projection.

### WIDGET-06. Calendar itinerary and Overview timeline space (2026-11-23)

Calendar Today/Week and Overview spend the chart region on their actual grids and omit the separate item strip and its hint at every size. This supersedes the strip fallback in WIDGET-03 through WIDGET-05 for these modes. Keep correctly positioned item and day actions where the launcher supports them, and keep the normal planner available through the widget header at every size. Tiny or overlapping marks remain visible. Overflow points to the planner. Agenda remains a list.

Calendar Month keeps an itinerary for the selected civil day only. Start on the projected local today. A date tap selects that day inside the widget when the month and itinerary fit. Indicate the selection and offer **Open day** to reach the normal Calendar for that date. Where only the grid fits, a date tap opens that day in Calendar. Where the grid cannot fit, show the selected-day itinerary with the existing resize guidance. Store selection per widget as local presentation state, fenced by account, configuration generation and the current displayed month. Clear obsolete selections on replacement, removal or month rollover. Date selection uses the existing saved projection and needs no network request. Itinerary rows keep their exact existing item actions. Empty and overflow states identify the selected date and allow opening the full day.

Add optional `month.itineraryRows` and optional `month.cells[*].itinerary`, a list of zero-based indices into those rows. Reuse native Calendar membership and civil date ranges, including exclusive all-day ends and cross-midnight events. Order selected-day rows by all-day first, then start time and stable identity. Show up to six rows per day, retain the true cell count, and cap the additive itinerary payload at 384 KiB UTF-8 within the existing snapshot budget. Old snapshots without the additive itinerary use only existing rows whose ranges overlap the selected day. Keep month size, snapshot/configuration versions, filters and saved account identities compatible.

Overview gives more room and useful context to the dated-work timeline above the timed Calendar. Keep aligned dates, actual task/Deck/all-day ranges, source accents and planner groups. Include source, unified status and relevant dates where space permits, prioritize actual work rows and expose hidden range counts. Keep both panes usable on compact widgets. The standalone Timeline also shows planned date range and available unified work status alongside source context. Work grouping, completion, source access, record identity, and app navigation retain their existing meaning.

Verification is limited to widget fixtures, native checks and an illustrative preview. This change does not authorize packaging or device installation.

### HISTORY-02. Native history and planner identity isolation (2026-11-23)

Full Calendar history must not copy the occurrence catalog into synchronized planner metadata. Native records with a verified portable source identity keep an existing planner ID when known; otherwise project them with a deterministic opaque ID derived from the source and its account-qualified identity key. Preserve existing registry entries and IDs, native aliases, conditional edits and pending acknowledgements. Newly projected records do not by themselves add registry entries. When an actual planner customization references a new native record, register its current identity atomically with the customization, preserving its projected ID. Promote loaded records referenced by relations, work sessions, project membership, item properties, workflow or manual item ordering. Preserve unresolved references. Older or legacy records without a verified account-qualified source identity keep the existing fallback rules. No raw native locator or body enters public record IDs. Ordinary source reads do not mark planner data pending merely because more uncustomized occurrences are visible.

Task and Deck records may expose only the source and identity key in their public identity field for existing idempotent card-task receipts. Public identity payloads exclude native locators and alias lists. Receipt request hashes and saved receipt keys keep their existing meaning across upgrades.

Keep the workspace schema, folder protocol and 8 MiB metadata limit. A bounded native read can save verified source data and permit normal native edit preflights even when metadata reconciliation or publication fails. Preserve the last valid workspace and record any genuine metadata error independently. Never claim a failed write or incomplete read succeeded. Preserve known denials, source access checks, stable row selection, native record identity and the durable source/edit/account fences. Android foreground and headless use this same projection policy. Verify large fictional history below the native resource limits and the late task/native status symptoms without real-account writes.

### VIEW-18. Softer weekend shading (2026-11-23)

Reduce the weekend contrast in all existing planner and widget surfaces. Keep the chosen weekday mask and today, selection and source treatments. Dark grids and native widgets use an approximately two-percent light overlay. Light grids use a quiet weekday tint and weekend lift. Remove the prominent extra outline on small weekend date labels.

### WIDGET-05. Readable native panels and explicit Board ownership (2026-11-23)

Bring the native preview closer to the approved layout hierarchy. Render a parent Deck card and attached tasks as a visually continuous bordered cluster with the parent's connector color and explicit parent context. Keep individual native task actions, direction, task status, source color and completed styling. Legacy snapshots and sizes remain usable. Use stronger inner chart and card surfaces over busy wallpaper while keeping the configured outer transparency. Overview separates group headings from individual work ranges and bookings on the common axis. Calendar, Timeline, Agenda and List improve date/time hierarchy, legibility, section boundaries and usable secondary context within the existing memory and action bounds. Retain guarded native navigation, proportional sizing and accessible item strips. Do not use wallpaper capture or extra permissions. Verify light and dark surfaces and dense/compact layouts. Physical launcher acceptance remains separate.

RELEASE-26 authorizes all three final local packages at **0.6.26/build28**, with Windows file version **0.6.26.28**, Android versionCode **28**, and Web app version **0.6.26**. Preserve existing packages and signing/storage identities and refresh `NextGlance-Latest.exe` with the successful Windows package.

### HISTORY-01. Board completion age and Calendar history (2026-11-23)

Board filters expose how long to show completed Tasks and Deck cards. Default to 14 days. A whole number from 0 through 36,500 sets the age in days, 0 hides all completed work, and All retains all completed work. Store this Board presentation choice locally in the installation. A record exactly on the cutoff remains visible. Use the native VTODO COMPLETED or Deck done timestamp, including native write readback. A genuinely completed record without a usable timestamp remains visible for positive age limits. Editing dates, titles or descriptions does not reset completion age. This filter applies to completed linked tasks as well as standalone tasks and to completed Deck cards. Keep the independent cancelled-task control and existing archived Deck behavior. Other pages and home-screen widget settings keep their completion rules. No records are deleted or modified by filtering.

Windows and Android Settings & connection expose Calendar history, default All history. Save a device-local per-account choice: `null` means All history, or an integer 0–36,500 counts whole days before today. Keep the present forward projection allowance. Only Calendar event projection changes; VTODO, Deck and planner metadata are independent. Reuse persisted raw resources and verified collection tokens/ETags, fetching missing or changed resources and applying confirmed deletions and denials. New history coverage is established only by a complete successful projection. A settings change reprojects using available resource bodies, fences obsolete results and preserves pending edits and account isolation. On Android foreground and headless publication must use the same value. Legacy settings without it default to All history. Server-side or safety limits stay explicit and retryable; they must not be reported as successful complete coverage.

Native caches may record the last completely projected history choice separately from the setting. A legacy or mismatched archive may require one catch-up projection when automatic Calendar sync is enabled. Preserve manual cadence and saved records on incomplete attempts. A missing collection token does not invalidate completed coverage evidence on its own.

The online-only Nextcloud client initially loads its existing recent Calendar period. On date navigation, fetch a bounded Calendar-only range covering the displayed page, including the Calendar month grid edges. Keep the recent result and at most the current additional range in session memory. Coalesce settled navigation within a range. Do not request intervening years or reread unrelated sources just because the date changes. Clear or replace expired range data on session/account change, refresh or source denial. Preserve acknowledged edits against older reads and handle partial or failed range reads without claiming complete coverage. Do not persist private event data in the browser. Historical Calendar dates remain reachable through ordinary date navigation.

The additive shared contract uses optional `WorkspaceRecord.completedAt`, optional `State.calendarHistoryDays`, optional `WorkspaceApi.setCalendarHistoryDays(days)`, and optional `WorkspaceApi.readCalendarWindow({from,to})` with UTC epoch milliseconds and an exclusive end. The portable DAV reader accepts `readAll({calendarHistoryDays,calendarWindow})`; a supplied window is a bounded Calendar REPORT/read projection range, and a supplied history value selects native past coverage. Legacy callers that supply neither keep their existing bounded behavior. No workspace, preference document, or folder protocol migration.

Acceptance covers exact completion boundaries, missing/non-completion timestamps, linked and cancelled work, historical one-off and recurring events, current edits/deletions, native persistent reuse, and Web range races and bounded memory. RELEASE-25 authorizes all three packages at **0.6.25/build27** after fast checks and source freeze. Windows file version **0.6.25.27**, Android versionCode **27**, Nextcloud app **0.6.25**. Update the permanent Windows shortcut EXE after packaging. Preserve previous artifacts, identities and application data.

### WIDGET-04. Responsive Android widget presentation (2026-11-23)

Improve the native home-screen presentation for existing widgets after owner feedback about stretched text and sparse styling. Preserve saved configuration, snapshot shapes, per-widget scope/filters, grouping, refresh cadence, transparency, source colors, weekend selection and guarded actions. This is an Android presentation change. RELEASE-24 authorizes a final Android **0.6.24/versionCode26** APK after fast checks and source freeze, with existing signing and account identities and prior APKs preserved.

Keep the outline and text of each chart proportional through density limits, launcher sizing and rotation. Raster rendering and display use uniform scaling. At API31+ use the available size variants with a common chart viewport for the image and its positioned hit layer, so actions align with what is drawn. Never fatten targets into other records or attach an item action at different coordinates from its rendered mark. At a narrow or uncertain size preserve an accessible native item strip or list for individual records. Legacy orientation fallback continues to show a proportional chart with native item rows. Adaptive sizes spend additional space on detail and legible labels. Compact sizes shorten or omit secondary text first. Large system text must keep controls and usable labels or reachable native rows. Respect WIDGET-03's bounds for bitmap memory, variant count, source data and update work.

Use a consistent, translucent NextGlance shell with a clear header, visible context where it fits, and distinct primary and secondary text. Calendar uses a quieter date and hour grid with clear Today, weekend and event marks. Overview separates ongoing work from the booking grid and aligns their date axes. Timeline keeps project hierarchy and a shared time axis. Board keeps a grouped card surface, linked prerequisites and follow-ups with their own status/completion. Agenda and List use legible rows with useful dates and source context. Preserve separate touch targets for create and settings. No wallpaper capture, ongoing rendering, extra permissions or sync changes.

Verify density and memory-constrained chart dimensions, fitting and touch alignment at narrow, wide, tall and rotated sizes, checked resources and overlapping items' native fallback. Reuse exact shared behavior vectors as membership and interaction regressions. Inspect visual evidence against the real layout rules where available. A fixture or package check cannot establish physical launcher behavior.

### VIEW-17. App-wide weekend days and shading (2026-11-23)

Settings & connection → Appearance exposes seven independent weekday checkboxes. Saturday and Sunday are the initial defaults, with Monday first in the settings list. The preference applies to every Space, page and Android widget in that installation. Store it as a device-local appearance setting, with no account planner data, cloud schema change or semantic filter sync. Window/browser hosts store only the local appearance scalar, including the Nextcloud app. Native Android stores it in app-private preferences shared between its interface and widgets. New or invalid values use the default. Selecting no days is valid. Persist and apply the same choices after reopening. Native updates repaint current saved widget views without requiring source sync or replacing their data.

The setting is a seven-bit integer mask from 0 to 127. Bit 0 is Sunday and bit 6 is Saturday. The fallback is 65. Use the exact calendar day displayed by a date cell or date badge, in the same local timezone as its existing date label. Native widget charts use the civil date already projected for the cell. Shade weekend headers, day cells, all-day lanes and timed tracks in Calendar, both Overview panes, Timeline and date/scheduling previews. On Board and List, apply the tint to the relevant date label for a dated item rather than the whole card or row. Undated items stay neutral. Show the same cue on Android widget grids, date columns and dated list/card labels. Use a subtle light overlay in dark and light palettes. Preserve Today, selection, range preview, event colors and legibility. This presentation setting does not change week boundaries, date calculations, filters or status.

Widget item rows may carry an additive `dateKey` with the exact local civil date for the visible label (event start or work due date). An undated row omits it. Widget snapshot and configuration versions stay compatible.

Acceptance includes the exact shared vectors for defaults, invalid input, custom or empty selection, and weekday classification of date keys. Verify actual grid/date-badge classes, local persistence, Nextcloud style containment, native widget geometry and targeted native tests. RELEASE-23 authorizes final local packages at **0.6.23/build25** after fast checks and source freeze. Windows file version is **0.6.23.25**, Android versionCode **25**, and the Web app version **0.6.23**. Preserve prior artifacts, application and signing identities. No deployment or publication is requested.

### SYNC-16. Recover a deferred foreground connection check (2026-11-23)

The owner requests an Android sync review and final package with WIDGET-03. RELEASE-22 targets **Android 0.6.22/versionCode24** after fast checks and source freeze. Preserve the Android signing and account identities and previous packages. No device installation, deployment or push is authorized.

When an eligible foreground entry is deferred by offline connectivity, the saved Wi-Fi policy or a recoverable network or authorization check failure, keep its authorization, planner metadata and lightweight source-access check pending for the current account and foreground entry. An online or Wi-Fi recovery signal resumes that work even when no source-body refresh is due. A network recovery signal received during a pending network check gets one coalesced follow-up if the first check deferred the entry. Repeated callbacks do not repeat the completed entry work. Clear pending work on account change, invalid authorization requiring reconnection, successful handoff, or foreground exit. Do not bypass Wi-Fi-only, manufacture current authorization from cached content, or refresh recent/manual-only source bodies solely to retry access. Existing deadlines, scheduled jobs, cadence and cache fences apply.

Use separate ephemeral `DeviceSync.foregroundError` text for failed foreground entry checks. Keep it visible in connection settings even when per-family background results exist. Successful foreground verification clears it. Ordinary offline or Wi-Fi policy deferral is not a failed job. The connection indicator retains actual network, saved-data and retry states. Verify offline-to-online and cellular-to-Wi-Fi entry recovery, queued transition signals, duplicate callbacks, cached-write safeguards and absence of unnecessary native data reads with deterministic Android controller tests.

Widget projection is a disposable consumer of an otherwise valid headless source result. If widget-only presentation fails, publish the validated source and launch generations without a widget payload, under the existing account, revision, edit and denial fences. Keep the previous widget snapshot and its original freshness, except where an existing access-denial invalidation removes it. Direct widget-only jobs still fail explicitly on a projection error. Verify failure isolation with real shared projection and a synthetic invalid widget-presentation timezone.

Reading a changed private archive for warm adoption does not acknowledge it as consumed. Confirm its revision only after reconciled state becomes the active planner under the current account, activity and edit guards. A cancelled or failed adoption leaves the newer saved generation eligible on a later foreground entry. A late acknowledgement must not replace revision knowledge from a newer cache operation. Unchanged saves still use their revision-only fast path. Verify with the actual two-slot cache and a failed or interrupted adoption attempt.

### WIDGET-03. Planner-faithful widgets and normal item navigation (2026-11-23)

The owner's physical tablet feedback supersedes WIDGET-01/02 where stated below. Implement the behavior and native presentation corrections with fast checks. The subsequent explicit packaging request includes these changes in RELEASE-22 after source freeze. Keep the existing private widget config version, account identities, filters, source isolation, publication guards and saved settings compatible.

**Linked work and grouping.** With Board linked-task grouping enabled, select visible parent Deck cards first; attach their eligible incoming/outgoing tasks even when the task's own unified status, date or completion would exclude a standalone task. The task stays in the parent's displayed status/project group, with its own status visible as context; this never changes native task status. Do not relax account, Space, source, kind, project/tag, assignment or search exclusions. A task whose parent is not visible uses the normal independent filters. Respect `groupBy` on Board and Timeline instead of always forcing status/date. Reuse the planner's project membership priority (explicit record membership, tag membership, then collection fallback) and grouping helpers, including My overview groups. Add `groupBy:'planner'` for the app's configured hierarchy; new Overview/Timeline widgets default to planner grouping, and existing explicitly saved grouping choices remain intact. Board keeps status as its new default. Linked children stay with their parent and retain direction/completion styling and distinct task accents.

**Calendar and Overview.** Extend `calendarLayout` additively to `agenda|day|week|month`. New Calendar/Overview defaults are week; retain explicitly saved Calendar agenda/month values. Offer Calendar Agenda, Today, Week and Month in settings; Overview offers Today and Week, rendering an older agenda/month value as Week without rewriting stored configuration. Week means the same rolling seven local dates as the app's week period; Today is the injected local date. Existing `dateRange` remains a membership filter, separate from display layout. Month behavior stays compatible. Agenda has clear subtle row separators and compact date headings.

Day/Week are actual time grids with date columns, shared hour rules, timed blocks, overlap lanes and an all-day strip. Overview has a top region of dated task/Deck ranges and multi-day/all-day event ranges and a bottom timed calendar grid sharing the date axis. Unscheduled items do not get invented date ranges. Allocate display rows only after intersecting Day/Week chart candidates with the displayed date interval. Reserve room for both Overview regions so bookings cannot consume the entire item budget. Timeline uses configured headings, compact title/source context and one date axis with aligned bars and vertical rules. Show overflow explicitly. Totals describe the full filtered selection while rendering remains bounded to 25 record identities and 50 section headings. Prioritize headings that contain visible rows and their ancestors, then retain empty configured Board status headings within the budget.

Pure shared projection supplies optional `calendarGrid:{mode:'day'|'week',label,days:[{date,label,today}],hourStart,hourEnd,ticks:[{minute,label}],timed:[{id,recordId,dayIndex,startMinute,endMinute,lane,laneCount,title,color,kind,point,planned}],allDay:[{id,recordId,startDay,endDay,lane,title,color,kind}],allDayLanes}`. Local days/time coordinates use the injected timezone/clock and the existing calendar semantics via optional pure clock ports. Ordinary app callers retain existing behavior. Start with 08:00–18:00 and expand to contain earlier/later timed items within 00:00–24:00. Split cross-midnight intervals. Preserve all-day exclusive ends, work/due semantics and overlap packing. When a repeated-hour transition reverses a timed block's local start and end labels, the single wall-clock axis shows a start marker and the item action retains the original instants. The native renderer consumes projected membership, completion and date geometry. Overview top-range presentation reuses existing timeline rows/axis. Additive `overviewRangeIds:string[]` identifies the row record identities allocated to that region.

Bound the chart payload to 175 timed segments and 25 all-day spans. A selected record may have many plan sessions. When timed segments exceed the allowance, retain the first segments in day/time order and mark the snapshot as truncated. Keep the record available in the item strip. The native renderer may draw bounded charts into cached bitmaps, with native accessible actions over sufficiently large item/day geometry. Keep header/create/settings targets at least 44dp. Do not enlarge overlapping targets so they select a neighboring event. Dense, short or narrow targets use a visible native item strip with full titles and individual actions. On older APIs without positioned overlay support, keep the chart and the item strip. At narrow sizes show an enlargement hint. Use up to four launcher-provided API31 size variants and orientation-aware legacy fallback. Bound chart bitmap memory to 2MiB total per widget across variants and respect the platform screen-buffer budget. Cache by snapshot, size and theme. Keep launcher rendering free of polling, wallpaper capture, WebView and network work. The strip and both Overview regions must leave usable content at minimum sizes.

**Open the regular planner.** Widget filters/grouping affect only widget content. After current account, generation, membership and availability checks, Open/Item/Date navigate to the real configured Space (or My overview) and page, using that page's existing app preferences. Item additionally opens the exact selected record and anchors its relevant date; selection survives normal navigation and no Return to planner mode exists. Existing app filters need not be overwritten to open details of a selected item; never change saved semantic filters to match the widget. Date opens normal Calendar day. Create uses the existing guarded composer with only widget-specific allowed destinations and configured creation defaults; it does not install a filtered planner session. Successful creation opens the created item even if it does not pass widget filters. Dirty drafts/account switches retain existing protection. Pure shared intent resolution owns destination decisions; views only apply them.

**Readable surfaces and honest evidence.** Preserve configurable transparency and fully opaque text, stronger local card/text contrast, consistent spacing, subtle separators, visible group headings and shared date rules. Standard RemoteViews does not expose an app-owned launcher Window; Android cross-window blur is not a widget backdrop API. No supported public Samsung third-party widget blur API was found in this investigation. Do not label transparency, a static texture or blurring the widget's own contents as real wallpaper frost. No hidden OEM APIs, extra wallpaper/media permissions or continuous capture for an imitation effect. Record this unresolved host capability explicitly instead of promising it from a browser mock.

Acceptance includes exact shared vectors for parent/status context with hard exclusions, project/planner grouping, normal navigation without filter mutations, day/week ranges and timezones/overlap; Android config compatibility, raster geometry/action bounds, cache/memory limits and targeted native compilation/tests. Compare the supplied screenshot with the approved product structure; physical launcher rendering and blur remain distinct evidence, not inferred from source or browser concepts.

### SYNC-15. Durable background results and truthful reopening (2026-11-22)

The owner requests an Android background-sync audit, lighter defaults, reliable saved-state reopening and a final APK. Include this correction with WIDGET-02 in the pending RELEASE-21 Android 0.6.21/versionCode23; the earlier packaging run was stopped before producing an APK. Preserve existing identities, prior packages and all valid saved interval choices. New or invalid Calendar/Tasks and Deck interval preferences default to **60 minutes**, Wi-Fi-only false. Manual-only and saved 15/30/60/240-minute choices remain unchanged. This supersedes SYNC-03's 15-minute default, not its allowed values or local-account scope.

Restored validated source data retains its historical read outcome and last-success timestamp, with additive local `cached:true` provenance. Recompute counts from restored records. Connected history without a valid timestamp becomes unavailable; denial/error evidence is preserved. For an older local snapshot only, the exact synthetic message `Saved on this device · checking for updates.` with unavailable state, valid success timestamp and no error/denial marker may recover connected history with cached provenance. Never recover a genuine unavailable/error result this way. Cached history is not fresh authorization: connection and native write prerequisites are independently verified and never granted by restoration. Legacy status-based write gates must reject cached history. Fresh successful source reads replace the cached flag. Recent restored successes may suppress redundant content scans under the normal cadence, including Notes/Collectives; actual failures, missing timestamps, stale content and backwards clocks retain their existing handling. No public launch checkpoint acquires native identities or write bases.

The UI labels cached successful sources as saved, not currently connected or first-sync unavailable. An online saved account awaiting authorization displays saved data/checking access rather than offline or fully synced. Real network loss, denial, errors and reconnection remain explicit. Historical source timestamps are visible before the first foreground refresh. These presentation rules live in pure core helpers. Planner verification remains ephemeral under the existing contract.

Reconcile native periodic jobs from validated saved identity and settings before network/authentication checks, including offline startup. Registering a job grants no authorization. Reuse matching persisted jobs without resetting their cadence. Native jobs remain short, constrained, read-only account-bound jobs; preserve the existing time budget and foreground write priority. Opening may cancel unfinished work; completed resource checkpoints and atomically published read generations survive. No permanently resident process/WebView, exact timer, battery exemption or instantaneous cold-process guarantee is implied.

Expose additive per-family background evidence under `DeviceSync.background.sources.{caldav,deck}`: `enabled`, `scheduled`, optional `lastAttemptAt`, `downloadedAt`, `readGenerationAt`, `projection` (`pending|ready|unavailable|incomplete`), `message`, `error`. `downloadedAt` means a completed native read; only a successful durable shared projection advances `readGenerationAt`. One family's success must not overwrite the other's result. Keep legacy aggregate `lastSuccessAt` as download history for compatibility; never label it usable planner publication. Aggregate scheduled is true only when every enabled family has its matching job (false when none is enabled). Unsupported/incomplete projection reports that limit and preserves previous usable data. No schema, cloud protocol or background native-write change.

Activity foreground signaling and cancellation must not wait on background filesystem publication or JavaScript sandbox teardown. Perform blocking cancellation/teardown on workers; retain serialized account/revision/edit-watermark publication fences and cancellation checks. A completed atomic generation may be adopted, but an interrupted or superseded generation must not overwrite newer edits. Verify the lifecycle signal with deterministic concurrency tests.

Acceptance: exact shared vectors for defaults, saved read provenance, cadence, no cached write authority and truthful labels/notices; Android cold/warm saved-state and offline scheduling regressions; native per-family scheduling/publication tests plus compilation. Physical reboot/Doze/launcher/background timing remains separate device evidence. Document the verified Android constraints and DAVx guidance without claiming unmeasured battery or launch-time improvements.

### WIDGET-02. Restore the approved widget visual hierarchy (2026-11-22)

The owner reports that the delivered native widgets flatten the approved examples into the same list. Correct the native presentation against the supplied screenshots and approved widget examples. Preserve WIDGET-01 configuration version, per-instance choices, source/status/date selection, action authority, access proofs and storage identities. The initial correction authorized source changes and fast verification. The subsequent explicit build request authorizes **RELEASE-21: Android 0.6.21/versionCode23**, packaged after those checks and source freeze. Preserve previous APKs, signing/application/account/storage identities and Windows/Web packages. No emulator, device installation, live-account writes, publication, deployment or push is authorized.

Use distinct page presentations. Calendar agenda places event times in a dedicated leading column, with compact date headings and source context; mixed work items remain visibly different from bookings. The existing optional month grid remains. Board shows unified status headers with inline counts, tinted bordered Deck card surfaces and indented linked tasks with a connector, direction label and completion strike-through. Empty configured status sections remain. List uses compact work rows with kind/completion indicators which open details; no nonfunctional completion checkbox. Overview exposes separate booking and work summary counts at the top, followed by visibly distinct booking/work sections. Timeline uses one labeled date axis and aligned date columns across rows, with positioned ranges/milestones rather than unlabeled progress tracks. Unsupported launcher drag/hover gestures are not implied.

Retain 32% default transparency and the existing 0–50 setting, fully opaque readable text, source accents, light/dark/high-contrast treatment and 44dp interaction targets. Replace oversized text-symbol controls with existing project icon artwork. Remove the redundant standalone page label when it repeats the title; show the Space and selected source kinds instead. Section names and counts share one compact line. Keep freshness truthful but compact: one secondary footer line, full source/metadata timestamps in accessibility/context details, with settings providing those details. Content scrolls inside its allocated region and cannot overlap the footer. At the minimum supported size, compact chrome must leave room for a usable item row after its heading; redundant context, summary tiles or the footer may collapse while Open/Create/Settings remain accessible and full freshness stays available in accessible context/settings.

Optional additive snapshot presentation fields are derived in the shared pure core: `contextLabel`, `overview:{bookings,work}`, `timelineAxis:{start,end,label,ticks:[{offset,label}]}` (0–100 offsets; injected locale/timezone/horizon), and per-row `leadingLabel`, `secondaryLabel`, `trailingLabel`, `sectionCount`, `displayDay`. Existing `subtitle`, `dateLabel`, rows and action IDs remain compatible. Calendar overlapping earlier-started ranges use an explicit ongoing label; visible booking dates remain identifiable. Timeline uses the existing horizon and interval geometry, and retains current ordering/filter semantics. Native views render these fields; they do not infer new membership or date rules. No change to cloud schemas or protocols.

Acceptance includes actual native resource hierarchy/geometry and pure presenter tests for each page, small/large and light/dark/transparent states, empty and linked-completed cases, long titles, missing dates, and source isolation. Compare the delivered layout with the approved visual target. A browser concept or compile-only check is not evidence of launcher visual fidelity; physical launcher rendering remains a separate explicit evidence level.

### WIDGET-01. Independently configured Android home widgets (2026-11-22)

The owner approved implementation of the researched widget plan and its translucent visual refinement. RELEASE-20 authorizes the final Android **0.6.20/versionCode22** APK after fast verification and source freeze. Preserve previous APKs, native signing/application/account identities and the Windows/Web packages. No publication, push, installation, emulator or live-account writes are authorized. This milestone delivers working native widgets and contextual creation through the existing guarded composer; a separate native capture/write runtime remains a later optimization, not a reason to duplicate write logic or delay the widget entry.

Each launcher instance owns local, account-bound settings. Deleting one removes only its configuration, snapshot and presentation actions. It never deletes Nextcloud records, shared metadata, drafts, in-flight mutation journals, acknowledgements or another widget. Configuration is separate from FILTER-03 and device navigation; optionally copying an app filter once must not bind subsequent edits. Initial setup cancellation saves nothing; reconfiguration cancellation retains the old instance. Upgrades/process death preserve valid local settings. Restored launcher IDs without valid matching settings show Set up widget; do not infer an account. Unsupported configuration versions fail closed without silently replacing saved settings.

The pure shared config version1 contains `widgetId` (positive Android ID), `accountKey` (existing private account cache identity), `generation` (positive monotonic instance revision), `title` (trimmed, 1..80 characters), `page` (`overview|calendar|timeline|board|list`), `scopeId` (existing Space ID or `all`), `sourceMode` (`all|selected`), `collectionIds`, `kinds` (`event|task|card`), `statusIds`, `projectIds`, `tagNames`, `assignment` (`all|me`), `includeUnassigned`, `showCompleted`, `query`, `dateRange` (`all|today|week|month|overdue`), `groupLinkedTasks`, `groupBy` (`date|source|project|status|none`), `sort` (`date|title`), `calendarLayout` (`agenda|month`), `transparency` (integer0..50), `density` (`compact|comfortable`), `theme` (`system|light|dark`) and `creationDefaults` (optional per-kind collection ID and Deck stack ID). Array values are unique bounded strings (maximum5000 IDs/tags; IDs at most512 characters, tags at most500); query retains FILTER-03's2000-character limit. Reject malformed account/widget/version identity. No cloud schema or folder protocol change.

Default title is the selected page name, scope `all`, all eligible sources, assignment `all`, includeUnassigned true, no query/status/project/tag exclusion, showCompleted false, compact density, system theme and32% transparency. Calendar defaults to event-only, next seven days, agenda/date grouping. Board defaults to Tasks+Deck, all dates, unified status sections and linked-task grouping enabled. List defaults to Tasks, all dates/date grouping; Overview/Timeline default to all three supported kinds, next seven days/date grouping. All pages default date sorting; configuration remains independent when page changes. Board never includes events. Calendar events and native Tasks are separate source-kind switches despite both using CalDAV. Notes/Files/Collectives are not widget work rows.

Source selection always intersects the current Space membership resolved by the existing pure planner, including project/tag grouping rules. Explicit collection exclusions also apply to linked context. Missing Space or explicitly selected source shows an unavailable/actionable condition, never a fallback to all account data. All status filtering and Board headings use the effective Space unified mapping; reuse existing done-task, done-card and archived-card semantics and linked completed-task exception. Project/tag filters narrow membership; they do not invent ownership. Linked prerequisites/follow-ups remain labeled, with completed tasks struck through; completion never completes the parent or modifies its description checklist.

The injected local date defines today; week/month mean today through the next7/31 local calendar days, not rolling168/744-hour windows. Dated interval overlap includes ongoing all-day/multi-day records; overdue uses existing deadline semantics and excludes completed records. Calendar/Overview/Timeline omit unscheduled work from dated output using existing planning/dependency rules. List/Board with all dates retain undated work. Locale/timezone formatting receives explicit host context; no production clock is read in pure selection. Sorting is stable with an ID tie-break. Each snapshot initially contains at most25 item rows plus required section headings and a total/has-more indication; this bounds rendering, never the underlying selection. Board retains configured mapped headings even if empty. Compact Board uses vertically scrolling status sections, without pretending launcher drag/pinch/hover interactions exist. Calendar supports agenda and month presentation; tapping a month date opens that date in the Calendar. Overview summarizes bookings/due work; Timeline shows bounded labeled date ranges; List displays task/work rows.

Native launcher views render small private atomic snapshots without starting an Activity/WebView, parsing the entire source archive, authenticating or making requests. Shared pure projection owns source/date/status/grouping decisions. Use the existing guarded foreground/headless state after reconciliation, known-denial filtering and acknowledged-edit overlays. Snapshot publication is fenced by account, config generation and underlying source/metadata/edit revisions; stale completions cannot resurrect deleted widgets or cross accounts. Publish after relevant successful data/config changes, coalescing equivalent results. Freshness is the last successful underlying read, not the widget render time. Failed sync preserves valid cached rows with stale/error context; denial/logout/replaced account removes affected visible rows and fences actions. Unsupported background JavaScript providers keep last valid snapshots with honest timestamps; no claim of refreshed projections on API24/25 or unsupported providers.

Private widget snapshot version1 has accountKey/widgetId/generation/page/scopeId/title, state `ready|empty|unavailable`, optional message, generatedAt, optional sourceVerifiedAt/metadataVerifiedAt, totalCount/truncated/fingerprint and flat `rows`. Rows have `type:heading|item`, id/title/subtitle, optional color/completed/depth/dateLabel and existing recordId/kind/source/collectionId/start/end/due/statusId/parentId/direction; direction is `incoming|outgoing`. Timeline rows may include pure `timeline:{offset,length}` percentages clipped to the displayed date horizon (today1/week7/month31 local days; all/overdue uses a labeled7-day preview). Off-range rows retain dates with no fabricated bar. Optional month data contains year/month, localized label/Monday-first weekdays and bounded `cells` with ISO date/day/count/today/inMonth, derived by the same injected-date projection. On widgets too short/narrow for an accessible month grid, show the agenda and an Enlarge for month grid hint without changing filters/configuration. Snapshot data never authorizes writes. Native store revision fences the entire config set; per-instance generation fences actions. The native host can request a one-shot `widgets` projection from private validated archives on configuration without a network request. Private action names are `open|create|item|date` with widgetId/accountKey/generation and optional recordId/date/kind; no credentials or raw native payloads in launcher intents. Full-page widget context is re-derived from the live validated state and config, never limited to25 snapshot rows.

Keep one existing account-level DAV/Deck scheduler, no per-widget network loop, resident WebView, continuous animation or exact refresh promise. While widgets exist, planner metadata may be conditionally checked within existing due background work only through the established manifest/inventory/consistency/merge rules. If the native background read runtime cannot perform that safely, preserve last verified metadata, expose its age and refresh it on normal app entry; do not claim remote Space/status changes are background-current. No new metadata-only source scanner or approximate Java merge is permitted.

The header exposes custom name, Create (+) and configuration access. A row opens its exact current record and configured page; title/Open all opens the page with temporary widget filters. Validate current account, instance generation, Space/source membership, record identity and allowed action before routing. Stale/deleted/missing actions show a useful recovery state. Respect dirty drafts before navigation. A temporary widget context must not overwrite saved FILTER-03 preferences or device navigation; leaving it restores the ordinary app context. A create action opens the existing composer promptly after local readiness, preselecting an eligible explicit destination/default without awaiting a bulk sync. Mixed widgets allow type selection. Destination remains visible and editable among eligible writable sources; actual creation keeps existing current-target preflight, defaults, validation, duplicate/retry and acknowledgement rules. No native widget shortcut bypasses write authority. Creation outside filters explains that the saved record is hidden. Direct checkbox completion may be added only through the same existing guarded operation; otherwise open item details rather than presenting a nonfunctional checkbox or fake completion. Native lightweight creation is follow-up work until a shared guarded write runtime is implemented.

Match the app's surface palette, compact spacing, blue controls, source stripes and14px shell corners. Default surface opacity68%; adjustable transparency0..50 per instance, text fully opaque, readable secondary labels and accessible touch targets. Provide a solid high-contrast/reduced-transparency treatment. Do not request wallpaper access or simulate costly live blur. Resize changes visible content/layout, not filters; phone/tablet settings remain independently configurable.

Acceptance covers independent instances, setup/save/cancel/delete/restore, safe config normalization, all5 pages, source/Space narrowing, Board links/headings, status/project/tag/date filters, ISO/DST boundary cases, bounded snapshots, stale and denied data, account switching, background publication races, deep-link/create routing and filter restoration. Run exact shared vectors through all clients and targeted pure/native tests; record native compilation separately from APK checks and physical launcher/device acceptance. No unmeasured instant-start, battery or refresh-time guarantee.

### SYNC-14. Android local launch and independent source verification (2026-11-22)

RELEASE-19 targets Android **0.6.19/versionCode21** after fast checks and source freeze. Preserve prior APKs and signing/application/storage identities. Windows remains 0.6.18/build20 and Web remains 0.6.17. The owner requested the final APK, without a new publication, push, deployment or installation request.

The owner requests investigation and correction of Android startup/full-refresh coupling, followed by a final Android package after fast checks and source freeze. Cached browsing must not wait for network access. A cold process still has platform/WebView initialization costs; neither hiding a loading indicator nor declaring an unmeasured instant launch satisfies this requirement. Measure first cached content, durable restoration, current write access and content freshness separately.

On open, verify current native access independently of full resource synchronization. A bounded portable `readSourceAccess({sources,isActive,onCollections})` operation supports Tasks, Calendar and Deck through fresh identity and existing collection/board discovery, without ICS/card-body reads or theme downloads. It returns current collections, verified source names and per-source errors; it never advances content timestamps or reports content as freshly synchronized. Successful empty discovery grants no writable targets. Transient failures preserve saved content but do not grant new write authority; explicit permission denial invalidates only its scope, authentication/identity loss fences the entire account. Actual mutations retain durable-restoration, current target permission and conditional revision checks. Public checkpoints never confer authority.

Source scheduling may take an explicit set of sources whose access is independently checked. For those sources, a restored unavailable presentation state alone must not force a full content refresh: use the existing last-success/attempt timestamp, interval and backwards-clock rules. Other hosts/sources retain the existing default scheduling behavior. The access check still runs on foreground entry when automatic content synchronization is disabled; manual Refresh still requests content. Preserve fresh-data diagnostics and existing denial/error/retry states rather than disguising cached data as current.

On resume, adopt a newer validated account-local background read generation before network reconciliation when possible. Reuse the existing private generation validators, denied-source scope, source/edit watermarks and revision checks. Do not replace live workspace, drafts, pending requests or newer acknowledged edits from a public launch checkpoint, an obsolete generation or an incomplete background pass. Unchanged disk generations should not trigger whole-state reconstruction. Cancellation/account switches fence late reads.

Two-slot launch/source archives may use a bounded prefix from the same native file revision to order candidates and read only the newest valid body. Prefixes are hints, never substitutes for complete envelope/account/content validation. Unknown/tied hints, changed revisions and invalid newest candidates retain safe full inspection/fallback; acknowledged-edit stores retain their stricter intact-history rule. Existing on-disk envelopes and corruption recovery remain compatible.

Background CalDAV uses freshly returned collection sync-token/ctag to avoid re-inventorying an unchanged collection only when a complete prior inventory and its exact local resource-file revision proofs remain valid. Optional private version-1 inventory acceleration metadata is account/collection scoped, atomically replaced, disposable and bounded by the existing resource-cache limits. It contains collection identity/properties/token, exact resource href/ETag/file revisions and completion evidence; it contains no credentials and is never cloud planner metadata. Commit it only after complete verified resource processing and successful shared headless publication. Missing/corrupt resources, local edits, eviction, changed collection properties, denial or incomplete processing invalidate reuse. No partial scan may advance its token or authorize deletion. Token absence/change uses the existing bounded ETag inventory fallback. Preserve the Files SSO transport limitations and direct-transport REPORT support.

An unchanged background projection may be reused only with matching account, projection day, complete network inventory proof and all relevant raw-resource, source, metadata and acknowledged-edit revisions. A process-local certificate may accelerate repeat jobs but must miss safely after process death. Never skip date rollover, deletion, denial or pending-edit reconciliation. Keep Android-managed unique, constrained jobs; do not add a resident WebView/service, exact-timing promise or battery-policy exemption. Web remains online-only and Windows behavior remains unchanged unless explicitly opted in.

Acceptance requires delayed-network cached launch, bounded permission discovery without body reads, recent/off/manual/stale scheduling vectors, valid/corrupt cache candidate selection, guarded background adoption, unchanged/changed/partial/denied collection reuse and native packaging evidence. Fixture request/byte counts are not physical-device startup, battery or provider-crash measurements.

### SYNC-13. Windows bounded calendar refresh repair (2026-11-18)

RELEASE-18: after the source repair and fast checks, the owner requests the final Windows **0.6.18/build20** package (file version0.6.18.20) and a source push to the existing GitHub repository. Preserve prior packages and application/account/storage identities. Android and Web packaging remain at 0.6.17/build19. Verify the new Windows executable and its packaged fix in an isolated profile. No store submission, server deployment or binary-release publication is included.

This clarifies the existing SYNC-03 transport opt-in after a Windows timeout report. A REPORT-capable reader without an explicit durable `resourceCache` must retain the existing server-side calendar-query path: complete VTODO queries and VEVENT queries bounded to the existing projection horizon. Discovering a collection sync-token/ctag alone must not switch that reader to downloading every historical resource. Readers with the durable cache port, and PROPFIND/GET-only transports, retain their existing incremental scan/checkpoint behavior. Preserve recurrence, permission, cancellation, response limits and native edit baselines; do not raise the deadline or falsely certify a partial source to conceal the timeout.

Windows retains an already recorded last successful source timestamp when a later transient/partial refresh fails. That historical timestamp is not a successful new attempt, does not enable editing or certify current data, and must not be advanced by failure. When no successful timestamp exists, keep it absent. Existing revocation, account isolation and cache reconciliation safeguards remain. This repairs transport selection and diagnostic retention; it adds no cloud schema, cache format, scheduler or release version.

### BRAND-01. Approved application icon (2026-11-17)

RELEASE-17: the owner subsequently requested rebuilt clients with the approved project icon. Package Windows, Android and Nextcloud at **0.6.17/build19** (Windows file version0.6.17.19, Android versionCode19, Web app0.6.17) after source freeze. Verify the actual packaged native icons, browser/shared branding and Nextcloud navigation assets against the approved artwork. Preserve prior releases, technical identities and signing continuity. No installation, live-account writes, deployment or publication is authorized.

The owner selected the stacked Calendar/rear-card symbol with two staggered timeline bars and a large angular Tasks tick crossing the lower-right frame as the application icon. The tick's separation is transparent negative space. The geometry is fixed; do not replace it with earlier explorations or generic cloud/layers/calendar placeholders. Canonical artwork lives in `packages/ui/src/branding/`; `docs/BRANDING.md` records the approved assets and environment-specific treatments.

Use the white symbol on solid Nextcloud blue (`#0082C9`) as the default self-contained launcher/favicon badge. Android adaptive icons separate the blue background from a safely inset white foreground and supply the same monochrome geometry for themed launchers. For host-controlled or in-app surfaces, use the monochrome symbol with the host's contrast-aware foreground color; Nextcloud navigation supplies the appropriate white/dark asset. Dark-on-blue and white-on-blue gradient badges remain approved alternatives, not a separate identity or a user preference requiring persistence.

Apply the icon across Windows native/window/packaging references, Android launcher/splash and browser preview, Nextcloud app navigation, and shared visible product branding. Preserve technical identities, resource identifiers where practical, saved data, release versions and prior packaged artifacts. This icon approval authorizes source/asset integration and fast verification, not a new release build, installation, deployment or publication. No planner state, protocol, or shared behavioral vector changes are required for this visual-only decision.

## Authority, reading order and changes

Read this document, `FEATURE_PARITY.md`, root `AGENTS.md` and the assigned client's instructions before implementation. Every global behavior change must update this document FIRST. Then update acceptance criteria and delegate client implementation. Historical documentation or implementation quirks do not silently override an explicit rule here; report conflicts to the orchestrator.

This document specifies platform-independent records, calculations, operations, state transitions and user-observable outcomes. Host authentication, credential vaults, filesystem mechanisms, input affordances and framework choices belong in the client instructions. Equivalent behavior does not require every host to use the same presentation technology or authentication handoff.

Each API named below is an application operation, not permission to expose an unrestricted network bridge. Optional operations are capabilities. Unsupported/read-only actions must be absent or explicitly unavailable, never return fabricated success. Persistent schema, derived runtime records and operation validation are intentionally distinct layers.

The companion parity ledger stages delivery. Phase 1 foundations are established. The owner's subsequent review authorizes alternative Android/browser-preview sign-in and the Windows-equivalent planner presentation, including responsive Overview, Calendar, Timeline, Board, List, Spaces and item inspection. The foundation-only screen is no longer the product entry. This does not mark every later-phase mutation or device interaction complete: expose operations only when their host capability is implemented and verified. Reuse existing shared implementations rather than independently approximating them.

The Web target is an application installed inside Nextcloud. The owner authorized implementation on 2026-11-14 under WEB-01 below, superseding earlier hold instructions. No standalone web authentication product is being introduced.

### Web preparation decisions (2026-11-14; documentation only)

The initial Web compatibility targets are Nextcloud Server **34.x**, including **34.0.5**, and **35.x**. These are intended test targets, not verified support declarations; each major requires integration acceptance before being advertised in installable metadata. Resolve the corresponding PHP requirements against those server versions before scaffolding. Existing Windows/Android compatibility is not narrowed by this Web target.

The owner intends the Nextcloud-installed app and public source repository to be free of charge and may charge for Google Play/Microsoft Store distribution. The owner subsequently selected AGPL-3.0-or-later for project-owned code. Preserve third-party licenses/notices; this choice does not authorize publication or deployment. WEB-01 records the approved app identity, online-only session model and styling.

### WEB-01. Nextcloud session host (2026-11-14)

Implementation is authorized in `web/`, reusing shared UI/core/native protocol. App ID is `nextglance` (Nextcloud-required lowercase), visible name NextGlance, PHP namespace `OCA\Nextglance`. Existing technical packages, native app/account identifiers, workspace schema 2, folder protocol 1 and `/Workspace/Nextspace/` remain unchanged. Server 34.x and 35.x are targets requiring separate real-server acceptance. Do not implement a second login flow or standalone website, proxy arbitrary authenticated URLs, create service-account credentials or expose app passwords.

Use the current Nextcloud session and same-origin, installation-base-path-qualified requests with current request-token protections. Bootstrap identity comes from authenticated server state, never query parameters or browser-supplied usernames. Optional source integrations keep their own permissions and explicit availability. Every native write preserves shared validation, fresh permission/version checks and conflict handling; failed native operations never become custom-only writes. Reuse the portable protocol for native data and planner folder conditional writes. A metadata read failure must not initialize an empty authoritative workspace over existing data. View-local filters remain separate from cloud organization.

This host is online-only. On initial load, require an authenticated server response. Connection loss shows an offline indication and disables writes; any already-rendered content is merely the current page's stale in-memory state. Do not add offline launch, service workers, persistent native/planner caches, offline write queues or background mobile-style synchronization. Cookies are for the existing Nextcloud session, never planner/native payloads. In-memory ETag/token caches may accelerate incremental reads within the page session. Non-content presentation preferences may remain device-local; credentials, native content, planner metadata and private drafts must not be persisted in browser storage. Saved organization remains on the server.

Session expiry/logout must stop requests, fence late responses, disable mutations and cover/remove private rendered content until Nextcloud authentication is restored. Do not expose another user's records after account switching. Reconnection must revalidate authenticated identity before resuming writes; old-account memory is discarded on identity change. No automatic replay of non-idempotent mutations after uncertain network outcomes. Keep unsent edits only in the current page while authorized context can be recovered; navigating/reloading may lose such drafts and must not claim server persistence. A durable scheduling/create-and-link recovery feature may be enabled only with server-side operation evidence or equivalent shared idempotency safeguards; omit unsupported operations from capabilities.

Nextcloud owns its global navigation, login/logout and theme. Mount the shared planner inside its application content area, scope CSS to that area and avoid global resets, duplicated host headers, body wallpaper replacement or desktop authentication controls. Follow native theme variables and the approved glass surfaces with opaque information surfaces. Windows/Android behavior is unchanged unless a separately specified shared correction is required.

Implement and verify in stages: authenticated shell/transport, shared read projections and metadata, then explicitly verified native editing capabilities. No fabricated data or capability advertisement for missing operations. Provide a concise manual deployment/update/rollback guide with required assets and honest integration evidence. Use fast unit, type/syntax and fixture checks during development; final UI packaging still follows the explicit-build policy. No live-account writes, production server changes, publication or store submission are authorized.

## Non-negotiable product decisions

### VIEW-16. Independent Timeline Unscheduled sidebar (2026-11-17)

RELEASE-16: the owner subsequently requested rebuilt applications after VIEW-16 verification. Package Windows, Android and Nextcloud at **0.6.16/build18** (Windows file version 0.6.16.18, Android versionCode18, Web app0.6.16). Freeze source before final packaging, preserve previous releases and account/signing/storage identities, and verify the packaged correction. This permits final local builds only, not deployment, publication or live-account writes.

The Timeline Unscheduled sidebar uses the same independent show/hide and resize behavior as Calendar and Overview. On wide layouts it sits beside the Timeline, never below it; narrow layouts use the existing bounded side overlay. Opening or closing the sidebar never changes Timeline row visibility. All matching unscheduled work stays available in the sidebar, including when also shown in the Timeline.

Replace the mutually exclusive move-to-sidebar/show-in-timeline buttons with a checkbox labeled **Hide unscheduled items in timeline** in the Timeline sidebar. Unchecked retains undated rows for dependency editing; checked hides only those rows from the Timeline. The default remains unchecked. Sidebar visibility, width and this row-placement choice retain their account/scope/page-local presentation storage; reuse the existing `inline` flag inversely for the checkbox, preserving saved choices without a cloud format change. Calendar and Overview continue to omit undated work from their dated panes. Empty sidebars and reopen controls consume no space. Explicit navigation to a hidden undated row reveals it in the sidebar without changing the checkbox.

This correction requires pure-core presentation transitions and shared-vector coverage for independent sidebar/row behavior, plus geometric UI regressions across desktop, tablet and phone layouts. Existing source identities, classification, synced semantic filters and release versions remain unchanged. The initial feedback was verified without packaging; the subsequent RELEASE-16 request above authorizes final rebuilt packages.

### PERF-18 / FILTER-03 / VIEW-15 / EDIT-18. Responsive sync and planning (2026-11-17)

VIEW-15 space use: when there are no unscheduled records in the current filtered view, its tray and reopen control reserve no space and do not overlay the planner. Retain the saved width/visibility choice for when matching items return.

PERF-18 planner-read refinement: after fresh manifest/legacy-baseline checks and a complete fresh folder inventory, an inventory identical to the last certified generation may reuse that validated workspace without a second inventory or reparsing unchanged documents. A changed generation, membership, validator, or pending legacy import uses the full consistency check. Required-path deletion checks and conditional writes remain mandatory; the shortcut never certifies a partial or previously failed read.

The owner authorizes implementation of the sync review and final Windows, Android and Nextcloud packages. RELEASE-15 is **0.6.15/build17** (Windows file version 0.6.15.17, Android versionCode17, Web app0.6.15), after fast checks and source freeze. Existing identifiers, workspace schema2 and folder protocol1 remain unchanged. No deployment, publication, emulator or live-account test writes are authorized.

PERF-18: cached browsing and last-view restoration must not wait for network freshness. Readiness to edit is still gated by durable restoration/current permissions, independently of a full source-body scan. Startup may use a disposable public checkpoint, but must never treat its absence as authoritative deletion of organization or preferences. Account-private cache revision metadata may avoid rereading unchanged, already validated slots; changed/corrupt slots require validation and durable acknowledged-edit safeguards remain. Background work runs without an Activity/WebView and updates an account-fenced usable read generation when the device supports the headless shared JavaScript projector. Use the actual shared projection/reconciliation rules, never a second approximated native business engine. Android JavaScriptSandbox is a permitted runtime boundary; unsupported devices retain raw-resource acceleration and explicitly report that background projection is unavailable. Read generations retain source revisions and are adopted only under matching account and acknowledged-mutation watermark; incomplete/cancelled refresh cannot replace complete data or resurrect a native deletion. Widgets are future consumers, not a widget UI implementation in this milestone.

Native background synchronization uses fresh collection-token comparison and metadata-only cache lookups to avoid reading unchanged raw bodies. Interrupted work is bounded/resumable, with retry backoff and an orderly foreground handoff. Neither repeated automatic retries nor user edits may create an unbounded queue. User preflight/writes have priority over bulk reads within the same bounded transport capacity. Distinguish provider/queue failures, cancellation, authorization, network and cache failures in diagnostics; never infer provider crash cause from a generic network error. Optional diagnostics include phase/queue durations and counts without account URLs or content. On transports advertising REPORT support, implement RFC6578 changed/deleted href deltas and bounded calendar-multiget body batches. Commit a new token only with a complete applied checkpoint; invalid/expired tokens require safe full inventory. The Files SSO provider's unsupported REPORT remains a supported fallback, not a reason to silently change login or forward arbitrary methods. Conditional Deck reads and original native bodies/validators remain intact.

Link selectors build record/relationship indexes once per input revision and compute cycle eligibility without per-candidate full-array scans. Render a bounded row window; preserve all candidate search, inaccessible reasons, Space source scope, keyboard access and fresh submit validation. Progress-only publications do not replace the entire reactive planner. Checklist task creation retains cloud-confirmed reservations, deterministic request identities, conflicts and durable partial-success recovery. A saved task whose relationship has not synced is described as saved/link pending; retry repairs the remaining operation. Optimize metadata transactions without weakening these invariants. After checklist selection, present a compact task editor with target task list, editable task titles, optional start/due dates with touch-capable visual interval editing, and Markdown description; these are task dates, not an implicit calendar booking. Selected completed checklist rows retain their native completed creation semantics. Windows event editor title/target controls must receive pointer input and show their calendar popup in the actual Electron host, including overlapping titlebar/inspector states.

FILTER-03 supersedes FILTER-02 and older device-local-filter prohibitions for saved semantic filters. Save independent account/scope/page filters, including owner `all` (My overview): assignment, includeUnassigned, unassignedBoardIds, hiddenCollectionIds, showCompleted, query, attention, listKind, statusIds. Retain existing defaults and bounds. Active page, dates/scroll, panel geometry, calendar mode and other presentation controls remain local. Store filters separately from organization in `/Workspace/Nextspace/view-preferences.json`, outside the v1 `data-*` generation inventory, so previous clients neither reject nor rewrite it. Envelope: `{format:'nextspace-view-preferences',version:1,scopes:Record<scopeId,{pages:Partial<Record<PlannerView,PageFilters>>}>}` with the existing FILTER-02 PageFilters shape/bounds, at most2500 scopes and2,000,000 serialized characters. No credentials/native payloads enter it. Missing document means no saved shared preferences; malformed/inaccessible data is an error, never permission to replace it with defaults.

Hosts expose optional `getViewPreferences():Promise<{preferences:ViewPreferences,etag:string|null}>` and `saveViewPreferences({base,preferences,etag}):Promise<{preferences:ViewPreferences,etag:string|null}>`. Read and conditionally write with strong server versions; create-only when absent. Merge distinct scope/page/field edits against the supplied baseline, preserve same-field divergent conflicts for explicit retry rather than silent last-write-wins, and bound412 retries. Import existing local saved pages only where cloud pages are absent; defaults shown during startup never count as user edits. Unrelated pages remain unchanged. Successful shared preferences apply without moving the current page/date. Desktop/mobile keep account-private local values for immediate restoration and pending preference edits; Web uses session memory only. Authentication/account changes fence reads and writes. Preference failures are reported separately and cannot make native-source refresh fail. Never prune saved preferences on a partial workspace; confirmed scope deletion may remove local presentation state, while stale shared scope filters stay inert rather than deleting another device's settings.

VIEW-15: use one pure Unscheduled classifier across Overview, Calendar and Timeline: work is scheduled if it has a valid native start/due range, planner session or dated linked calendar booking (`scheduled_during`). A `for_event` association alone does not reserve time and does not remove undated work from Unscheduled. No dates are invented. Overview places unscheduled work in a separate tray and omits its timeline rows. Timeline defaults to retaining undated rows for dependency work and offers an explicit option to move them to the tray. All three trays can be completely hidden/reopened and resized with mouse, touch and keyboard. Resizing is bounded to available viewport, preserves aligned Overview axes and never leaves a blank reserved column when hidden. Narrow screens may use a bounded overlay. Classification respects current filters, selection, groups and linked navigation. Tray visibility/width and Timeline placement are local per scope/page, independently of synchronized semantic filters.

### EDIT-17 / BOARD-06. Native stack moves, drag feedback and unified dependencies (2026-11-14)

Deck stack selection and Board column drops perform the same native move operation. Validate the destination within the current writable board and preflight the current native card; preserve genuine concurrent-change conflicts. Use Deck's supported reorder semantics and verify the returned/native-read card identity and destination before adopting success. A successful move must update the stored native stack, snapshot and revision together so the next edit does not compare against the pre-move card. A failure retains the attempted edit for explicit retry/discard, never reports a custom-only move as native success. Readback must bypass stale caches. Do not resolve a real version conflict by overwriting unrelated server changes.

For the Deck API, preflight reads use the current card locator; reorder uses `PUT /index.php/apps/deck/api/v1.0/boards/{boardId}/stacks/{destinationStackId}/cards/{cardId}/reorder` with `{stackId: number, order: 99999}` matching that destination. Deck route parameters take precedence over same-named body parameters. The response may be an array of affected cards or an empty acknowledgement; it is not a canonical single-card snapshot. After acknowledgement, perform one fresh targeted read to confirm destination and identity and obtain the enriched card and response validator together. Adopt native completion as returned rather than infer it from the column name. This is a protocol repair, not a planner schema migration.

An activated Board drag shows a floating, noninteractive representation of the grabbed card following the pointer/finger with the original grab offset. The original position is visually subdued and the eligible destination column/insertion position is highlighted. Existing long-press activation, ordinary scrolling before activation, cancellation, keyboard ordering, native status mapping and ambiguous-target selection remain intact. Releasing over a valid destination commits exactly one move/reorder intent and the card appears in that destination optimistically; pending native acknowledgement and failure recovery remain truthful. Invalid drops, pointer cancellation and Escape remove the preview without changing source state. The preview must not intercept hit testing or reserve layout space, and updates must not trigger data synchronization or full Board recomputation per pointer movement.

The inspector has exactly one **Dependencies** section with **Waits for (incoming)** and **Needed by (outgoing)** columns containing both task and Deck-card dependencies. Task-specific actions (**Link task**, **Create task**, **From checklist**) remain identifiable for Deck cards within this section, without a second pair of direction columns or duplicated relation rows. The general **Add dependency** action continues to accept both eligible tasks and cards. This supersedes the separate Tasks dependency panel in EDIT-16; task receipt, creation, direction, native ownership, scope, retry and Jump to behavior is unchanged.

RELEASE-14: the owner requests final Windows, Android and Nextcloud Web packages after these fixes, targeted checks and source freeze, at **0.6.14 / build 16** (Android versionCode 16; Windows executable 0.6.14.16; Nextcloud app 0.6.14). Preserve previous artifacts and identities. This authorizes final local packaging, not live-account writes, deployment or publication.

### EDIT-16 / NAV-02. Deck tasks, checklist conversion and linked-item navigation (2026-11-14)

Deck inspection exposes **Tasks** with **Link existing**, **Create task**, and **From checklist** actions. Linking existing work uses the same scoped dependency eligibility/cycle rules as Add dependency, with a task-only picker and explicit incoming/outgoing direction. Incoming means the card depends on the task (`fromId=card`, `toId=task`); outgoing reverses this. New tasks and checklist conversion default to incoming. These are real native CalDAV VTODOs and synchronized cross-source `depends_on` relations, so the existing grouped Board places incoming tasks above and outgoing tasks below the card. Native Deck card-to-card dependencies remain native. Creating/checking/completing a task does not implicitly complete the parent card or edit its Markdown checklist.

Creation is explicit, never triggered by opening/refreshing a card. The user chooses a writable task list within the active Space's sources (Overview uses available sources), with the existing scoped default when available. Manual task creation offers title, optional start/due and Markdown description. Checklist conversion previews parsed Markdown checklist rows (excluding fenced code), their checked state and existing-task matches; the user selects rows and destination before submitting. A Select new tasks action selects eligible new rows at once; Clear selection resets the selection without touching existing tasks. Checked rows create completed tasks; unchecked rows create NEEDS-ACTION tasks. Dates are not guessed from the parent. Empty labels and labels exceeding the native 500-character title bound cannot create tasks. Limit one conversion submission and one card's retained receipts to 200 entries, reporting the limit rather than truncating silently.

Checklist identity uses the rendered plain label normalized with Unicode NFKC, lowercase and whitespace folding, plus its one-based occurrence among identical normalized labels. Ignore checkbox state, Markdown emphasis, physical line/offset and unrelated row insertion/reordering. Identical duplicate labels remain distinct occurrences. Renaming a row changes this identity; never guess that a different title is the same task. Prefer a saved receipt; otherwise a single already-linked task with the same normalized title may be adopted, without changing its native content or completion. Multiple matching linked tasks or indistinguishable matching duplicate rows require explicit resolution rather than automatic creation/adoption. The interface explains that renamed checklist rows may need Link existing. No background bidirectional checklist synchronization is introduced.

Store operation evidence in `workspace.properties[cardId].cardTasks`, a dictionary of receipt keys to `{version:1,requestId:string,collectionId:string,title:string,description:string,completed:boolean,start?:string,due?:string,checklist?:{text:string,occurrence:number},taskIdentityKey?:string}`. `title` is trimmed 1..500 characters, description at most 20,000 characters, collection/native identity strings obey existing bounds, dates obey native task interval rules, occurrence is an integer 1..200. A receipt key is `checklist-` plus the 64 lowercase hex SHA-256 of JSON `[normalizedLabel,occurrence]`, or `manual-` plus a UUID. Checklist requestId is a deterministic UUID using the first 16 SHA-256 bytes of UTF-8 JSON `["nextglance-card-task-v1",cardNativeIdentityKey,receiptKey]`, with RFC variant bits and version 8 bits; manual requests use a freshly generated UUID retained through retries. Card native identity comes from the registry, not its title or an independently assigned app UUID. Immutable draft/destination fields are recovery evidence, never a replacement for native task content. Do not alter a reserved receipt on retry; changed inputs require a new explicit manual request. Retain receipts after linking, deletion or unlinking to prevent accidental recreation. Unavailable completed receipts report an existing/missing task and require review, never silently recreate it.

Before any native task creation, reserve the receipt using existing conditional planner writes and confirm cloud sync success. Concurrent incompatible reservations must conflict before the losing caller creates anything. Reuse the published reservation after identity reconciliation. No offline native creation or silent metadata fallback. Create tasks sequentially through a shared framework-independent coordinator; each native acknowledgement is adopted through the host's existing durable/in-memory source path. Add the dependency and task's native identity to the receipt through the normal planner merge. If native creation succeeds but linking fails, clearly report partial success and retain the reservation: retry uses the same native request identity and repairs the link rather than creating another task. A completed receipt with loaded native identity is a no-op; do not re-add a deliberately removed relation automatically. Successful earlier rows remain acknowledged when a later row fails. Web uses these server-persisted reservations rather than introducing a browser cache/outbox. Account changes fence the coordinator and prevent cross-account writes.

Extend `createTask` input with optional `requestId:string` and `completed:boolean`. The native protocol validates a UUID (versions 1..8), uses its lowercase value as UID and resource filename, writes `X-NEXTSPACE-REQUEST`, and uses create-only `If-None-Match:*`. On an existing resource/precondition failure, verify exactly one matching VTODO, UID and request marker at the same safe destination, then reuse its current version without overwriting later edits. A mismatch is a conflict. A lost response can be retried with the same ID. Ordinary creation without requestId remains unchanged. Initial completed tasks have native STATUS COMPLETED, PERCENT-COMPLETE 100 and COMPLETED timestamp; ordinary initial tasks remain NEEDS-ACTION. Hosts must pass these fields explicitly and validate before network writes. Native file IDs, source identities, workspace schema 2 and folder protocol 1 remain unchanged.

Linked task/event rows have an explicit **Jump to** control, separate from opening inspector details. In Overview, Calendar or Timeline it reveals the target in that same view, adjusting date and row/time scroll and expanding its group as needed. Board (and List) offers Calendar or Timeline destinations. Preserve ordinary click-to-inspect and Back behavior. Jumping to the already-selected item still works. Protect unsaved drafts before navigation. Missing/unloaded targets explain the problem; out-of-scope or filtered targets explain what prevents visibility rather than silently changing Space or resetting filters. Undated work can jump to its Timeline row or Calendar's unscheduled section without inventing dates. Navigation is device-local and never mutates native dates, links or cloud organization.

RELEASE-13: after targeted checks and source freeze, the owner requests all three client packages at **0.6.13 / build 15** (Android versionCode 15; Windows executable 0.6.13.15; Nextcloud app version 0.6.13). This authorizes final packaging only, not deployment, publication or live-account test writes. Real Nextcloud 34/35 and physical-device acceptance remain separately reported.

- Nextcloud remains the owner of native Tasks, Calendar, Deck, Notes, Files and Collective content. Custom files store only the additional organization/relationships/settings unsupported natively, plus the identity registry required to connect them.
- My overview is independent of Spaces. Spaces are saved views with their own selected sources and source groups, not owners of the underlying records.
- Card-to-card dependencies and Deck note/file attachments use native Deck/Files representations. A failed native write never silently becomes a custom-only link.
- Notes have native identifiers. Names, titles and paths are presentation/locators, not universal identity.
- Data loading failures never replace real account data with sample records. Real source edits require current permissions and verified source state.
- Preserve drafts, conditional-write conflicts and partial-operation evidence. No silent last-write-wins overwrite, cross-account leakage or destructive reset to fix sync.
- Saved organization synchronizes across clients; transient navigation/filter state remains local. See the explicit exclusions below.
- No automatic dependency-chain scheduling, group dragging, native offline outbox, server-wide availability or complete complex-recurrence editor is promised by the present implementation.

## Explicit baseline decisions and limitations

1. Appearance mode (`system`, `light`, `dark`) currently belongs to synchronized appearance settings. Older prose calling the override local is superseded. `system` means follow the user's Nextcloud preference, with operating-system fallback when applicable.
2. A cancelled task is closed for display/filter purposes, but cancellation does not satisfy a dependency. Dependency readiness currently requires the loaded prerequisite's `completed` flag. Missing prerequisites remain unresolved context and do not contribute to the loaded blocked-count calculation; do not present that count as proof every unseen prerequisite is satisfied.
3. Ordinary optimistic native edits are in memory until acknowledged. Custom metadata saves are durable. Create-and-link scheduling has a separate durable local operation journal; it is not a general write queue.
4. Deck freshness/readback reduces stale writes but is not a universal atomic conditional-write guarantee. Notes and DAV validators must follow their own contracts; do not equate opaque Notes ETags with DAV strong validators.
5. General metadata conflicts preserve versions and report conflict; there is no complete reference-client interactive field conflict resolver. Note editing has a separate explicit review flow. Do not claim one is the other.
6. A Notes category rename changes its source identity derived from the category path; no general collection-alias migration exists. Preserve unavailable organization references rather than guessing a rename from equal titles.
7. Full timeline virtualization and unlimited large-data performance are not implemented. Bounded rendering and structural state reuse are requirements where specified, not an unmeasured performance SLA.
8. Existing legacy imports are compatibility behavior documented below. They do not authorize inventing new legacy formats or adding legacy UI merely to preserve early test data. New clients must not corrupt a supported current workspace and must explicitly report unsupported historical input.
9. Source audit and fixture tests establish specific evidence; an actual platform build and physical-device/server integration remain separately verified. Never mark parity from a successful web asset build alone.

## Document map

The sections below cover (A) typed models, operation contracts, identity, validation and synchronization; (B) scope/view/status/date/edit/scheduling state machines; and (C) native content, Markdown, attachments, tags, matching and protocol edge cases. Source/test references identify the audited evidence. They are not alternate authorities for silently changing the specified behavior.



## A. Data models, operation contracts and synchronization

Detailed contract baseline. Audited against current source on 2026-11-11. This fragment changes no implementation. Examples use invented IDs and content, not account data.

### Scope and authority

- The current shared model is Workspace schema 2. Cloud folder protocol 1 and local envelope schema 1 are different version numbers.
- Normative shared rules below describe existing product behavior that another client must reproduce.
- Sections marked **current limitation**, **compatibility only**, or **implementation discrepancy** identify gaps or historical implementation choices; they are not invitations to invent alternate behavior.
- Source references are repository-relative evidence locations. Platform-specific evidence files do not require another client to use the same runtime or UI framework.
- Read the native source first for fields that source owns. Store only missing organizational/relationship/planning information in the custom workspace. Never populate a failed account with invented sample records.
- The API described here is the application's logical operation interface. It is not an HTTP service currently hosted at the Nextcloud server.
- An optional operation in the interface represents a host capability gate. A client that lacks it must show an unavailable/read-only action, rather than pretending a local edit has reached Nextcloud.

Evidence: packages/contracts/src/index.ts; packages/core/src/planner-schema.mjs; packages/nextcloud/src/nextcloud.mjs; packages/nextcloud-node/src/workspace.mjs.

### 1. Canonical model vocabulary

#### 1.1 Scalar and enumeration conventions

| Name | Exact values / representation |
|---|---|
| Source | tasks, calendar, deck, notes, collectives |
| Record kind | task, event, card, note, page |
| PlannerView | overview, calendar, timeline, board, list |
| RelationType | depends_on, for_event, scheduled_during, reference, related |
| Relation role | preparation, during, follow_up |
| WorkflowColumn | inbox, planned, doing, done |
| Appearance mode | system, light, dark |
| Assignment preference | me, all |
| Native task status | NEEDS-ACTION, IN-PROCESS, COMPLETED, CANCELLED |
| Date-only | YYYY-MM-DD, without time or zone |
| Explicit instant | ISO date/time with Z or an explicit numeric UTC offset |
| App record identity | A stable UUID generated by the application identity registry |
| Native ID | Source-owned opaque identifier, usually serialized as a string in public models |
| Optional field | Omitted/undefined means not present; it is not automatically a request to clear |

Do not conflate native IDs, record UUIDs, collection IDs, and display names. A name change is not an identity change. The metadata schema validates IDs as bounded nonempty strings; it does not require all historical entity IDs to have UUID syntax.

#### 1.2 Native identity and tag models

~~~ts
type Source = 'tasks' | 'calendar' | 'deck' | 'notes' | 'collectives'
type PlannerView = 'overview' | 'calendar' | 'timeline' | 'board' | 'list'
type RelationType = 'depends_on' | 'for_event' | 'scheduled_during' | 'reference' | 'related'
type WorkflowColumn = 'inbox' | 'planned' | 'doing' | 'done'

interface NativeIdentity {
  source: Source
  key: string
  locator?: string
  aliases?: string[]
}
interface RecordTag { id: string; title: string; color?: string }
interface FileTag extends RecordTag { assignable: boolean }
interface CloudFile {
  id: string; name: string; path: string; directory: boolean
  size?: number; mimeType?: string
}
interface DeckAttachment {
  id: string; type: string; name: string; url: string
  fileId?: string; path?: string; size?: number; mimeType?: string
}
interface RelatedResource {
  providerId: string; itemId: string; title: string; url: string
  subtitle?: string
}
~~~

- FileTag.assignable describes permission to change assignment, not whether the tag is currently assigned.
- Where a native numeric ID is required, the connector accepts digit-only values whose numeric value is a positive safe integer. Do not interpret an arbitrary UUID or title as a numeric native ID.
- A restricted assigned tag remains visible and attached when omitted from the editable selection.
- RecordTag.color is optional. Do not invent a source-native tag color when none exists.
- CloudFile.path is an account Files path, not a local-device path or arbitrary URL.
- RelatedResource is a server recommendation, not an automatically saved relationship.

#### 1.3 Source record projection

~~~ts
interface WorkspaceRecord {
  id: string
  source: Source
  kind: 'task' | 'event' | 'card' | 'note' | 'page'
  title: string
  body?: string
  url?: string
  collectionId?: string
  collectionTitle?: string
  due?: string
  start?: string
  end?: string
  allDay?: boolean
  busy?: boolean
  completed?: boolean
  priority?: number
  percentComplete?: number
  tags?: string[]
  tagDetails?: RecordTag[]
  color?: string
  status?: string
  updatedAt?: string
  readonly?: boolean
  etag?: string
  assigneeIds?: string[]
  assignmentKnown?: boolean
  assignmentCount?: number
  stackId?: string
  nativeDependencies?: string[]
  nativeDependents?: string[]
  nativeRelatedIds?: string[]
  fileId?: string
  attachmentFileIds?: string[]
  fileTags?: FileTag[]
  identity?: NativeIdentity
  remote?: Record<string, unknown>
}
interface Collection {
  id: string; source: Source; title: string
  readonly?: boolean; color?: string
  labels?: RecordTag[]
  stacks?: { id: string; title: string }[]
}
~~~

- The source record model is a projection, not the full native document.
- Dates can be date-only or instants according to source semantics. Do not coerce date-only values through UTC midnight when displaying or moving them.
- Tasks/cards use start and due; events use start and end. These are distinct native concepts.
- Calendar-event end is exclusive for all-day events.
- Item color and collection/source color are independent. The original source color remains available even if the item overrides its own color.
- A Deck stack title is the card's native status label; native completion is independent of its stack name.
- Task CANCELLED is closed but distinct from completed. A percentage of 100 alone does not prove completion.
- Unavailable assignment information must not become a fabricated empty assignee list. assignmentKnown carries that distinction.
- Native relationship arrays contain application-resolved endpoint IDs after identity reconciliation; unknown endpoints can remain unresolved.
- Native file and tag metadata may be unknown rather than empty. Preserve that distinction.
- The public state returned to presentation code strips remote and per-record identity. Full raw iCalendar bodies and native snapshots stay in the private source cache. The workspace identity registry is still part of shared metadata.
- Runtime Collection objects can also carry private remote locators even though Collection's public interface does not declare that field. Public snapshots strip those locators too.

#### 1.4 Workspace metadata

~~~ts
interface Space {
  id: string; name: string; color: string; collectionIds: string[]
  defaultCalendarId?: string; defaultTaskListId?: string; defaultBoardId?: string
}
interface Category {
  id: string; spaceId: string; name: string; color: string
  collectionIds: string[]
}
interface Project {
  id: string; spaceId: string; name: string
  categoryId?: string; color?: string; archived?: boolean
  collectionIds: string[]; recordIds: string[]
}
interface Relation {
  id: string; type: RelationType; fromId: string; toId: string
  role?: 'preparation' | 'during' | 'follow_up'
  label?: string
  native?: boolean // runtime projection only; forbidden in persisted Workspace
}
interface PlanSession { id: string; recordId: string; start: string; end: string }
interface StatusMappingColumn { id: string; title: string; color: string }
interface StatusMapping { columns: StatusMappingColumn[]; assignments: Record<string, string> }
interface PlannerSettings {
  view: PlannerView; scopeId: string; assignment: 'me' | 'all'
  includeUnassigned: boolean
  unassignedBoardIds: string[]; hiddenCollectionIds: string[]; excludedSpaceIds: string[]
  showCompleted: boolean
  showCompletedByView?: Partial<Record<PlannerView, boolean>>
  scopeAssignments: Record<string, 'me' | 'all'>
  workflow: Record<string, WorkflowColumn>
  statusMapping?: StatusMapping
}
interface Workspace {
  schemaVersion: 2
  id: string; name: string; updatedAt: string
  spaces: Space[]; categories?: Category[]; projects: Project[]
  relations: Relation[]; plans: PlanSession[]
  identities: (NativeIdentity & { id: string })[]
  properties: Record<string, Record<string, unknown>>
  appearance: { mode: 'system' | 'light' | 'dark'; calendarColors: Record<string, string> }
  planner: PlannerSettings
}
~~~

- Category is the persisted name for a source group. Its ownership is per Space, not global.
- The same native source can belong to groups in different Spaces. Within one Space it can belong to only one group.
- Projects retain both whole-source membership and individually curated record membership.
- Native links are projected into runtime relations with native true. Do not serialize that flag or duplicate native data into cloud metadata.
- A custom depends_on relation points from dependent item to prerequisite item.
- PlanSession is planner-only time, distinct from a native calendar event and a scheduled_during link.
- The workspace schema intentionally permits preserved references to temporarily unavailable native items. The editing layer applies stricter availability, source-kind and permission checks.
- The schema does not validate that a Space's default destination currently exists, belongs to a selected source, or is writable. Destination resolution and create operations perform those checks.
- **Implementation discrepancy:** properties has an object-valued declared type, but the schema currently accepts arbitrary safe JSON values beneath each property-record key. A reader must not discard an accepted existing primitive or array value. A future schema tightening requires an explicit versioned decision.

#### 1.5 State returned to a client

~~~ts
interface ScheduleRequest {
  requestId: string; recordId: string; title: string; collectionId: string
  start: string; end: string; allDay?: boolean; description?: string
}
interface State {
  mode: 'demo' | 'live' | 'disconnected'
  workspace: Workspace; revision: number
  records: WorkspaceRecord[]; collections: Collection[]
  recordIdAliases?: Record<string, string>
  createdRecordId?: string; creationWarning?: string
  statuses: {
    source: Source; state: 'connected' | 'error' | 'unavailable' | 'demo'
    count: number; message?: string; lastSyncedAt?: string; metadataStale?: boolean
  }[]
  theme?: NextcloudTheme
  pendingSchedules?: (ScheduleRequest & { created?: boolean })[]
  connection: {
    connected: boolean; serverUrl?: string; username?: string
    reconnectRequired?: boolean; restoreError?: string; recoveryOnly?: boolean
  }
  storage: {
    localPath?: string; remotePath?: string; syncStatus: string
    message?: string; lastSyncedAt?: string
  }
}
~~~

- State.revision is a nonnegative safe integer and protects custom metadata writes.
- createdRecordId identifies the canonical application UUID of a newly created native record. A creator uses it for immediate Project membership; it must not guess by title.
- creationWarning reports a partial post-create action or uncertain readback; do not create a second native item to clear a warning.
- recordIdAliases supports actions already in flight while a cloud identity registry chooses another canonical UUID.
- pendingSchedules are unfinished account-local scheduling requests, not arbitrary unsaved event drafts.
- Source statuses internally also contain permissionDenied and revokedCollectionIds during reconciliation. The declared public interface is not exhaustive of these internal fields.
- lastSyncedAt on a source error is an attempt timestamp, not proof that the source is fresh.
- The demo enum remains in type/compatibility code; normal disconnected and restoration-failure paths use real cached data or an empty connection screen, never generated samples.
- storage.syncStatus is loosely typed as string in the interface. Actual durable values are local, synced, pending, conflict, error. A memory-only recovery state additionally reports recovery.

#### 1.6 Theme and derived view models

~~~ts
interface ThemePalette {
  surfaceColor?: string; textColor?: string; mutedColor?: string
  hoverColor?: string; borderColor?: string; primaryColor?: string
  primaryTextColor?: string; primaryLightColor?: string; primaryLightTextColor?: string
}
interface NextcloudTheme {
  name?: string; color?: string; textColor?: string
  backgroundColor?: string; backgroundTextColor?: string
  logoUrl?: string; backgroundUrl?: string; backgroundDataUrl?: string
  dark?: boolean; highContrast?: boolean; mode?: 'light' | 'dark' | 'system'
  light?: ThemePalette; darkPalette?: ThemePalette
}
interface OverviewAxis { labelWidth: number; dayWidth: number; scrollLeft: number }
interface PlannerModel {
  records: WorkspaceRecord[]; actions: WorkspaceRecord[]
  events: WorkspaceRecord[]; resources: WorkspaceRecord[]
  contextRecordIds?: string[]
  overdue: WorkspaceRecord[]; today: WorkspaceRecord[]
  upcoming: WorkspaceRecord[]; undated: WorkspaceRecord[]
  spaces: (Space & { openCount: number })[]
  categories: (Category & { openCount: number })[]
  projects: (Project & { openCount: number })[]
  relations: Relation[]
  hiddenAssignmentCount: number; unassignedCount: number; unknownAssignmentCount: number
  scope: { id: string; name: string; color?: string; kind: 'all' | 'space' | 'category' | 'project'; unavailable?: boolean }
  counts: { actions: number; events: number; overdue: number; today: number; undated: number; blocked: number; records: number }
}
~~~

Derived counts, context IDs, source records, theme cache and viewport geometry are not new shared-folder fields.

### 2. Defaults, omission and clearing

New workspace defaults from createPlannerWorkspace:

~~~json
{
  "schemaVersion": 2,
  "id": "workspace",
  "name": "My planner",
  "updatedAt": "2026-11-11T12:00:00.000Z",
  "spaces": [], "categories": [], "projects": [],
  "relations": [], "plans": [], "identities": [], "properties": {},
  "appearance": {"mode": "system", "calendarColors": {}},
  "planner": {
    "view": "overview", "scopeId": "all", "assignment": "me",
    "includeUnassigned": false, "unassignedBoardIds": [],
    "hiddenCollectionIds": [], "excludedSpaceIds": [],
    "showCompleted": false, "showCompletedByView": {},
    "scopeAssignments": {}, "workflow": {}
  }
}
~~~

- updatedAt is generated at creation and successful metadata save, not the example timestamp.
- categories may be absent in an accepted older schema-2 file; read it as an empty list.
- showCompletedByView may omit a view. That view falls back to showCompleted until explicitly toggled.
- A missing statusMapping means use the product's default mapping behavior, not an empty board.
- A native status assignment key is the canonical JSON string of [source, collectionId, status], with source deck or tasks. It must round-trip exactly through JSON.stringify, and each tuple member is a nonempty string. Task status must be one of the four native statuses. Deck completion has the special native status key $completed; unknown stack projection uses $unknown. User-defined unified column IDs cannot start with $. Generic JSON object-key limits also apply to the whole serialized assignment key.
- Planner-settings normalization tolerates invalid input by taking defaults; validateWorkspace is stricter and rejects unsupported persisted input. Do not substitute the normalizer for wire validation.

| Operation/field | Omitted | Explicit empty / false |
|---|---|---|
| updateRecordDates.start/due for task/card | Preserve native value | Empty string clears that endpoint |
| updateRecordDates.end for event | Preserve endpoint or derive existing native duration | Empty string is invalid; an event needs an interval |
| updateRecordDates.allDay | Preserve mode | Boolean requires date values to match selected mode |
| updateRecordAppearance.color | Do not edit color | Empty string clears item override; use source color |
| updateRecordAppearance.tags | Do not edit task/event categories | Empty array removes categories |
| updateRecordAppearance.tagIds | Do not edit Deck labels | Empty array removes selected native labels |
| updateDescription.description | Required | Empty string removes native description property/content |
| updateNote.category | Preserve category | Empty string moves to uncategorized/default |
| updateNote.title/content | Required | Empty content allowed; blank title rejected |
| createNote.category without collectionId | Empty/default category | Empty string remains default |
| createNote.collectionId | Use supplied category/default | Nonempty selected collection supplies its category, including empty default category |
| createTask/createCard.start/due | No endpoint | Empty string normalizes to no endpoint |
| setTaskDue.due | Clear due | Empty string also clears due |
| createCard.assignToMe | False | False creates without requested self-assignment |
| createEvent.allDay | False | True requires date-only, exclusive end |
| createLinkedEvent.description/allDay | Empty description / false | Same explicit values |
| setDeckDependency.remove | Add dependency | True removes dependency |
| setNoteTags.newTags | No new definitions | Empty array creates none |
| Incoming theme field | Preserve prior cached theme | Explicit undefined is a confirmed removal before JSON normalization |
| Incoming attachmentFileIds/fileTags | Unknown; preserve the specific prior optional metadata on refresh | Explicit empty array authoritatively clears that metadata |

Do not generalize the final row into retaining every missing source field. The refresh preservation explicitly covers Deck attachmentFileIds, Notes fileTags with derived tagDetails/tags, and omitted theme. A confirmed source response can clear ordinary missing native fields.

### 3. Validation and size limits

#### 3.1 Safe JSON and schema limits

Validation occurs before local persistence and after remote assembly/merge. It clones accepted input; it does not coerce arbitrary wire types.

| Area | Rule |
|---|---|
| Workspace UTF-8 JSON | At most 8 MiB |
| Generic JSON nesting | Depth at most 12 |
| Generic JSON array | At most 20,000 entries |
| Generic JSON string | At most 200,000 characters; no NUL |
| Generic JSON number | Finite |
| Generic JSON object | Plain/null-prototype object only; no unsupported host objects |
| Object keys | At most 2,048 characters, no NUL; reject __proto__, prototype, constructor |
| Root schema fields | Exact allowlist from Workspace interface; schemaVersion must equal 2 |
| Generic text/ID | Nonblank string, at most 2,048 characters, no NUL unless a stricter field limit applies |
| Workspace name | Nonblank, at most 200 characters |
| updatedAt | String at most 80 characters, parseable date |
| Spaces | At most 200, unique IDs |
| Source groups | At most 1,000, unique IDs, IDs distinct from Spaces |
| Projects | At most 1,000, unique IDs, IDs distinct from Spaces/groups |
| Space/group/Project names | Nonblank, at most 200 characters |
| Entity membership string lists | Unique IDs, at most 5,000 entries |
| Space default destinations | Optional bounded nonblank IDs |
| Group owner | Existing Space; one membership for a collection within each Space |
| Project owner/category | Existing Space; optional category must belong to that Space |
| Project archived | Boolean when present |
| General metadata colors | # followed by 3, 4, 6 or 8 hex digits |
| Relations | At most 10,000, unique IDs, allowlisted fields, no self-links |
| Relation label | Optional string up to 200 characters; empty permitted |
| Relation roles/types | Exact enumerations; no native flag in storage |
| Relation uniqueness | type/fromId/toId/role-or-empty tuple |
| Dependencies | Complete custom graph must be acyclic |
| Plan sessions | At most 10,000; start/end at most 80 characters; timezone-bearing timestamps; end strictly after start |
| Identity entries | At most 20,000; unique app IDs and unique source/key pairs |
| Identity key/locator | Up to 4,096 characters, though a copied alias has the stricter generic 2,048 limit |
| Identity aliases | Unique strings, at most 32 |
| Property-record entries | At most 20,000; safe JSON contents |
| Status-mapping columns | One to 30, unique IDs; IDs cannot begin with $ |
| Status-mapping titles/colors | Nonblank up to 120 characters; exactly six hex digits after # |
| Status-mapping assignments | At most 10,000; parseable native status keys; target column exists |
| Planner preference fields | Strict view/assignment/workflow enumerations and booleans; allowlisted keys |

Plan timestamps permit minute precision, optional seconds and up to nine fractional digits, followed by Z or +/-HH:mm; validate the day, hour, minute, second and offset ranges. The native-edit timestamp parser is separate and accepts at most three fractional digits. Do not accidentally narrow accepted plan files to the native-edit grammar.

#### 3.2 Native-operation validation

| Field/operation | Bound |
|---|---|
| Server URL | 4,096 characters at host boundary; HTTPS except loopback; no credentials/query/fragment |
| Username / canonical username | 512 characters at host boundary; connector rejects colon in login username |
| App password | 4,096 characters; nonempty |
| App record/collection/stack IDs | 2,048 characters at host boundary |
| Item version | Up to 1,000 characters; no wildcard or malformed header characters |
| Note/task/event title | 500 characters; nonblank; trimmed before native create/write |
| Deck card title | 255 characters; nonblank |
| Note body / editable description | 500,000 characters; empty allowed |
| Notes category | 200 characters; empty allowed; connector rejects control characters |
| Date fields | 80 characters at host boundary |
| Task/event tags | At most 100; nonblank up to 200 characters each; no controls; trimmed/deduplicated |
| Deck label selection | At most 100 numeric native IDs belonging to that board |
| New Deck label | Nonblank up to 100 trimmed characters; no controls; optional six-digit hex color |
| Notes assigned tag IDs | At most 100 numeric native IDs |
| New Notes tag names | At most 20; nonblank, no controls; each trimmed UTF-8 name at most 64 bytes |
| Nextcloud Files path | At most 4,096 characters; rooted account path, no backslash, controls, URL scheme, dot traversal or empty interior segment |
| Attachment ID | 100 characters at host boundary |
| Upload | One user-chosen file, at most 20 MiB |
| Related-resource results | At most first 100 items; title 500, subtitle 300 characters; same-origin URLs only |
| Scheduling request ID | UUID with version 1-8 and valid variant; normalized lowercase |
| Scheduling journal | At most 10,000 requests and 16 MiB |

An optional etag in the logical interface does not imply version-free mutation. The operation may use the current cached version when omitted, and must reject a missing/invalid required native validator.

### 4. Ownership, identity and source projection

#### 4.1 Where information belongs

| Information | Authoritative storage |
|---|---|
| Task title/body/status/completion/start/due/categories/item color | Native CalDAV VTODO |
| Event title/body/start/end/all-day/busy/categories/item color | Native CalDAV VEVENT |
| Deck title/body/stack/completion/start/due/card color/labels/assignees | Native Deck |
| Card-to-card dependency | Native Deck dependency endpoint |
| Notes content/title/category | Native Notes API / backing file |
| Notes tags | Native Files system-tag assignment |
| Deck note/file attachment | Native Deck attachment / Files share relationship |
| Collective page body/assets | Native Collectives/Files, currently read-only here |
| Spaces, per-Space source groups, Projects | Shared custom workspace organization document |
| Cross-source relationships without native equivalent | Shared custom relation documents / dependency document |
| App UUID/native key registry | Shared custom identities document |
| Planner sessions, custom item attributes, personal workflow | Shared custom metadata |
| Status mapping and appearance override | Shared custom settings |
| Current screen/filter/completed visibility | Device-local planner preferences |

Keep original native color/status/source data available when deriving unified colors or columns. A mapped board column is not permission to rewrite a source status unless the user performs an action with an unambiguous native destination.

#### 4.2 Canonical account and record keys

The connector account prefix is the first 16 hexadecimal characters of SHA-256(normalizedServerURL + NUL + canonicalUsername).
The native key is prefix + ':' + source + ':' + native identity.

- Notes native identity is numeric note/file ID; renaming does not change it.
- Deck native identity is card ID; collection is board ID and stack is stack ID.
- Collective native identity combines collective ID and page ID.
- Task native identity includes collection ID, UID and recurrence identity, serialized as a JSON tuple.
- Event native identity includes collection ID, UID and occurrence identity, serialized as a JSON tuple.
- Task/event locator and historical UID identities are aliases where safe; they are not unconditional globally unique IDs.
- Account local profile scope is separately hashed: 'account-' + SHA-256(normalizedServerURL + newline + canonicalUsername).

Identity reconciliation order:

1. Group loaded rows by qualified source/key; duplicate same-key rows at different nonempty locators are an error.
2. Prefer an existing registry source/key match, then an existing app ID.
3. Consider aliases only when unique in both loaded inputs and registry and not already claimed.
4. If exactly one safe candidate exists, retain its app UUID; otherwise generate a new UUID.
5. Retain the latest 32 unique nonempty aliases, including a previous key after a key move.
6. Reject two loaded source records claiming the same app UUID.
7. Remap native dependency/dependent/related arrays, relation endpoints, session record IDs, Project record membership, custom-property keys and personal-workflow keys.
8. Preserve unresolved references verbatim; ambiguous aliases cannot become reference targets.

Two independently initialized clients can assign different app UUIDs before syncing. The published cloud registry is canonical for the same source/key. Rebase local and common-base metadata onto its UUIDs before merging. Keep account-local session aliases for pending callers using old UUIDs.

The same UID in separate source collections can represent a copy, not a move. Shared aliases with different native keys and no common history cause an identity-alias conflict rather than silently combining distinct records.

Evidence: packages/core/src/identity.mjs; packages/core/src/workspace-merge.mjs; tests/workspace.test.mjs; tests/workspace-sync.test.mjs; tests/deck-dependency-identity.test.mjs; tests/portable-nextcloud.test.mjs.

#### 4.3 Fetch windows, optional metadata and source health

- Fetch the five source families independently; one failing app does not erase successful sources.
- Calendar source projection covers the preceding 14 days and following 90 days. Recurrence expansion has a 20,000 occurrence limit.
- Deck-mirror task UIDs starting with deck-card- or deck-stack- are excluded from task projection.
- Notes paginate with chunkSize 200 and at most 200 pages. Repeating cursors fail explicitly instead of looping or claiming completeness.
- Re-fetch known Notes file tags in batches of four; do not issue a tag request for every unseen note on every refresh.
- Opening a note reads its assigned tags only. It does not enumerate the instance-wide tag catalog for picker suggestions.
- Deck attachment metadata and known Notes tag metadata can be stale independently of the main source. Set metadataStale/message without unnecessarily disabling otherwise successful source editing.
- A late optional-metadata read must not overwrite a newer attachment or tag snapshot; read epochs guard these races.
- Missing optional metadata preserves only the explicit previous optional fields described in section 2; an explicit empty list clears them.
- Successful source refresh replaces that source's ordinary cache projection.
- A transient source failure retains previous cached records and reports that editing awaits successful refresh.
- Confirmed source/collection permission revocation removes affected cached content, including recovery backup content. Revocation wins over locally protected or in-flight records.
- Ordinary unavailable metadata references can persist without rendering revoked source content.

The delegated-authentication DAV fallback is a current host variation: PROPFIND + GET replaces REPORT where transport cannot issue REPORT. It completes a logical inventory scan through cooperative batches of at most 250 resource jobs and 16 MiB of reserved download capacity, with 2 MiB/file and four concurrent downloads. A batch boundary must continue the scan rather than permanently truncating the source. Collection, inventory, scan and projected-output bounds and transient ETag reuse are defined in section 8.5. Report genuine partial/stale results instead of implying incomplete coverage is complete.

### 5. Complete logical operation API

All operations are asynchronous. S means the full State described above; W means Workspace. A return of S does not mean unrelated sources were refreshed. Native mutations normally reconcile just the saved item.

#### 5.1 Account, state, persistence and utility operations

| Operation | Input | Result | Gates / behavior |
|---|---|---|---|
| getState | none | S | Read current account/disconnected/recovery state |
| refresh | none | S | Native source refresh; disconnected returns current state; coalesces concurrent refresh calls |
| retryConnection (optional) | none | S | Retry preserved sign-in; retain account/cache if unavailable |
| saveWorkspace | W, expectedRevision:number | {workspace:W,revision:number,storage:S.storage} | Exact revision; full validation; identity registry is connector-owned |
| beginLogin | serverUrl:string | {flowId:string,loginUrl:string} | HTTPS/same-origin flow; secure credential storage must be available |
| pollLogin | flowId:string | {pending:true} or {pending:false,state:S} | Current unexpired flow; late cancelled/replaced results rejected |
| cancelLogin | flowId:string | S | Invalidate uncommitted flow; if commit already started, return resulting state |
| connect | {serverUrl,username,appPassword}:strings | S | Discover/validate canonical account before switch; securely persist credentials |
| disconnect | none | S | Remove active sign-in, invalidate flows, open empty disconnected profile; preserve account workspace files |
| syncWorkspace | none | S | Live connection required; custom metadata sync, not a full native refresh |
| exportWorkspace | none | {exported:boolean,path?:string} | Export metadata snapshot only; user cancellation returns false |
| openExternal | url:string | void | Safe http(s) URL; HTTPS except loopback; no embedded credentials |

Saving metadata never accepts a caller's attempt to delete/replace the connector-owned identity registry. The persisted registry from the current store supersedes that input. A successful save updates updatedAt and increments revision.

#### 5.2 Notes operations

~~~ts
createNote({ title: string, content: string, collectionId?: string, category?: string }): Promise<State>
updateNote({
  id: string, title: string, content: string, category?: string, etag?: string,
  base?: { title: string, content: string, category?: string }
}): Promise<State>
readNote?({ id: string }): Promise<{
  id: string, title: string, content: string, category: string, etag: string, readonly: boolean
}>
readNoteTags?({ id: string }): Promise<{ tags: FileTag[], availableTags: FileTag[] }>
setNoteTags?({ id: string, tagIds: string[], newTags?: string[] }): Promise<{
  tags: FileTag[], availableTags: FileTag[]
}>
~~~

- Create/update require a successfully verified writable Notes source; update rejects a read-only note.
- readNote and tag reading need a connected readable note, not write permission.
- Native Notes capability versions explicitly older than API 1.2, missing etag or native readonly mark a note read-only. An unspecified capability-version list is not alone a denial.
- Create with collectionId takes the category from that collection; the empty default category is meaningful.
- updateNote.base is the frozen editor-start title/content/category, not a mutable latest-cache snapshot.
- A rename/category move retains stable file identity and known tags. New category collections can be added on readback.
- availableTags currently returns assigned tags, not the whole global catalog. UI suggestions combine already loaded app context elsewhere.
- setNoteTags validates newly selected IDs before mutation, preserves nonassignable existing tags, creates or reuses requested names, and then changes native assignments.
- A native tag-name collision or missing creation location can require one fallback global lookup during save. That catalog is never returned as picker suggestions.
- Notes save conflict handling is detailed in section 10; a conflict must preserve the edit for review/retry.

#### 5.3 Work-item and event operations

~~~ts
createTask({ title: string, collectionId: string, start?: string, due?: string, description?: string }): Promise<State>
createCard?({
  title: string, collectionId: string, stackId: string, start?: string,
  due?: string, description?: string, assignToMe?: boolean
}): Promise<State>
createEvent?({
  title: string, collectionId: string, start: string, end: string,
  allDay?: boolean, description?: string
}): Promise<State>
createLinkedEvent?(input: ScheduleRequest & { expectedRevision: number }): Promise<State>
updateDescription?({ id: string, description: string, etag?: string }): Promise<State>
updateRecordDates?({ id: string, start?: string, due?: string, end?: string, allDay?: boolean, etag?: string }): Promise<State>
updateRecordAppearance?({ id: string, color?: string, tags?: string[], tagIds?: string[], etag?: string }): Promise<State>
updateTaskStatus?({ id: string, status: string, etag?: string }): Promise<State>
setTaskCompleted({ id: string, completed: boolean }): Promise<State>
setTaskDue?({ id: string, due?: string }): Promise<State>
updateEvent?({ id: string, start: string, end: string, allDay?: boolean }): Promise<State>
setCardCompleted?({ id: string, completed: boolean }): Promise<State>
moveCard?({ id: string, stackId: string }): Promise<State>
setDeckDependency?({ fromId: string, toId: string, remove?: boolean }): Promise<State>
createDeckLabel?({ collectionId: string, title: string, color?: string }): Promise<{ label: RecordTag, state: State }>
~~~

- Create destinations must be loaded, writable and of the matching source type. A UI-supplied collection ID is not trusted as proof.
- Record mutations resolve old IDs through current canonical aliases, check expected source kind and deny readonly records.
- Cached native items cannot be edited until that source has refreshed successfully in the active session.
- createTask writes native NEEDS-ACTION. It does not manufacture a custom task status.
- createCard requires an actual native stack; self-assignment is a separate requested native action. A partially successful creation must not be blindly repeated.
- Card creation accepts date-only inputs by converting start to local 00:00 and due to local 23:59, then serializing an instant. Existing-card date editing requires explicit timestamp/offset values; do not copy the creation-only conversion into every edit path.
- moveCard only accepts a stack from the card's current board. It uses native reorder and does not mark completion merely because the stack title resembles Done.
- updateTaskStatus accepts exactly the four native VTODO statuses, not arbitrary unified column titles.
- setTaskCompleted(true) maps to COMPLETED; false maps to NEEDS-ACTION.
- updateDescription and updateRecordDates support only tasks, events and cards with safe native write representations.
- updateRecordDates requires at least one date endpoint. allDay alone is insufficient.
- Tasks/cards reject end; events reject due. Tasks/cards reject allDay in this operation.
- At least one of color/tags/tagIds must be supplied for appearance changes.
- Deck uses tagIds only; task/events use tag names only. Passing the wrong tag representation is an error.
- A server lacking Deck's native color field reports unavailable; do not silently save a planner-only card color.
- createDeckLabel rereads board permission and existing labels, reuses a case-insensitive name match, and otherwise creates a native board label.
- setDeckDependency means fromId depends on toId. The dependent card must be writable; a readable prerequisite can be referenced. Adding/removing uses native Deck dependency endpoints, with readback verification.
- createLinkedEvent needs a readable task/card and a writable calendar. It does not require write permission on the work item because it edits the calendar and custom link.

#### 5.4 Attachment, file, Collective and recommendation operations

~~~ts
listFiles?({ path?: string }): Promise<{ path: string, files: CloudFile[] }>
readDeckAttachments?({ id: string }): Promise<{ attachments: DeckAttachment[] }>
attachDeckFile?({ id: string, path?: string, noteId?: string }): Promise<{ attachments: DeckAttachment[] }>
removeDeckAttachment?({ id: string, attachmentId: string }): Promise<{ attachments: DeckAttachment[] }>
uploadDeckAttachment?({ id: string }): Promise<{ attachments: DeckAttachment[], cancelled?: boolean }>
readRelatedResources?({ id: string }): Promise<{ available: boolean, resources: RelatedResource[] }>
readPage({ id: string }): Promise<{ body: string, etag?: string }>
readPageAsset?({ id: string, path: string }): Promise<{ dataUrl: string }>
migrateDeckNoteLinks?(input?: { limit?: number }): Promise<{
  state: State, converted: number, remaining: number,
  errors: { relationId: string, message: string }[]
}>
~~~

- listFiles defaults to account Files root '/'. It never enumerates arbitrary local directories.
- attachDeckFile requires exactly one nonempty path or noteId. A note resolves by stable native file ID, including after rename; a folder cannot be attached as a file.
- Deck file sharing creates a native share with shareType 12, shareWith equal to native card ID, and permissions 1. This makes the file available to board members as native Deck does.
- Existing attachment identities deduplicate. Removing an attachment detaches the native relationship, not the underlying file; unsupported old uploaded attachment types must not be mistaken for ordinary Files shares.
- uploadDeckAttachment's logical API has no caller-provided local path. The host obtains an explicit file selection, enforces the size limit and uploads native multipart content. Cancellation returns cancelled true with current attachments.
- Native attachment changes refresh just the affected card/metadata. Opening attachment metadata does not force a full workspace refresh.
- Related Resources uses provider deck with board ID, or provider files with Notes file ID. Other kinds return available false. Restricted/missing optional service also returns unavailable rather than creating relationships.
- Collective pages and raster assets remain source-authenticated reads. Paths must remain within the source page/collective; unsafe paths or unsupported asset formats fail. They are not editable Notes.
- migrateDeckNoteLinks is a compatibility operation described in section 13, not a new-client user flow to preserve as an extra attachment mode.
- Its optional limit defaults to 1 and must be an integer from 1 through 5. converted/remaining count removed/remaining custom relations, not necessarily unique notes.

#### 5.5 Representative logical payloads

Clear a task start while keeping its due date:

~~~json
{"id":"c0596d27-6889-4da7-a108-d36017f620c6","start":"","etag":"\"task-v7\""}
~~~

Set a card color and native board labels; source board color remains unchanged:

~~~json
{"id":"c0596d27-6889-4da7-a108-d36017f620c6","color":"#3388cc","tagIds":["12","18"]}
~~~

Create one all-day booking covering November 12 and 13, then link it to a task:

~~~json
{
  "requestId":"63a12ef4-6a67-489b-85d3-f86a2226d8f2",
  "recordId":"c0596d27-6889-4da7-a108-d36017f620c6",
  "title":"Prepare review","collectionId":"account-prefix:calendar:calendar-native-key",
  "start":"2026-11-12","end":"2026-11-14","allDay":true,
  "description":"Review the brief.","expectedRevision":42
}
~~~

Save a note using a frozen baseline; category is intentionally omitted so it is not moved:

~~~json
{
  "id":"8b211812-fb5e-44ae-8f6c-f77913bc3590",
  "title":"Review notes","content":"- [x] Read the brief\n- [ ] Draft questions",
  "etag":"opaque-notes-version",
  "base":{"title":"Review notes","content":"- [ ] Read the brief\n- [ ] Draft questions","category":"Work"}
}
~~~

### 6. Shared-folder wire protocol

#### 6.1 Paths and document envelopes

Root is '/Workspace/Nextspace/' in authenticated Nextcloud Files. It contains manifest.json and one active generation directory. A generation name must match data- followed by 36 lowercase hexadecimal/hyphen characters under the current parser; new generation writers use UUID-shaped names.

~~~text
/Workspace/Nextspace/
  manifest.json
  data-11111111-2222-4333-8444-555555555555/
    core.json
    organization.json
    dependencies.json
    identities.json
    settings.json
    legacy-import.json
    legacy-original.json       # only when an old cloud workspace existed
    links/<digest>.json
    plans/<digest>.json
    properties/<digest>.json
    workflow/<digest>.json
~~~

The dynamic digest is SHA-256 of the stable JSON serialization of the key, not SHA-256 of unquoted key bytes. For a string key, hash JSON.stringify(key). Stable object serialization sorts object keys and preserves array order. Digests are lowercase hexadecimal.

~~~json
{
  "format":"nextspace-planner-document","version":1,
  "kind":"relation","key":"link-example",
  "value":{"id":"link-example","type":"scheduled_during","fromId":"task-uuid","toId":"event-uuid"}
}
~~~

Tombstone of that same dynamic file:

~~~json
{"format":"nextspace-planner-document","version":1,"kind":"relation","key":"link-example","deleted":true}
~~~

Manifest example:

~~~json
{
  "format":"nextspace-planner-folder","version":1,
  "generation":"data-11111111-2222-4333-8444-555555555555",
  "createdAt":"2026-11-11T12:00:00.000Z",
  "required":["core.json","dependencies.json","identities.json","organization.json","settings.json"],
  "legacyHash":null
}
~~~

| File/kind | Key | Exact value fields |
|---|---|---|
| core.json / core | workspace | id, name, schemaVersion:2 |
| organization.json / organization | workspace | spaces, categories, projects |
| dependencies.json / dependencies | workspace | relations containing only depends_on, sorted by relation ID |
| identities.json / identities | workspace | identities sorted by app ID |
| settings.json / settings | workspace | appearance, planner; planner allows only optional statusMapping |
| links/digest.json / relation | relation ID | Full non-dependency Relation without native flag; value.id must equal key |
| plans/digest.json / plan | session ID | Full PlanSession; value.id must equal key |
| properties/digest.json / property | item ID | Existing safe JSON custom attributes |
| workflow/digest.json / workflow | item ID | WorkflowColumn value |

- All five fixed files are required, even when empty.
- Fixed files cannot be tombstoned. Removing a fixed file is a corruption/recovery problem, not a deletion command.
- Exact envelope allowlists apply. A live document has format/version/kind/key/value; a tombstone has format/version/kind/key/deleted and no value.
- Path and envelope kind/key must match. Only the five fixed filenames and the four hash-named dynamic folders are accepted in a generation's normal document listing.
- legacy-import.json and legacy-original.json are separately handled compatibility files, not ordinary envelopes.
- Unsafe property/workflow keys are rejected.
- Native cache, raw source documents, credential material, sync baselines, current viewport and device preferences are never written here.
- appearance.mode is shared, along with calendar color overrides. Earlier text describing that mode as local is inconsistent with current serialization.
- Workspace.updatedAt is not an individual cloud document field; assembly uses the manifest creation timestamp and local synchronization preserves appropriate timestamps. Do not use it as the only cloud-change detector.
- **Effective initial-file limit:** required has an explicit 20,000-entry guard and generic JSON arrays are capped at 20,000, despite a later 60,000 guard. Folder checkpoints allow up to 60,000 paths. Treat 20,000 as the accepted manifest-required limit until changed explicitly.

#### 6.2 Read and write algorithm

Read:

1. Read manifest with a usable file version. If absent and a previous folder checkpoint exists, stop with missing-folder conflict.
2. Validate manifest and reject a generation different from the saved checkpoint.
3. Load/validate compatibility import receipt as required by the current protocol implementation.
4. List the generation root and four dynamic directories; only safe immediate children are accepted.
5. Require every manifest-required and previously checkpointed file to be present.
6. Require strong file versions. Reuse cached document bodies only for matching ETags.
7. Fetch changed bodies in batches of six; validate each envelope.
8. List again. If listing or any read version changed, retry the consistent read, at most three attempts.
9. Assemble, deduplicate identical ordinary links, and validate the complete schema-2 Workspace.
10. Merge any newly detected older-client changes only through the compatibility baseline; never treat an old snapshot as authoritative replacement.

Write:

1. Require that the caller's aggregate ETag matches the last complete read.
2. Split the validated Workspace into target documents.
3. Compare bodies structurally; unchanged files are untouched.
4. Write identities before dependent link files. Other changed documents are deterministically ordered.
5. Existing file write requires its last strong ETag; creation requires If-None-Match '*'.
6. Removed dynamic entries become tombstones, preserving the deletion for offline clients.
7. Read back the folder; commit the new base/checkpoint only after acknowledgement.
8. If only some documents were acknowledged, retain the old base. Retry rereads current files and writes only still-needed differences.

The dependency graph stays atomic in one file to prevent two independently valid opposite edges from becoming a cycle. Organization stays atomic so moving a collection between groups cannot publish contradictory ownership. Identities stay atomic so clients cannot publish separate UUID entries for the same native key.

Unknown files, malformed documents, unusable versions, physical deletion of known files and replacement generations must not be silently deleted, overwritten or treated as an empty workspace.

Evidence: packages/nextcloud/src/planner-folder.mjs; tests/planner-folder.test.mjs; tests/nextcloud-folder-transport.test.mjs.

### 7. Local persistence and shared merge

#### 7.1 Account-local envelope

Current durable envelope:

~~~ts
interface LocalEnvelope {
  schemaVersion: 1
  revision: number
  workspace: Workspace
  cache: { records: WorkspaceRecord[]; collections: Collection[]; statuses: unknown[]; theme?: NextcloudTheme }
  sync: {
    baseHash: string | null; initialHash: string | null; etag: string | null
    status: 'local' | 'synced' | 'pending' | 'conflict' | 'error'
    message?: string; lastSyncedAt?: string
    baseWorkspace?: Workspace; initialWorkspace?: Workspace
    conflictWorkspace?: Workspace; conflictPaths?: string[]
    folder?: { generation: string; paths: string[] }
  }
}
~~~

The local physical layout can differ by host, but account isolation, atomicity, baseline semantics and retention behavior are shared requirements. Current desktop adapter uses workspaces/<account-scope>/planner.json and a rotating planner.json.bak.

- Validate the full envelope before adoption. revision must be a safe nonnegative integer.
- Cache is JSON-bounded to 50 MiB, depth 24 and individual strings up to 4 MiB. Generic array and unsafe-key rules still apply.
- The cache validator requires records/collections/statuses arrays and safe JSON; it is not a complete per-native-field schema validator.
- Normalize theme into allowlisted safe values. No executable CSS or SVG background data URLs.
- Cached embedded images are canonical base64 PNG/JPEG/GIF/WebP, at most 2 MiB, with matching file signatures.
- Base/initial hashes are SHA-256 of canonical full Workspace serialization; verify supplied baseline hashes match their stored Workspace.
- Folder checkpoint is durable, account-scoped and records every observed dynamic path, including tombstones.
- A metadata save checks exact expectedRevision, validates input, keeps connector-owned identities, updates timestamp and increments revision.
- A native metadata-only read that returns identical attachment/tag fields causes no disk rewrite or identity rehash.
- Short local commits are serialized. Network work does not hold the persistence lock.
- Failed disk writes leave the current saved file intact; do not delete it to force replacement.
- The existing adapter writes same-directory temporary file, flushes, preserves previous backup, and atomically replaces current. Lock-only errors retry at 20, 40, 80 and 160 ms for each replacement operation; other failures are not repeatedly retried.
- A valid backup can restore a corrupt current file. If both are invalid, preserve originals and report recovery required.
- Permission-revoked cache data is also removed from the recovery backup.

#### 7.2 Device-local fields

Exactly these planner fields are local: view, scopeId, assignment, includeUnassigned, unassignedBoardIds, hiddenCollectionIds, excludedSpaceIds, showCompleted, showCompletedByView, scopeAssignments.

They are excluded from cloud documents and shared hashes and always retain this device's value during merge. Workflow, statusMapping, Spaces, source groups, Projects, custom relations, plans, identities, properties and appearance remain shared. Navigation-only/timestamp-only changes need no cloud upload.

#### 7.3 Three-way merge rules

| Base/local/remote condition | Result |
|---|---|
| Local equals remote | Keep that value |
| Local equals base | Adopt remote |
| Remote equals base | Keep local |
| Device-local preference | Keep local regardless of cloud value |
| Both change different object fields | Recurse and combine |
| One deletes, other edits same value | Conflict; retain local working copy and remote for review |
| Both change same primitive differently | Conflict |
| Both add different entities | Combine by entity ID |
| Same typed relation added under different IDs | Deduplicate if all non-ID fields agree; otherwise conflict |
| Membership list existing member removed by either side | Remove |
| Membership list new member added by either side | Include |
| One side reorders existing entities | Honor reorder |
| Both reorder existing entities differently | Ordering conflict |
| updatedAt differs | Latest parseable timestamp |
| Identity aliases merged | Set semantics, keep last 32 |
| Canonical native identity shared across devices | Remap base/local UUID references to published UUID before merge |

Merge does not mean last-writer-wins. Return conflict paths and preserve both values. Validate the complete merged workspace before publishing: combined membership/dependency edits may violate invariants even when each original workspace was valid.

#### 7.4 Metadata synchronization state machine

| Current situation / trigger | Next storage state | Required effect |
|---|---|---|
| New local profile, no cloud baseline | local | Durable metadata available locally |
| Local save after a cloud baseline | pending | Preserve base; await upload |
| Fresh uncustomized client finds valid cloud metadata | synced after adoption | Adopt cloud, retain device preferences, reconcile identities |
| New customized client finds different cloud metadata without common base | conflict | Preserve both; do not guess or discard |
| Cloud changed, local unchanged | synced after adoption | Adopt cloud substantive fields |
| Local changed, cloud unchanged | synced after conditional upload | Publish local substantive fields |
| Both changed independently | synced after validated merge/upload | Preserve both independent edits |
| Both changed incompatibly | conflict | Store cloud copy and conflict paths |
| Previously synced cloud metadata removed | conflict | Preserve local; do not recreate over assumed deletion |
| Conditional write races | retry up to three attempts | Reread and merge each time |
| Network/storage-format/version failure | error or explicit conflict | Retain local and prior baseline |
| New local edit while upload is in flight | pending after upload acknowledgement | Merge edit into current state and upload in next cycle |
| Overlapping local edit while upload is in flight | conflict | Retain in-flight published copy and newer local draft |
| Read-only memory recovery | recovery | Block metadata mutation until account recovery |

An initialHash equal to a migrated workspace does not prove the user has no customization. Safe first adoption requires an actual initial baseline or a comparison proving only navigation/identity discovery changed.

No new local state is published from a sync candidate before acknowledgement. The final short commit reconciles against the latest local state, not the stale snapshot from the start of the network operation.

Evidence: packages/core/src/workspace-merge.mjs; packages/nextcloud-node/src/workspace.mjs; tests/workspace.test.mjs; tests/workspace-sync.test.mjs; tests/background-sync.test.mjs; tests/background-state.test.mjs.

### 8. Authentication, account lifecycle and recovery

#### 8.1 Shared account guarantees

- Normalize the final HTTPS server URL; allow HTTP only for localhost, 127.0.0.1 or ::1 test origins.
- Reject embedded credentials, query strings and fragments in server URLs.
- Discover the canonical account username before choosing account storage/identity namespace.
- Do not expose passwords or authentication headers to view state, metadata exports or cloud planner files.
- Persist credentials only through a protected host mechanism, or delegate authentication to a trusted host-owned authenticated transport.
- Validate account and secure-storage availability before replacing the current active connection.
- Account switches form an operation barrier: finish earlier mutations and already-running background work, then change context; later operations wait for the new context.
- Restored credentials do not prove every cached source is still writable. Reset source verification and refresh before enabling native writes.
- Disconnect invalidates login flows and active sign-in. It does not erase the prior account's planner/cache.

#### 8.2 Login/recovery transitions

| State / trigger | Outcome |
|---|---|
| No saved account pointer | Empty disconnected workspace |
| Valid pointer and decryptable matching credential identity | Live connection context; cached source data initially unverified |
| Valid pointer but credential missing, inaccessible or decrypt failure | Preserve actual account/cache offline; reconnectRequired |
| Invalid/unreadable pointer or unresolvable account identity | Empty memory-only recovery; recoveryOnly; no account-file writes |
| Account workspace and backup unreadable | Preserve originals/sign-in; recovery required |
| Start new login | Invalidate previous flow generation |
| Poll valid flow, authorization not complete | pending true; continue bounded polling |
| Cancel or replace before credential commit | Late polling result cannot activate account |
| Cancellation after credential commit begins | Return committed resulting state; do not falsely claim sign-in was undone |
| Successful login/discovery | Atomically store credentials, select canonical account, sync metadata, refresh sources |
| Retry saved connection succeeds later | Reopen same account without replacing its data |

Login Flow v2 client behavior: a flow expires after ten minutes; initial polling delay 1.8 seconds, subsequent polling every two seconds. Begin/poll/login endpoints must remain on configured origin. Native poll 404 means authorization still pending, not source unavailable.

#### 8.3 Host authentication variations

These are transport implementations, not different business logic:

- Current desktop host supports Login Flow v2 and manual app-password connection; it encrypts per-account credentials using protected platform storage. Its active pointer can contain verified nonsecret server/account identity for recovery.
- Portable connector supports password mode using UTF-8 Basic authorization, or delegated mode with an explicitly provided authenticated transport and no appPassword. Delegated mode must not fall back to uncredentialed generic fetch.
- Android offers installed Nextcloud Files SSO and an independent browser authorization option using Login Flow v2. Both use the same canonical account, cache, metadata and lifecycle rules. SSO retains bounded PROPFIND/GET fallback where the delegated transport lacks REPORT.
- A server-hosted Web client may use its authenticated Nextcloud session. That implementation is not defined by the current host API and must be specified before claiming auth parity; shared account separation, permissions, request-origin and recovery rules still apply.

Evidence: win/electron/auth-restore.cjs; win/electron/security.cjs; win/electron/main.cjs; packages/nextcloud/src/nextcloud.mjs; tests/auth-restore.test.mjs; tests/portable-nextcloud.test.mjs.

#### 8.4 Alternative authorization and evaluable mobile preview (owner revision)

The Android browser preview must offer a working **Sign in with Nextcloud** action after entering a server URL. It must not require an Android Files installation, show a permanently disabled sign-in action, copy another client's credentials, or fill the account with example records. The native Android client retains the Files account flow, now presented as the primary **Continue with Nextcloud Files** action (8.7). Independent browser authentication occurs on the user's Nextcloud server; this revision does not add a main-password form.

Use the existing public `beginLogin(serverUrl) -> {flowId: string, loginUrl: string}`, `pollLogin(flowId) -> {pending: true} | {pending: false, state: State}` and `cancelLogin(flowId?) -> State` contracts. The host retains the actual poll token/endpoint and resulting app password. Flow IDs are opaque, bounded, host-generated identifiers, not credentials. Apply the ten-minute client deadline, 1.8-second initial polling delay and two-second subsequent delay already specified in 8.2. A 404 from the validated poll endpoint remains pending. Replacement, cancellation, expiry, disconnect or account-switch generation invalidates late replies before credential commit. Network failure is an actionable retry, not successful authentication. A prior usable account remains intact until a replacement is validated and committed. Resolve canonical username using the authenticated account endpoint before selecting its cache namespace.

Native hosts store the app password through protected platform storage, never presentation state, preferences, logs or planner files. Native requests remain origin/path bounded and never forward authentication across redirects. Transport choice (Files SSO versus direct browser authorization) is private host information; it does not add cloud fields or change the logical account identity.

Changing authorization method for the currently selected canonical server/user must reuse its existing private cache locator, including an existing Files provider account name. Keep the transport's provider reference separate from that locator. A newly connected direct account uses the private name `nextspace-direct:` followed by lowercase SHA-256 hex of normalized server URL, a NUL separator and canonical username (UTF-8). This is an internal locator, not a new public/cloud account field. Never erase an older provider-keyed cache or pending metadata when adding direct authorization.

The local development preview may use a loopback-only host bridge to avoid browser CORS restrictions while preserving these same boundaries. Its credentials and pending flow tokens stay in host memory, are never returned to browser JavaScript and expire with the development server process; restarting that process requires sign-in again. Browser source/metadata caches remain account-qualified and contain no credentials. Disconnect clears active authorization while preserving valid prior-account planner metadata. The bridge must validate exact loopback Host/Origin, require a per-process unguessable request token and JSON on its command endpoint, reject cross-origin requests, bound request/response sizes/time, permit only declared operations and constrain authenticated requests to the selected Nextcloud origin/base path. It must not be an arbitrary authenticated proxy or expose a desktop account. Private responses are non-cacheable. This development bridge is not the postponed Nextcloud Web client and must not ship as a public server.

The mobile presentation must use the reference client's navigation, vocabulary, source/item/status color distinctions, Nextcloud theme, five planner views and item detail hierarchy. Adapt width and touch targets: a phone uses collapsible navigation, scrollable date/board surfaces and a full-width detail sheet; a tablet uses available space for the aligned split Overview and side details. Preserve the shared date axis and view/filter/scope semantics. There is no separate simplified list-only product. Do not label an unauthenticated device as **Offline · saved data** when no saved account exists; show **Not connected**. Read-only/cached/unimplemented actions are explicitly gated and must not invite an edit that only fails at submission. Existing complete Windows operations stay available on Windows.

Protocol reference: [Nextcloud Login Flow v2](https://docs.nextcloud.com/server/stable/developer_manual/client_apis/LoginFlow/index.html#login-flow-v2). Its server token lifetime is distinct from the shorter existing client deadline.

#### 8.5 Calendar transport capabilities and honest refresh feedback (owner test correction)

Calendar reading is selected by the actual authenticated transport, not the client name. Direct Login Flow v2 native transport and the local browser-preview host support CalDAV `REPORT` and MUST use the same server-side task/event queries as the reference client. Only Files SSO, which cannot forward REPORT, uses the bounded PROPFIND/GET fallback. Do not falsely advertise REPORT or mark partial coverage complete. The owner-reported persistent 250-file truncation is corrected by completing the scan in bounded batches as described below, not by repeatedly downloading a larger prefix.

**Files SSO complete-scan correction (2026-11-12):**

- A logical refresh obtains and validates fresh complete Depth-1 inventories for up to 64 unique supported calendars; Tasks and Calendar share the same resource work. Inventories retain same-origin/collection-child validation, duplicate rejection, root validation and the 2 MiB listing-response bound. At most 10,000 resource hrefs per collection and 50,000 across the logical scan are admitted. An exceeded bound is an explicit incomplete-source limit, never silent truncation.
- Distribute resource jobs round-robin across collection queues. Process sequential cooperative batches, at most 250 jobs and 16 MiB of reserved transfer capacity per batch, with at most four simultaneous downloads and a 2 MiB document bound. Each uncached request reserves 2 MiB before dispatch; refund verified unused capacity whenever a complete bounded response body is known, even if its status/content/revision fails validation. An unknown transfer consumes its full reservation. Cache hits consume a processing slot but no network reservation. Oversized files fail once rather than blocking all later work. Yield between batches so interaction and cancellation remain responsive. A batch boundary alone is not an error and must not leave later calendars permanently unread.
- A logical scan additionally permits at most 256 MiB of reserved/consumed resource transfer capacity (known unused reservations refunded), 10,000 projected records per source, and 32 MiB of serialized projected Tasks/Calendar records combined. These are genuine resource bounds; hitting one produces truthful partial status for affected sources. Parse successful resource documents into the relevant source projections promptly rather than retaining unbounded whole-scan raw arrays. A fresh scan with complete coverage returns connected status and uses ordinary source replacement, removing deleted/out-of-window records. A failed/incomplete scan retains the existing partial-source merge/readonly semantics.
- A client may retain a transient LRU resource cache, at most 32 MiB of raw bodies and 10,000 entries, keyed by canonical collection/resource href. Each entry is `{etag:string, raw:string, bytes:number}`; reuse requires an exact matching strong ETag in a newly validated inventory. Missing, weak or changed listing validators require a fresh GET. Never replay old contents when that GET fails. Complete inventories prune absent cache entries; denied collections purge their entries and expose revoked collection IDs; authentication revocation clears the cache. Cache eviction only affects performance, never completeness. Account/client replacement discards this cache; it is not cloud planner data or a durable continuation schema.
- The shared read operation accepts an optional local `isActive():boolean` predicate. Check it before inventory requests, queued resource work and batch continuation; false aborts further scan scheduling with cancellation, without source writes. The Android caller captures the account, client and generation of that read and also checks disposal/reconnection state. Disposal invalidates the generation so late results cannot be adopted or persisted. Account/authorization actions may cancel source-read continuation before awaiting the existing operation barrier; they must still wait for in-flight native mutations and must not reorder or interrupt committed writes. Cancellation is distinct from permission revocation and must not erase valid saved data.
- Do not create sample records or import another client's cache. The source-status item count covers all loaded/retained records of that source, while a timeline collection/group count covers only that group's records after the current filters. Collapsed Overdue/Outside-this-period buckets are not missing source data.

Acceptance: a Files-SSO fixture with more than 250 historical files plus later tasks/calendars completes in one logical refresh; unchanged strong-ETag bodies are reused on the next refresh; changed/weak/missing validators fetch again; deletion and permission revocation remove records on complete/revoked coverage; task/event projections share a single download per resource; genuine limits, malformed inventories, download failures and cancellation never claim complete writable data. Direct REPORT behavior is unchanged.

The private host account-operation envelope may include `capabilities: {davReadMode: 'report' | 'propfind-get'}` alongside its existing public account descriptor. Missing capability defaults conservatively to `propfind-get`; an unknown value never enables REPORT. This is a transport capability, not an account identity field, cloud setting or source permission. Establish it at account restore/selection/authorization completion and re-check it on refresh. Reauthorizing the same canonical account with another transport updates its reader without replacing its cache locator, planner baseline or pending metadata. Native/browser request guards permit bounded read-only REPORT only when the active transport supports it; account/origin/path/header/response limits still apply. No native editing is authorized by a read capability.

Permitted REPORT bodies are nonempty, well-formed XML of at most 1 MiB UTF-8, with `application/xml` or `text/xml` content type and a single root named `calendar-query` in `urn:ietf:params:xml:ns:caldav`. Explicit document type/entity declarations are rejected with SECURITY; oversized bodies with LIMIT; invalid content type/XML/root/namespace with VALIDATION. XML parsing must not resolve external entities. This guard accepts the reference reader's calendar-query output, including default or prefixed CalDAV namespaces, without expanding the native mutation surface.

A partial-source warning must distinguish a successful subset from a wholly failed load. The presentation must not always assert cached content: zero retained items means no items from that source are currently available; a retained subset may contain newly downloaded and older records and must be described as loaded/retained items that may be incomplete or out of date. Show the source's actual diagnostic in Details, including an explicit safety-limit warning. Successful sources remain usable. Never imply that local caching caused a source request failure.

Caches belong to each host/profile. Android native snapshots are in the application's private storage; browser-preview snapshots are in that browser origin's IndexedDB under `nextspace-android-preview`, separately qualified by canonical account and cache locator. They are created from source reads and metadata loads during this client's use, including partial successful loads; they are not imported from the Windows profile or seeded with test records. First use may have no cache at all. A restored, authorized account should start a background refresh even while its cached sources are initially unverified/`connected: false`; a missing/revoked credential or explicit recovery state must not start unauthorized network requests. Cache display state and transport authorization are different conditions.

#### 8.6 Android Notes, date editing and linked scheduling (owner-authorized parity)

The owner now authorizes the Android host and its local browser preview to implement the existing reference Notes, native date-editing and calendar-booking flows. This supersedes their earlier blanket read-only milestone restriction for these operations. It does not authorize invented behavior, unrestricted native writes or enabling an unfinished operation merely because another operation on that source works. The Web client remains on hold and the no-full-build policy remains in force.

- Notes: use the existing native create/read/update protocol, conditional field merge and explicit conflict review described in Notes sections below. Linked notes and notes opened from the list have identical editing capabilities. Preserve title/content/category/base/version drafts across the detail panel, expanded editor and Back navigation. Formatted Markdown editing, source editing and direct checklist toggles use the same save path. Retain genuine source/API/ETag read-only restrictions.
- Note tags: load assigned native Files tags when opening the note, render them in the existing tag editor, and support selection/removal/inline creation and bounded linked-work/context suggestions. Preserve restricted tags and partial-failure feedback. Opening the picker must not enumerate the global catalog. Category is a separate folder path; the presentation receives its safe category string without exposing native request locators or credentials.
- Dates: enable the reference contextual date timeline for eligible Tasks, Deck cards and events, including undated work. Preserve exact date/all-day validation, start/due/end rules, conditional native writes and optimistic failure recovery. Use the same operation for date dragging and the detail form; do not save native dates only in planner properties.
- Schedule in calendar: enable the reference contextual week calendar, writable destination resolution and native event creation followed by a custom `scheduled_during` relation. Source work may be read-only because this operation edits the destination calendar and planner relation. Existing bookings, conflicts and explicitly linked work use the reference rules.
- Scheduling keeps an account-private durable request journal with the reference `pending` → `created` → `linked` progression, request UUID/digest, deterministic native UID and conditional creation. Persist retry intent before issuing a native write. A created event is read on retry, never blindly recreated; local link/save failure retains the event and original request. Account switches, restart, repeated submission and changed-payload retries cannot duplicate a booking or apply it to another account. Journal errors block creation with a visible explanation. The journal is device-private and does not change the shared planner schema/folder protocol.
- Native edits are serialized for the same item and protected against account changes. A refresh started before an acknowledged edit must not overwrite that newer result. Publish acknowledged records/counts/identities and persist them locally without waiting for a full-source refresh; keep the main interface responsive. Failed writes retain drafts and report errors, never report simulated success.
- Capabilities are operation-specific. Notes editing/tags, date changes and linked scheduling may be enabled while task/card creation, status editing, native dependencies and attachment mutations remain unavailable. Presentation gates must reflect implemented API operations plus current source/record/destination permissions, not a single all-or-nothing mobile flag. Unsupported operations must remain absent/disabled before submission.
- Native and preview transport guards admit only the concrete Notes, Files-tag, calendar-resource and Deck-card requests required by these operations, with origin/account/path/header/body/response limits and required conditional validators intact. Removing a note tag may delete only that assignment, never the global tag or source file. Direct authorization preserves real HTTP statuses and creation Location headers. A provider that cannot preserve a required guarantee must fail explicitly; it must not fabricate a successful native write or silently fall back to custom metadata.

Verification uses isolated protocol/service/UI fixtures, shared pure rules, targeted native compilation/JVM checks and no-emit checks. No real-account edits are necessary for automated verification. Fast checks do not establish physical-device or live-account write success.

The private account-operation capability envelope additionally admits `nativeEdits: 'notes-dates-scheduling'`. Missing/unknown values enable no native mutations; `davReadMode` never implies write support. The public runtime snapshot may include `nativeOperations: string[]`, populated on Android with only the currently supported operations from `createNote`, `updateNote`, `setNoteTags`, `updateRecordDates`, `createLinkedEvent`, or an empty array when unsupported. This projection is recomputed on authorization/account/transport changes, is not persisted in cloud organization, and contains no credentials. Reference hosts without this field retain their established operation availability. A presentation allowlist cannot override an explicit empty runtime list or a missing API method. Read-only note/tag metadata methods do not require write capability.

Source mutation bodies are bounded to 8 MiB UTF-8 at the transport boundary, in addition to the existing tighter field/record validation. Admitted mutations are Notes collection POST and numeric-note conditional PUT; Files system-tag POST and numeric file/tag assignment PUT/DELETE; a bounded DAV calendar resource conditional PUT; and numeric board/stack/card Deck PUT using the reference request representation. Calendar-resource paths may use a shared calendar principal; the service must resolve a currently loaded writable collection/record and use its discovered locator, never accept an arbitrary URL from presentation. Metadata remains limited to the existing account-owned planner protocol paths. Preserve Location/Content-Location for native tag creation with the reference same-origin validation. Files SSO can issue these write methods but may omit conflict-response bodies: retain the conflict and offer a fresh native read for explicit review rather than guessing a merge or weakening If-Match.

#### 8.7 Reconnection entry and primary Android authorization (owner correction)

The native Android connection screen presents **Continue with Nextcloud Files** as its first, primary action, invoking the installed Files account-selection/authorization flow. Independent **Sign in using browser** remains an accessible alternative with server URL entry; Files installation or a usable Files account is not required for it. Files cancellation, unavailable provider or denied access preserves the prior account/cache and leaves the alternative available. The browser preview cannot invoke native Files SSO and presents browser sign-in as its primary action. Windows retains its established browser/app-password options.

A restored nonsecret account descriptor is not proof of authorization. When Android or its preview starts with a saved account requiring reconnection, show the connection dialog with its saved server URL filled in, while retaining the cached planner underneath. Present the sign-in choices; do not launch a browser or native picker without a user action. A clean first start keeps the ordinary connection entry. A restored authorized account refreshes without a sign-in prompt, even if source health is not yet verified.

**Reconnect** opens the connection dialog when authorization is required; it must never only repeat an unauthorized source refresh. A separate saved-connection retry may check whether protected credentials/provider access became available. If retry still requires authorization, keep the sign-in actions visible. Do not treat a resolved API call returning a disconnected state or a cancelled picker as successful connection. Show success only for confirmed authorization; partial-source failure is a separate health state.

If authorization is lost during use, leave drafts and the current dialog untouched and expose the reconnect action. Do not repeatedly reopen a dismissed connection dialog on background ticks or steal focus from an editor. Development-preview server/session expiry clears the host session token and marks authorization as requiring reconnection; it does not constitute confirmed permission revocation and must not purge saved sources or planner metadata. A subsequent user-initiated sign-in uses a fresh host session. Preserve account-qualified caches and pending metadata across reauthorization; no automatic disconnect, sample data or credential copying.

### 9. Background concurrency, health and optimistic edits

#### 9.1 Background scheduling

- Automatic custom-metadata cloud synchronization is debounced 1.2 seconds after relevant change; durable local persistence is queued immediately.
- Periodic native refresh and metadata synchronization run every 60 seconds when eligible.
- Focus/visibility resume refreshes when the last successful refresh is older than 30 seconds.
- Connectivity restoration triggers refresh opportunities.
- Freshness expires after 125 seconds without a successful refresh.
- Do not block the entire interface during network work. Only the relevant action waits, and the sync indicator communicates progress.
- Defer starting automatic custom-metadata synchronization around dirty editors, active saves, failed pending edits and sensitive open dialogs; resume when safe. Native refresh may continue with draft-protected merging. Defer identity-remapping adoption when applying it would invalidate an active draft; do not freeze all background reads merely because an editor is open.
- An explicit metadata conflict stops automatic retry. Time passing does not resolve conflicting user edits.
- Coalesce concurrent native refresh requests; serialize cloud metadata cycles without serializing every native read behind them.

| Combined health priority | Condition |
|---|---|
| offline | No active connected account or network offline |
| syncing | Relevant native or metadata operation active |
| error | Failed writes, failed native changes or metadata error/conflict |
| stale | Deferred/failed refresh, source issue, no successful refresh, old data, metadataStale, or unavailable source with cache |
| pending | Local work not yet acknowledged by cloud |
| synced | Native sources fresh and custom metadata acknowledged |

The checked cloud icon cannot be derived from metadata synced alone. Source lastSyncedAt on an unsuccessful attempt is insufficient.

#### 9.2 Per-item optimistic mutation lifecycle

| Trigger | Visible / durable behavior |
|---|---|
| User changes an editable field | Apply optimistic patch immediately; append to that item's queue |
| Earlier item mutation in flight | Queue later patch; preserve its independent fields |
| Acknowledgement | Update acknowledged base; replay remaining patches over it |
| Next write | Use newest acknowledged native version |
| Failure | Restore acknowledged source item; retain all failed/unexecuted patches for retry; report failure |
| Retry | Replay retained patches in order using valid acknowledged base |
| User supersedes failed draft | Do not replay stale failed values over the replacement |
| Background source reply | Adopt untouched items; protect dirty/failed item drafts and canonical identity remaps |
| Permission revocation | Remove affected protected content; permission change wins |
| Account mismatch / older full-state revision | Reject stale adoption |

There is no general durable offline native-write queue in the current application. Custom metadata is durable, and the scheduling journal is a deliberate exception. A new client must not promise that arbitrary offline native edits survive restart unless the spec is changed and that capability is implemented across clients.

Evidence: packages/core/src/record-edits.mjs; packages/core/src/background-state.mjs; win/electron/operation-lanes.cjs; packages/ui/src/App.vue; tests/record-edits.test.mjs; tests/background-state.test.mjs; tests/background-sync.test.mjs; tests/automatic-sync-ui.mjs.

### 10. Native write concurrency and API payloads

#### 10.1 Notes conditional updates

Native endpoint: POST /index.php/apps/notes/api/v1/notes for creation; GET/PUT /index.php/apps/notes/api/v1/notes/<nativeId> for one note.
Create JSON is title/content/category. Update JSON includes only desired title/content and category when explicitly requested.

Notes JSON etag is an opaque value; quote it exactly once for HTTP If-Match. Reject weak W/ tags, wildcard, missing validators and malformed header characters. Do not apply the Notes quoting rule to WebDAV, whose validator already uses HTTP syntax.

On 412:

1. Require a complete current representation from the response: matching native ID, string title/content/category, valid etag and no error payload.
2. Compare desired fields against the frozen editor baseline and current server representation.
3. If desired equals current, no write is needed for that field.
4. If desired equals baseline, the user did not edit it; preserve the server's change.
5. If server equals baseline, safely retry the user's change with current etag.
6. If both differ from baseline differently, report the conflicting field and preserve the user's edit; never merge conflicting body text by replacement.
7. If a required baseline field is missing, do not guess.
8. Stop if the current note is read-only.
9. Retry at most three writes. A desired edit already applied returns the latest representation without another PUT.

Favorite and unrelated note metadata are not sent in the update patch, so concurrent unrelated changes survive. An explicitly old etag without its matching baseline is rejected before unsafe rebasing.

#### 10.2 CalDAV document edits

- Discover current-user-principal, calendar-home-set, supported component types, display name, privileges and source color via DAV.
- Use native raw iCalendar as the write basis. Edit only requested properties plus native modification metadata; retain other properties and embedded timezone definitions.
- Require a safe single editable VTODO/VEVENT: multiple matching components, calendar METHOD, recurrence rules/dates/exclusions/instance, organizer or attendee make it complex/read-only for these edit operations.
- Refuse a UID mismatch or missing source location/version.
- Creation is conditional PUT to a generated UID .ics location with If-None-Match '*'.
- Mutation is conditional PUT with the acknowledged native ETag.
- Update LAST-MODIFIED and DTSTAMP and increment SEQUENCE for edits.
- Replacing a date property removes incompatible old TZID/VALUE parameters. Preserve source timezone where an exact instant can be represented; reject invalid/nonexistent conversion rather than moving silently.
- Embedded VTIMEZONE takes priority; IANA database is fallback. Ambiguous wall times use first occurrence; nonexistent times use pre-gap offset. Unsupported zones report TIMEZONE.
- Events require an end after start; all-day endpoints are date-only and end is exclusive.
- Task/card work ranges require compatible endpoint types and valid ordering. Clearing one endpoint is allowed where the native type permits it.
- Existing duration is preserved when a compatible start alone changes; explicitly changing finish removes duration. Invalid duration/start combinations are rejected.
- A date-edit parser rejects normalized invalid calendar days and 24:00 instead of silently shifting them.
- updateTaskStatus writes native STATUS, PERCENT-COMPLETE and COMPLETED consistently. A prior progress value is valid only if an integer from 0 to 100, otherwise use 0. COMPLETED sets 100; IN-PROCESS clamps to 1..99; NEEDS-ACTION caps at 99 without resetting existing lower progress; CANCELLED retains progress. Completing stamps COMPLETED; leaving completed removes COMPLETED.
- COLOR and CATEGORIES are native task/event properties. Empty override removes COLOR; empty tags removes CATEGORIES. Readback verifies requested appearance changes.

#### 10.3 Deck writes

Base: /index.php/apps/deck/api/v1.0. Card endpoints are addressed through native board/stack/card locators.

- Read a fresh card and compare known version/snapshot before mutation.
- Full-card updates explicitly preserve known unrelated native write fields: title, type, owner, description, order, startdate, duedate, archived, done, color.
- Dates missing in native JSON are represented as null in full update payloads. Native card color omits '#'; public color includes '#'.
- Do not claim arbitrary unknown native Deck fields are round-tripped: current full-update bodies are an explicit allowlist. Fresh snapshots preserve the supported fields, not every possible future server field.
- Native labels use assignLabel/removeLabel with numeric labelId; label definitions remain board-owned.
- Native move uses reorder with stackId and order 99999.
- Native dependency uses dependentCards/<prerequisiteNativeId> on the dependent card, POST for add and DELETE for removal. Verify the resulting dependency set.
- Use returned usable validators when present and read back to confirm. Deck's API does not guarantee the same atomic conditional semantics as DAV; fresh comparison/readback mitigates but cannot eliminate every race.
- If a write succeeded but confirmation is incomplete, report partial/uncertain result and request refresh. Do not tell the user that nothing changed or blindly repeat a create.

#### 10.4 Files, native tags and attachment payloads

- Files use authenticated /remote.php/dav/files/<canonicalUser>/ paths, with DAV metadata/file identity resolution.
- Native Notes tag assignment uses /remote.php/dav/systemtags-relations/files/<fileId>/<tagId> with PUT/DELETE.
- New native tag definition POST /remote.php/dav/systemtags/ has {name,userVisible:true,userAssignable:true}.
- Only trust Content-Location/Location pointing to the expected same-origin systemtags path and a numeric ID; otherwise use bounded native lookup rather than sending credentials to a returned arbitrary URL.
- New Deck label POST .../boards/<boardId>/labels has {title,color}, where color has no '#'.
- Attach existing file POST /ocs/v2.php/apps/files_sharing/api/v1/shares?format=json has {path,shareType:12,shareWith:<cardId as string>,permissions:1}.
- Native file upload uses Deck's multipart attachment endpoint. Do not copy local-path authority into a presentation API.
- Related Resources GET /ocs/v2.php/apps/related_resources/related/<provider>/<nativeId>?format=json returns recommendations; no automatic persistence.

Evidence: packages/nextcloud/src/nextcloud.mjs; tests/nextcloud.test.mjs; tests/note-save.test.mjs; tests/native-appearance.test.mjs; tests/native-tags.test.mjs; tests/native-attachments.test.mjs; tests/native-dependencies-ui.mjs.

### 11. Durable event creation and linking

Creating a calendar event and then adding a custom relationship is a multi-step operation. The request ID must be saved before the native mutation so retry cannot create a duplicate booking.

| Journal state | Meaning | Retry behavior |
|---|---|---|
| pending | Valid payload and digest durably recorded; native create not yet confirmed | Conditional deterministic event create/recover with same requestId |
| created | Native href/UID saved | Read that exact event; never recreate a deleted known-created event |
| linked | Canonical event and work item linked; completion fingerprint retained | Return current state; no second write |

- Journal is account-local, schema 1, separate from shared metadata and credentials.
- Validate request UUID, title, target calendar, interval and source task/card before mutation.
- First attempt requires expectedRevision to match. Resuming an existing request can survive later metadata revisions.
- A requestId reused with a different payload digest is rejected. Resume its original details.
- A work item cannot start another booking while it has an unfinished request.
- Persist pending before native create, created after confirmed create, then add scheduled_during from work item UUID to event UUID, then persist linked.
- The deterministic native event UID is nextspace-<lowercase requestId>; resource name is that UID plus .ics, and the event carries X-NEXTSPACE-REQUEST with the same request ID. A conditional create 412 recovers only that matching ordinary event; a wrong ownership marker, incompatible recurrence or cancelled event is a conflict, not permission to overwrite it.
- Metadata-link save retries revision conflicts up to three attempts and first checks if the same typed link already exists.
- Canonical ID changes are resolved during retry; title matching is never used to recover the event.
- A known-created event deleted in Nextcloud is not recreated automatically.
- Linked history retains requestId/digest/recordId/eventId, not draft description forever.
- Corrupt/unreadable journal disables scheduling without replacing it; tell the user why duplication protection is unavailable.
- Partial failure tells the user the request is saved and should be resumed, not resubmitted under a new UUID.

Evidence: win/electron/scheduling.cjs; packages/nextcloud/src/nextcloud.mjs createEvent/readCreatedEvent; tests/calendar-scheduler.test.mjs.

### 12. Transport, error states and security boundaries

#### 12.1 Request rules

- All authenticated source URLs must remain on the configured origin, without embedded credentials or fragments.
- Reject redirects by default; use the final configured HTTPS server address. An explicitly permitted 304 is the only supported exception to the general 3xx rejection.
- Request timeout is 25 seconds including response-body consumption, not just first-byte receipt.
- Default response cap is 24 MiB. Planner JSON is capped at 8 MiB; theme image at 2 MiB; individual mutable iCalendar readbacks commonly 2 MiB; Collective page/assets 4 MiB.
- Apply size limits to streamed bodies as well as fixed Content-Length responses.
- JSON must parse. DAV XML must validate and have a multistatus root. Reject DOCTYPE/ENTITY declarations.
- Accept a valid empty multistatus as an empty source result, not malformed XML.
- OCS success is statuscode 100 or 200 inside a valid successful response.
- Theme values are data, not arbitrary server-provided styles or executable markup.

#### 12.2 Error mapping

| Error / HTTP | Meaning and visible action |
|---|---|
| VALIDATION | Reject input before source mutation; keep draft and explain field issue |
| REVISION_CONFLICT | Local metadata changed; reload/rebase before save; newer saved copy intact |
| CONFLICT / 409 / 412 | Conditional source/metadata contention; preserve draft, refresh/review or bounded safe retry |
| AUTH / 401 | Sign-in rejected; reconnect; do not expose cached revoked content as current |
| PERMISSION / 403 | Action denied; no local-success substitute; confirmed revocation clears affected cache |
| UNAVAILABLE / 404,405,501 | App/API/capability absent or source unavailable; show appropriate read-only/unavailable state |
| STORAGE / 507 | Server storage full; retain local/draft state |
| NETWORK | Network/certificate/timeout issue; preserve cache and mark stale/offline as appropriate |
| FORMAT | Malformed or incomplete response; do not adopt or overwrite guessed data |
| LIMIT | Prototype data limit exceeded; report partial/unavailable rather than silently claiming completeness |
| TIMEZONE | Unsupported timezone; offer native source path instead of destructive edit |
| SECURITY | Unsafe URL/path/resource identity; block request |
| REDIRECT | Redirected authenticated request; configure final server URL |
| NEXTCLOUD | Other server status, surfaced with safe contextual message |
| ETAG_UNAVAILABLE | No trustworthy overwrite validator; leave cloud data untouched; diagnose proxy/server version headers |
| STORAGE_LAYOUT | Metadata parent path is not a usable directory or cannot be established |
| FOLDER_FORMAT | Unsupported/corrupt custom protocol; preserve files |
| FOLDER_MISSING | Known manifest/document removed; preserve local and require recovery |
| FOLDER_CONFLICT | Folder replaced or incompatible documents; retain copies for review |
| LEGACY_CHANGED | Conflicting older-client changes; preserve both and require review |

Metadata FOLDER_MISSING/FOLDER_CONFLICT/LEGACY_CHANGED map to storage conflict. Folder format/layout/missing-validator failures map to storage error. Exhausted conditional retries report conflict but must not assert that another device is definitely responsible; proxy version problems can cause the same symptom.

Raw native filesystem paths, secrets and network headers must not escape in presentation errors. Local disk permission/full/read failures use a safe message and preserve saved data.

#### 12.3 Strong validator handling

- Never strip W/ from a weak WebDAV ETag or add quotes to guess a strong file validator.
- Planner reads request identity encoding and no-cache to avoid using an intermediary's compressed-representation version as a file version.
- When GET lacks a usable version, a DAV-checked consistent read can recover the real strong file version. Verify body/version belong to the same representation.
- If a PUT lacks an ETag, read back matching content with a usable file version before acknowledging.
- Conditional failures never fall back to unconditional PUT.
- Create missing parent directories only within fixed planner storage; verify existing parents are collections. An absent/removed cached parent may be retried once without weakening the conditional request.

### 13. Compatibility behavior, not new legacy product features

The code currently retains these compatibility paths. They are not reasons to build duplicate legacy controls into new clients.

1. Workspace schema 1 from the retired dashboard experiment can migrate to schema 2. Preserve properties/appearance; convert source-to-source links to generic related links; drop links to retired dashboards/self-links; deduplicate; preserve original file.
2. Local old workspace.json can migrate to planner.json. Disconnected mode does not import retired demo workspaces.
3. Existing /Workspace/planner.json can seed the folder protocol. Preserve exact pre-migration local backup and old cloud original.
4. A deterministic seed generation allows interrupted migration to resume only when existing seed documents exactly match expected content. Publish manifest last after every required file and import receipt is saved; recheck old cloud data before activation.
5. legacy-import.json stores {format:'nextspace-legacy-import',version:1,workspace:<old workspace or null>}. It is still required by the current folder reader, even for a new folder without old metadata. A client claiming wire interoperability must include/read it until protocol changes.
6. Later independent edits from an older single-file client can merge forward using that import baseline. Conflicts do not overwrite either copy. Receipt advances only after the folder data is acknowledged.
7. migrateDeckNoteLinks converts old custom Deck-note references to native attachments, then removes duplicate custom intent only after native confirmation. New links should use native attachment behavior from the outset. These native conversions require native-write capabilities and Phase 2 authorization; a Phase 1 client preserves the references/retry intent and MUST NOT run native dependency or attachment conversions.

User direction favors native storage and avoiding legacy testing baggage. Therefore any removal of these compatibility readers/receipts should be a deliberate shared protocol change, not silently inferred by a new client or embedded as another permanent user-facing attachment mode.

### 14. Important limitations and discrepancies for implementation planning

- Shared metadata schema validation is strict; arbitrary new global fields cannot be added by one client without changing the spec/schema and interoperability tests.
- Native source cache has looser safe-JSON validation than the typed public model. Unknown safe native cache data is not permission to expose it or send it back to a source endpoint.
- iCalendar edits preserve unrelated raw properties; Deck full writes preserve a known allowlist, not all unknown future fields. Treat these as different native round-trip contracts.
- Optional attachment/tag metadata preserves missing versus explicitly empty values only for defined fields; do not merge stale values into a confirmed authoritative absence.
- Appearance.mode is currently shared. Device view/filter settings are currently local. These are actual storage facts, even when older prose suggests otherwise.
- A successful metadata sync alone does not prove source freshness, and a source-attempt timestamp alone does not prove successful refresh.
- General native edit drafts are not a durable offline outbox. Scheduling journal and shared metadata have stronger restart durability than ordinary source edits.
- Complete native recurring/invitation editing, general file deletion, arbitrary status creation in CalDAV, and arbitrary server-side related-resource mutation are not existing capabilities.
- Notes tags are native Files tags with a 64-byte native creation limit, whereas task tags are categories and Deck tags are per-board labels. A unified selector must retain these backend differences.
- Folder manifest required-file limit is effectively 20,000 despite a later 60,000 guard; checkpoint capacity is separate.
- Existing schema2 does not demand UUID syntax for entity IDs, and generic properties admit more JSON shapes than their declared object-valued TypeScript type.
- Host-specific auth and DAV fallback must be documented as transport choices; they must not change shared UUID keys, source ownership, conflict decisions or permissions.
- Fixture tests establish expected behavior, not proof of physical-device/network parity. New host implementations need the same behavioral acceptance cases against their actual transport/storage.

### 15. Evidence and acceptance-test map

| Behavior | Primary source | Existing verification evidence |
|---|---|---|
| Exact interface / entities | packages/contracts/src/index.ts | Consumers plus protocol tests; not a standalone runtime schema |
| Metadata validation | packages/core/src/planner-schema.mjs | tests/workspace.test.mjs; tests/categories.test.mjs; tests/space-organization.test.mjs |
| Defaults | packages/core/src/planner.mjs | tests/planner.test.mjs; tests/done-visibility.test.mjs |
| Identity / copies / moves | packages/core/src/identity.mjs | tests/workspace.test.mjs; tests/deck-dependency-identity.test.mjs |
| Canonical identity merge | packages/core/src/workspace-merge.mjs | tests/workspace-sync.test.mjs; tests/background-state.test.mjs |
| Per-file protocol / tombstones | packages/nextcloud/src/planner-folder.mjs | tests/planner-folder.test.mjs |
| DAV strong validators | packages/nextcloud/src/nextcloud.mjs | tests/nextcloud-folder-transport.test.mjs |
| Local revision/atomic persistence | packages/nextcloud-node/src/workspace.mjs | tests/workspace.test.mjs |
| Sync concurrent local edits | packages/nextcloud-node/src/workspace.mjs | tests/background-sync.test.mjs; tests/workspace-sync.test.mjs |
| Account restore | win/electron/auth-restore.cjs | tests/auth-restore.test.mjs |
| Account operation barriers | win/electron/operation-lanes.cjs | tests/background-sync.test.mjs |
| Per-item edit queue | packages/core/src/record-edits.mjs | tests/record-edits.test.mjs; tests/instant-edits-ui.mjs |
| State adoption / permission wins | packages/core/src/background-state.mjs; win/electron/security.cjs | tests/background-state.test.mjs; tests/background-sync.test.mjs |
| Native transport / identities | packages/nextcloud/src/nextcloud.mjs | tests/nextcloud.test.mjs; tests/portable-nextcloud.test.mjs |
| Notes concurrency | packages/nextcloud/src/nextcloud.mjs | tests/note-save.test.mjs; tests/note-conflict-ui.mjs |
| Native tags / colors | packages/nextcloud/src/nextcloud.mjs | tests/native-tags.test.mjs; tests/native-appearance.test.mjs |
| Native attachments / recommendations | packages/nextcloud/src/nextcloud.mjs | tests/native-attachments.test.mjs; tests/native-note-relations.test.mjs |
| Durable scheduling | win/electron/scheduling.cjs | tests/calendar-scheduler.test.mjs |
| Background timers / indicators | packages/ui/src/App.vue | tests/automatic-sync-ui.mjs; tests/background-interactions-ui.mjs |
| Delegated DAV fallback | packages/nextcloud/src/nextcloud.mjs | tests/mobile-dav.test.mjs |
| Cross-host metadata protocol | shared core/nextcloud packages and host adapters | tests/android-metadata-interop.test.mjs; tests/space-organization-sync.test.mjs |

This part is source-derived documentation. Tests were read as acceptance evidence, not executed during this documentation-only task.


## B. Organization, planning and interaction state machines

This part records behavior present in the source audited on 2026-11-11.
It is a platform-neutral behavioral reference, not a proposal to add missing capabilities.
The evidence references at the end identify the present implementation and regression tests.
`must` below describes behavior another client must preserve for parity.
An explicitly labeled limitation is not a guarantee that a future release must retain that limitation.
Native objects remain authoritative; arranging a view must not silently mutate native objects.

### FLOW-01. Organization and scope membership

#### 1.1 Concepts and ownership

- **My overview** is the global view of loaded records, filtered by personal view preferences.
- A **Space** is an independently saved view with selected sources, optional defaults and its own source groups.
- A **source group** combines selected calendars, task lists, Deck boards or other collections inside one Space.
- The current storage field for a source group is `categories`; this is not a Notes category or an item tag.
- A **project** belongs to one Space and may optionally belong to one source group in that same Space.
- A project includes selected source IDs, explicit record IDs, or both.
- A source may be selected in several Spaces without one Space owning or consuming it.
- Within one Space a source may be assigned to at most one source group.
- The same source can belong to differently named groups in different Spaces.
- A source group has its own stable identity; renaming it preserves that identity and its references.
- Creating, deleting or editing a Space must not change My overview membership, row grouping, source colors or creation destinations.
- Historical `excludedSpaceIds` data has no visibility effect and is cleared when applying preferences.
- Neither source grouping nor project membership grants additional Nextcloud permissions.
- Native sources and item-to-item links remain independent of Space organization.

#### 1.2 Direct membership algorithm

1. Deduplicate loaded records by canonical record ID.
2. For `scopeId = all`, every remaining record is directly in scope.
3. For a Space, collect its own source IDs plus the sources of its source groups and nonarchived projects.
4. Include the explicit record IDs of those nonarchived projects.
5. For a source group, collect that group's source IDs plus sources and explicit record IDs of its nonarchived projects.
6. For a project, use that project's source IDs and explicit record IDs.
7. A record is directly included if its collection ID is selected or its record ID is explicitly selected.
8. An unavailable scope yields an empty membership set; it must not silently become a global scope.

The visible navigation excludes archived projects. An archived project is not inherited into a parent Space or group.
Directly selecting an event into a project imports that event alone, not every event from the event's calendar.
Adding a project source also consolidates that source into its parent Space's selection on accepted save.

#### 1.3 Linked context expansion

After direct membership is calculated, inspect `for_event`, `scheduled_during` and `reference` relationships.
If one endpoint belongs to the original direct membership, include the other endpoint only when its kind is `event`, `note` or `page`.
Inspect either relationship direction for this membership expansion.
Use the original direct set, not the growing result: context expansion is one hop, not recursive traversal.
Do not expand membership through `depends_on` or `related`.
Do not import another task or card merely because it is linked to an in-scope item.
Expose included context-only record IDs separately so the interface can label them **Linked context**.
Missing linked records remain missing context rather than being fabricated as records.
Hidden-source filtering occurs before scope expansion, so context must not bypass an explicitly hidden source.

#### 1.4 Timeline grouping algorithm

My overview defaults to grouping work by native collection identity, never by a Space containing that source. ORG-07 additionally permits its own independent source/tag groups; that amendment supersedes historical source-only restrictions below.
Inside an explicit Space/group/project, resolve one deterministic group for each task or card:

1. A project explicitly containing the record ID wins.
2. Otherwise a project selecting the record's collection wins.
3. Otherwise use the matching source group inside the current Space.
4. Otherwise use **Ungrouped sources** within the current Space.
5. Records without applicable organization use their native collection group.

When multiple applicable projects exist, the first in saved project order wins; there is no multi-row duplication.
Only the selected Space's project/group definitions participate in this resolution.
Project color falls back to group color, then Space color for group headings only.
Source and individual item colors remain separate presentation data.
Groups without work rows are omitted from the timeline even when the definitions remain stored.
Group counts count work rows recursively, not associated calendar events or notes.
Native collections with identical case-insensitive titles get source-type disambiguation such as `Personal · Task list`.
Do not infer source equivalence from equal display titles.

#### 1.5 Space and group editor state machine

| State | Trigger | Next state and behavior |
|---|---|---|
| Closed | Open new Space | Unsaved blank draft; no persistent identity allocated |
| Draft unchanged | Browse presets | Draft remains unchanged until a preset is accepted |
| Draft | Accept preset | Add an empty group to this draft only |
| Draft | Skip suggestions | Preserve current draft; no metadata write |
| Draft | Change sources/groups/defaults | Dirty draft; changes remain isolated from accepted organization |
| Dirty draft | Cancel and confirm discard | Close without changing saved organization |
| Dirty draft | Save invalid values | Stay open with validation message; no partial definition save |
| Dirty draft | Source removal affects projects | Require explicit update-projects choice or cancel save |
| Dirty draft | Organization changed since baseline | Retain draft and report concurrent organization change |
| Valid draft | Save | Validate whole proposed organization before allocating new IDs |
| Accepted draft | Durable local save succeeds | Close and retain stable Space/group IDs |
| Accepted draft | Durable local save fails | Keep accepted IDs and draft for Retry save; do not create duplicates |

Suggested groups are Personal, Freelance, Work, Shared, Home and Learning.
They are optional, not installed by merely opening the editor.
Accepted empty groups are valid saved definitions; they can be filled later.
Within a Space, group names must be nonempty and unique after trimming, Unicode NFKC normalization and lowercasing.
A group must retain its original Space owner; an existing ID cannot be repurposed as a group in another Space.
Assigning a source to another group removes its previous assignment in that Space.
The interface must explain the old/new group move before accepting that explicit choice.
Assigning a source to a group also selects the source in the Space.
Removing a group retains all its source IDs in the parent Space and removes matching project group references.
Deselecting a Space source removes draft group assignments and invalid default destinations.
When projects also select that source, saving is blocked until the user chooses to update those project selections.
Unavailable source IDs are retained and shown with their inclusion reasons; temporary unavailability is not deletion.
An open existing-Space draft compares the baseline Space, owned groups and owned projects with current data.
If those owned definitions changed, do not overwrite them using the stale draft.
Unrelated organization changes in other Spaces can be merged without invalidating this Space's draft.
Deleting a Space removes its owned groups/projects and obsolete per-scope preferences, not native records or global links.
Deleting a selected scope returns to My overview and preserves an open item draft.

#### 1.6 Organization acceptance examples

- Select a Personal calendar and Personal board in Space A; add a Personal group. Their work groups together only in A.
- Select the same board in Space B under Production. A's Personal group remains unchanged.
- Create or delete B. My overview continues to show the board under its native source identity.
- Put one event from an unrelated calendar into a project. Other events in that calendar do not become project members.
- Link a project card to an external note. The note appears as Linked context, not as a selected source.
- Make that card depend on another person's card. The other person's card does not automatically join the project.
- Remove a group. Its work remains in the Space under Ungrouped sources unless another explicit project placement applies.

### FLOW-02. Assignment, filters, counts and view preferences

#### 2.1 Assignment semantics

The assignment filter affects Deck cards only.
Tasks, events, notes and pages are not removed by the Deck assignment choice.
My overview defaults to **My Deck cards** (`assignment = me`).
A new Space, source group or project defaults to **All Deck cards** (`assignment = all`).
An explicit saved per-scope assignment preference overrides the default.
For `me`, `assignmentKnown` must be exactly true.
A card is mine when `assigneeIds` contains the canonical connected username, including cards assigned to several people.
Do not match a display name, infer group membership, or assume an unknown assignment means mine.
Unassigned means assignment is known and `assignmentCount`, or the fallback length of `assigneeIds`, is zero.
Known-unassigned cards can be included globally for the view or from selected board IDs.
Unknown-assignment cards remain excluded from `me` even when unassigned cards are included.
Show distinct hidden-assignment, known-unassigned and unknown-assignment counts.

#### 2.2 Completion and cancellation

`closed(record) = record.completed || (record.kind == task && upper(record.status) == CANCELLED)`.
Done visibility is explicitly configurable for each of the five layouts within each scope.
A new layout inherits the old general done-visibility setting until explicitly configured.
Default visibility is to hide closed work.
Showing closed work does not increase open-work counters.
Cancelling a task is not equivalent to completing it, even though both are hidden by the same closed-work filter.
The Show done setting must survive leaving and returning to the scope/layout and restarting on the same device.
Reset filters must not reset Show done.

#### 2.3 Selection pipeline and ordering

Apply visible-record selection in this order:

1. Deduplicate record IDs.
2. Exclude explicitly hidden collection IDs.
3. Calculate direct scope and allowed linked context.
4. Hide closed task/card records if Show done is off.
5. Apply Deck assignment policy.
6. Apply the trimmed, case-insensitive search query to title, collection title and tag names.

Search does not search description bodies or download note content.
The search query is a simple substring comparison, not fuzzy matching.
Work order is open before closed, then local due date ascending, undated last, then title.
Events are ordered by normalized start value.
Resources are ordered by most recent update first, then title.
Timeline row ordering has an additional viewport priority described in section 5.

#### 2.4 Attention buckets and counts

All attention buckets use open task/card records after normal scope, search and assignment filtering.
`today` is the local calendar day, not a UTC date string.
Overdue: valid due day strictly before today.
Today: due day equals today.
Upcoming: due day strictly after today and strictly before local today plus seven days.
Undated: no valid due day, even if a start exists.
Blocked: at least one loaded task/card prerequisite is not completed.
Only distinct blocked record IDs count once, regardless of prerequisite count.
**Current rule:** a cancelled prerequisite still blocks because cancellation does not set `completed`.
**Current rule:** a missing prerequisite record does not contribute to the blocked count.
Navigation badges count open work in the destination scope using that scope's assignment choice.
Navigation badges do not inherit the active view's search, temporary hidden sources or unassigned-board inclusion.
The main work count is open selected work; the record count includes all selected kinds and visible closed work.
The events count counts selected event records, including expanded occurrences, not original recurrence series.
Calendar per-day summaries count overlapping events and due dates of open work.
Do not confuse the attention bucket **Undated** with calendar **Not scheduled**: the latter requires both dates absent.

#### 2.5 Local versus shared preferences

Spaces, source groups, project membership, relationships, status mappings and personal workflow are shared metadata.
Temporary view preferences are device-local and account-qualified.
Local snapshot fields are layout, assignment, unassigned options, hidden source IDs, completion visibility, query, attention and list kind.
Local scope keys use the canonical server origin/path with trailing slashes removed and canonical username.
Credentials must not be included in the preference key or preference value.
Account changes save the previous account's local snapshot before loading the new account's snapshots.
Fresh scopes have clean defaults rather than inheriting the currently filtered scope.
Old global completion defaults seed My overview only.
Local scope removal prunes only obsolete scopes; it does not rewrite source definitions.
Corrupt local preference data must fall back safely and must not prevent account startup.
Preference parsing accepts at most 2,000,000 serialized characters and 2,500 scope snapshots.
ID lists are deduplicated, reject unsafe prototype keys and null characters, and retain at most 5,000 IDs.
Preference IDs are nonempty strings of at most 2,048 characters; query is capped at 2,000 characters.
Valid attention values: `all`, `overdue`, `today`, `undated`, `blocked`.
Valid list-kind values: `all`, `tasks`, `calendar`, `deck`, `notes`, `collectives`.
Date anchor/range is retained per scope during the active session, separately from persisted snapshots.
Switching accounts clears that in-session viewport map.
Selecting an unavailable scope falls back to My overview through navigation reconciliation.
Changing layout clears attention to `all` and resets the visible-list page size, but retains search/source settings.
Reset filters clears search, attention, list kind, hidden sources and unassigned inclusions, and restores the scope assignment default.

### FLOW-03. Native status, unified mapping and personal planning

#### 3.1 Native status authority

Task status values are `NEEDS-ACTION`, `IN-PROCESS`, `COMPLETED`, `CANCELLED`.
Their displayed names are To do, In progress, Completed and Cancelled.
Absent or unknown task status projects as NEEDS-ACTION unless native completion is true.
Native task completion is true when a COMPLETED timestamp exists or status equals COMPLETED.
A percentage of 100 alone does not imply completion.
Task status changes use this progress normalization:

| Requested status | Resulting completed | Resulting percent complete |
|---|---:|---|
| NEEDS-ACTION | false | `min(previousValidPercent, 99)` |
| IN-PROCESS | false | `max(1, min(previousValidPercent, 99))` |
| COMPLETED | true | `100` |
| CANCELLED | false | Preserve previous valid percentage |

A previous valid percentage is an integer in `[0,100]`; otherwise use zero before applying the table.
Mark done uses COMPLETED for tasks; reopen uses NEEDS-ACTION.
Reopening cancelled work also uses NEEDS-ACTION through the completion-toggle action.
A Deck card's stack identity and native completion flag are independent attributes.
Never infer Deck completion from a stack called Done, DONE, Finished or any translated/custom label.
Moving a card between ordinary native stacks does not itself toggle native completion.
Native stack/status controls must display every available option with its mapped color.
The current color for a stack choice uses the stack mapping; the separate Deck completion state may map elsewhere.

#### 3.2 Board projection modes

All Board modes retain their defined columns when empty, including after search, assignment, source visibility or Show done filters. Render a zero count and an empty drop area; filtering changes items, not the status catalog. The available native source catalog is scoped by the current Space/group/project definitions (including sources of explicitly assigned project items), independent of currently visible matches. My overview uses all loaded sources. A native board with no matching cards remains selectable. Scope changes still select the default board mode. Unknown fallback statuses remain visible when records reference them; do not invent unknown stacks.

**Source status:** combine native statuses into display columns only when labels match after trim, whitespace collapse and lowercase.
Custom labels are never semantically guessed into To do/Doing/Done.
Completed work projects into Done regardless of its ordinary stack.
Seed columns from every native Deck stack in the scoped source catalog, plus Done for Deck completion. When any scoped task list exists, retain all four task-status columns (To do, In progress, Done, Cancelled). Identical normalized labels merge as before.
Task cancellation projects into Cancelled.
To do and In progress sort before custom labels; Done and Cancelled sort after them.
This combined source-status mode is a projection, not an arbitrary cross-source writable workflow.

**One Deck board:** display that board's native stack order and put each card in its native stack.
If a referenced stack is absent, keep a fallback stack column using the known native status/title rather than dropping the card.
Native board moves remain within the same board and require a writable available target stack.

**Unified statuses:** display explicitly configured custom columns and native-status mappings.
Use an Unmapped column when a work record's native status has no valid assignment.
Unmapped is always prepended, including when empty; it is not a writable target.
Each work record appears once after ID deduplication.

**Personal planning:** display Inbox, Planned, In progress and Done from custom workflow metadata.
Always include Cancelled, including when empty; it remains a read-only projection of native cancellation, not a new custom workflow value.
Native completed work always displays in Done; native cancelled work displays in Cancelled.
For other work, missing/invalid custom workflow defaults to Inbox.
Changing personal planning never changes a native task status, Deck stack or native completion.
Closed work cannot be dragged to a personal planning column.
The saved internal values are `inbox`, `planned`, `doing`, `done`.

#### 3.3 Mapping structure and defaults

A custom column has stable nonempty `id`, nonempty trimmed `title` and six-digit hexadecimal `color`.
Column IDs must not begin with `$`; duplicates are not valid independent columns.
A source-status key is canonical JSON `[source, collectionId, nativeStatus]`.
The source is exactly `deck` or `tasks`, and all three values are nonempty strings at most 2,048 characters without nulls.
Keys must equal the canonical JSON serialization, not an alternative spacing/escaping representation.
For tasks, the third value must be one of the four supported status constants.
For Deck, an ordinary stack ID is the native status; `$completed` denotes native completed cards.
`$unknown` can describe a missing card stack; `$unmapped` is reserved for the display column.
Assignments reference only configured column IDs.
Unavailable source/stack mapping references remain visible as unavailable options rather than being renamed or guessed.
The default columns are `todo`/#8b939f, `doing`/#0082c9, `done`/#2c9d70 and `cancelled`/#8b748e.
Default mapping assigns the four task statuses for each known task list and Deck `$completed` to done.
Default mapping does not guess ordinary Deck stack assignments from titles.

#### 3.4 Unified-board drop state machine

| State | Trigger | Required result |
|---|---|---|
| Idle | Start drag on writable eligible work | Dragging |
| Dragging | Drop into its current mapped column | No-op |
| Dragging | Drop into Unmapped | Reject/no native mutation |
| Dragging | No own-source status maps to target | Inform user to map a status from this source first |
| Dragging | Exactly one valid own-source target | Apply that native status change |
| Dragging | Multiple valid own-source targets | Open explicit native-target selection; no mutation yet |
| Choice open | Cancel | Return to unchanged board |
| Choice open | Confirm | Recalculate eligible targets and apply only if chosen key is still valid |
| Native change pending | Acknowledged | Show authoritative result |
| Native change pending | Failure | Restore acknowledged record and offer Retry/discard |

Reverse mapping must consider only mappings belonging to the item's own source and collection.
A mapping from another board/list cannot serve as a drop target for this item.
A read-only item, read-only/missing collection or missing target stack is not eligible.
For Deck `$completed`, mark the card done without requiring a target stack.
For a normal Deck stack target, reopen the card if necessary, then move it to that stack.
Those two native Deck writes are sequential; this is not a server transaction.
If the later step fails, surface the failure and reconcile on refresh/retry; do not claim atomic rollback of the native server.
The default board submode is Unified statuses when a saved mapping exists, otherwise Source status.
Changing scope resets that board submode choice to the default rather than persisting a per-scope board selector.

#### 3.5 Status acceptance examples

- A card in a stack named DONE with `completed = false` remains open unless the user marks it done.
- Map Review and Waiting from one board into Doing. A drop to Doing must ask which native stack to use.
- Map a different board's Doing stack into Doing. That mapping cannot move a card from this board.
- Cancel a 60%-complete task. Its status becomes CANCELLED and percentage remains 60.
- Move an open card to Personal planning Done. Its native card remains open; only custom workflow changes.

### FLOW-04. Dates, time zones and recurrence

#### 4.1 Canonical meanings

Preserve a date-only value as `YYYY-MM-DD`, interpreted as a local calendar day, not UTC midnight.
Preserve timed values as instants and serialize submitted timed edits as ISO UTC timestamps.
Calendar event intervals are half-open: start is included and end is excluded.
Work deadlines include the due day when date-only.
Native work start/due ranges express planned work range; they do not reserve a busy calendar interval.
An ordinary event requires start and end on creation and end strictly after start.
A task may omit either bound or both; when both exist its due value must be strictly after start.
A one-day date-only task uses due only instead of identical DTSTART and DUE.
Deck dates are native instants, including when the user edits them using calendar dates.
In date-only Deck editing, start maps to local 00:00:00.000 and due to local 23:59:00.000.
Explicit empty strings in a date-edit payload mean remove that bound.
Do not manufacture a work start merely because a due date exists.
Do not manufacture a due date merely because a work start exists.
An item without either date must still offer Edit dates and an initially blank draft.

#### 4.2 Boundary validation differences to preserve

Creation event: both bounds required and end > start.
Creation task: optional bounds, but if both exist due > start.
Creation card: optional bounds, but if both exist due >= start at the initial form-validation stage.
Existing-item date editor: if both effective bounds exist, end/due must be > start after type-specific encoding.
Thus a date-only card edited for one day is valid after 00:00/23:59 encoding.
An existing timed card with identical start/due is rejected by the date editor.
Malformed, impossible calendar dates must not normalize silently into another month for accepted date-only values.
The native write layer validates again; a valid interaction preview is not authority to bypass native validation.
Unsupported/read-only recurring or invited items must remain read-only in these ordinary edit flows.

#### 4.3 Day arithmetic and geometry

Day offsets use the difference between UTC representations of each local calendar date, divided by 86,400,000.
Add local wall-clock minutes divided by 1,440 when calculating timed position within a day.
This keeps each displayed calendar day the same width across 23-hour and 25-hour DST transitions.
Do not calculate visible day columns by dividing elapsed local milliseconds by 86,400,000.
DATE values shift by rounded whole calendar days.
Timed values shift whole days using local date arithmetic, then add any fractional-day elapsed minutes.
Due-only DATE markers are positioned at the middle of their date column.
A valid work span requires both bounds and a positive effective range.
DATE due extends the work span through the complete due day; event end remains exclusive.
Start-only and due-only work displays as a point rather than an invented interval.
An undated dependency anchor is only a visual connection point, not a saved date.
Out-of-range bars are clipped to the visible period and retain clipping semantics.
The source-color indicator stays at the visible leading edge, even when the original start precedes the view.

#### 4.4 Range selection and date-mode conversion

An empty all-day click selects one whole day with an exclusive next-day selection end.
An all-day drag includes all touched day columns in either drag direction.
A timed click floors the start to a 15-minute boundary and proposes one hour, clamped to the visible interval.
A timed drag snaps both ends to nearest 15 minutes with at least 15 minutes duration.
Selection is clamped to the visible day count and retains a positive interval.
Selection ranges use an exclusive end regardless of the eventual item kind.
When changing a selection into work date inputs, convert exclusive end to inclusive final due day.
For a one-day task selection, leave Start blank and set only the deadline.
Switching item type retains edited range coverage rather than resetting to the original clicked location.
Notes ignore date selection and must say that no scheduled dates will be saved for the note.
Switching timed to all-day preserves every covered day.
An event already ending at midnight does not gain another all-day date.
Switching back to timed restores exact remembered times when the all-day projection has not changed.
Otherwise use 09:00 start and 10:00 event end, or 17:00 work deadline, on the appropriate covered days.
Due-only work remains due-only through an unchanged mode round trip.
Default new work has no dates; default new event uses today 09:00–10:00.

#### 4.5 Move and resize algorithms

The timeline edit algorithm can snap timed values to 1/96 day (15 minutes), and date-only values to a whole day.
The current interaction offers 15-minute timeline dragging only when the visible range is at most three days; broader ranges drag in whole days.
Moving an event with two timed bounds preserves elapsed duration after shifting its start.
Moving a work range shifts its present bounds; missing fields are not fabricated.
A resize changes only the requested bound and must retain a strictly positive effective interval.
A due-only marker gains start only by extending to a valid earlier point.
An undated task placed on a day gets a DATE due value and no start.
An undated Deck card placed on a day gets a local 23:59 due instant and no start.
Calendar movement separates rounded horizontal local-day movement from vertical minutes snapped to 15 minutes.
All-day event movement ignores vertical minutes.
When both timed bounds are present in a calendar move, preserve their elapsed duration across DST.
A timed instantaneous event represented by equal normalized start/end moves its start without writing a fabricated zero-duration DTEND.
Moving a custom plan session changes that session identity only, not the underlying work's native dates.
Zero movement, invalid dates, invalid ranges and cancellation produce no write.

#### 4.6 Recurrence and unsupported edit cases

Loaded event recurrence expands occurrences within the fetched agenda coverage.
EXDATE exclusions, named time zones, DST transitions and moved exceptions participate in projection.
Occurrence identity uses the original recurrence slot, not the moved occurrence's new start.
Detached exceptions and moved exceptions can appear even when the original slot lies outside the expansion interval.
Cancelled events/occurrences are not displayed as live calendar bookings.
One recurrence expansion is bounded to 20,000 iteration steps.
If expansion cannot exhaust safely, report the limit rather than claiming complete coverage.
The normal agenda window is the previous 14 days through the next 90 days.
Only loaded coverage is available for viewing, matching and conflict checks; changing visible dates is not a guarantee of a fresh full-history fetch.
Recurring events, recurrence exceptions, invitations and unsupported multi-component resources are read-only for ordinary date/description/status mutations.
Organizer or attendee properties make ordinary task/event mutation unsupported in this implementation.
Missing trustworthy resource ETags also make native calendar/task records read-only.
The user must edit those unsupported records in Nextcloud; do not flatten a recurrence into an ordinary event.
Native edits preserve unrelated content, status, alarms, custom parameters and named-zone semantics.
Floating-time and duration-backed native resources must be normalized through the connector, not reconstructed from display fields alone.

#### 4.7 Date acceptance examples

- Select 10–12 November all-day: event end is 13 November; task/card deadline includes 12 November.
- Select just 10 November for a task: due is 10 November and start is absent.
- Move a 09:00 booking across the autumn DST boundary by one local day: the displayed start remains 09:00 and elapsed event duration is retained.
- An event ending at Monday 00:00 occupies no time on Monday.
- A task due Monday occupies Monday's due/all-day projection; it is not a Sunday deadline because of UTC conversion.
- Drag a due-only task's start handle forward past its due value: reject the edit and retain the saved value.

### FLOW-05. Five layouts and interaction parity

#### 5.1 Shared interaction contract

All five layouts use the same selected records, canonical identity, completion filter, source/item colors and item inspector.
Selecting a record must not trigger a full native refresh as a prerequisite to opening its cached details.
Selection and hover are distinct: hovering must not select, open an inspector, navigate dates, save or alter scroll position.
Hover both work and its linked bookings in either direction; show the same relation semantics in standalone and embedded calendar views.
Leaving hover clears transient emphasis while retaining selection emphasis.
Source color identifies the originating calendar/board/list; item color may fill the remaining item surface.
Work status, item tags and native read-only limitations must remain consistent across layouts.
Details remain available even when completion causes the item to leave the currently filtered main view.
Opening a linked record can push the prior selection onto an inspector history; Back returns to the latest still-available record.
Closing or replacing an inspector with a dirty edit requires discard consent or successful flush, not silent loss.

#### 5.2 Overview

Overview combines a task/card timeline above an hourly calendar under one aligned date axis.
Use the same anchor, day count, day widths and horizontal date position in both parts.
The middle divider resizes the two parts; each part may scroll vertically independently.
The initial/reset Overview date range is seven days beginning at the current anchor, normally today.
Overview's work part is focused: work in the period, selected work and relevant dependency context remain visible.
Other work is represented in expandable Overdue, Outside this period and Unscheduled buckets.
Within-period includes a visible native range/marker, visible custom plan or visible scheduled_during event.
An item linked by a chain of visible dependency endpoints can remain exposed so the chain stays intelligible.
This only uses already-visible work membership; it does not import filtered-out dependency work.
An item with a dated linked booking is not classified Unscheduled merely because native work dates are absent.
The calendar-side context area supplies upcoming bookings and work that needs time, rather than an empty decorative region.
The all-day/multi-day area gets space based on content; overflow is allowed when density exceeds available space.

#### 5.3 Timeline

The initial/reset Timeline range is fourteen days; zoomed range is bounded to 1–90 whole days.
One row model aligns names, native statuses, due values, work bars and dependency connectors.
Calendar events appear as date bands/labels, not as work rows.
Hovering a calendar event emphasizes its whole visible time band so its range is identifiable.
Persistent dependency connectors remain visible without requiring hover.
Visible groups can be collapsed/expanded individually or all at once.
Inside a group, priority is work visible in the period, then genuinely undated work, then other dated work.
Within each priority, sort by start-or-due time then title.
Focused Overview additionally buckets out-of-period rows; standalone Timeline displays the expanded row model.
Rows initially reveal at most 180 row entries and can reveal more; a count of shown work must not be confused with total selected work.
Dependency endpoints should remain interpretable for undated items without manufacturing dates.
All calendar bands controls the presentation of background/header context; it is not a source-visibility filter.
Header event labels use packed lanes; overflowing labels remain available from the event list.

#### 5.4 Calendar

Standalone Calendar shows a seven-day week beginning Monday.
It shows calendar events, native task/card date projections and valid custom plan sessions.
Native work is not converted into a real event just to display it.
DATE work and work spanning different local dates goes to the all-day/multi-day region.
Timed same-day work goes to the hourly region, including Due or Starts points.
A multi-day item is one clipped continuous box with one title, not repeated daily mini-cards.
All-day lanes sort by start, longer visible span first, then title and occupy the first nonoverlapping lane.
Timed overlapping blocks use lanes so concurrent items can be distinguished.
An exact plan-session/native timed interval for the same work record is not drawn twice.
Invalid or orphaned plan sessions are omitted from projection, not converted to unrelated work.
Not scheduled lists work lacking both native start and due; it provides a route to planning that item.
Calendar initially scrolls to 07:00 while retaining the full 24-hour scale.
The current local day's time indicator reflects current local minutes.
Calendar hour scaling must not change underlying start/end timestamps.

#### 5.5 Board

Board shows task/card records only and supports the projection modes in section 3.
Board source selection must remain within sources represented in current work membership.
Click a card to inspect it; completion/checklist interactions must not accidentally begin a card drag.
Description checklist children represent native markdown checklist lines, not separate tasks or dependency records.
Completing one child edits the owning card description and does not mark the card complete.
The whole card, including an expanded checklist surface, retains the individual card color treatment and source-color leading edge.
The ordinary source-status combination cannot be used to invent a writable cross-source status from matching text alone.
Unified moves require the reverse-mapping algorithm, including ambiguity confirmation.

#### 5.6 List

List includes all selected record kinds unless a source-kind filter is active.
Attention shortcuts open List with the chosen attention bucket and reset list kind to All.
Closed work never contributes to attention buckets even when Show done is enabled.
The initial list page contains at most 120 rows; more results can be revealed without altering source membership.
Changing query, list kind, attention, scope or layout resets that initial page limit.
List preserves source labels, native status, dates, tags, item colors and linked-context indication.

#### 5.7 Scroll and zoom rules

Ordinary vertical wheel/trackpad motion scrolls rows or hours; it must not navigate dates.
Horizontal intent requires absolute horizontal delta greater than absolute vertical delta.
With Shift held, use whichever wheel axis has larger magnitude as horizontal motion.
Control-modified wheel belongs to zoom and must not also pan dates.
Normalize line wheel units by 16 and page units by the viewport page size.
On Timeline and split Overview, consume real horizontal overflow first; accumulate remaining travel into whole-day date navigation.
Carry sub-day wheel remainder so many small trackpad events are not lost.
Reset accumulated remainder after more than 250 ms idle or a direction reversal.
Use whole-day truncation for committed date travel and retain the fractional remainder.
The visible timeline/Overview date scrollbar and earlier/later controls operate on the same anchor as wheel navigation.
Current standalone Calendar horizontal gestures scroll available horizontal overflow only; they do not pan into another week after reaching the edge.
Standalone Calendar week navigation uses its earlier/later period controls. This is a current interaction-parity limitation.
Timeline zoom changes visible start/end dates, not just the width of unchanged columns.
For timeline zoom, clamp wheel delta to [-200,200], multiply day count by `exp(delta * 0.004)`, round and clamp to [1,90].
If rounding produces no change for a nonzero wheel delta, change by one day in the delta direction where allowed.
Adjust the anchor so the day under the pointer remains at the same relative screen location within day rounding.
Calendar zoom changes hour height only, bounded to 0.5–3 times the default scale.
The reference default is 48 units/hour, with minimum 24 and maximum 144; equivalent physical scaling is acceptable.
Scale by `exp(-delta * 0.002)` and preserve the hour under the pointer by adjusting vertical position.
Reset calendar zoom restores the default while retaining the same top visible hour.
On the split Overview, the surface receiving Control+wheel determines horizontal timeline zoom versus vertical calendar-hour zoom.

#### 5.8 Drag state machine

| State | Trigger | Behavior |
|---|---|---|
| Idle | Primary pointer down on editable item/handle | Candidate with immutable starting record and pointer location |
| Candidate | Move less than 4 reference units | Keep candidate; preserve normal click behavior |
| Candidate | Cross movement threshold | Dragging preview, suppress accidental click |
| Dragging | Pointer moves/scrolls | Recalculate date proposal or dependency target from original snapshot |
| Dragging | Invalid interval/target | Show invalid preview; no write |
| Dragging | Release with valid proposal | Commit one mutation |
| Candidate | Release without a drag | Select/open item only |
| Candidate or Dragging | Escape, pointer cancellation or loss of capture | Cancel without committing |

Native mutation eligibility requires writable item/source and supported date or relation operation.
A timeline end/start handle resizes bounds; a dependency handle establishes work order rather than changing dates.
Dragging a dependency from prerequisite toward dependent stores the reverse-directed depends_on edge.
Dragging an existing calendar item moves it; it must not also create an overlapping new event draft.
Dragging empty space starts a creation-range preview instead.
Single-item direct manipulation is supported; group movement and automatic downstream date rescheduling are not implemented.

### FLOW-06. Native creation and destination context

#### 6.1 Available creation kinds and fields

Supported native creation kinds are task, Deck card, event and note.
Expose a kind only when its source is connected and an applicable writable destination/capability exists.
A Deck board also needs an available stack.
Notes can use the default category with an empty destination; other kinds require an explicit valid destination ID.
The form retains title, description/content, per-kind destination and date range while changing kind.
Deck assign-to-me defaults true; the initial stack is the first available native stack of the selected board.
Changing boards retains the selected stack only if it exists on the new board; otherwise select that board's first stack.
Form titles must be nonempty after trim; card title limit is 255 characters and other form titles are 500.
The ordinary creation form limits description/content entry to 100,000 characters.
This form limit is narrower than some native API limits; do not claim every API limit equals the form limit.
Dates follow section 4, and description/content must not be replaced by a generated placeholder.
Creation sends the chosen native collection identity, not its display title.
Notes category identity must preserve the real native category, including default/uncategorized edge cases.

#### 6.2 Destination algorithm

In My overview:

1. If creation came from an item row and that row's collection is a writable destination for the chosen kind, propose it.
2. Otherwise choose a destination only if exactly one writable collection of that kind exists.
3. Otherwise leave destination empty and require a user choice.
4. Do not use any Space's defaults simply because it happens to contain the source.

Inside an explicit scope:

1. Resolve active project/group/Space from the scope and, when applicable, source-row context.
2. Prefer the first writable matching source explicitly selected by that project.
3. If a group applies, use a matching writable group source or no preselection; do not jump to a different group.
4. Otherwise use the Space's default of the matching kind only if still selected and writable.
5. Otherwise use the first selected writable Space source of the matching kind or no preselection.

A curated project with no source of that kind can use the parent context for native creation.
If created outside project-selected sources, add the newly created record as explicit project membership.
This creation rule is deliberately different from the stricter booking-calendar default in section 7.
Defaults are proposals; the form still validates the final user-selected writable destination.
Missing or read-only defaults are not authority to write to another source by title matching.

#### 6.3 Creation state machine and partial success

| State | Trigger | Behavior |
|---|---|---|
| Closed | New item or empty-range selection | Open populated draft with appropriate context |
| Draft | Invalid title/destination/range | Show validation; keep draft; no native write |
| Valid draft | Submit | Lock duplicate submission; flush incompatible pending edits |
| Creating | Native create fails | Keep draft and error; do not show confirmed created item |
| Creating | Native create acknowledged | Adopt native item and stable identity |
| Native created | Project membership required | Save only explicit membership metadata |
| Native created | Membership save fails | State that native item exists and membership needs Retry save |
| Native created | Created identity cannot be confirmed | Ask refresh/manual project membership; do not recreate |
| Completed | All required steps succeed | Close form, select created item and show success |

Native item creation is not an optimistic fake record.
Submission remains protected through native creation and project membership persistence.
The created record is resolved using the returned createdRecordId, falling back to a new record with the submitted title.
The fallback is not a guarantee of identity discovery for every unusual server response; surface the unconfirmed-membership case.
A creation warning from the native adapter remains visible even after successful creation.
Do not repeat native creation when only project membership failed.
There is no general durable offline native-create queue.

### FLOW-07. Calendar work sessions and booking recovery

#### 7.1 Relationship meaning

`scheduled_during` means a task/card reserves work time in a real calendar event.
Store one edge from work record to event; reverse lookup derives scheduled work without creating another edge.
`for_event` means contextual preparation/follow-up association, not a reserved work session.
A work item can have several real calendar bookings.
Several work items can link to the same existing event.
Creating a booking does not change the work item's native start/due fields.
Changing work dates does not automatically move its calendar bookings.
Unlinking a booking removes the association, not the native event.
The task/card only needs to be readable for booking; the chosen calendar must be writable.
A read-only event may be linked as existing context/reserved time because the event itself is not changed.

#### 7.2 Default booking calendar

If the selected record is itself an event in a writable calendar, that calendar is its direct default.
In My overview, only preselect a calendar when exactly one writable calendar exists.
In an explicit scope, honor that scope's Space ownership; never let another Space containing the same source win.
Find the applicable project, preferring explicit record membership over source membership.
Use the first writable calendar in that project's selected sources when one exists.
If the selected scope is explicitly that project and it has no writable calendar, return no default.
Next consider the applicable source group's selected calendars.
An applicable group is a destination boundary: if its calendar is unavailable/read-only, return no default rather than a different group's calendar.
Without an applicable group, use the Space's still-selected writable default calendar, otherwise a selected writable Space calendar.
An invalid/deleted explicit scope has no default.
Never infer a default because a calendar and board have similar names.

#### 7.3 Conflict calculation

Compare actual instants for timed events and local midnight boundaries for DATE all-day events.
A busy interval requires a valid start, valid end and end > start.
Treat intervals as `[start,end)`; touching boundaries do not conflict.
An overlap exists iff `candidate.start < other.end && other.start < candidate.end`.
Ignore the candidate's own event ID and deduplicate repeated event IDs.
Ignore non-event work spans and planner-only sessions.
Ignore events marked `busy = false`, CANCELLED, or native TRANSPARENT.
Ignore malformed, zero-length and reversed intervals.
Linking work to an event must not suppress overlap warnings against other genuine busy events.
Sort conflicts by start time and stable ID fallback.
Conflict information covers only accessible loaded events; never claim another person's unavailable calendar is clear.

#### 7.4 Scheduling request payload and validation

A scheduling request contains `requestId`, `recordId`, `title`, `collectionId`, `start`, `end`, optional `allDay`, optional `description` and initial `expectedRevision`.
`requestId` is a valid UUID normalized to lowercase.
`recordId` and `collectionId` are nonempty strings of at most 2,048 characters without nulls.
Title is trimmed, nonempty and at most 500 characters.
Start/end are nonempty strings of at most 80 characters and must pass interval validation.
`allDay` is boolean when supplied and defaults false.
Description defaults empty and is at most 500,000 characters without nulls.
The source must be a loaded task from tasks or a card from Deck in the active account.
The calendar must be available, writable and have a native resource address.
The initial expectedRevision must be the current safe integer revision.
There can be only one unfinished scheduling request for a work record at a time.
Retry must use the same request ID and exactly the same normalized payload fingerprint.

#### 7.5 Durable booking state machine

| Durable state | Operation | Success transition | Failure behavior |
|---|---|---|---|
| None | Validate and persist request identity | pending | No native write if validation or journal save fails |
| pending | Conditional deterministic native create | created | Keep pending; retry same request, even if response was lost after commit |
| created | Read/verify created native resource | created with confirmed record | Keep created; never create another event |
| created | Adopt canonical event identity and save scheduled_during relation | relation exists | Keep request for retry; preserve other later metadata edits |
| Relation exists | Persist completion fingerprint | linked | Retry deduplicates the relation and retries journal completion |
| linked | Repeat same request | linked/no-op | No repeated native create/read needed |

Persist the account-local request before any native event creation.
Use deterministic event UID `nextspace-<lowercase requestId>` and a matching native request marker.
Use conditional creation so an existing resource cannot be overwritten.
If the response was lost after native commit, retry can discover the existing resource and verify ownership.
If a known-created event is later deleted in Nextcloud, retry must not recreate it.
If the existing resource no longer matches UID/request marker or became unsupported, report conflict without overwrite.
Adopt the created event directly even when outside normal agenda coverage.
Update cache and canonical identity before creating the metadata relationship.
Deduplicate the exact work→event scheduled_during edge on retry.
Metadata revision conflicts while adding the relationship are retried against the latest snapshot up to three attempts total.
Unrelated metadata edits made after an unfinished request began must survive its retry.
After linked completion, retain request ID/digest/work ID/event ID but discard the full draft text from the journal entry.
The journal is account-local and is not part of cloud-synced planner metadata.
A different device does not resume the first device's unfinished scheduling journal automatically.
Journal schema version is 1; allowed statuses are pending, created and linked.
Journal size is bounded to 16 MiB and 10,000 requests; a full journal blocks a new booking before mutation.
Invalid/corrupt journal data disables scheduling and preserves the existing file rather than replacing it with an empty history.
Once submitted or restored as pending, the form retains original values for safe retry rather than accepting a changed payload under the same request ID.

### FLOW-08. Dependency graph and relationship writes

#### 8.1 Canonical direction

Store `depends_on` as **dependent → prerequisite**.
For selected item A, **Waits for / Incoming** lists prerequisites B for which edge A→B exists.
For selected item B, **Needed by / Outgoing** lists dependents A for which edge A→B exists.
These user-facing incoming/outgoing terms describe the order of work, not the stored edge's arrow direction.
Timeline arrows show prerequisite finish → dependent start, opposite the stored dependent→prerequisite orientation.
Dragging from the finish of A to the start of B means B depends on A and stores B→A.
Selecting an incoming target in the dependency picker stores selected→target.
Selecting an outgoing target stores target→selected.
Example: Publish release depends on Review draft means Publish→Review.
Website must show Resurect under Needed by; Resurect must show Website under Waits for.

#### 8.2 Native authority and deduplication

A Deck card's native `dependentCards` selection is interpreted as its prerequisites.
The normalized `nativeDependencies` field is canonical when present, even when it is an empty array.
Historical alternate field names must not reverse that meaning.
Native dependency edges are synthesized into the common graph and deduplicated by type/from/to.
Native edges take precedence over identical planner metadata edges.
A card-to-card dependency must be created/deleted in native Deck and reflected after readback.
Do not silently substitute a planner-only relation if native Deck dependency mutation fails.
Cross-source task/card dependency relationships use custom metadata where no supported native cross-source representation exists.
Ordinary associations and references do not imply dependency, work scheduling or completion.
A native attachment-derived note reference is not a second dependency edge.

#### 8.3 Graph guards

Both dependency endpoints must resolve to currently available task/card records.
Reject missing IDs, unsupported relationship types, self-links and exact same-type same-direction duplicates.
Reject non-work dependency endpoints; events/notes require an appropriate association/reference type.
To test a proposed dependent→prerequisite edge, traverse existing depends_on edges from the proposed prerequisite.
If traversal reaches the proposed dependent, adding the edge creates a cycle and is rejected.
Traversal must track visited IDs to terminate even when existing imported data is cyclic.
For reference/general associations, the picker treats reverse-direction copies as Already linked.
Dependencies preserve direction: the reverse dependency is not an equivalent association and normally fails the cycle guard.
Revalidate target and native write eligibility at submission; a previously opened picker is not proof permissions remain unchanged.
Native dependency writes first read the dependent card and validate its native identity, current stack, active state and edit permission.
The prerequisite card need only be readable; write permission is required on the dependent card being changed.
The native dependentCards array must be available or the operation is unsupported.
If the requested add/remove already holds, return the read result without another mutation.
Use the native ETag condition when supplied, then verify the response or read back to confirm the specific relation.
An ETag is not mandatory for this dedicated Deck endpoint in the current implementation; do not imply full conditional-write coverage when none was supplied.
Avoid rewriting unrelated dependency selections when adding/removing one link.
If the native write/readback cannot confirm the intended result, report failure rather than a false saved state.

#### 8.4 Connector geometry and blocked state

Dependency paths leave the prerequisite's right/end edge and approach the dependent's left/start edge.
When the target is at least two clearance widths to the right, use a centered orthogonal bend.
For overlapping/backward dates, route the return segment through a row gutter instead of crossing row centers.
Reference geometry uses clearance 18 and rounded corners up to 7, reduced for short segments.
Both endpoints remain exact at item edges; connectors are not center-to-center straight lines.
Dependencies remain visible outside hover, subject to visible rows and clipping.
Linked work hidden by filters is not silently brought into the data set; surface missing/hidden context honestly.
Current blocked status is derived only for open selected work with a loaded incomplete work prerequisite.
**Current limitation requiring deliberate future change:** CANCELLED prerequisites still block because `completed` is false.
Completing a prerequisite does not auto-complete dependents, change their statuses or reschedule them.
Creating a dependency does not force dates into a consistent order or automatically resolve backward ranges.

### FLOW-09. Optimistic native edits, draft protection and background adoption

#### 9.1 Per-record edit state machine

| State | Trigger | Visible result / next state |
|---|---|---|
| Acknowledged | User edits a supported field | Apply patch immediately; enqueue record-local operation |
| Pending | Another edit to same record | Apply later patch over current visible result; append to same queue |
| Pending | Edit to another record | Independent queue; keep other work usable |
| Pending | First operation acknowledged | Replace acknowledged base, remove operation, reapply later queued patches |
| Pending | Operation fails | Restore last acknowledged base; preserve failed and later patches for retry |
| Failed | Retry | Re-enqueue preserved operations in order using current acknowledged native state |
| Failed | Explicit discard | Remove preserved failed operations; keep acknowledged record |

Only the acknowledged record is reconciled after a native edit, not the whole stale application snapshot.
A save acknowledgement must return the expected canonical record identity; missing/wrong identity is a failure.
Later same-record operations receive the latest acknowledged record/ETag, not the ETag captured before earlier saves.
Native edits must not erase another record's pending edit or newer custom metadata.
Protected record IDs include pending and failed edits.
When identities are remapped, keep the queue connected to the original logical record until operations drain.
Do not allow an unrelated new field edit to silently discard an earlier failed edit on the same record.
A replacement of the same failed draft fields may be accepted by an explicit editor retry path.
Ordinary optimistic native edit queues are in-memory; they are not durable offline outboxes.
The application warns before closing with pending/failed native operations or unsaved drafts.

#### 9.2 Metadata persistence and operation guards

Custom metadata is accepted locally and saved durably before a later cloud upload.
Local metadata-save failure retains the user's current draft and offers Retry save/export recovery.
Operations requiring a coherent metadata baseline wait for local save completion and pending native edits.
Failed source edits must be retried or explicitly discarded before incompatible planner operations proceed.
Inline appearance and note-tag edits flush before selection replacement or dependent operations.
Resource/attachment writes in progress can prevent conflicting inspector actions until their operation completes.
The distinction between local durable save, pending upload and confirmed cloud sync must remain visible.
Do not report a native item as unsaved merely because a separate project membership upload is pending.
Do not report all changes synced when source data is stale or a failed native edit remains unresolved.

#### 9.3 Draft/navigation behavior

An inspector draft has an explicit baseline; dirty means edited values differ from that baseline.
Changing selected record flushes inline edits, then asks before discarding dirty description/note content.
Closing the inspector uses the same protection.
Opening a linked record may preserve a back stack; back skips records that no longer exist.
Changing scope/layout need not discard an open item draft; deletion of its former scope keeps the draft available.
Dirty creation, scheduling, date, relation, mapping and organization dialogs require protected close/discard behavior.
Account switch/login/disconnect must handle dirty forms and pending/failed writes before changing account context.
Do not apply late account-A responses to account B.
Notes have additional conflict review behavior specified in the notes fragment; general Retry must not overwrite a changed server note blindly.

#### 9.4 Background state merge

Capture the before-request snapshot, then compare it with current local state when the response arrives.
Ignore a response for a different canonical account.
Ignore a response with a lower revision than current state.
Resolve identity aliases and deduplicate old/canonical records before merging.
For unchanged local records, adopt refreshed native values.
For records edited since the request began or explicitly protected, retain current local values while adopting other records.
Retain locally created/edited records absent from a response that began before those edits.
Confirmed source/collection permission revocation overrides draft retention and removes inaccessible records from visible cache.
Merge custom metadata with its baseline rather than replacing it wholesale.
If metadata changes overlap, keep local values and expose conflict state; do not silently choose remote values.
If identity remapping would disrupt an active dirty form, defer adoption until the draft is saved/discarded.
Unchanged data branches should retain stable identities so timestamps alone do not trigger full expensive view recomputation.
Selection/hover should only change highlighting and details, not repeat timeline packing or parse every description.

#### 9.5 Background refresh triggers and timing

Load cached state first, then request a native refresh when connected at startup.
Check custom metadata and native sources every 60,000 ms while connected and network-online.
On return to visible focus, check when there has been no successful session refresh or it is older than 30,000 ms.
On network-online transition, trigger a check.
Debounce custom metadata sync by 1,200 ms after changes/relevant revisions.
Do not overlap a custom sync with another custom sync or a native refresh with another native refresh.
Native refresh can run while an item draft is open; background adoption protects that draft.
Custom sync is deferred during exclusive operations, creation, login, local saving, pending native saves, most open dialogs, active content editing, dirty inspectors or unresolved save/source failures.
Automatic custom sync does not repeatedly attempt an unresolved metadata conflict; explicit user resolution/manual retry is needed.
If local mutations occur during a sync or storage remains pending, schedule another debounced attempt.
Manual source refresh reports partial source failures; automatic refresh records stale/error state without repeatedly interrupting work.
Recovery-only account mode must not attempt normal custom metadata sync.
These are best-effort foreground-client timers, not guarantees of background service execution while a device suspends the application.

#### 9.6 Unified cloud indicator state machine

Evaluate states in this precedence order:

| Priority | Condition | State / user meaning |
|---:|---|---|
| 1 | Not connected or network offline | offline; showing saved data |
| 2 | Refresh/sync/native save/resource/link work active | syncing; continue working where operations allow |
| 3 | Failed native edit, metadata save failure, sync error/conflict or native-note sync error | error; needs attention |
| 4 | Sources stale by conditions below | stale; cached data may be outdated |
| 5 | Local save active or storage not confirmed synced | pending; changes waiting to sync |
| 6 | None of the above | synced; acknowledged metadata and fresh source state |

Sources are stale when background adoption is deferred, native refresh failed, a source reports error, or no source refresh succeeded in this session.
They are also stale after 125,000 ms since the last successful source refresh.
Source metadataStale, or an unavailable source with retained cached records, also makes the source set stale.
The indicator tooltip reports last successful source refresh and relevant stale attachment/tag explanations.
Show a tick/confirmed visual only for synced, a motion indicator for active work, and distinct offline/stale/error states.
A sync timestamp alone must not freeze or repaint the entire view.
Reference transient success notifications dismiss after 4,500 ms; durable errors must remain actionable beyond a toast.

### FLOW-10. Explicit current limits and parity boundaries

- No automatic task/card date cascade through dependencies.
- No multi-item group drag transaction.
- Standalone Calendar horizontal scrolling does not yet pan to an adjacent week at the overflow edge, unlike timeline/Overview date panning.
- No inferred semantic equivalence of custom Deck stack names.
- No global ownership of a source by a Space.
- No durable offline queue for ordinary native field edits or ordinary native creation.
- Durable booking recovery is account-local, not a cross-device distributed transaction.
- Recurrence and invitation edits must be performed in Nextcloud through ordinary supported external opening.
- Calendar coverage, availability and matching use loaded accessible data rather than complete server-wide knowledge.
- Cancelling a prerequisite does not unblock a dependent under the current completed-only predicate.
- Missing prerequisite records do not count as blockers, although the relationship may still exist.
- Personal planning Done is not native completion and must be explained as such.
- Attention Undated and Calendar Not scheduled currently use different predicates.
- Board submode and per-scope date viewport are not guaranteed to sync or survive restart; saved definitions and mappings are shared.
- Ordinary Deck reopen-plus-stack moves are sequential native writes, not an atomic transaction.
- General creation can succeed natively while project membership persistence fails; retries must target metadata only.
- A malformed booking journal blocks new scheduling rather than silently discarding protection against duplicate creation.

### Evidence index and acceptance coverage

Evidence paths below are repository-relative references; these are implementation pointers, not platform requirements.
Tests are evidence of covered cases, not a claim that they were rerun during documentation extraction.

| Behavior | Source evidence | Regression evidence |
|---|---|---|
| Scope membership, assignment, counts, closed predicate | `packages/core/src/planner.mjs` | `tests/planner.test.mjs`, `tests/done-visibility.test.mjs`, `tests/space-context.test.mjs` |
| Scope-aware grouping and native Overview grouping | `packages/core/src/timeline.mjs` | `tests/timeline.test.mjs`, `tests/space-context.test.mjs`, `tests/spaces-overview-ui.mjs` |
| Draft organization, baseline guards, source removal | `packages/core/src/space-organization.mjs`, `packages/core/src/source-groups.mjs` | `tests/space-organization.test.mjs`, `tests/space-organization-sync.test.mjs`, `tests/space-editor-ui.mjs` |
| Device-local bounded scope snapshots | `packages/core/src/scope-preferences.mjs` | `tests/scope-preferences.test.mjs`, `tests/space-context.test.mjs` |
| Native task status/progress and mapping keys | `packages/core/src/status-mapping.mjs` | `tests/status-mapping.test.mjs`, `tests/status-inspector-ui.mjs` |
| Unified-board reverse mapping and ambiguous move confirmation | `packages/ui/src/PlannerBoard.vue`, `packages/ui/src/App.vue` | `tests/status-mapping-ui.mjs`, `tests/status-mapping.test.mjs` |
| DATE/event/work conversion, type switching | `packages/core/src/creation-dates.mjs` | `tests/creation-dates.test.mjs`, `tests/creation-form-ui.mjs` |
| Existing-item blank dates, removal, miniature date planning | `packages/core/src/record-date-editor.mjs`, `packages/ui/src/RecordDatesEditor.vue` | `tests/record-date-editor.test.mjs`, `tests/record-dates-ui.mjs` |
| Selection bounds and snap rules | `packages/core/src/range-selection.mjs` | `tests/range-selection.test.mjs`, `tests/range-creation-ui.mjs` |
| Timeline move/resize and range zoom | `packages/core/src/timeline-edit.mjs`, `packages/ui/src/PlannerTimeline.vue` | `tests/timeline-edit.test.mjs`, `tests/timeline-manipulation-ui.mjs`, `tests/time-scale-ui.mjs` |
| Calendar move/DST/duration | `packages/core/src/calendar-edit.mjs`, `packages/ui/src/PlannerCalendar.vue` | `tests/calendar-edit.test.mjs`, `tests/calendar-move-ui.mjs` |
| Multi-day projection, lane layout, native/plan deduplication | `packages/core/src/calendar-items.mjs` | `tests/calendar-items.test.mjs`, `tests/calendar-work-ui.mjs` |
| Shared Overview axis, scroll and resize | `packages/ui/src/OverviewSplit.vue` | `tests/overview-split-ui.mjs`, `tests/overview-interactions-ui.mjs` |
| Trackpad intent and accumulated date navigation | `packages/core/src/date-wheel.mjs` | `tests/date-wheel.test.mjs`, `tests/touchpad-ui.mjs` |
| Dependency direction, graph checks, picker intent | `packages/core/src/planner.mjs`, `packages/core/src/relation-picker.mjs`, `packages/core/src/deck-dependencies.mjs` | `tests/deck-dependencies.test.mjs`, `tests/relation-picker.test.mjs`, `tests/native-dependencies-ui.mjs` |
| Persistent finish-to-start path routing | `packages/core/src/timeline-link.mjs` | `tests/timeline-link.test.mjs`, `tests/timeline-links-ui.mjs` |
| Creation context and partial-success messaging | `packages/ui/src/App.vue`, `packages/ui/src/CreateItemForm.vue` | `tests/context-creation.test.mjs`, `tests/range-creation-ui.mjs`, `tests/audit-regressions-ui.mjs` |
| Booking projection, default calendar and conflict interval | `packages/core/src/scheduling.mjs` | `tests/scheduling.test.mjs`, `tests/scheduling-ui.mjs`, `tests/scheduling-week-ui.mjs` |
| Durable scheduling journal and idempotent recovery | `win/electron/scheduling.cjs`, `packages/nextcloud/src/nextcloud.mjs` | `tests/calendar-scheduler.test.mjs`, `tests/nextcloud.test.mjs` |
| Recurrence/DST/native preserved fields and write limitations | `packages/nextcloud/src/nextcloud.mjs` | `tests/nextcloud.test.mjs`, `tests/mobile-dav.test.mjs` |
| Per-record optimistic save queues | `packages/core/src/record-edits.mjs` | `tests/record-edits.test.mjs`, `tests/instant-edits-ui.mjs`, `tests/fast-source-edits.test.mjs` |
| Background identity merge and permission revocation | `packages/core/src/background-state.mjs`, `packages/ui/src/App.vue` | `tests/background-state.test.mjs`, `tests/background-interactions-ui.mjs` |
| Timers, refresh indicators and protected drafts | `packages/ui/src/App.vue` | `tests/automatic-sync-ui.mjs`, `tests/background-sync.test.mjs`, `tests/ui-navigation.mjs`, `tests/audit-regressions-ui.mjs` |
| Interaction responsiveness | `packages/ui/src/App.vue`, timeline/calendar projections | `tests/view-performance-ui.mjs`, `tests/background-performance.mjs` |



## C. Native content and interoperability

This part records behavior verified against the repository on 2026-11-11.
It is intended for incorporation into the shared behavior specification.
It describes observed behavior, including limits, rather than promising capabilities not present in the source.
Identifiers used in examples are illustrative, not account data.
Implementation and test paths at the end are evidence pointers, not requirements to use a particular framework.

### 1. Ownership and identity

Native Nextcloud applications own every field and relationship for which this application has an equivalent supported native operation.
The planner metadata store owns additional organization and relationships that native applications cannot represent through the implemented integrations.
Do not save an application-only copy and claim a native operation succeeded.
Do not create shadow Tasks for description checklist entries.

| Information | Authoritative representation | Required result |
| --- | --- | --- |
| Event title, description, dates, item color, categories | CalDAV `VEVENT` | Changes are visible in Nextcloud Calendar |
| Task title, description, dates, status, progress, completion, item color, categories | CalDAV `VTODO` | Changes are visible in Nextcloud Tasks |
| Card title, description, dates, stack, completion, item color | Deck card | Changes are visible in Deck |
| Card-to-card dependency | Deck `dependentCards` | Both clients derive the same dependency direction |
| Card labels and label colors | Board-owned Deck labels | Native label identity is retained |
| Note title, text, category | Notes API and its underlying file | The original note is edited, not copied |
| Note tags | Files system tags on the note file | Native Files tag IDs and assignment permissions apply |
| Note/file attached to a card | Native Files-to-Deck share/attachment | Board members can read the original file through Deck |
| Note associated with a task or event | Planner `reference` relation | Synced custom relationship, original note content stays native |
| Collective page associated with work | Planner `reference` relation | Page stays in Collectives; no editable copy is created |
| Task/card linked to a calendar booking | Planner `scheduled_during` or supported event relation | Dates and source content remain independent |
| Task-to-task or mixed task/card dependency | Planner `depends_on` relation | No unsupported native API is invented |
| Task tag display colors | Planner property map | Category names remain native; colors sync as custom metadata |
| Related resources | Server recommendations | Read-only recommendations; never automatically stored as dependencies |

Native IDs are scoped by account and source in the application identity layer.
A Deck card ID is a positive native integer; its board and stack are current locators, not its immutable identity.
A note's Notes ID is its underlying Files ID; rename and category change do not change that identity.
A note must not be located by its visible title when attaching it to a card.
Tasks and events carry CalDAV UID plus collection and, for occurrences, recurrence identity.
CalDAV href is a current resource locator and may change independently of the logical record identity.
Source colors, item colors, tag colors, and mapped status colors are separate concepts.

When native-write capability and Phase 2 authorization are present, existing planner card-to-note `reference`/`related` edges, in either direction, are automatically converted to native attachments. Phase 1 preserves existing links and retry intent but MUST NOT run native attachment or dependency conversion, including from login/refresh/synchronization hooks.
The conversion attaches the original file, verifies the native result, and only then removes the matching custom relation.
Conversion is an internal retryable operation, not an additional permanent user-facing link type.
Failure must not display an attachment as successfully native.
Unrelated relations and concurrent planner edits are preserved during conversion.
Planner deletion tombstones sync removal of the superseded custom copies.
Existing native attachments are reused rather than duplicated.
Existing directed planner card-to-card dependencies similarly remain retry intent until Deck acknowledges the native dependency.
Neither conversion deletes the original note or card.

### 2. Integration envelope and error contract

All paths below are relative to the configured Nextcloud installation URL, which may contain an installation subpath.
Construct URLs by encoding path components; never concatenate an untrusted title or filename into an authenticated URL.
Authenticated requests must remain on the configured origin.
Credentials embedded in returned URLs, off-origin URLs, and fragments in authenticated request targets are rejected.
Redirects are not followed automatically with account credentials.
A redirect prompts use of the final server URL rather than silently changing the account endpoint.
HTTPS is required, except HTTP on `localhost`, `127.0.0.1`, or `[::1]`.
The configured URL cannot contain username, password, query, or fragment.

The current connector request deadline is 25 seconds, including response-body consumption.
The default response-body bound is 24 MiB; individual operations use smaller limits listed below.
Enforce the limit while streaming, not only after allocating the full response.
Malformed JSON and non-JSON success pages produce a format error.
OCS responses require `ocs.meta.statuscode` equal to 100 or 200 as well as a successful HTTP envelope.
DAV XML rejects `DOCTYPE`, `ENTITY`, invalid XML, and a missing `multistatus` root.
An empty DAV `multistatus` is a valid empty result.
Only successful DAV property blocks contribute values; access-denied property blocks remain permission evidence.

| Failure | Error code | Behavior |
| --- | --- | --- |
| Invalid local input | `VALIDATION` | Explain the invalid field; do not write |
| HTTP 401 | `AUTH` | Require valid sign-in; do not claim an empty successful source |
| HTTP 403 | `PERMISSION` | Respect denied access; preserve unsaved draft |
| HTTP 409 or 412 | `CONFLICT` | Preserve server copy and local retry/review intent |
| HTTP 404, 405, or 501 | `UNAVAILABLE` | Treat missing app/API capability explicitly |
| HTTP 507 | `STORAGE` | Report insufficient server storage; retain user input |
| Other unsuccessful HTTP status | `NEXTCLOUD` | Show failure; do not claim sync/save success |
| Invalid server representation | `FORMAT` | Stop unsafe normalization/write recovery |
| Unsafe target/path | `SECURITY` | Block before an authenticated request |
| Request timeout or network/certificate failure | `NETWORK` | Keep cached data and retry intent |
| Response/pagination/expansion bound exceeded | `LIMIT` | Report incomplete/unavailable data, not an authoritative empty list |
| Unsupported/unrepresentable timezone | `TIMEZONE` | Direct editing of the affected item to Nextcloud |

Operations that may have succeeded before a readback failed must explicitly say so.
Do not encourage a duplicate create after a known successful native create.
Do not describe a multi-request partial write as rolled back when the server may already contain some changes.

### 3. CalDAV discovery, normalization, and native updates

#### 3.1 Discovery and read representation

Discover the principal using `PROPFIND remote.php/dav/`, Depth 0, requesting `DAV:current-user-principal`.
Discover its calendar home using Depth 0 and `calendar-home-set` on the returned principal URL.
Discover collections using Depth 1 on the home URL.
Request display name, resource type, supported components, privileges, and Apple calendar color.
Only calendar resources become calendar/task collections.
Write permission requires at least `all`, `write`, or `write-content` privilege.
An absent write privilege is read-only, not an optimistic assumption of access.
Ignore app-generated Deck calendar collections whose path matches `app-generated--deck--...`.
Ignore task UIDs beginning `deck-card-` or `deck-stack-` to avoid showing Deck exports as independent tasks.

Preserve the original iCalendar resource for mutation so unknown/unrelated properties survive edits.
Map `SUMMARY` to title and `DESCRIPTION` to body.
Map `DTSTART` to start; task `DUE` to due; event `DTEND` or derived duration to end.
Date-only values remain `YYYY-MM-DD`; they are not converted to UTC midnight.
Date-time values become explicit instants for application use.
All-day event end is exclusive.
Map all `CATEGORIES` property values to tag names, respecting iCalendar escaping.
Map `COLOR` to item color; collection calendar color remains the source color.
An event is busy unless `TRANSP` equals `TRANSPARENT`, case-insensitively.
Cancelled events are not emitted as ordinary visible event records by the calendar parser.
For Tasks, `COMPLETED` property presence or `STATUS:COMPLETED` means completed.
`PERCENT-COMPLETE:100` alone does not mean completed.
`CANCELLED` remains a distinct native state.

Recurrence is displayed by expanding masters and applying matching exceptions.
Detached exceptions and moved exceptions are included, even if the original occurrence lies outside the display window.
Occurrences have recurrence identity and are read-only here.
The expansion limit is 20,000 iterations per master; exceeding it is an explicit limit failure.
The reader may stop at the requested upper bound when no range exceptions require further scanning.
Unsupported IANA zones fail explicitly rather than silently interpreting the item in the device zone.
When embedded zone data is absent, IANA zone rules supply offsets.
Ambiguous local times select the first occurrence; nonexistent local times use the offset before the gap.

#### 3.2 Edit eligibility and preservation

Ordinary editable resources require a writable source, known version, raw iCalendar data, matching UID, and no recurrence-instance locator.
A task/event resource is complex and not editable here if it contains multiple components of the same relevant kind, `METHOD`, or any of `RRULE`, `RDATE`, `EXDATE`, `RECURRENCE-ID`, `ORGANIZER`, `ATTENDEE`.
The interface must offer opening the native item rather than pretend all recurring/invited resources are supported.
All normal updates use a conditional `PUT` to the resource href with `Content-Type: text/calendar; charset=utf-8` and `If-Match`.
Conflicts never cause an unconditional retry.
An explicit edit ETag that differs from the current cached record is rejected before writing.
Wildcard, missing, malformed, or unsafe version identifiers cannot justify overwriting a native object.
Do not convert a weak DAV validator to a strong one by stripping `W/`.

Each ordinary mutation updates `LAST-MODIFIED` and `DTSTAMP` to the current instant and increments `SEQUENCE`.
Description updates replace only `DESCRIPTION` and the revision metadata.
An empty description removes the description property.
Description input must be a string of at most 500,000 characters and must not contain NUL.
Appearance changes replace only requested `COLOR` and/or `CATEGORIES`, plus revision metadata.
Unrequested fields, alarms, custom properties, and other content remain intact.

#### 3.3 Date mutations

Application operation:

```json
{"id":"record-id","start":"2026-11-12T08:00:00Z","due":"2026-11-14T17:00:00Z","etag":"\"version\""}
```

For tasks/cards use `start` and `due`; for events use `start`, `end`, and optional `allDay`.
An omitted bound is unchanged; an explicitly empty bound clears it where permitted.
At least one bound must be supplied.
Bound strings are limited to 80 characters.
An event must not receive `due`; a task/card must not receive `end` or `allDay`.
Date-time input requires a date, hour/minute, optional seconds/fraction, and explicit `Z` or numeric offset.
Invalid normalized dates such as February 30 or 24:00 must be rejected for date-edit operations.
Where both bounds exist, types must match and finish must be strictly later than start.
Tasks/cards may have neither, one, or both bounds.
Events need a start and a valid ending interpretation; an explicitly cleared event end is invalid.
If an unchanged event has no explicit end, derive it from `DURATION`, or one day for a date-only start.
The specific native zero-duration event case with no original end/duration may remain zero-duration when no finish is edited.
Changing the finish removes `DURATION` to prevent contradictory endings.
A task with `DURATION` cannot lose its required compatible start unless its due date is explicitly handled.

Date edits preserve the original timezone/floating-time representation where possible.
An unchanged instant retains the original property.
Changing date type clears obsolete timezone/value parameters.
If an instant cannot be represented unambiguously in the original zone, fail with a timezone explanation rather than write a different instant.
Do not silently auto-adjust dependencies, linked bookings, or other records when one record changes dates.

#### 3.4 Creation and readback

Create tasks as a new `VCALENDAR` containing one `VTODO`, UUID UID, trimmed summary, optional description/start/due, `STATUS:NEEDS-ACTION`, and timestamp.
Create events as a new `VCALENDAR` containing one `VEVENT`, UID, summary, optional description, start, exclusive end, and timestamp.
Use `PUT {collectionHref}/{uid}.ics` with `If-None-Match: *`.
Creation destinations must be writable and of the correct source kind.
Titles must be nonempty after trimming and at most 500 characters at the application operation boundary.
Description must be a string of at most 500,000 characters; title and description cannot contain NUL.
Date strings are bounded to 80 characters at the operation boundary.
The lower-level transport alone does not enforce every boundary length; all clients must retain the complete application-level validation, not only copy the transport calls.

Scheduling requests with an explicit UUID derive UID `nextspace-{lowercaseRequestId}` and store `X-NEXTSPACE-REQUEST`.
For such a request, HTTP 412 means read the existing resource, verify UID and request marker, and reuse it.
Do not overwrite a mismatched or cancelled resource or infer identity from title.
This is idempotence for the same scheduling request, not global duplicate detection.
Ordinary creates without a request ID do not have the same durable retry guarantee.

Use a successful write representation directly where sufficient.
If it lacks resource body/version, fetch only the affected resource, not every source.
Readback must identify exactly one matching UID for an ordinary edited resource.
If a create succeeded but readback fails, retain the returned identity, show a creation warning, and make the provisional record read-only until refreshed.

### 4. Deck native cards and dependency semantics

#### 4.1 Deck reads and edit snapshot

Read boards with `GET index.php/apps/deck/api/v1.0/boards?details=true`.
For each nondeleted, nonarchived board read `GET .../boards/{boardId}/stacks`.
Only nondeleted stacks and nondeleted, nonarchived cards are normalized.
Board edit permission must be explicitly true for general editing.
A card-level explicit denial also makes the card read-only.
Keep board color, board-owned labels, current stack ID/title, card color, completion, and native dependency IDs separate.
If one board fails, other boards may still load; report partial failure.
An explicit permission revocation removes the affected collection rather than treating an old cache as authorized current data.

Before a general native card mutation, GET the current card at:

```text
index.php/apps/deck/api/v1.0/boards/{boardId}/stacks/{stackId}/cards/{cardId}
```

Require matching card and stack identity, a nonarchived/nondeleted card, and no current permission denial.
Compare the current card to the saved snapshot for `title`, `description`, `type`, `order`, `duedate`, `startdate`, `done`, `color`, and `lastModified`.
Treat missing/null equivalently for this comparison.
A changed snapshot is a conflict; refresh before editing rather than overwrite known stale fields.
Deck does not provide a documented universally atomic card-update If-Match guarantee in this implementation.
The freshness check plus an ETag where available reduces known stale writes; it does not guarantee freedom from every race between GET and PUT.

General card updates preserve unedited title/type/owner/description/order/start/due/archived/done/color from the fresh snapshot.
Resolve owner from a string, `owner.uid`, or `owner.primaryKey`.
Missing owner/title/type/integer order is a format failure, not permission to guess.
Native write responses must confirm the changed values; otherwise report unconfirmed success and require refresh.

#### 4.2 Dependency direction is normative

For an edge `{type:"depends_on", fromId:A, toId:B}`, **A waits for B**.
`fromId` is the dependent item; `toId` is its prerequisite.
Deck's field named `dependentCards` lists the selected prerequisites of its owner in the currently integrated API/UI.
Do not reverse it based on the English field name.

Example:

```json
{"type":"depends_on","fromId":"houdini-card","toId":"website-card"}
```

The Houdini card displays Website under **Waits for / Incoming**.
The Website card displays Houdini under **Needed by / Outgoing**.
Incoming/outgoing are user-facing work-flow labels; storage orientation remains dependent-to-prerequisite.
Both directions are displayed at once when an item has both.
Dependency content precedes the description in the detail view.
Where space allows, incoming and outgoing use separate adjacent areas; narrow presentation may stack them without changing meaning.

The logical mutation is:

```json
{"fromId":"dependent-card-id","toId":"prerequisite-card-id","remove":false}
```

Resolve both records; both must be loaded Deck cards with valid native locators.
The dependent/owner card must be writable; the prerequisite need not be writable merely to be referenced.
Reject self-links, including aliases resolving to the same native card ID.
Common relation validation rejects duplicate dependencies and cycles in the loaded dependency graph.
Do not fabricate a custom fallback if native dependency support is absent or a native write fails.
Two Deck cards linked through the generic relation flow must use dependency semantics, not a second generic card-link kind.

Native mutation:

```text
POST   .../cards/{dependentId}/dependentCards/{prerequisiteId}
DELETE .../cards/{dependentId}/dependentCards/{prerequisiteId}
```

These requests have no synthesized card replacement payload.
GET the owner first and require matching owner/stack identity and current permissions.
Require an actual `dependentCards` array; absent support produces `UNAVAILABLE`.
If the requested add/remove is already true, return the current card without another write.
Use an available owner ETag on the dedicated mutation.
Accept a matching returned card; otherwise GET the owner once to verify.
If verification still differs, report the change unconfirmed and allow safe retry.
This makes retry after a lost response idempotent without comparing or rewriting unrelated description fields.

| Dependency state | Trigger | Next state/result |
| --- | --- | --- |
| Absent | Add a valid pair | Native write pending |
| Already present | Retry add | Confirmed present, no duplicate write |
| Present | Remove | Native delete pending |
| Already absent | Retry remove | Confirmed absent, no duplicate write |
| Pending | Native acknowledgement/readback matches | Confirmed desired state |
| Pending | Capability/permission/network/readback failure | Failed retry intent; no fake saved custom edge |
| Any | Self/cycle/duplicate-invalid input | Validation explanation, no mutation |

Dates and completion do not cascade automatically along dependencies.
A linked prerequisite completing does not itself complete the dependent card.
Timeline connectors represent prerequisite finish to dependent start; this is a visual interpretation of the same stored orientation.

#### 4.3 Native creation, completion, and stack movement

Create a card using `POST .../boards/{boardId}/stacks/{stackId}/cards` with:

```json
{"title":"Prepare render","type":"plain","order":99999,"description":"- [ ] Check output","startdate":"2026-11-12T08:00:00.000Z","duedate":"2026-11-13T17:00:00.000Z","users":[{"id":"current-user-id","type":0}]}
```

`users` is empty unless the user chooses assignment to self.
Stack ID must belong to the selected writable board.
Trimmed card title must contain 1–255 characters; the application boundary also bounds the untrimmed title to 255 characters and rejects NUL.
Card description is at most 500,000 characters without NUL at the operation boundary.
Date-only card creation input is converted to device-local 00:00 for start and 23:59 for due, then to an explicit instant.
Ordinary card date edits require explicit date-times; Deck has no CalDAV DATE value.
After creation, GET the single card to verify assignment and dates.
If the server ignores requested fields, retain the created card and warn; do not create a duplicate.

Completion sets native `done` to the current ISO timestamp, or `null` when reopening.
The `done` field must be supported; absence is capability unavailable.
Completion is independent of stack title and position.
A stack named Done is not a substitute for native completion unless an explicit mapping operation requests that transition.
Stack movement uses `PUT {cardUrl}/reorder` with `{"stackId":123,"order":99999}`.
Movement is limited to a writable stack in the same board.
It must not silently move a card between boards.

### 5. Native task status contract

| Native status | Display meaning | Progress written | Completion property |
| --- | --- | --- | --- |
| `NEEDS-ACTION` | To do | Previous valid percent capped at 99 | Remove |
| `IN-PROCESS` | In progress | Previous valid percent clamped to 1–99 | Remove |
| `COMPLETED` | Completed | 100 | Current timestamp |
| `CANCELLED` | Cancelled | Preserve previous valid percent | Remove |

An invalid/missing prior percent is treated as zero for these calculations.
Cancellation does not reset partial progress.
Reopening a previously completed task yields To do with percent capped at 99, not 100 with a contradictory noncompleted status.
The boolean completion action maps true to `COMPLETED` and false to `NEEDS-ACTION`.
Update native status, percent, completion, last-modified, timestamp, and sequence together in one conditional iCalendar write.
Only the four native statuses above are valid write targets.
Unified-board labels are presentation mappings, not new CalDAV status strings.
Task status selectors and Deck stack selectors use the mapped status color on the whole selector/pill and show colors for alternative options.

### 6. Color and tag presentation

#### 6.1 Color meanings

Normalize accepted display colors from optional-`#` 3-, 6-, or 8-digit hexadecimal values.
Expand three-digit values; discard an eight-digit alpha suffix; use lowercase `#rrggbb` internally.
Invalid colors do not reach style/native color inputs.
Write input accepts exactly six-digit `#rrggbb`, or empty string to clear an item override.
The default source fallback is `#0082c9` when neither a valid source color nor valid supplied fallback exists.

Source color is the current collection's calendar/board color.
Item color is its native override when present, otherwise source color.
The source indicator remains visible even when the item has an override.
In Board, the outer card body uses item color treatment and a leading stripe uses source color, including cards with checklists.
In Calendar, the stripe is at the visible leading edge of each rendered item segment even when its actual start predates the viewport.
In details, the item-color control is compact and precedes the title; clicking it edits directly.
Tag controls are near the top of details and are directly editable without a separate Edit button.
Clicking away commits the current color/tag selection.
A failed commit retains the draft and exposes Retry/Keep saved or equivalent explicit recovery.
Do not quietly discard failed selections when the control closes.

#### 6.2 Deck colors and labels

Appearance operation:

```json
{"id":"card-id","color":"#e24b45","tagIds":["12","23"],"etag":"known-version"}
```

Deck card native color omits `#`; clearing writes `null`.
Fresh card data must expose a `color` field to support native card-color editing.
Requested label IDs must be positive native IDs present in the current board label definitions; maximum 100.
Do not send arbitrary tag strings for a Deck card.
Check the fresh card's labels against the edit snapshot before assignment changes.
Remove labels using `PUT {cardUrl}/removeLabel` with `{"labelId":12}`.
Add labels using `PUT {cardUrl}/assignLabel` with `{"labelId":23}`.
Read back and confirm both requested color and label set.
Label assignment operations do not delete or rewrite board label definitions.
Several requests may partially succeed; failure text must say some changes may already be saved.

Create/reuse a board label by first GETting the current board, checking permissions and archive/deletion state, and matching title case-insensitively.
If no matching label exists, POST `{boardUrl}/labels` with `{"title":"Action needed","color":"e24b45"}`.
Trimmed label title is 1–100 characters and contains no U+0000–U+001F control characters.
Optional creation color must be `#rrggbb` at the application boundary; fallback is board color, then `#0082c9`.
Validate returned label identity and board identity if supplied.
Creating a label is a native side effect separate from assigning it; cancelling assignment does not delete the explicitly created label.

#### 6.3 Task and event tags/colors

Appearance operation uses names:

```json
{"id":"task-id","color":"#7f56a8","tags":["Freelance","Action needed"],"etag":"\"version\""}
```

Reject `tagIds` for CalDAV items.
Allow at most 100 tag strings, each nonempty after trimming, at most 200 characters, without U+0000–U+001F.
Trim names and remove exact duplicate names before writing.
Save categories through native `CATEGORIES`; preserve escaping through an iCalendar serializer.
An empty list removes the categories property; empty color removes `COLOR`.
A readback verifies UID, desired normalized color, and category set.
Native category names do not intrinsically supply per-category colors in this integration.
Task tag display colors use `workspace.properties['tag-colors'][JSON.stringify([collectionId,title])]`.
This scope prevents a same-named task tag in a different list from unintentionally sharing a custom color.
Native tag color, when available, takes precedence over a custom task-tag color.

#### 6.4 Notes tags, permissions, and suggestions

Notes tags are native Files system tags, not Notes category folders or a planner-only string list.
The note interface has one tagging control, labelled Tags, backed by these native assignments. It supports multiple selection, inline tag creation and linked-work suggestions through the same native save path. There must not be a second editable category field presented as another way to classify an existing note, either in the detail editor or expanded editor.
The Notes API `category` is the note's native folder location, not a tag. Existing locations remain intact and can be shown read-only as Folder. Ordinary title/content/checklist saves omit the desired `category` field and do not optimistically change it; the frozen baseline may still include category for concurrency handling. A concurrent remote folder change must survive an ordinary note save. Tag saves must never move/rename a note, write a Notes category or create a planner-only tag assignment.
Creating a note may offer a destination labelled Folder or Save in folder (including the default folder); it must not suggest linked-work names as category/folder changes. Contextual classification suggestions belong to the native tag selector. The native category API and source identities remain supported; this presentation change does not migrate notes or remove folders.
When moving between compact and expanded editing, keep one active tagging surface and preserve pending/failed tag selections and content drafts. Native tags save on click-away/Done independently of the content save; content cancellation does not roll back an acknowledged native tag change. Retain read-only/offline guards and report native tag failures without silently substituting local tags.
Expanded note editing and conflict review use an opaque outer surface as well as dense text fields: underlying note titles or controls must not show through behind the single tagging surface.
Notes `favorite` remains a separate native concept; it is not an assignable Files tag merely because a Favorite display label exists.
A normalized Files tag is `{id:string,title:string,assignable:boolean,color?:string}`.
Read only assigned tags when opening a note:

```text
PROPFIND remote.php/dav/systemtags-relations/files/{fileId}    Depth: 1
```

Request `oc:id`, `oc:display-name`, `oc:user-visible`, `oc:user-assignable`, `oc:can-assign`, and `nc:color`.
Exclude inaccessible/invalid/explicitly invisible tags.
`can-assign`, when present, takes precedence over `user-assignable`; only `true`/`1` means assignable.
Restricted assigned tags remain visible as managed and cannot be unchecked.
Omitting a restricted assigned tag from a request must still preserve its assignment.
Do not delete global tag definitions while editing note assignments.

Application operation:

```json
{"id":"note-id","tagIds":["45"],"newTags":["Freelance"]}
```

At most 100 native tag IDs and 20 new names may be submitted per save.
IDs must be positive native integers represented as strings at the application boundary.
New names are trimmed, nonempty, contain no U+0000–U+001F, and fit within 64 UTF-8 bytes.
The byte bound is not a 64-character bound; do not silently truncate Unicode names.
Existing assigned tags remain usable even if their historical names exceed current creation validation.
Before adding an unassigned known ID, GET its DAV properties and recheck assignment permission.

For a new/context name, reuse a same-named assignable current tag, then a known loaded tag after refreshing its ID/name/permission.
Otherwise POST `remote.php/dav/systemtags/` with:

```json
{"name":"Freelance","userVisible":true,"userAssignable":true}
```

Resolve the native ID from valid same-origin `Content-Location` or `Location` beneath the systemtags endpoint.
Do not send credentials to an untrusted creation Location.
If creation collides, creation is forbidden, or a successful response omits a usable Location, an assignable same-named native tag may be resolved from one catalog read per save.
This fallback catalog is never displayed as picker suggestions.
If no allowed native tag can be found/created, report permission failure.
Assign by empty-body `PUT remote.php/dav/systemtags-relations/files/{fileId}/{tagId}`.
Unassign editable removed tags by `DELETE` on the same path; already absent 404 is tolerated.
Read back the assigned set after changes.
Assignment changes are separate requests and can partially succeed; refresh/review may be required before retry.

Picker choices come from loaded record tags, Deck board label definitions, Spaces, category groupings, nonarchived projects, and the note's assigned native tags.
Deduplicate contextual names case-insensitively after trimming.
Assigned native IDs and permissions override a same-named contextual option.
Deck label IDs must never be reused as Files tag IDs.
The entire instance-wide tag catalog must not be loaded merely to open the picker.
Creation is offered inline when the search name does not already match a choice.

Suggest at most eight tags from work linked to the selected note.
Work parents include cards, tasks, and events in either direction of a displayed association.
Use parent tags and an applicable grouping/project/Space name in the current explicit view context.
Exclude names already assigned, deduplicate case-insensitively, and do not auto-apply suggestions.
My Overview must not infer a Space's grouping just because that Space exists.
A user accepting a suggestion performs the same native tag save as a manual selection.

### 7. Notes editing and conflict state machine

#### 7.1 Native representation and validation

List Notes using `GET index.php/apps/notes/api/v1/notes?chunkSize=200` and subsequent `chunkCursor` values.
Require an array result; read the next cursor from `X-Notes-Chunk-Cursor`.
Reject repeated cursors and stop after 200 pages with an explicit limit failure.
Notes API versions advertised by header take precedence over capabilities.
If an advertised version list lacks 1.2 or newer within major 1, safe editing is disabled.
A note with no ETag or explicit readonly flag is read-only.

Note category is one folder path, including nested values such as `Clients/Studio`.
The empty category displays as `Uncategorized (default)`.
Changing category changes the note's category collection representation but not its file identity.
Category is independent of multi-select Files tags.

Create with POST to the Notes collection endpoint and `{title,content,category}`.
Creation validates title at most 500 characters, content at most 500,000, and category at most 200 at the application boundary, rejecting NUL and requiring a nonempty trimmed title.
When a category collection is explicitly selected, its native category wins over a separate free category value in the request.
Update with PUT to `index.php/apps/notes/api/v1/notes/{nativeId}` and conditional version.
Review the latest note with a no-cache GET on the same item endpoint.

Application update payload:

```json
{
  "id":"application-note-id",
  "title":"Interview notes",
  "content":"## Discussion\n- [ ] Follow up",
  "category":"Freelance",
  "etag":"opaque-json-etag",
  "base":{"title":"Interview notes","content":"## Discussion","category":"Freelance"}
}
```

Update title must be a string, nonempty after trimming, and at most 500 characters before trim.
Content must be a string at most 500,000 characters.
The application boundary also rejects NUL in note title, content, category, version, and base string fields.
Optional category must be a string at most 200 characters without U+0000–U+001F.
Optional base must be an object, not an array, containing valid bounded title/content strings and optional bounded category.
The base is the saved reference when the user began editing; do not replace it with a background-refreshed record.
Do not submit `favorite`, modified timestamps, or unrelated fields in content-edit retry patches.

Notes JSON ETags are opaque and may be unquoted.
Normalize them to exactly one quoted HTTP `If-Match` validator.
Preserve a valid already quoted strong tag.
Reject weak validators, `*`, empty/malformed tags, unsafe bytes, and values longer than 1000 characters.
This special normalization applies to Notes JSON ETags, not DAV HTTP ETags.
If an explicit draft ETag differs from the current record and no matching base was supplied, fail rather than guess the reference.

#### 7.2 Conditional three-way merge

Initially PUT the desired title/content and category only if category was supplied.
If the response is not 412, use normal status handling.
On 412, the response must contain the current note: same native ID, title/content/category strings, usable ETag, and no error representation.
An invalid, incomplete, or unrelated response is a conflict requiring review, with no unsafe retry.
If the current note is now read-only, stop with a permission failure.

For each desired field compare desired `D`, original base `B`, and latest server `S`:

| Condition, in order | Merge decision |
| --- | --- |
| `D == S` | Already satisfied; omit field from retry |
| No string base for this field | Conflict; cannot infer original intent |
| `D == B` | User did not change it; retain server value |
| `S == B` | Only user changed it; include desired field |
| Otherwise | Both changed same field differently; conflict |

This is field-level merging, not paragraph/line-level text merging.
Two different concurrent body edits require explicit review even if a human might combine them.
If no retry fields remain, the desired result is already satisfied; return the latest representation without another PUT.
Otherwise retry only the safe patch against the latest version.
Use at most three PUT attempts total; repeated races terminate with a preserved-draft conflict.
Each later 412 is re-evaluated; a safe first retry does not authorize overwriting a later edit.

#### 7.3 Editing and review states

| State | Trigger | Required outcome |
| --- | --- | --- |
| Saved | Begin editing | Freeze title/content/category/version reference and create draft |
| Draft | Edit rich/source content or title | Only draft changes; native folder baseline remains intact and ordinary saves omit desired category |
| Draft | Expand/collapse editor | Same draft; no implicit save |
| Draft | Save | Optimistic projection and pending native save |
| Saving | Success | Adopt acknowledged record/version; clear saved draft |
| Saving | Failure | Restore last acknowledged record; retain draft and retry/error details |
| Failed draft | Review current note | Read latest snapshot without mutating draft or cache merely for review |
| Review | Back to draft | Original local edit remains available |
| Review | Use current note | Explicitly discard failed local edit and adopt reviewed current note |
| Review | Save my reviewed edit | Use reviewed version/base; retain latest values for fields user never changed |
| Review save | Another concurrent change | Conflict again; no unconditional overwrite |
| Any dirty state | Navigate away/disconnect/close | Unsaved-change protection applies |

Opening a linked note preserves a route back to the originally selected work item.
Returning must not silently abandon a dirty/failed note edit.
Expanded editing is an in-application roomy editor, not an independent unsynchronized copy.
Read-only/offline source state blocks native saving while keeping the user's draft available.

### 8. Markdown and checklist behavior

Descriptions and Notes support formatted editing, source editing, and preview of the same Markdown document.
Baseline rendering supports linkification and line breaks with raw HTML disabled.
Formatted tools include bold, italic, heading, bullets, numbered list, task list, quote, code block, links, tables, undo, and redo.
Disabled/read-only content must not expose mutating controls.
Changing editor mode or simply opening content must not rewrite unchanged source.
If formatted edits are undone back to the original document, preserve the original source body instead of gratuitous reserialization.

Before enabling formatted editing, check whether source can be round-tripped without semantic loss.
Compare normalized parsed tokens, treating soft/hard line breaks consistently and normalizing checklist X case and default ordered-list start.
If the editor cannot represent the same tokens, fall back to source mode with an explanation.
Known source-only cases include front matter, reference-link definitions, images, raw HTML/custom tags, footnote syntax, custom fenced directives, and double-dollar math markers.
Do not silently drop unsupported constructs to produce a cleaner looking editor.

Rendered Markdown is sanitized.
Raw image, iframe, style, form/input, video, and audio markup does not become active remote content.
Pasted rich content has media/script/style elements and URL-bearing image attributes removed before parsing, then is sanitized.
Ordinary images remain inert placeholders unless an explicitly authorized Collective-page asset operation is available.
Link creation accepts supported HTTP(S), mailto, tel, rooted relative, and fragment forms; opening is routed through the application's safe external navigation contract.
Do not use content text as executable instructions or authenticated resource targets.

#### 8.1 Checklist source mapping

Only parsed list-item paragraphs beginning `[ ]`, `[x]`, or `[X]` produce checkbox controls.
Fenced code, indented code, inline code, and non-list examples do not become actionable checkboxes.
Support nested, ordered, and blockquoted list containers.
Derive each control from the original source line and source character offset of its marker.
Validate that offset against a fresh parse before toggling.
Toggle exactly one marker character between space and lowercase `x`.
Preserve all other source bytes/characters, list markers, duplicate labels, indentation, and CRLF/CR/LF choices.
Do not identify a checkbox by label text; duplicate checklist labels are valid.
Cross-language ports must preserve the same text location even if their string indexing is not UTF-16; offsets refer to the corresponding source marker, not a guessed byte index.

Read-mode checkboxes are clickable without entering an editor when the source is writable and no conflicting content draft is active.
Saving a checkbox uses the same description/Notes native mutation and failure handling as a normal edit.
A checklist displayed beneath a Board card is a projection of that card's description.
Initially show three checklist entries with expansion for the rest.
Progress is checked-entry count divided by total count; empty lists do not become tasks.
Completing all checklist entries does not mark the parent Deck card done.
Checklist entries have no independent IDs, start/due dates, source statuses, calendar bookings, or dependency relationships.
Do not invent those capabilities when reproducing the visual nested-list design.

### 9. Notes and Files attachment flow

#### 9.1 Selection and creation

Work details have one Attach entry point for notes/files.
The attachment dialog orders tabs **Existing notes**, **Create a note**, then **Other files**.
Other files is available for Deck cards only when native Files capability is available.
The dialog explains that a native Deck attachment shares the file with board members with read access.
Collective page references remain custom associations and should not be described as native shared note files.

Existing notes includes loaded Notes and Collective pages, excluding the owner itself.
Already-associated notes/pages are ineligible and explicitly marked.
Reference membership is treated as an association in either direction.
Allow multiple selections, retaining selection across search, paging, and tab switches.
Search every entered word across title, category/collection, full loaded body, and visible tag names, case-insensitively.
Search must not be limited to the short display excerpt or first visible batch.
Show up to 50 rows initially and another 50 on request; a changed search resets visible count, not selection.
Display unlinked choices before already-linked choices, then title order.
Display excerpts from bounded source text, not an expensive complete-document render for every row.

The create tab keeps its title/text/destination-folder draft through tab changes (the native payload field is still `category`). Folder is a storage destination, not a second tag control; linked-work classification suggestions belong to the native Files tag selector.
Creating a note writes a native Note, returns it to Existing notes, and selects it for attachment.
Creating is not the same as attaching: the user may select additional notes before committing.
The user must resolve or explicitly discard a creation draft before committing other selections.
Never close with an undisclosed unsaved creation draft.
Successful note selections are removed from retry eligibility; failed selections remain.
When files are also selected, successful note linking keeps the dialog open and proceeds to files.
When files finish but note/create work remains, return to that tab instead of closing.
Global navigation and dialog close honor dirty selection/draft protection.

#### 9.2 Files browsing and native attachment

List a folder using `PROPFIND remote.php/dav/files/{username}/{encodedPath}`, Depth 1.
Request display name, resource type, content length/type, and `oc:fileid`.
Only valid positive file IDs within the authenticated user's Files root are selectable.
Folders navigate; they are not attachable files.
Sort folders first, then name; search applies to current folder names.
A folder with more than 5000 normalized entries produces a limit error.
Retain file selections across folder navigation, keyed by native file ID where present.
Late folder responses must not replace a newer navigated folder.

Paths must be strings of at most 4096 characters inside Nextcloud Files.
Reject URL schemes, backslashes, control characters, empty internal path segments, `.` and `..`.
Do not accept an arbitrary local machine path from a content/UI payload as an attachment request.
Before attaching, re-read the card to check it still exists in the expected stack and remains editable.

For a note, resolve current path by immutable file ID using `SEARCH remote.php/dav/` with `oc:fileid` equality, current user's Files scope, and a result limit of 2.
Require exactly one matching nondirectory file; a renamed/moved note remains attachable through its ID.
For an explicitly selected file path, PROPFIND that path at Depth 0 and require a file.
Read current attachments; an existing identical file ID is successful idempotent reuse.
Then create the native Files-to-Deck share:

```text
POST ocs/v2.php/apps/files_sharing/api/v1/shares?format=json
Content-Type: application/json
```

```json
{"path":"/Notes/Freelance/Interview.md","shareType":12,"shareWith":"123","permissions":1}
```

`shareWith` is the native target card ID as a string.
This is a card share, not a public link, copied note, or custom relation.
After acknowledgement, read Deck attachments and verify the file ID appears.
On a conflict, a readback that already contains the file ID is successful retry recovery.
If not confirmed, report unconfirmed attachment and require refresh/retry; do not synthesize success.

#### 9.3 Attachment read, upload, and detach

Use API v1.1 for attachments:

```text
GET index.php/apps/deck/api/v1.1/boards/{boardId}/stacks/{stackId}/cards/{cardId}/attachments
```

The older v1.0 attachment listing cannot be substituted because it filters modern file attachments.
Normalize nondeleted types `file` and `deck_file` with valid attachment IDs.
Read `extendedData.fileid`, safe path, size, MIME type, and attachment name where available.
A file-ID attachment opens through `index.php/f/{fileId}`.
A legacy attachment without file ID may open through its attachment endpoint.
Native note associations are derived from intersection of card attachment file IDs and loaded note file IDs.
Do not separately list the same attached note as both a linked note and an ordinary file row.

Upload is a native file-selection action, returning cancellation without a mutation if the user cancels.
Allow bytes up to 20 MiB with a nonempty filename containing no slash, backslash, or U+0000–U+001F.
POST multipart data to the same v1.1 attachments endpoint:

```text
type = file
data = selected filename
file = selected file bytes with selected filename
```

Recheck card permission before upload and refresh the attachment list afterward.
Do not embed arbitrary local paths in the server payload.

Detach validates a positive attachment ID, rechecks writable card, then reads current attachments.
An already-absent attachment is an idempotent success.
Only native type `file` is detached here using `DELETE {attachmentsUrl}/{attachmentId}?type=file`.
Read back and verify absence.
Detaching removes the card share; it never WebDAV-deletes the original file or note.
Legacy `deck_file` removal opens/is deferred to Deck because its deletion semantics differ.

#### 9.4 Partial success and caches

Batch selections are not a transaction.
Process selected files/notes individually, report successful count and per-item failures, and retain remaining selections for retry.
Stop when owner identity or permission is no longer valid.
Successful native attachments remain successful even if another attachment fails.
Successful note creation remains created even if its subsequent attachment fails.
Do not attempt a destructive rollback by deleting the newly created note or attached source file.

| State | Trigger | Result |
| --- | --- | --- |
| Browsing | Select notes/files | Dirty multi-selection |
| Dirty selection | Confirm | Per-item attaching progress |
| Attaching | All requested attachments confirmed | Clear resolved selections; close only if no other draft remains |
| Attaching | Some fail | Keep successes; show failures; retain unprocessed/failed selections |
| Uploading | User cancels native picker | Return unchanged to dialog |
| Uploading | Success | Refresh native attachments; retain other selected work |
| Any | Owner changes or permission revoked | Stop mutation; explain unavailable owner |

Attachment cache keys use native card ID and version composed from lastModified plus attachmentCount.
Unchanged lists may be reused for less than 120 seconds in background refresh.
Opening card details explicitly requests a fresh list.
Cards without attachment evidence do not receive an attachment request on every refresh.
Previous discovery of attachments is evidence requiring future refresh even if the current count is absent.
An explicit successful zero-attachment list may clear attachment identities; an unavailable list must not masquerade as deletion.
Use read generations/epochs so an older response cannot replace a newer attachment/tag snapshot.
If optional metadata fails, retain prior values and mark metadata stale without disabling unrelated native card/note edits.
Unchanged resource reads must not trigger a full workspace read/merge/write merely because a detail view opened.

Known note-tag metadata is refreshed in batches of four when Notes refreshes.
Unopened/unseen notes do not require one extra Files-tag request each on every source refresh.
Loaded note tags persist in the cache and can participate in later refreshes.
Consequently a previously unopened note may not display all native Files tags until its tag metadata is loaded.

### 10. Collectives and Related resources

#### 10.1 Collectives content

List Collectives through `GET ocs/v2.php/apps/collectives/api/v1.0/collectives?format=json`.
List pages at `.../collectives/{collectiveId}/pages?format=json`.
Skip trashed groups/pages and preserve composite collective/page identity.
These records are read-only; collaborative editing opens the native application.
Listing a title is not equivalent to loading page content.

On page open, request current PageInfo at `.../collectives/{collectiveId}/pages/{pageId}?format=json`.
Require matching page ID, nontrashed page, and an actual mounted `collectivePath`.
Use refreshed collectivePath/filePath/fileName to resolve renamed/moved pages and custom/emoji folder locations.
Reject unsafe path segments, backslashes/control characters, traversal, or non-Markdown filename.
Read the Markdown file from the authenticated Files root, bounded at 4 MiB.
Accept text/markdown, text/x-markdown, text/plain, application/octet-stream, or absent MIME; reject unexpected types/NUL content.
Return body plus available ETag; this does not grant write support.

Markdown and constrained literal `<img>` references may be shown as inert placeholders.
Load at most 30 page image placeholders sequentially through the authorized asset operation.
Cancel adoption of pending results when the selected page/content generation changes.
Only relative image paths within the same mounted Collective root are eligible.
Reject absolute/scheme URLs, query/fragment, credentials, encoded traversal, double-encoded path components, off-root paths, and backslashes/control characters.
Image responses are bounded at 4 MiB and must match both MIME type and magic bytes for PNG/JPEG/GIF/WebP.
SVG and arbitrary remote tracking images are not authorized by the page preview.
Unavailable image placeholders remain with an explanation and access to the native page.

#### 10.2 Related resources

Related resources is a recommendation engine based on shared access, not an API for writing explicit graph links.
For a Deck record query the board provider ID; for a note query the Files provider ID:

```text
GET ocs/v2.php/apps/related_resources/related/deck/{boardId}?format=json
GET ocs/v2.php/apps/related_resources/related/files/{noteFileId}?format=json
```

Other source kinds currently return unavailable; do not guess a Calendar provider identity.
HTTP 403/404/405/501 yields `{available:false,resources:[]}` for this optional feature.
A supported response must be an array.
Keep at most 100 entries with title and URL strings.
Accept only same-origin HTTP(S) URLs without embedded credentials.
Titles are bounded to 500 characters and subtitles to 300.
Return provider/item IDs as strings and show recommendations as links.
Do not automatically attach recommended files, modify sharing, or convert them to dependencies.
Related-resource failure is distinct from attachment failure; one does not hide a successfully loaded other section.

### 11. Find matching events: complete deterministic behavior

#### 11.1 Scope and candidate eligibility

The action is global and remains in the application-level controls rather than repeated in each layout.
It operates on **all currently loaded sources**, independent of active view, Space, project, filters, or date viewport.
It does not perform an unbounded server-wide search or claim unloaded history was scanned.
It is a review workflow, never a silent automatic link writer.
Deduplicate records by application ID before generating pairs.
Eligible work records are Tasks/tasks and Deck/cards.
Eligible events are Calendar/events with a valid start and noncancelled status.
An existing relation of any kind between the work/event in either direction excludes that pair.
An event linked to other work is still reviewable, with a warning.
One dated work item may legitimately have multiple event bookings.

#### 11.2 Title preprocessing

Normalize a title with Unicode NFKD, remove combining marks, lowercase, remove straight/curly apostrophes, replace other nonletter/nondigit runs with spaces, and collapse whitespace.
Keep both the normalized full title and a normalized core.
Remove a leading HH:MM or HH:MM–HH:MM time prefix from the core.
Remove parenthesized/bracketed notes from the core, preserving meaningful notes separately for warnings.
Remove numeric YYYY-MM-DD / YYYY/MM/DD / YYYY.MM.DD dates from the core.
Remove recognized English month-name dates, with optional year and ordinal suffix.
Month pattern is `jan(uary)`, `feb(ruary)`, `mar(ch)`, `apr(il)`, `may`, `jun(e)`, `jul(y)`, `aug(ust)`, `sep(t(ember))`, `oct(ober)`, `nov(ember)`, `dec(ember)` with the corresponding optional suffix forms in the reference algorithm.

Split core words, deduplicate them, and remove filler words:

```text
a an and n the of to for with az es egy und der die das
```

For specificity, also exclude these generic words and purely numeric words:

```text
a an and at by for from in of on or the to with my your task event work session
meeting call review admin reminder deadline todo to-do appointment preparation
planning update follow up please done start end today tomorrow within days day
week weeks month months due before after az a es és egy hogy kell napi
emlekezteto emlékeztető megbeszeles megbeszélés hatarido határidő der die das
ein eine und für fur mit von termin besprechung rappel reunion réunion
```

A title is specific only if it has at least two informative words and core length at least eight, or one informative word at least nine characters long.
Two generic titles on the same date are not a candidate.
Capture unique numeric runs of two or more digits from the core.
If both titles contain such runs and their sets differ, similarity is zero; different invoice/order numbers must not merge.
Build sets of all three-character substrings of each core for spelling-tolerant comparison.

#### 11.3 Similarity formula

If either title is nonspecific, similarity is zero.
If full titles or cores are equal, similarity is one, subject to the numeric/specificity guards.
Otherwise calculate:

```text
tokenScore = common distinct words / union of distinct words
gramScore  = 2 * common distinct trigrams / total distinct trigram counts
contains   = 0.85 when all words of the shorter title occur in the longer,
             shorter word count >= 2,
             shorter / longer word count >= 0.60,
             both core lengths >= 14; otherwise 0
distinctiveOverlap = any shared informative word with length >= 5
similarity = max(contains,
                 0.45 * tokenScore + 0.55 * gramScore,
                 distinctiveOverlap ? 0.96 * gramScore : 0)
```

The distinctive-word term permits a small typo such as Resurect/Resurrect when a distinctive other word matches.
Dates strengthen a sufficiently similar title; they cannot create similarity themselves.

#### 11.4 Date distance, thresholds, and score

Convert date-only values to validated civil-day numbers without UTC-local shifting.
For instants, use the local civil day containing the instant.
For event ends, subtract one day for a DATE value or one millisecond for an instant before deriving the occupied ending day.
This preserves exclusive event end semantics at midnight.
Work bounds use start and due, falling back to end when relevant.
When only one bound exists, use it for both ends; normalize reversed valid bounds with min/max for comparison.
With no work bounds, distance is null.
Otherwise interval distance is `max(0, workStart - eventEnd, eventStart - workEnd)` in days.

Reject similarity below 0.73.
When similarity is below 0.96, reject undated work below 0.90 or dated work more than 14 days apart.
When similarity is below 0.85, require distance exactly zero.
Exact/very strong names may still appear far apart, but with warnings and without automatic selection.

```text
dateBonus = 15 when distance == 0
         = 10 when known distance <= 3
         =  5 when known distance <= 7
         =  0 otherwise
score = round(similarity * 85 + dateBonus)
```

Include reasons describing same title, same title without notes, very similar/similar title, same day, within work dates, distance, or undated work.
Add warnings for distance over seven days, completed/cancelled work, event already linked to other work, and differing meaningful title notes.
Parenthetical notes about deadline/due/within/days/weeks/months/hatarido/ig, recognized month dates, or year-month-day are excluded from meaningful context warnings.
Meaningful note differences only trigger this specific warning when similarity is exactly one but full title/context-note lists differ.

A candidate is recommended only with no warnings and either known distance at most three days with similarity at least 0.90, or unknown work date with similarity at least 0.98.

#### 11.5 Ambiguity and review

For each event find its best score; if multiple work candidates are within 12 score points of best, mark all those competitors ambiguous and not recommended.
Warn that several work items match the event.
For an undated work item with multiple candidate events, mark all ambiguous and not recommended.
Do not disambiguate by silently preferring a Task over a Deck card or one source over another.
Sort recommended first, descending score, work title, event start, then deterministic pair ID.
Pair ID is the serialized two-element `[workId,eventId]` tuple.

The review initially selects recommended candidates only.
Ambiguous/warning candidates require deliberate selection.
Allow per-candidate selection removal/addition, clear selection, and restoration of recommended selection.
Search the candidate's work/event titles and collection titles without clearing existing choices.
Initially show 80 review rows, with additional rows on demand.
Confirmation emits selected `{fromId:workId,toId:eventId}` pairs, not arbitrary inferred dates or title changes.
Freeze the loaded records/relations as the review baseline when opening the dialog, then validate against current records/relations at confirmation time.
Deduplicate submitted pairs; skip pairs already linked with the same directed `scheduled_during` relation.
If a selected item disappeared or any proposed pair is invalid, keep the dialog open and do not apply the prepared additions.
After all pairs validate, create `scheduled_during` edges with work as fromId and event as toId, then persist the batch.
If local persistence fails, remove this attempt's newly projected edges from the current in-memory list and retain the dialog selections; a retry must use the user's current selection.
If there are no new additions because every selected pair is already linked, close with an already-linked message.
Do not modify source dates, descriptions, statuses, or existing booking content while linking.
Show created/already-linked/invalid results honestly; do not imply all proposed pairs were accepted if validation changed.

### 12. Responsiveness, mutation queues, and capability boundaries

A native edit is optimistically reflected immediately; waiting for the network must not freeze selection, scrolling, or unrelated work.
Serialize mutations per record so a later checkbox/date edit uses the acknowledged version of an earlier mutation.
Other records can continue independently.
Keep acknowledged state plus pending patches, rather than replacing the whole application with each operation's returned snapshot.
On success reconcile the edited record and replay any later pending patches.
On failure restore the last acknowledged record, retain the failed edit, and require Retry or explicit discard before a new mutation to that record.
Do not let an old background read overwrite a pending edit or newer native metadata result.
Do not let a failed edit on one item silently poison another item's changes.
The current native pending queue is in memory; it is not a promised durable offline native-operation queue.
Native write success may be followed by planner-sync pending; the indicators must distinguish those states.

Avoid all-source refresh after a single description, checkbox, tag, or date save.
Use targeted native acknowledgements/readback and structural reuse of unchanged data.
Opening an unchanged attachment picker must not reprocess the entire cache.
Search the complete loaded dataset but bound visible results and reuse derived search content.
Selection/hover must reuse precomputed relation/geometry data rather than repeatedly parse all source content.
Do not describe current rendering as fully virtualized; expanded work rows still render their loaded rows.
Performance benchmarks are evidence, not a cross-device hard latency promise.

| Capability | Supported scope | Explicit boundary |
| --- | --- | --- |
| Native ordinary event/task content and dates | Writable nonrecurring, noninvitation resources | Complex resources open in Nextcloud |
| Recurrence display | Expanded calendar instances/exceptions | No instance/series edit support claimed |
| Task status | Four standard native statuses | Custom board labels are mappings |
| Deck completion | Native done timestamp | Not inferred from stack name |
| Deck dependencies | Native owner-to-prerequisite pair | No custom fallback on failure |
| Mixed work dependencies | Synced planner relation | No fabricated Deck task ID |
| Deck notes/files | Native card shares/attachments | Source file is never deleted on detach |
| Notes save | Conditional field-level merge/review | No automatic text-line merge |
| Notes tags | Native Files system tags | Notes app may show category/favorite only |
| Collective content/assets | Authorized read preview | Editing opens native app |
| Related resources | Optional Deck-board/Files recommendations | Not a relationship storage service |
| Matching events | Review of loaded records | Not automatic linking or full-server scan |
| Native offline edits | Preserved current-session retry intent | No durable offline queue guarantee |
| Card concurrency | Fresh snapshot and best available ETag | No universal atomic race guarantee |

### 13. Acceptance scenarios

1. **Native direction:** Given Houdini waits for Website in Deck, Houdini's incoming list shows Website and Website's outgoing list shows Houdini; no reversed duplicate is created.
2. **Native dependency write:** Adding a card prerequisite issues the dedicated native operation, is visible in Deck, and survives another client's fresh read without a planner-only edge.
3. **Dependency retry:** A lost response followed by retry reads an already-present pair and succeeds without duplicate or unrelated card overwrite.
4. **Readonly prerequisite:** A writable dependent can reference a readonly prerequisite; an unwritable dependent cannot own the change.
5. **Cycle:** A proposed edge that closes a loaded dependency cycle is rejected with no native/custom write.
6. **Task completion evidence:** A task with COMPLETED property but no STATUS appears completed; percent 100 alone does not falsely complete another task.
7. **Task progress:** Moving a 40% task to In progress retains 40%; cancelling retains 40%; completing writes 100% plus timestamp; reopening removes timestamp and caps progress to 99%.
8. **Deck independence:** Moving a card to a stack titled Done does not by itself counterfeit its native done field.
9. **Source stripe:** An overridden red card from a blue board retains a blue leading stripe in Board and Calendar, including a multi-day item beginning before the visible period.
10. **Native label identity:** Selecting a same-named Deck label and a Files tag never sends one service's numeric ID to the other.
11. **Tag creation:** A missing Deck tag is created on that board; a missing task tag is a category name; a missing note tag is resolved/created as a native Files tag.
12. **Large tag catalog:** Opening a note or tag picker reads assigned tags only and offers loaded-context names rather than the entire instance catalog.
13. **Restricted tag:** A managed assigned tag remains after saving a request that omits it.
14. **Unicode tag limit:** A name over 64 UTF-8 bytes is rejected for new Files tags before write and is not truncated.
15. **ETag quoting:** An opaque Notes JSON tag is quoted exactly once for If-Match; a DAV weak ETag is never converted into a guessed strong tag.
16. **Independent note edits:** Local body edit plus remote category change merges safely, retaining the remote category and unrelated favorite value.
17. **Concurrent body edits:** Different local/remote body edits preserve both choices for explicit review, with no automatic replacement.
18. **Repeated race:** Three conditional Notes attempts do not turn into an infinite loop or unconditional final save.
19. **Review race:** Saving a reviewed draft still conflicts if the reviewed server version changes again.
20. **Draft navigation:** Expanding/collapsing the note editor and opening Back retain the draft or invoke explicit unsaved-change protection.
21. **Exact checkbox:** Toggling one of two identical labels changes only that marker; mixed newline styles, nesting, and Unicode before it stay intact.
22. **Code example:** A Markdown code example containing `- [ ]` never becomes an interactive checkbox.
23. **Unsupported Markdown:** A reference-link/front-matter/image document opens source editing without silent data loss.
24. **No fake subtasks:** Completing all Board checklist entries does not create Tasks or complete the parent card.
25. **Renamed note:** A note renamed/moved in Notes attaches using its file ID and latest path, not its old title/path.
26. **Native detach:** Removing its Deck attachment removes only the share; the original note remains readable in Notes.
27. **Legacy upload:** Attempting to remove a legacy deck_file routes to Deck rather than deleting its file contents here.
28. **Mixed selection:** One note succeeds and another fails; the success is retained and only failed/unresolved selections remain for retry.
29. **Create before attach:** A created note remains present if attachment fails; retry does not create a second note.
30. **Late response:** A slow previous attachment/tag response cannot overwrite a newer confirmed mutation.
31. **Metadata stale:** Optional attachment/tag refresh failure preserves cached links/tags and marks stale metadata rather than erasing them.
32. **Collective assets:** A local image within the mounted Collective renders; an off-server or traversing image does not receive credentials.
33. **Related resources:** A recommendation can open safely but does not silently appear as an incoming dependency or attachment.
34. **Matching specificity:** Same-day generic “Meeting” titles and different invoice IDs never create suggestions solely from dates.
35. **Reminder wording:** Different reminder/deadline parentheses around a distinctive same-day title can recommend a work/event pair.
36. **Competing sources:** Equally plausible Task and Deck-card matches for one event appear unselected with ambiguity warnings.
37. **Multiple bookings:** Several distinct bookings for one dated task can be confirmed; repeated candidates for an undated task require review.
38. **Exclusive end:** An all-day event ending on Tuesday occupies Monday for matching, not Tuesday as well.
39. **No duplicate create:** A source create followed by failed readback preserves identity and warns to refresh rather than offering an apparently failed fresh create.
40. **Immediate edit feedback:** A slow source request does not block unrelated selection/scrolling; a failed checkbox save restores acknowledged content and exposes the preserved retry edit.

### 14. Evidence and test inventory

Primary native source: `packages/nextcloud/src/nextcloud.mjs`.
Application operation shapes: `packages/contracts/src/index.ts`.
Dependency routing and validation helpers: `packages/core/src/deck-dependencies.mjs` and `packages/core/src/planner.mjs`.
Color and custom tag-color interpretation: `packages/core/src/record-presentation.mjs`.
Native task progress/status rules: `packages/core/src/status-mapping.mjs`.
Contextual tag choices: `packages/core/src/known-tags.mjs`.
Matching algorithm: `packages/core/src/event-matches.mjs`.
Markdown semantic guards and exact toggles: `packages/core/src/markdown.mjs`.
Checklist projection: `packages/core/src/board-checklist.mjs`.
Optimistic mutation/background adoption: `packages/core/src/record-edits.mjs` and `packages/core/src/background-state.mjs`.
Flow orchestration: `packages/ui/src/App.vue`.
Notes selection: `packages/ui/src/NoteLinkPicker.vue`, `NotePickerRow.vue`, `CloudFilePicker.vue`.
Native resources: `packages/ui/src/NativeResourcesPanel.vue`.
Notes tags: `packages/ui/src/NoteTagsEditor.vue`.
Markdown editing/rendering: `packages/ui/src/MarkdownEditor.vue`, `MarkdownContent.vue`, `BoardChecklist.vue`.
Match review: `packages/ui/src/EventMatchReview.vue`.
Supporting architecture: `docs/PLATFORM-ARCHITECTURE.md`. The native contracts in this specification remain authoritative.

Relevant automated verification files, to reuse or port as behavioral fixtures:

- `tests/nextcloud.test.mjs`: native request/read/update behavior and capability failures.
- `tests/portable-nextcloud.test.mjs`: portable connector contracts.
- `tests/native-dependencies-ui.mjs`: dependency direction/routing in interaction flows.
- `tests/native-note-relations.test.mjs`: deriving note links from native attachments.
- `tests/note-link-migration.test.mjs`: native conversion, acknowledgement, concurrent metadata, retry safety.
- `tests/note-save.test.mjs`: ETag quoting, field merges, conflicting bodies, bad snapshots, repeated races, readonly changes.
- `tests/note-conflict-ui.mjs`: draft/current review actions and preserved editor state.
- `tests/native-attachments.test.mjs`: stable file identity, shares, safe detach, upload, tags, paths, permissions, cache generations.
- `tests/native-appearance.test.mjs`: card/item/source colors, label assignments, CalDAV categories, status/progress.
- `tests/native-tags.test.mjs`: scoped tag reads, create/reuse, permissions, ID separation, name limits.
- `tests/known-tags.test.mjs` and `tests/known-tags-ui.mjs`: loaded-context tag catalog and direct creation.
- `tests/markdown.test.mjs`: exact marker offsets, line endings, code exclusion, semantic source fallback.
- `tests/board-checklist.test.mjs` and `tests/board-checklist-ui.mjs`: parent-description projection and interaction.
- `tests/event-matches.test.mjs` and `tests/event-matches-ui.mjs`: scores, dates, ambiguity, explicit confirmation.
- `tests/notes-native-ui.mjs` and `tests/note-components-ui.mjs`: native note/resource flows.
- `tests/note-picker-performance-ui.mjs`: bounded rows and complete search behavior.

These paths identify existing evidence; this documentation audit did not execute these tests.
Known migration handling is recorded because it currently runs, not as an invitation to invent future compatibility layers for every prototype format.
Client implementations must expose unsupported native operations honestly rather than silently changing ownership or creating a client-specific business rule.

## D. Appearance, presentation safety and navigation

### PRESENT-01. Follow the connected user's appearance

`workspace.appearance.mode` is synchronized custom metadata. Explicit `dark` or `light` wins. Otherwise use the connected Nextcloud user's explicit dark/light mode; if that is also system/unspecified, follow the device's current appearance. Device appearance changes update the selected palette without writing a new workspace preference.

The native theme cache is account-local source data, not shared planner metadata. Read theming capabilities, the user's enabled themes when necessary, and the generated light/dark palette. An enforced first theme takes precedence. High-contrast theme selection uses the corresponding high-contrast palettes. Preserve that selection as optional boolean `NextcloudTheme.highContrast` across the native theme cache and presentation boundary; accept only actual booleans. A known ordinary selection sets it false; unknown selection can omit it. This is source appearance data, not a synchronized planner setting. Never inject remote theme stylesheets as executable/unrestricted styling: extract only validated color values.

Apply the selected palette to surfaces, text, headings, muted text, borders, hover and accent surfaces. A validated palette primary/foreground pair takes precedence; otherwise use the shared accessible-accent calculation. The fallback accent input is `#0082c9`. Do not replace native source colors with a Space/group's color. Source identification and item appearance remain separate even when the main application palette changes.

For an item's displayed color, the main planner uses its normalized native item color first, then an explicit saved calendar override for its collection, then the native collection/source fallback. The source-identification stripe always retains native collection identity. Clearing a calendar override deletes that entry and resumes source fallback; it does not edit the native calendar or each item.

### PRESENT-02. Authenticated wallpaper and optional failures

Wallpaper requests remain on the account's trusted origin. Only PNG, JPEG, GIF and WebP with validated type/signature are accepted, maximum 2 MiB. The presentation boundary additionally requires a matching bounded raster data URL (under 2,800,000 characters). SVG, arbitrary remote image URLs, credentials and remote executable styles are not passed through as wallpaper.

Cache-validation compatibility detail: GIF/WebP textual signature checks currently use seven-bit ASCII decoding semantics, while PNG/JPEG checks compare their expected byte signatures. Portable extraction preserves that existing behavior; strict literal-byte GIF/WebP checking would be a separately specified correction. Do not equate this cache check with a complete image decoder.

Cache validators support conditional image reads. Missing/restricted optional theming endpoints do not fail native data synchronization. A transient theme/network failure preserves the previous usable cached theme; a confirmed removal can clear it. Changing accounts cannot retain another account's wallpaper. Cached appearance remains usable offline.

Current limitation: refresh loads the selected wallpaper image, not a guaranteed pair of light/dark wallpaper variants. Switching the device palette does not promise a second wallpaper request or automatic alternate image. Theme stylesheets are bounded to 256 KiB and the optional appearance page to 2 MiB.

Acceptance: explicit light ignores a dark device setting; Follow Nextcloud honors an explicit server dark setting; system/system follows device changes; a temporary theme failure preserves cached colors; an off-origin wallpaper never receives credentials; a clipped multi-day item retains its source stripe regardless of theme or item color.

### PRESENT-03. Focus, dismissal and detail navigation

Opening a modal retains its previous focus target and moves focus into the modal. Keyboard traversal stays within the modal; closing restores the prior target when it still exists. Escape first attempts to close the active modal, then the filter popover, then selected details, then navigation, using the existing draft-protection guards rather than discarding unsaved content.

The host search shortcut focuses planner search when no modal is active. Pointer-specific gestures may use equivalent accessible touch/keyboard actions on another host, but confirmation, cancellation, validation and persistence outcomes remain identical. Icon-only controls have descriptive accessible names and tooltips. Background save status is available without requiring the user to interpret color alone.

Selecting a different detail item resets its content scroll and invalidates old asynchronous page loads. A late response for a previously selected Collective page must not replace the current detail body. Expanded note editing shares its draft with the detail presentation; return navigation restores the linked origin item with draft protection.

Evidence: `packages/ui/src/App.vue`, `packages/ui/src/planner-ui.ts`, `packages/core/src/record-presentation.mjs`, `packages/core/src/theme-cache.mjs`, `packages/nextcloud/src/nextcloud.mjs`, `tests/appearance-ui.mjs`, `tests/inline-appearance-ui.mjs`, `tests/native-appearance.test.mjs`, `tests/workspace.test.mjs`.

### PRESENT-04. Shared glass shells and solid content surfaces

The approved NextGlance material treatment uses the connected user's validated wallpaper and current light/dark palette. The 2026-11-12 phone/tablet feedback supersedes the earlier denser-side-panel preference: use the Board's favored glass strength consistently for workspace, navigation, inspector and dialog outer shells. Centralize the shell material in shared tokens/rules rather than view-specific overrides. Preserve layout, source stripes, native item colors, tags and mapped-status colors. Do not introduce a fixed demonstration wallpaper into connected production views or replace the user's theme.

Glass surrounds information; readable content itself is opaque. Cards, calendar/timeline grids, inspector information sections, description/note editing surfaces, inputs and dialog forms/results use a solid near-black base in dark mode and a solid theme-light base in light mode. Native item-color fills are composited against that opaque base, not against the wallpaper; source stripes, tags and status colors stay distinct. Side-panel/dialog shells may be glass again, including overlays, while their actual information sections remain solid. Avoid a separate background wrapper on every line or control: apply the solid-content rule at coherent section/list/grid boundaries.

Use a small number of container-level blur layers; do not apply backdrop blur independently to each card, event, row or tag. Background content stays static while scrolling; no animated blur. Unsupported blur, requested reduced transparency, forced colors or a high-contrast theme use solid surfaces. Fallbacks preserve text, native source/item/status distinctions and focus visibility. No new synchronized setting, record field, business rule or storage migration is introduced by this material change.

Acceptance: all main views share the same outer glass strength; actual content has no wallpaper/text ghosting against bright backgrounds; phone/tablet inspector and dialog shells show glass around solid readable sections; Overview date axes and split resizing remain intact; no per-item blur is introduced; reduced-transparency/high-contrast fallbacks are solid. Windows and Android use the same small set of shared surface rules. Web implementation remains on hold.

### PRESENT-05. Host capability defaults

Host capability defaults must survive the actual presentation boundary. When omitted, `nativeConnection`, `canMutateNative`, `manualConnection` and `canExportWorkspace` default to true for the reference host; `mobileHost` defaults to false. Explicit false is preserved. Presentation-framework Boolean coercion must not turn omitted defaults into a read-only client. An operation must still exist and pass source freshness, authorization, readonly and any supplied runtime/host operation-list restrictions. Android's explicit false flags plus scoped native-operation allowlists retain their existing meaning. Integration verification must mount the real shared presentation with omitted options and also exercise explicit false; testing the pure capability helper alone does not prove this boundary.

### PRESENT-06. Touch navigation and deliberate item dragging

Timeline, standalone Calendar and both panes of Overview support touch gestures in addition to existing mouse, wheel and keyboard controls. Apply gesture handling to the planning surfaces, not the whole app: buttons, inputs, note text, menus, dialogs and system navigation retain their normal behavior. On phone-sized layouts, compact fixed item-label columns must leave a visible date plotting area available for touch navigation; retain item identification and existing desktop sizing. No touch gesture bypasses native edit/source permissions or changes date/completion semantics.

The platform-neutral gesture states are `idle`, `pending`, `pan`, `pinch`, `armed-edit` and `suppressed`. A first touch enters pending and records its position, time, hit item/handle and owning surface. Motion greater than 8 CSS pixels before arming cancels the hold and enters pan. A stationary touch on an editable item/handle arms its existing edit operation after 500 ms, with visible feedback; read-only items never arm. A second touch enters pinch and cancels any pending/armed item edit without committing. Lifting one pinch finger enters suppressed until all gesture fingers lift; the remaining finger must not start an edit or create an item. A third simultaneous touch also suppresses the gesture until all fingers lift. Pointer cancellation, lost capture, view/scope replacement and unmount discard gesture state and previews without writes.

- **Pan:** one finger moves content with the finger continuously in both axes, including diagonal movement. Vertical movement scrolls the touched row/hour viewport; horizontal movement scrolls dates by pixels without snapping to whole weeks or days. Keep the visible range separate from a bounded rendered date buffer: render one visible range (at least seven days) before and after it, at most 270 days at the existing 90-day zoom limit. Rebase near buffer edges while preserving fractional scroll offset, date beneath the pointer and vertical position. A normal pointer move must not change the parent date anchor or regroup every item; publish the settled visible anchor after navigation settles. Explicit previous/next buttons retain their week/range jump behavior. Overview uses one shared buffer/offset for header, tasks/cards and calendar. A gesture originating in one Overview pane remains owned there when another finger enters the other pane. This replaces the earlier standalone week-on-release behavior; no storage/schema changes are implied.
- **Pinch:** spread fingers to zoom in and close them to zoom out. Timeline pinch changes the visible date range within the existing 1–90-day bounds, anchoring the date beneath the centroid. Calendar Day/Week grids support both axes: horizontal separation changes date-column width/visible dates, vertical separation changes hour height (24–144 CSS pixels), and a diagonal pinch can change both. Calculate axis scales from the fixed starting separation; an axis with less than 24 pixels initial separation stays inactive for the gesture. An eligible axis keeps scale 1 until its separation changes by more than 8 pixels. This prevents nearly aligned fingers or small incidental motion from blowing up the other axis. Standalone date-column width is bounded to 12–1440 CSS pixels with a bounded date buffer of at most 90 visible days; the chosen Day/Week mode remains the navigation preset, and changing mode resets its horizontal zoom. Preserve the fractional date and time beneath the moving centroid within scroll limits. In Overview, a horizontal pinch in the calendar changes the shared 1–90-day timeline range and keeps both panes aligned; vertical pinch changes only calendar hour height. The upper timeline keeps its existing date-range pinch. Month retains its bounded density gesture below. Pinch and pan never mutate item dates, create items or dependency links.
- **Move/resize:** only movement after an armed hold delegates to the existing conditional date-edit pipeline. Calendar item bodies move their native range with existing duration/all-day/15-minute snapping rules; this change does not add Calendar resize handles. Timeline item bodies and existing boundary/place handles retain their move/start/end/place semantics. Existing dependency handles remain permission-gated and may use the same deliberate hold. A release commits at most one valid changed edit; a stationary hold or cancelled/invalid preview produces no native write. A second finger, cancellation or source permission loss cancels an in-progress edit.
- **Tap:** a short stationary item tap opens it; a short stationary blank-grid tap uses the existing contextual creation flow and native destination rules. Suppress the compatibility click generated after pan, pinch or item dragging so it cannot open/create another item. A subsequent deliberate tap still works. Existing mouse drag, Ctrl+wheel, trackpad scrolling, split resizing and keyboard access retain their semantics.

Interaction classification and threshold/zoom calculations must live in pure, framework-independent functions with injected time/coordinates. View adapters own pointer capture, scroll effects and event forwarding. Tests must cover real multi-touch browser input in addition to pure transitions: two-axis pan, focal zoom, long-press move, short swipe on an item without edits, cancellation and one-finger release after pinch, tap selection/creation, read-only guards, and Overview date alignment.

When pending motion crosses the pan threshold, the first pan effect includes the full displacement from the original touch, including pre-threshold movement; later effects are incremental. This prevents the canvas lagging behind the finger by the discarded slop distance. Applying the same absolute pinch result more than once is idempotent: rebuild the desired range/offset rather than adding an absolute offset as a new delta. A suppressed or cancelled gesture discards queued animation-frame movement, including a pinch waiting to render when a third finger arrives.

**2026-11-12 responsiveness correction:** coalesce pan/pinch visual updates to at most one animation-frame callback, flushing the final movement before release. Short inertial panning uses a capped release velocity of 2.5 CSS pixels/ms, exponential decay of 0.006/ms, and stops below 0.02 pixels/ms or at 600 ms; reduced-motion disables this coast. Stop coast immediately on a new touch, pinch/edit, explicit navigation, scope/view replacement, unmount, or cancellation. A coast is navigation only and cannot commit edits or create items. Rebase only the bounded date window, never allocate an unbounded list of columns. Item text on planning grids is nonselectable during normal touch interaction (including before a hold arms); Notes, descriptions, editors and ordinary text fields retain selection. Preserve all native permissions and long-press safeguards above. Continuous date browsing does not claim calendar records outside the source's actually loaded coverage.

### PRESENT-07. Compact controls and truthful sync notices

At phone widths, use a compact search button that expands/focuses the existing search field; a nonempty search remains discoverable and clearable. Put Show done inside Filters, retaining its per-layout persistence and visible active-filter indication. Keep date navigation/date range in one compact row when width permits; remove redundant view descriptions and permanent hour-height percentage prose across clients. Preserve an accessible, compact hour-zoom reset action and date/range controls. Icon controls need accessible names, tooltips where applicable, visible focus and usable touch targets. Do not remove useful actions merely to hide labels.

Use one concise actionable notice for source refresh problems rather than simultaneous generic connection and concatenated per-source banners. An active refresh is progress, not a failure cause; retain known failures/details without claiming every source failed merely because one read is still running. Source freshness and custom-planner metadata sync are distinct. Details identify the operation/source, last successful refresh when known, elapsed progress when measured, and the safe actual failure classification/message. Offer retry, reconnect or conflict review only when that action matches the observed state. Do not claim network/authentication/conflict as a diagnosis without evidence. Metadata pending edits remain preserved. Detailed item counts belong in the details panel, not repeated paragraphs above the workspace.

### PRESENT-08. Scope header, contextual controls and usable canvas space

The 2026-11-12 placement feedback refines PRESENT-07. Show the current scope name (My overview, Space, source group or project) in the upper application header with its existing identity/color. On wide layouts place the five view choices in that upper area as well, removing the duplicate large workspace-heading row. On narrow layouts keep the current scope identifiable and the view choices reachable in a compact header arrangement without hiding navigation or colliding with global sync actions. Truncate long names visually with their full accessible name available. Global matching-events, refresh and sync remain global actions, separate from page settings.

Each Space in the navigation sidebar has a labeled three-dot actions button beside its name. Space organization actions (source grouping, source assignments/Space management and adding a project) belong there, not across the workspace header. The menu targets the Space whose button was pressed, even if another scope is selected. Opening or cancelling its editor must not switch the current scope, reassign sources, or affect My overview. Source assignment can remain part of the existing Manage Space editor, with a clear menu label or destination. Preserve existing unsaved-change guards, save ordering, metadata locks and organization validation. Existing project management remains reachable contextually from its project row; do not lose it when removing the old header action. My overview has no Space organization editor. Closing a menu with Escape/outside activation restores normal navigation without writes, and keyboard activation/focus remains usable.

Draft initialization is a pure projection of the workspace and explicit editor target. Editing a project keeps its own parent Space and optional source group; an unrelated selected scope never supplies a missing category. Creating a project from a Space's menu uses that Space, its color and no preselected source group. Creating without an explicit parent retains the current nested scope's valid parent/group defaults, falling back to the first available Space when needed. Existing values take precedence over defaults. A Space's editor includes its direct sources plus sources of its groups and nonarchived projects, deduplicated. Draft arrays are detached; opening never mutates the workspace or generates an identity. An explicit target removed before opening (or while waiting for outstanding saves) is unavailable, not a request to create a replacement or edit another Space. Existing save-time validation still applies.

On wide Board layouts place its existing source/mode selector and Map statuses with search/filter controls in the shared toolbar, eliminating the separate full-width controls row and redundant explanatory text. Preserve Board mode, scope, native/unified status semantics and mapping editor behavior. On phone-sized or otherwise tightly constrained layouts, consolidate page controls into one labeled top-right Page options menu on every view: search (including clear), filters including Show done, view-specific source/mode controls, Map statuses and timeline range where applicable. These are the same controls/state used on wide layouts, not separately persisted mobile copies. Active search/filters remain indicated on the menu trigger when closed. Keep compact previous/Today/next/date navigation directly available on calendar/timeline views. Resizing the viewport must not discard entered search, change filters or select a different source/mode.

Reduce outer workspace/header/toolbar/card spacing moderately on desktop and more on tablet/phone using a small shared set of density rules. Preserve readable text, visible focus and approximately 40-pixel minimum touch targets for primary controls; gaining room must not make hit targets tiny. Content-heavy panels retain the shared solid-content/glass-shell material rules. Do not add a new user setting, cloud field, storage migration or platform-specific behavior fork for these layout changes.

Historical PRESENT-08 navigation (superseded by PRESENT-10): Overview originally exposed one shared horizontal Dates navigation scrollbar at its bottom. Remove the duplicate native horizontal bars within the task/card and calendar panes while retaining their independent vertical scrolling, shared date alignment, split resizing, two-axis touch/trackpad navigation, pinch zoom and long-press editing. Suppressing a redundant scrollbar must not disable programmatic or gesture-driven horizontal movement. Standalone views retain usable horizontal navigation. Avoid an additional outer document scrollbar when the workspace can occupy the available viewport; long content scrolls in its owning view/panel.

Acceptance: desktop/tablet show scope and view navigation higher, Space actions open for the correct sidebar row, Board controls share one toolbar, narrow layouts expose all page actions through one menu with persistent active-state feedback, and Overview has only its shared bottom date scrollbar plus necessary vertical scrolling. Check phone, tablet and desktop layouts and existing context/draft/gesture behavior separately from native host packaging. This milestone is development-demo only; no app builds are authorized.

### PRESENT-09. Unified page controls and compact view selection

The next 2026-11-12 owner feedback supersedes the responsive placement details of PRESENT-08, while retaining its Space menus, pure editor targeting, density, shared scroll axis and draft protections. All five views follow the same control positions: search at the left when expanded on a wide desktop, date navigation centered where applicable, and filters/page options at the right. Board's source/mode, status mapping and help use that same control system rather than a separate page-specific header row. Board and List do not acquire a date selector when their content has no date-navigation behavior.

Tablet-sized layouts use the same consolidated Page options menu as phones. Search, filters/Show done, source selection, Board mode/Map statuses and timeline range remain in that menu with their current state; the collapsed trigger retains an active-search/filter indication. Use a consistent compact-control breakpoint covering tablet widths (up to 1280 CSS pixels). Wider coarse-pointer devices also use compact page controls. This is responsive presentation, not a different mobile filter model or new persisted setting.

At phone widths (up to 760 CSS pixels), replace the five horizontal page tabs with one top-header dropdown that always shows the current page name. Its options are Overview, Calendar, Timeline, Board and List; choosing one invokes the same existing view transition, including existing view-specific preferences and date-range defaults. Retain readable active scope identity and global actions without a dedicated row of page tabs. The dropdown supports keyboard selection, Escape/outside dismissal and focus return; changing screen size does not change the current view.

To preserve readable page selection and usable targets on narrow phones, keep the cloud sync/freshness indicator directly visible and place Find matching events, Refresh sources and New item in a labeled Global actions overflow menu. Retain their existing availability, native permissions, handlers and sync activity feedback; a hidden toolbar label must never make an action inaccessible. Desktop/tablet can keep these global actions directly in the header. The global menu and page-options/Space menus dismiss each other when opened, close before deeper navigation on Escape/native Back, and return focus to their visible trigger. No new global business action or sync semantics are introduced.

The compact Page options trigger is a small rectangular button at the upper-right of the workspace, not a full-width button and not a row reserved solely for that action. On date views it shares the compact date-navigation line, with dates centered and the menu at the right. On Board/List, use the existing upper-right header corner rather than dedicating a new toolbar row or a permanent side rail; the entire content area stays available and no card/column heading is covered by an overlay. Do not obscure the inspector, a modal, card content or its controls. Menu contents scroll when necessary, preserve touch targets and close correctly with keyboard/native Back. One set of controls owns the data across responsive layouts; opening/closing/resizing must not reset search, filters, mapping or Board mode.

The owner explicitly requested fresh Windows and Android app builds after this correction. Perform fast iteration checks first, then produce the existing same-version portable Windows application and Android test APK at the end of this milestone. Preserve application identity, signing identity and saved accounts. This authorization does not enable the Web app, publishing or emulator/device operations.

### PRESENT-10. Lean Overview and calendar periods

The next owner feedback retains PRESENT-09 but removes the entire Overview bottom Dates/arrow/range/scrollbar row. Shared horizontal date movement continues through the existing date canvas, touch/trackpad scrolling and top date navigation; removing the footer must not detach the two date axes. The resizable middle divider occupies 4 CSS pixels visually, with an overlapping larger pointer hit area and its existing keyboard resize operation. Do not add another permanent row as its replacement.

Standalone Timeline calendar chips display their event title without the small visible time/source subtitle underneath, on every device. Preserve full time, source and all-day information in their accessible label/tooltip and item details. The event selection list may retain its useful details. This change does not remove calendar source colors or highlight bands.

Board controls must not turn into a vertical stack when the inspector opens. Apply the compact Page options layout when either PRESENT-09's viewport/pointer condition holds or the available main workspace width is at most 1000 CSS pixels, even on a wider desktop. Available-workspace sizing must not narrow the global app header or reset control state. Preserve search-left/date-center/filter-right when there is enough room, and the same focus/search behavior when controls collapse.

Standalone Calendar has `CalendarMode = 'day' | 'week' | 'month'`. Week remains the default and its existing rolling seven-day hourly layout is retained. Day uses one visible local date with the same 24-hour grid, all-day lane, linked highlights, creation, editing and continuous date-canvas gestures. Month uses a Monday-first seven-column calendar grid: start on the Monday on/before the first day of the anchor month; end on the Sunday on/after its last day, producing four to six full weeks. Adjacent-month cells are visibly quieter but retain their real dates and actions. All period arithmetic uses local calendar dates, never fixed 24-hour multiplication across daylight-saving transitions.

Expose a labeled Day/Week/Month selector with the existing page controls: inline on wide desktop, inside Page options when compact. Mode is the account/scope-local `ScopeViewExtras.calendarMode` field; missing/unknown values normalize to `week`. Include it in the existing local preference capture/restore with `query`, `attention` and `listKind`. It is not a new Workspace/PlannerSettings/cloud field. Switching mode retains the anchor date, filters, current scope, selection and protected drafts. Reset filters retains calendar mode. Returning to a scope restores its local mode. Overview's lower calendar and contextual scheduling dialogs keep their existing behavior.

Previous/next in standalone Calendar moves one local day, seven local days or one calendar month according to mode. Month navigation preserves day-of-month when valid and otherwise clamps to the destination month's last day (January 31 → February 28/29). Today selects the local current date without changing mode. The date label covers the displayed day/week, or names the anchor month/year in Month mode. Selecting a calendar date preserves mode. Clicking a month day-number opens that date in Day mode. Pure shared helpers own normalization, period generation and navigation; deterministic shared test vectors cover these rules, including leap years and month boundaries.

Month shows loaded native calendar events, dated tasks/cards and planner sessions using existing source/item/tag colors and completion/source filtering. It does not invent unscheduled dates or fabricate remote coverage. Event all-day end remains exclusive; work due date remains inclusive. Split multi-day items at week boundaries, with one labeled bar per weekly segment and a source stripe at each visible segment's left edge. Timed items retain a readable time indication. Same-day items remain separate and can open details; overflow must be reachable rather than silently dropped. Unscheduled work remains accessible in the existing unscheduled list/context.

Month empty-cell clicks and mouse range drags open the existing creation dialog with the selected date-only range (exclusive selection end); touching and scrolling must not accidentally create. Existing items open details on click/tap and may move between days by mouse drag or deliberate long press, using the existing native permission gates and date-edit/plan-move helpers. Moving retains native date-only/timed semantics, local start time and duration; no source mutation occurs before the normal commit. Escape, pointer cancellation, another finger, scope/mode changes and permission loss cancel an edit preview. Reuse the shared gesture classifier. Month scrolling pans its overflowing grid; pinch changes local grid density, bounded to 70–220 CSS pixels per day column and 100–300 pixels minimum per week row, and never writes item dates. Controls remain usable without gestures. Day/Week hour pinch is unchanged.

This request also requires a first-use illustrated guide covering the actual organization and platform capability rules. Clearly distinguish explanatory diagrams from captured application screens and examples from real account data. Document that a Project is a saved subset inside a Space, not a newly created native Deck board. Guide publication is local only. Use fast checks during this round; the preceding packaged artifacts remain the previous milestone unless the owner requests new builds.

### PRESENT-11. Compact timeline controls and floating calendar context

The next owner correction moves the standalone Timeline legend and **All calendar bands** toggle into Page options on phone/tablet and other compact-control layouts. Remove the footer entirely in these layouts; the desktop footer may retain the legend/toggle. Both placements control the same band state and explain work range, due date, reserved time and dependencies without affecting source data. Preserve keyboard access and the current event picker for overflow/out-of-period context.

Opening an inspector must never make Board/List search and filters unreachable. Tablet/phone continue to consolidate them in Page options with a visible trigger. The owner's latest screenshot rejects the narrow corner/control gutter: Board and List now use the same compact top toolbar row as the other pages, below the global header, with Page options on the right. Remove the side gutter and restore the full content width; do not float a button over cards. These undated pages do not invent date navigation merely to fill the row. When only the workspace becomes narrow on a wide fine-pointer desktop, retain an inline toolbar with search at the left and a visible Page options trigger at the right; move source/mapping/help/filter controls into that menu. Do not hide the whole toolbar simply because the inspector reduced the workspace width. Preserve the same query, board mode and filter state, focus return and accessible labels through transitions. Avoid duplicate controls/state owners.

Standalone Timeline has a **Float visible events** desktop option. The local account/scope preference is `ScopeViewExtras.timelineFloatingEvents: boolean`, default false; invalid/missing values normalize to false. Mobile/tablet presentation (viewport at most 1280 CSS pixels or coarse pointer) always uses the floating behavior without overwriting the stored desktop choice. Desktop's option is available with the Timeline controls. This is device-local presentation, not cloud organization. Overview retains its existing split header behavior.

In floating mode, the date/column heading and full calendar-context region scroll away vertically with the work list. Only calendar event chips whose native interval intersects the actual visible horizontal time range may float. A chip starts floating only after its original header position would cross the top edge of the timeline viewport; it returns to its original position when scrolling back. Clip the floating region to the date plotting area, leaving task names readable, and retain original source/item colors, opening, linked highlights and accessible full date/time/source descriptions. Do not pin a tall empty header or show offscreen buffer events. Preserve the existing compact lane/overflow limit and event picker rather than growing a floating overlay over all work rows. All calendar bands continues to control bands versus calendar summaries; floating chips do not imply a new booking or dependency.

Visible-range intersection, clipping and float eligibility are pure coordinate/date projections. Pointer movement/scroll updates are frame-coalesced and must not regroup all work or serialize snapshots for each pixel. Existing two-axis navigation, event opening, permission-gated edits and cancellation semantics remain unchanged. When editing a floating event, show its drag/resize preview in the visible floating area without using preview dates to remove the captured original chip. The normal fixed heading remains available on desktop by disabling Float visible events.

### PERF-02. Stable data during navigation and background updates

Further responsiveness work preserves all existing source freshness, mutation, conflict, account-isolation and cancellation semantics. Navigation and progress-only updates must not require an avoidable second native snapshot read, repeated unchanged identity reconciliation or rewriting a large unchanged native cache. Consume acknowledged operation results with their revisions; reject stale/account-replaced results and preserve optimistic pending edits and unsaved drafts. Never trade speed for skipped permission changes, stale visible records, lost source data or suppressed sync errors.

Updates containing only the existing `deviceViewKeys` (view/assignment/visibility fields) save through the existing account/scope-local preference store, without invoking full workspace persistence or advancing the shared mutation revision. Organization, workflow and status mappings still use the normal durable planner save. A pending planner save completing after a local view change must retain the latest device view fields. Scope selection may retain its existing host persistence until its active-scope restore contract changes; do not invent a new local storage format for this optimization.

Reuse unchanged internal projections only when their actual input identities/content and account generation are unchanged. Mutable snapshots returned to callers/subscribers remain detached: one consumer cannot alter another consumer's data or the controller/store. Do not expose private native payloads or credentials. Reference sharing inside the presentation is permitted for equal acknowledged data, but a changed item, native permission, relation, collection or planner rule must invalidate its affected projections. Avoid per-frame full-record scans or DOM measurement of every work row during horizontal/vertical panning. Keep performance changes narrow and measure isolated realistic record sets; a desktop microbenchmark is not a physical-phone frame-rate claim.

### SYNC-03. Cache-first Android startup and durable incremental source refresh

This owner correction supersedes Android's one-minute all-source/planner polling and the requirement to wait for complete private-cache hydration before rendering. Windows keeps its existing schedule unless its host explicitly adopts this optional contract. Web implementation remains on hold.

**Startup:** once an account has a usable saved planner, opening must render its locally saved appearance, scope and public records without waiting for provider authorization, network access, source refresh or custom metadata download. Read a validated nonsecret saved account descriptor first. A separate account-local launch checkpoint may store the public state needed for this first render, with format version 1 and exact `accountKey`; it is a disposable presentation cache, never the authority for credentials, permissions, edit baselines or cloud writes. Restore the durable source, metadata and pending-scheduling stores separately; until that finishes, expose `deviceSync.restoring=true`, no native mutation capabilities and no planner writes. Do not show a reconnect failure merely because authorization is still being checked. Failed/corrupt launch checkpoints fall back to validated local stores; they never reset them or fabricate source records. Publish restored content before doing optional reconciliation/cache writes. Device-local cache format versions are independent of workspace schema 2 and folder protocol 1.

The normalized Android source cache may use version 2 to deduplicate raw native documents: records retain their existing private fields except repeated `remote.raw` strings are replaced on disk by checked references to a single raw-document table; restoration reconstructs the same records for existing edit safeguards. References, byte bounds, source/account association and table entries must validate before use. Existing version-1 caches remain readable and are rewritten only after a valid successful save. Never drop an edit baseline merely to make startup faster. Launch checkpoints must be invalidated/updated on account changes, verified revocation and acknowledged changes; a late old-account write cannot repopulate a revoked cache.

**Incremental reads:** add an optional account-bound lazy `resourceCache` port to the native-source reader. Its methods are `get({kind,collection,href})`, `put(entry)`, `remove(locator)`, `prune({kind,collection,hrefs})`, `retainCollections({kind,collections})`, and `clear()`. An entry is `{version:1,kind:'dav'|'deck',collection:string,href:string,etag:string,body:string,bytes:number}`. Locators must stay in the selected account's server/path; `bytes` is exact UTF-8 length, an integer >=0 within the existing resource/response bounds. Store these in device-private per-resource files with atomic replacement and a bounded 256 MiB total cache, not synchronized planner files or a giant eagerly loaded WebView snapshot. The existing hot memory cache may remain smaller. Corrupt/missing/evicted entries cause a normal source read, not fabricated completeness.

Every refresh verifies a complete fresh collection/board inventory for permission changes and removals. DAV resources may reuse cached bodies only when a fresh successful inventory reports the identical strong ETag. Weak/missing tags force an actual read. A changed/missing body uses a bounded GET and retains the exact native document, including documents with no occurrence in the current display window. This validator-based incremental path may be used for both supported transports when the durable port is present; do not pretend the Files SSO provider supports REPORT. Commit successful resources throughout a partial scan so restarting can resume without downloading the completed prefix. Do not prune on a failed, truncated, malformed or cancelled inventory. Confirmed revocation purges the affected resources and prevents late writes from restoring them. Account/operation activity must be checked around awaited reads and cache writes.

Deck always gets a full fresh board inventory. Read stack/card content conditionally using each endpoint's saved ETag and `If-None-Match`; 304 is usable only with a complete validated cached response. Missing/corrupt cache forces an unconditional fetch. Fresh board permissions/metadata override cached values. Do not treat a changed-since board list as a complete inventory or infer a deletion from a partial response. Native mutations invalidate/revalidate affected cache entries before a later read can certify them current.

`readAll({sources?,isActive?,onProgress?})` may refresh a canonical subset of native sources; Tasks and Calendar share one CalDAV scan. Omitted sources retain their existing records, collections and statuses. An empty/invalid selection does not silently mean all sources. Only successful complete refreshes advance the relevant source freshness timestamps. Resource-cache download success alone does not claim that the displayed normalized records are freshly projected. Optional `cacheWarning:{errorCode:'CACHE_READ_FAILED'|'CACHE_WRITE_FAILED',errorStage:'local-cache',message:string}` reports cache IO failure separately from a successful native read; fallback downloading may succeed while offline-cache durability still needs attention. The progress callback receives `{sources:Source[],stage:'discovery'|'source-read',completed:number,total?:number,message:string}` with validated counts.

DAV projection size limits count retained document content once per resource plus each normalized item’s metadata, excluding repeated copies of the same raw document in recurrence records. Keep the existing 32 MiB projected-data bound and per-resource bounds; deduplicating accounting must not remove the exact raw version needed for conditional native edits. This is an accounting correction, not a larger scan limit.

**Device sync preferences:** optional `State.deviceSync` contains `settings:{caldavMinutes:0|15|30|60|240,deckMinutes:0|15|30|60|240,wifiOnly:boolean}`, `restoring:boolean`, optional `plannerSyncing:boolean` (ephemeral, never restored as active), optional `plannerVerifiedAt:string` (ISO instant proving a successful planner pass in this process; never restored from storage, see SYNC-04), optional `activity:{sources:Source[],stage:'authorization'|'discovery'|'source-read'|'local-cache',startedAt:string,lastProgressAt:string,completed:number,total?:number,message:string}`, and optional `background:{supported:boolean,scheduled:boolean,lastAttemptAt?:string,lastSuccessAt?:string,error?:string}`. Timestamps are ISO instants; counts are nonnegative safe integers, total when known is >=completed. Default intervals are 60 minutes for CalDAV and Deck (SYNC-15), Wi-Fi-only false; 0 means automatic checking for that group is off, while manual refresh remains available. Invalid saved values normalize to those defaults. Preferences are device/account-local, not cloud organization. Expose optional `setSyncSettings(settings):Promise<State>`, `resumeSync(reason:'open'|'resume'|'timer'|'online'):Promise<State>`, and `setAppActive(active:boolean):Promise<void>` on capable hosts. Setting preferences validates input, persists it and updates the actual scheduler; failures are shown, never falsely presented as scheduled. `resumeSync` initiates/coalesces work and returns the current snapshot without awaiting network completion.

On open/resume, render cache first, check authorization asynchronously, pull custom planner metadata once for that foreground entry, and refresh due native groups. Coalesce overlapping browser/native resume signals; do not restart an active scan on repeated focus. Successful earlier source timestamps decide what is due; a failed attempt waits its configured interval before an automatic retry, while manual retry remains available. While foreground, use the selected native intervals; Notes/Collectives check when due on open and at a fixed 15-minute foreground interval. Manual source refresh checks all sources. Custom planner edits still upload after the existing idle debounce, and manual planner sync remains available; custom metadata is no longer pulled every minute or after every native refresh on Android. This does not promise immediate remote planner changes while another device remains continuously open. Optional `subscribeSync(listener:(deviceSync)=>void):()=>void` publishes lightweight sync activity without repeatedly cloning all source records; final data still uses the normal state subscription.

Restored source statuses remain unverified until a fresh inventory checks their permissions. An enabled group with an unavailable status and no attempt in this process is due immediately, even if its cached last-success timestamp is recent; a failed attempt then observes the normal interval. Manual refresh bypasses the automatic cadence and Wi-Fi preference. Automatic Wi-Fi checks must not block offline rendering.

Native Android must schedule actual operating-system background jobs for the CalDAV and Deck preferences, without keeping an Activity or hidden WebView alive. Jobs refresh the same private raw-resource cache; the existing portable reader remains the sole projection/merge engine when the app resumes. Background jobs must rediscover collections/boards, preserve account/path/security bounds, and never mutate source data or custom planner metadata. The OS may defer work for battery/network restrictions, and force-stopping the app prevents it until reopened; show this distinction rather than claiming an exact timer. Browser preview supports checks only while running and must not claim OS background support.

**Bounded work and truthful activity:** a native request must have a finite total deadline, including Files-provider binding and body reads (at most 45 seconds). Foreground source passes have a 120-second elapsed budget with incremental resource checkpoints; OS background passes have a 90-second budget. A pass exceeding its budget ends activity, retains verified cached data, reports partial refresh plus its specific stage/retry guidance, and resumes using saved resource validators on the next check. Cancellation/account replacement do not become network failures. Do not leave a persisted or abandoned `refreshing` flag active across process restarts. Show the actual source/stage, progress when known, last successful refresh and a retryable timeout/error instead of an unbounded generic spinner. Progress is throttled and must not clone/publish all records for each downloaded file. A selected interval changes the stale threshold for that group (interval plus two minutes); disabled automatic checks show the last checked time and a manual-refresh state, not a permanently running spinner. Desktop/phone timings must be reported separately; no physical cold-start promise is verified by a fixture test alone.

### PERF-01. Mobile snapshots, lifecycle and diagnostic integrity

Project public source records before cloning: private raw source documents and identity locators must never enter renderer snapshots or their clone cost. Public snapshots remain detached from mutable private state; subscribers cannot mutate another subscriber's view or the controller through shared references. Avoid copying unchanged public datasets multiple times while adopting the same host result. Metadata-only operations do not rewrite unchanged native-source snapshot files; successful native edits, source refreshes and verified revocation still persist the required source changes. Preserve alternating-slot corruption recovery and account isolation; do not replace disk validation with an unverified remembered slot head.

Foreground/background/account lifecycle cancellation is not a source failure: propagate `CANCELLED` out of per-source/discovery collectors and abandon the obsolete read without replacing valid cached statuses, losing edits, claiming offline/auth failure, or retaining a cancellation warning. Keep foreground native safety and existing mutation ordering. Resume can request one coalesced refresh, not simultaneous overlapping scans.

SourceStatus and StorageStatus may carry optional, runtime diagnostic strings `errorCode` and `errorStage`. `errorStage` is one of `discovery`, `source-read`, `planner-read`, `planner-write`, `local-cache`. Retain only recognized connector/store codes (including AUTH, PERMISSION, NETWORK, TIMEOUT, LIMIT, FORMAT, NEXTCLOUD, CONFLICT, FOLDER_CONFLICT and existing CACHE_/FOLDER_ diagnostics); never include credentials or arbitrary exception payloads. Unknown codes use a neutral failure explanation rather than a fabricated diagnosis. AUTH offers reconnect, PERMISSION explains access review, NETWORK/TIMEOUT offers retry, conflicts retain/review local changes, and local-cache failures explain local saving/recovery. Preserve the safe underlying message and stage instead of replacing all metadata errors with generic text. These are diagnostic extensions, not new native records or cloud workspace schema fields.

For the demo, measure the actual snapshot/refresh/render paths using at least 2,200 deterministic records (the later screenshot reports 1,947 Tasks, 157 events and other sources). Report desktop/browser measurements separately from physical Android performance. The observed 256 MiB scan-limit error is an incomplete calendar scan, not proof of authentication failure or planner-metadata conflict; do not mask it by marking the source connected or merely increase the budget without a verified read strategy.

For bounded DAV GET accounting, record the actual UTF-8 response-body bytes as soon as a bounded response is returned, before HTTP status, empty-body or revision validation. Refund unused reservation even when that known response fails validation. A transport exception without a complete bounded response retains the full reservation, because consumed bytes are unknown. Diagnostic scan details distinguish known response bytes, unknown-transfer reservations and failed requests; a reserved-capacity limit must not claim the same quantity was downloaded. Keep the 256 MiB logical-scan limit and partial-source integrity rules. Calendar/Tasks source diagnostics remain separate from planner-folder synchronization.

Scan diagnostics also count failed GET requests by recognized safe error code (unrecognized codes count as Unknown). Do not include resource URLs, titles, credentials or arbitrary error text. When a budget is exhausted after failed requests, retain both the limit and the observed failure counts so the limit does not hide the underlying cause. A non-limit failure may expose the common recognized failure code only when the failures support that classification; mixed or unknown causes remain neutral. Shared Tasks/Calendar scan totals must be labeled as shared, not mistaken for independent per-source downloads.

## E. Pure behavior boundaries and fast conformance

### VERIFY-01. Humble View Pattern

All state machines, validation, parsing and business decisions specified here MUST live in pure, framework-independent core modules/classes or ViewModels with zero UI dependencies. Presentation renders state and forwards user intent. Platform/network/storage adapters perform effects through explicit ports; deterministic core decisions use injected clocks/IDs and effect results. Tests must exercise the same production rules used by clients without mounting a UI or packaging an application.

Existing reference presentation code is evidence of user behavior, not a prescribed location for those rules in a new client. Extract touched business rules before extending UI-owned logic; preserve behavior, and keep unrelated later-phase functionality outside the current milestone. Pure functions/modules are acceptable implementations of the pattern; a class wrapper is not itself evidence of decoupling.

### VERIFY-02. Shared language-agnostic test vectors

`specs/TEST_VECTORS.json` is the shared executable example contract derived from this specification. Its format is `nextspace-test-vectors`, version `1`, with a `cases` array. Each case has a unique stable `id`, a `behavior` name, a `specRef`, `initialState` (JSON value), `input` (JSON object identifying an operation/event and its payload), and `expected` (object with `output` and/or `nextState`, or an `error` expectation). Optional descriptive notes do not change assertions. Fixture-format version is unrelated to workspace schema or folder protocol versions.

Cases must explicitly encode relevant time/identity inputs, avoid wall-clock/random/network dependencies, and use invented data. Expected values are fixed reviewed JSON examples; never generate them during a test by calling the implementation under test. Error expectations may assert a stable code or specified message substring where the current operation exposes only textual errors. Do not invent production error codes to satisfy a fixture.

Every client has a fast local test loading this one JSON file, validating its format/IDs, dispatching every known case to its actual pure logic, and asserting expected results/errors. Unknown operation types, malformed expectations, zero cases or skipped cases fail the test. Client adapters translate fixture input into production calls only; they must not duplicate the business algorithm. Clients using the same portable core may share a test dispatcher while retaining a local test entry point. A client written in another language must implement an equivalent dispatcher against its own production logic and use the same JSON unchanged.

The initial fixture set covers core representative transitions and edge cases. It is not an assertion of exhaustive application, transport or UI coverage. Add cases as behavior evolves, updating this specification first. Passing pure tests for later-phase rules does not authorize enabling those later-phase user flows. A test-only Web entry point is explicitly allowed while the Nextcloud app implementation remains on hold.

### VERIFY-03. No full builds during iteration

The owner's Fast Verification Policy supersedes the original Phase 1 full-application-build requirement. Use targeted pure/unit tests, targeted local native unit tests, and no-emit/native type checks. Full app/UI builds, APK assembly, bundling, installer packaging and emulator launches are forbidden during regular coding and sub-agent iterations. Do not invoke them indirectly through helper commands or test hooks.

Full UI/application builds are allowed only at the end of a major milestone when the owner explicitly requests a playable build. Report fast-test/type-check success separately from deferred artifact or device verification; never describe an old binary as newly built. The client instruction files list actual-stack commands and equivalents of the owner's example commands. Do not introduce a different implementation framework just to manufacture an example compiler/test task.

### PRESENT-12. Stable manual ordering and linked Board task stacks (2026-11-12)

The owner requires predictable row positions and a short practical Markdown guide. This section supersedes viewport-priority/attention-bucket ordering in both standalone Timeline and Overview. Windows/Android share this presentation; Web stays on hold.

Timeline default order: within each existing source/project/group, sort by effective start (valid start, otherwise due/end), then effective end (valid due/end, otherwise start), then title and stable ID. Missing dates sort last. Never use viewport, scrolling, hover, selection, today or overdue status as ordering keys. Direct work-to-work links form connected components within each group. Keep each component contiguous, order components by their earliest member, and use deterministic prerequisite-before-dependent traversal inside dependency components with chronological ties and deterministic fallback for malformed cycles. Reference/related work links also create adjacency. Shared event/note links do not pull unrelated work together. Preserve group boundaries and membership. Do not automatically collapse/move rows into Overdue/Outside this period/Unscheduled buckets as dates scroll. Out-of-range rows stay in place without a visible bar; undated labels remain. Group collapse is explicit.

Manual order: dedicated list handles reorder rows within their group or group headers among siblings. A group moves with its subtree, without reparenting. Board order handles reorder root cards within their column; existing cross-column native status moves remain separate and keep existing validation/confirmation. Bar dragging still edits dates; dependency handles still link. Touch handles require deliberate long press (500 ms); movement before activation scrolls. Escape/cancel/second finger/permission loss cancels without writing. Focused handles support Alt+Up/Down as the keyboard equivalent. Show a drop marker, commit once on release, never on pointer movement. Reset order restores the current view's default without changing links/dates. Manual order overrides date/component ordering. Filtering never deletes saved positions; unavailable IDs remain stored but are ignored in projection, new IDs follow saved ones in default order. Scope changes load that scope's order.

Synced contract: optional `PlannerSettings.arrangements: Record<string, ScopeArrangement>`, max 2500 scopes. Scope keys include `all`, are nonempty safe strings <=2048 characters, no null/prototype keys. A ScopeArrangement permits only optional `timelineRows: string[]`, `timelineGroups: string[]`, and `boardCards: Record<string,string[]>`. Sequences are unique safe IDs, max 5000. Board keys are canonical JSON `[mode,boardId,columnId]`, mode `source|deck|mapped|planning`, nonempty boardId only in deck mode, nonempty columnId; max 2500 board entries and same key safety/length limits. Missing fields mean default order. These are synced organization, not device filters. Keep workspace schema 2/folder envelope version 1; add kind `arrangement`, key scopeId, path `arrangements/<existing sha256 digest of scopeId>.json`, existing envelope/tombstone/conditional-write conventions. Exclude arrangements from settings.json. Identity reconciliation remaps and deduplicates timelineRows and every boardCards sequence; group/scope IDs stay unchanged. If retaining stored positions plus the newly visible IDs would exceed 5000, reorder is a no-op preserving the prior sequence; never truncate saved unavailable IDs. Order arrays are ordered merge values, never membership sets: divergent concurrent edits report the existing conflict; independent scope/field edits merge. Custom reorder never changes native stack order, status or dates.

Board highlighting: hover, keyboard focus or selection highlights the item and its directly linked visible items in either direction, preserving colors with a clear outline. Selection highlighting persists after pointer exit. No reloads or full graph scan per card on hover.

Group linked tasks: a toolbar/Page options toggle, default off, remembered as device/account/scope-local `ScopeViewExtras.boardGroupTasks:boolean`. Only direct task–Deck-card `depends_on` links create directional stacks. For card C, C depends_on T puts T above C (input/prerequisite); T depends_on C puts T below C (output/dependent). Generic links have no direction and remain ordinary cards with highlighting. Only already-filtered visible tasks/cards participate; never reveal hidden completion/assignment/source data. A task linked to multiple visible cards appears once with the earliest card by the stable date/title/ID comparator; retain all actual links. If no eligible card is visible, the task remains in its native column. Visual grouping uses the parent's column but preserves the task's status, dates, source and completion. Column counts count root cards; stacks show child count separately. All defined columns remain visible.

Incoming tasks partially overlap behind/above the dominant Deck card, outgoing tasks behind/below. Hover, keyboard focus, or selection of parent/child expands to readable full task cards. Touch has a labeled expand/collapse button; selection also expands. Completed tasks shown by Show done have strike-through and completion icon. Opening a child selects the actual task. Reordering a parent moves its visual stack, without changing child links/status. Child handles cannot reparent them; use the dependency editor. Custom ordering needs writable planner metadata even if the native source is read-only. All native edits keep existing capability gates.

Verification: pure/shared vectors cover stable dates, component direction, saved/filtered/unknown IDs, sibling grouping, Board modes, stack ownership and deduplication, completion filters, identity remap, folder round-trip and merge conflicts. Fast checks only; rendered/physical input evidence separate. Replace the guide with one practical Markdown file, about 500–700 words and 2–3 existing explanatory images. Do not regenerate HTML/wiki.


PRESENT-12 release authorization (2026-11-12): the owner explicitly requested Windows and Android playable packages at the end of this milestone and gradual version increases. Set the product release to 0.6.1, a single patch increment, and increment Android versionCode by one. Technical application/package/storage identities stay unchanged. Full builds are authorized only after implementation and fast checks finish. This does not authorize publication, deployment or version jumps.

### PRESENT-13. Direct manipulation, compact timelines and public documentation

The owner supersedes PRESENT-12's dedicated reorder handles. Remove visible grip icons and their reserved rows/columns. Drag the Board card body to reorder within its column; dragging into another column invokes the existing native status/planning move rules and any existing ambiguous-target confirmation, rather than changing status as a side effect of ordering. Empty columns remain drop targets. Grouped child tasks do not reparent or move their Deck card when dragged. Drag Timeline/Overview list item labels and group headings to reorder within their existing sibling group. Timeline bars, resize edges and dependency points retain their date/link gestures; label reordering does not mutate dates. Undated work remains schedulable through its date editor and calendar scheduling.

A short click/tap still opens an item or collapses a group. Mouse movement activates dragging after the existing movement threshold; touch requires 500 ms hold, with early movement scrolling/panning. Exclude nested checkbox/editor/menu/status/link controls from body dragging. Suppress the click after an actual drag or pan, but not a normal tap. Escape, a second finger, pointer cancellation, stale/removed targets or lost permission cancel without writes. Keep keyboard Alt+Up/Down on the focused item/group. Commit once on release, never during movement. Keep native edit permission gates separate from planner ordering permission. Reuse shared pure ordering/gesture rules; use one input adapter rather than conflicting native and pointer drag engines on the same card.

Board visual states distinguish primary focus from relationships: selected, hovered or keyboard-focused items use the strong primary treatment (solid outline); only linked peers use a subtler dashed/soft outline and tint, as in Calendar. An item that is both primary and linked uses primary styling. Preserve native item fill/source stripes, completion strike-through and readable contrast. Apply the same state precedence to expanded task layers. Compute the relation index once per changed relation set, not per pointer event.

Reduce timeline list/header/cell padding and surrounding margins on all screen sizes, with denser phone/tablet rules. Rows are 44 CSS pixels on wide desktop and 40 on compact/touch layouts; headers are row height plus 4 pixels. Use shared row geometry for labels, bars, dependency routing and hit-testing: no mismatched row heights or clipped controls. Floating event projection accepts optional nonnegative finite `headerHeight` (legacy default 56); a lane floats at `headerHeight + 6 + lane * 32` pixels of vertical scroll. Keep text legible, horizontal/vertical pan available and usable touch targets. Do not add separate control rows to recover removed grips.

Documentation is prospective public repository content: use neutral fictional examples and placeholder account/server paths only, no real personal items, calendars, notes, hostnames, usernames, machine paths or screenshots containing them. The short Markdown guide must show before/after app-view diagrams explaining what a Space source selection, a Space-local source group and a project selection actually change; also show optional linked-task grouping separately from status columns. No new wiki or generated long guide. Audit maintained and historical publishable documentation for personal details; keep private runtime/cache/artifact directories excluded rather than copying them into docs. This rule does not rename technical storage identifiers or modify user account data.

The owner explicitly requested both apps rebuilt after these changes. This release is 0.6.2 / Android versionCode 4; no other version/protocol/identity changes or publication. Fast checks precede the final authorized packaging.

### SYNC-04. Nonblocking launch, bounded authorization and planner-source diagnostics (2026-11-12)

This corrects the SYNC-03 implementation, preserving its storage, credentials, permissions and incremental-read contracts. A saved account opens its cached presentation independently of authorization, provider binding, network, background-job status, large raw-source hydration and custom planner synchronization. Publish the lightweight launch checkpoint before scheduling heavy restoration. A missing/invalid checkpoint falls back to a locally themed shell immediately and restores validated durable data asynchronously; it does not await all private stores before exposing the application. A small nonsecret appearance/account launch hint may be retained per account, must be invalidated on disconnect/account replacement, and never grants editing rights. No promises of zero operating-system process startup time; measure application cache-to-first-content separately from network freshness.

Authorization must have a finite caller deadline including provider binding and queue wait. A stalled source or planner request must not hold the local-cache or authorization executor. Provider requests remain bounded, cancelled/generation-guarded and safe for native edits; no unbounded thread creation or parallel unsafe writes. Foreground entry coalesces duplicate resume signals. Each authorization/source/planner activity clears on success, failure, cancellation and timeout; no persisted activity is restored as active. Planner metadata pulls have an independent finite pass deadline, preserve local edits, report their failing stage and remain retryable. Do not label a queue waiting for authorization as actively downloading files. Late results cannot overwrite a newer account/pass or certify stale data as synced. Diagnostic messages distinguish authorization, source discovery/read, local restoration and custom planner file operations. Keep existing native-resource validators/checkpoints; never solve a hang by repeatedly downloading the full calendar or simply increasing limits.

Settings & connection lists **Planner data** alongside the five native sources. It is a presentation of existing `State.storage`, not a sixth native Source enum or duplicated database. Display the actual remote folder (fallback `Workspace/Nextspace/`), last successful sync, status and specific error/retry guidance. Derive status in this precedence: active restoration -> restoring; storage conflict/error -> conflict/error; active planner transfer -> syncing; local pending/dirty changes -> pending; verified synced storage -> synced; otherwise saved locally/not checked. Offline or reconnect-required conditions must never present current cloud freshness merely because a previous sync succeeded. Native source refresh and planner sync are independently reported; source progress must not masquerade as planner progress. Do not invent a file count from record counts. Keep existing explicit Sync planner retry and source-refresh actions.

The owner requests a final Android playable build after these fixes. Increment Android once to 0.6.3/versionCode 5, preserving application ID/signature/storage. Windows source receives shared presentation changes but its latest packaged release remains 0.6.2; no Windows package is requested for this milestone. Physical-device startup, provider SSO and scrolling validation must remain separately recorded from fixture/compile/build evidence.

### PRESENT-14. Compact timeline context and continuous all-day touch (2026-11-12)

Overview and Timeline expose a visible, accessible collapse/expand control for the left work-list/context area, including on phones/tablets. Add account/scope/device-local `ScopeViewExtras.timelineListCollapsed:boolean`, default false; normalize missing/non-boolean to false and preserve it through filter reset. It is not synced organization. Overview uses one aligned horizontal date axis in both halves after collapsing; retain a narrow 40 CSS-pixel control/time gutter and a working expand control. Hide the broad calendar context alongside the work list. Collapse must not change filters, order, membership, selection, dates or links. Bar and point-only deadline titles become visible in the plot when the list is collapsed, clipped to the visible chart area and pinned to the visible leading edge of their actual span. Out-of-range items do not fabricate spans.

Explicitly collapsed groups retain compact thin schedule spans for their already-filtered descendant work items in the group row. Use the same effective work range/deadline geometry as expanded rows, including due-only points and viewport clipping. Undated items have no fake span. Preserve each item/source color; thin overlapping lanes may be allocated deterministically, with accessible item names and tap/click opening the actual item. Do not reveal items excluded by scope, source, assignment or completion filters. Opening an item does not expand/reorder the group or modify its dates. Group collapse remains explicit and stable as dates pan.

All-day/multi-day calendar rows participate in the same immediate two-axis pan, inertial scrolling, pinch and long-press edit arbitration as the timed calendar, in Overview and standalone Calendar. Blank all-day areas as well as editable/read-only items must pan. Normal tap opens an item, early movement scrolls without text selection or accidental edits; long press arms a permitted date edit and a second finger cancels edits for pinch. Event titles and the source stripe follow the visible leading cutoff while any portion of a multi-day item remains onscreen, for both date clipping and horizontal scrolling. Labels stay inside the real item rectangle and do not obstruct resize/link/drag controls. Batch geometry reads and visual updates per frame; scrolling must not trigger full record/relationship recomputation or native synchronization.

SYNC-04 responsiveness refinement: cached source parsing/projection is still work even when no download occurs. The portable DAV reader must periodically yield between bounded resource/item batches while retaining account/pass cancellation checks, exact ETags/raw edit baselines, accounting limits and permission revocation semantics. A complete cached scan must not monopolize the presentation event loop. A yield does not publish partial records as a verified source success or start another synchronization pass.

For release diagnostics, the shared presentation may accept a host-provided `appVersion` display string. Show that client's packaged version; absent host version means Development, never a different client's release. This label does not change technical identifiers, storage schemas or release eligibility.

SYNC-04 retry readiness: a manual custom-planner retry requires an account identity, online state, no explicit authorization/recovery failure, no active restore/planner transfer and no protected in-flight edit/draft. It must not require a successful native source refresh (`connection.connected`) or successful metadata initialization; those failures are precisely states the retry can recover. Hosts must still verify authorization and conditional-write baselines before any transfer. Native edit eligibility remains unchanged.

SYNC-04 independent planner freshness: optional `DeviceSync.plannerVerifiedAt:string` is an ISO instant set only after the current account's successful planner pass, matching `State.storage.lastSyncedAt`. It is ephemeral and never restored from a persisted checkpoint. Reset it when replacing/disconnecting an account. This matching proof may display Planner data as synced even when all native sources failed (`connection.connected:false`); it must not mark those native sources successful. Restoration, conflict/error, authorization loss, offline, active transfer and pending edits retain their precedence. A mismatched or invalid timestamp cannot certify freshness. Hosts without this optional proof keep the existing connected-session status projection.


### DIAG-01 / SYNC-05. Opt-in performance recording and large-source progress (2026-11-12)

Settings offers Start recording, Stop recording, Copy log, Save log and Clear log. Recording is off by default and never starts automatically on launch. A recording is device-local, at most ten minutes and 5,000 recent events; evicted event count is reported. No automatic upload. Export a versioned JSON document containing application version/platform, relative monotonic timings, a recording summary and whitelisted events. Never include credentials, authorization/header values, server URLs, usernames, source/item/file names or identifiers, tags, descriptions, note content, request/response bodies, raw exception messages or stacks. Safe enums (source family, request method, stage, error code, page name), numeric duration/byte/count/status values and booleans only may enter events. Bounded numeric aggregates describe requests, cache reuse/download, source projection, local restore/write, authorization, planner operations and UI frame/scroll/page-switch delays. Recording overhead must be bounded: aggregate high-frequency activity instead of serializing per-frame or per-resource bodies. Recording stop preserves the captured report until Clear/replacement; account replacement/disconnect stops and clears it. Backgrounding stops with a reason so ordinary background activity is not recorded unexpectedly.

Host diagnostics API is optional: startDiagnostics():DiagnosticSummary, stopDiagnostics():DiagnosticSummary, getDiagnostics():DiagnosticSummary, clearDiagnostics():DiagnosticSummary, readDiagnostics():string, recordDiagnostic(event:DiagnosticInput):void, saveDiagnostics():Promise<{saved:boolean,cancelled?:boolean,name?:string}>, copyDiagnostics():Promise<{copied:boolean}>. DiagnosticSummary has recording:boolean, elapsedMs:number, eventCount:number, dropped:number, canSaveFile:boolean, optional stopReason:'manual'|'duration'|'background'|'account-change'. DiagnosticInput is a strict whitelist defined by DIAG-01's recorder module; arbitrary caller fields/text are discarded. Shared UI samples frame/event-loop delays only while recording, in one-second aggregates, excludes hidden-tab intervals, and records page/open-panel/scroll intent timings without record IDs. Copy prefers the native clipboard when available, otherwise browser clipboard, then selectable-text fallback. It uses the exact sanitized JSON. Android Save uses the native document creation chooser, with application/json and a neutral timestamped filename; cancellation is not an error. The native boundary accepts only a validated bounded diagnostics document. Missing host diagnostics capability never invents network metrics.

Large native sources retain their exact ETag/raw-baseline, account, permissions and deletion rules. Cache reuse must not perform a full disk inventory/size scan for each resource write. An optional bounded batch cache lookup (at most 32 resource locators and bounded total bytes) may amortize bridge overhead; a missing/truncated cache batch is a cache miss, never source absence. Warm repeated projection may be reused only with matching raw resource revision, collection permissions and date horizon. Fresh inventory still controls membership/revocation. Prior incomplete work must not permanently starve unseen resources on retries; persist/reuse validated downloaded resources and prioritize unfinished work. Native source results publish independently: a slow Tasks/Calendar pass cannot relabel already verified Notes/Deck/Collectives as timeout. Keep finite request/pass limits and cancellation guards; do not merely increase timeouts or certify a partial scan complete. Progress distinguishes discovery, cache lookup/reuse, transfer, projection and local persistence through sanitized diagnostics. Native sources and custom planner data remain independent.

### ORG-05. Space status maps, status filters and tag-selected projects/groups

Add optional Space.statusMapping:StatusMapping, validated with the same strict columns/assignments rules as planner.statusMapping. Absent override inherits the global planner.statusMapping (or built-in default). My overview edits only that global default. A Space, its groups and projects resolve the owning Space's override. Saving customization creates/replaces only that Space's full map; Use default removes the override. Native states/completion semantics do not change. All status display/filter/color and unified-board drop resolution uses the same effective map for the current scope; native editing controls retain the real native stack/status labels. Unmapped work uses the existing $unmapped identity. Calendar events/notes/pages have no task/Deck status and are not excluded by work-status filters.

Add device/account/scope-local ScopeViewExtras.statusIds:string[], default []; empty means all unified statuses. Nonempty means include those effective column IDs or $unmapped. The filter applies to action items across Overview, Timeline, Calendar, Board and List, before linked task stacks; excluded work must not leak back through grouping. It is separate from Show done: both filters apply. Reset clears statusIds. Removed/unknown saved status IDs remain visible as unavailable filter choices with a remove/reset action rather than silently broadening the filter. Filters never enter synced organization. Maps and tag rules do sync in the existing organization files, with same-field conflict handling.

Add optional Category.tagNames:string[] and Project.tagNames:string[], maximum 100 nonempty trimmed names of at most 200 characters. Match names using NFKC normalization, trim and locale-independent lowercase; reject duplicate canonical names. Preserve native source-specific IDs and display spelling; tag rules do not create/change native tags. Candidate suggestions come from all loaded Deck board labels and all loaded Tasks/Calendar/Deck record tags/tagDetails, across accessible sources, even when not yet selected in the Space. Selecting a tag never expands the Space source pool; the match count explains zero matches. Selected missing names stay editable and marked unavailable. Do not fetch the instance-wide Files tag catalog. Match ANY selected tag.

For a project/group with nonempty tagNames, its collectionIds constrain matching sources when nonempty; otherwise candidates come from the owning Space's selected source pool (including its explicitly assigned group/project sources). Tagged membership is source-pool AND any selected tag. Project explicit recordIds remain an additive curated exception. With absent/empty tagNames, preserve existing whole-source/explicit membership. This permits multiple projects/groups selecting different tags from the same source. Only unfiltered whole-source categories retain the one-source-per-category-per-Space constraint; tag-filtered categories may share sources. Sources outside that Space pool are never pulled in by a coincidentally matching tag. Native data is never moved or retagged. My overview ignores Space grouping/tag rules.

An item may match multiple project/group selections and appear when opening each selection; a combined timeline displays it once. Resolve heading placement deterministically: explicit project record membership, then tag-matched project, then whole-source project, then tag-matched category, then whole-source category, then ungrouped source. Ties use stored configuration order. Keep project's existing category hierarchy. Archived projects do not supply automatic membership. Counts and scopes use the same lookup; compute tag indices per changed record/rule set, not during pointer scrolling. Editors must explain that tags narrow selected sources and show a live match count with neutral examples. Draft save/cancel protections remain.

### PRESENT-15. Compact calendar allocation and themed page dropdown

Use a themed anchored page dropdown on phone layouts, retaining the current page and scope in its trigger. Do not invoke the platform's native select sheet. Selected page, keyboard arrows/Home/End/Enter, Escape/outside dismissal, focus return and Android Back must work; choosing a page uses existing draft/navigation guards. Desktop page tabs remain. This dropdown is a presentation change only.

Day/week all-day rows are packed from items intersecting the actual horizontal viewport, not distant buffered dates. Recompute only when visible day boundaries/data change. Automatic height follows those visible lanes, with no empty rows for offscreen items. Default minimum 24 CSS pixels, automatic maximum min(180px,40% of available calendar height), retaining timed-hour space. Compact rows use28px height+3px gap with6px total vertical padding. Add a thin divider with a larger invisible interaction target: drag with mouse/touch, keyboard arrows in16px steps, Home/double-click/Auto reset return automatic fit. Manual height is view-local ephemeral, reset on scope/mode change, clamped between24px and min(320px, available height minus120px), falling back to24px in extremely short viewports. Overflow stays scrollable; empty all-day backgrounds retain touch/date-creation behavior. Overview's date alignment and independent main split stay unchanged.

Reduce noninteractive date-header height to32px on phones,40px on compact/tablet and44px on desktop, with smaller labels/padding; keep actionable controls legible with adequate hit targets. Preserve all-day/timed labels, source colors and accessible contrast. Use shared density rules rather than per-screen patches.

Release authorization: final Android0.6.4/versionCode6 after fast verification and source freeze, preserving application identity/signature. Windows shared source gets these changes but no new Windows packaging. Web implementation remains on hold. Physical performance acceptance is separate from fixture/build evidence.

### SYNC-06 / DIAG-02. Independent cache maintenance and measured work (2026-11-13)

Ordinary native resource-cache remove, prune and retain-collections operations are maintenance within the current authorized account session. They MUST NOT advance the account/credential epoch or cancel unrelated foreground source reads. Serialize conflicting cache operations under the captured account guard. Actual account replacement, disconnect, credential revocation and acknowledged native source mutations retain their existing invalidation/cancellation boundaries. Foreground/background coordination and late-result protection remain mandatory. A concurrently refreshed Deck board must not cancel CalDAV discovery/cache work merely by pruning its own cache. Preserve permission revocation, fresh-inventory authority, exact ETags and the two-generation durable-cache recovery rules.

Every source pass that starts and terminates while recording remains active emits one terminal finish/error event, including code CANCELLED when cancelled. Cancellation is not presented as a successful refresh; unrelated completed sources retain their results. Use existing diagnostic kinds/stages/codes, without recording request URLs or content. Manual/background stop does not capture later activity; an app account switch may clear the log as DIAG-01 requires. No raised timeouts, repeated immediate retries, cache deletion, fabricated success or forced reauthorization as a workaround for maintenance cancellation.

Cache persistence must avoid redundant full-document JSON clones and hydration on the presentation thread. Preserve validation of newly written data, current durable generation/corruption checks, bounded bytes and cancellation/revocation cleanup. Compact snapshots and validated raw baselines remain exact; any optimized codec must retain the same serialized contract and recovery outcomes. Measure the entire snapshot preparation/persistence interval rather than only native file I/O. Changes must have fixture evidence for reduced repeated processing, independently of device latency.

### PRESENT-16. Lower-cost rendering and compact phone landscape (2026-11-13)

Calendar/Overview/Timeline date panning, selection and source progress must not repeatedly format unchanged date headings or rebuild unchanged source/tag lookups. Index timed items once per changed record/date input, reuse existing overlap semantics, and render timed event controls only for visible dates plus a small overscan. Preserve full scroll dimensions, date geometry, all-day lanes, gestures, selection, active edit previews and accessible event names. Decorative hour lines may use equivalent CSS backgrounds instead of per-hour elements; real controls and hit targets remain. Pinned-label geometry updates skip vertical-only scroll when horizontal offset, viewport and item layout are unchanged. Pure layout/window helpers have deterministic fixture/vector coverage.

Use one day of horizontal overscan for timed controls. All-day lanes retain full packed content height but mount only the vertical viewport plus two lanes of overscan. Retain any currently focused/edited item until focus/edit ends, even when it moves outside the ordinary render window. Windowing changes mounted presentation only; counts, overlap/lane allocation, filtering, selection and data completeness remain based on the full eligible set. A zero-width/unmeasured viewport uses an initial seven-day window; an unmeasured all-day viewport uses160px before overscan. Window ends are exclusive and clamped to available dates/lanes; never mount the unbounded full dataset as an initial fallback.

An item opens its cached inspector shell and lightweight controls immediately. Defer expensive description/resource sections and native auxiliary reads until the shell has had a frame opportunity. Cancel deferred launches on selection/account change, close and disposal; late responses cannot update another item/account. Do not defer actual save/validation rules, weaken permission gates or discard drafts. Closed optional organization sections do not instantiate their project controls or trigger whole-record membership work. Equal auxiliary data must not replace arrays and invalidate the planner projection unnecessarily.

Preserve the glass appearance with a wallpaper-only background treatment; do not blur moving application content behind a full-screen live backdrop on touch devices. Opaque information surfaces and source/item colors remain. Avoid continuous animation or GPU work when idle except the existing truthful active-sync indication. Recording-only frame sampling remains bounded and stops in background. UI action timing starts at the handler before synchronous preparation and ends after a render/frame opportunity; it is an interaction timing estimate, not a measurement of GPU time or device temperature.

For coarse-pointer landscape viewports with height at most600 CSS pixels, top-bar content height is44px plus the actual safe-area top inset. Use2px outer side/bottom padding in addition to device cutout/navigation safe insets, with similarly compact inner page edges. Keep44px actionable hit areas, readable titles, reachable menus and the aligned calendar/timeline axes. Desktop spacing and safe cutout protection are not removed. Use centralized density rules, not page-specific exceptions.

This follow-up authorizes source fixes and fast verification only. No new app package/version is requested; the existing Android0.6.4 artifact remains unchanged until a later explicit build request. Phone temperature, battery cost and final touch latency remain physical-device acceptance, not outcomes inferred from fixture timings.

Release authorization update (2026-11-13): the owner subsequently requested the APK. Package the verified SYNC-06/DIAG-02/PRESENT-16 fixes as Android0.6.5/versionCode7, preserving application ID, signing identity, account/cache identifiers and cloud protocols. This authorizes one final Android frontend/native package, not a Windows package, Web implementation, emulator launch or publication. Verify the resulting APK's manifest, signature and bundled assets; physical-device acceptance remains separate.

### SYNC-07 / DIAG-03. Isolated synchronization and early restoration (2026-11-13)

The owner's tablet recording shows that cooperative yields on the presentation thread are insufficient. Native source parsing, base64 decoding, identity reconciliation, organization merge, durable-cache validation/serialization and synchronization orchestration must execute outside Android's presentation event loop. Reuse the existing portable controller and its exact native-write, draft, account, timeout and recovery rules in a dedicated module worker. Do not implement a second business engine. The presentation thread handles platform effects and renders public state; provider credentials remain exclusively in the native host. Network processing in the background must not require the interface to stop responding. This changes execution, not native/cloud data ownership or background scheduling defaults.

The local worker transport uses protocol version 1, a per-worker session token, monotonic integer call IDs and an explicit method allowlist. Calls carry `{type:'call',session,id,method,args}`; replies carry `{type:'result',session,id,value}` or a bounded `{code,message}` error. Host effects are restricted to existing native account/authorization/request/resource-cache/scheduling methods, validated account cache paths, connectivity, opening an external browser, diagnostic export/clipboard and bounded nonsecret launch hints. No arbitrary method/property evaluation, credential transfer, executable input or unrestricted filesystem access. Pending operations reject on worker termination; stale session/account replies cannot publish or authorize a write. Do not replay an uncertain mutation after a crash. Show a recoverable retry/reconnection state and retain available cached presentation; never silently run heavy synchronization on the presentation thread as a fallback.

Only the existing sanitized public State projection may cross into presentation. An initial complete snapshot may be followed by sequence/account-qualified changes: record and collection upserts/removals plus changed top-level public fields. Apply only consecutive changes in the same account epoch; gaps require a new complete snapshot. Preserve record order, exact deletions, operation capabilities, source completeness and draft-safe merges. Coalesce superseded state notifications while retaining the latest state and independently delivering truthful lightweight progress. Returned API snapshots remain caller-owned; view mutations cannot alter the worker's authoritative state. Account switches clear obsolete pending publications. Full cache hydration is not required to display the small validated launch checkpoint.

Begin worker startup and local restoration before importing the complete planner/editor interface. The saved appearance hint remains small, nonsecret and independently validated. Render saved scope, appearance and cached public data as soon as both shell and checkpoint are available; do not await authorization, source I/O, full private-cache hydration or an optional cache rewrite. The existing `deviceSync.restoring` and native-write gates remain until authoritative local state is restored. A corrupt checkpoint falls back to validated local stores, never a reset or sample data. Lazy interface modules must expose a usable loading/retry state, preserve the open item's draft and load only when needed. Widgets themselves are outside this milestone.

Native batched cache reads may perform full account-fingerprint validation at entry and exit, with atomic epoch/deadline checks during the locked batch. Account replacement, revocation and mutation invalidation must still cancel publication before any old-account data escapes. Eliminate redundant per-entry parse/serialize/parse conversions. A serialized bounded batch may be decoded by the worker; missing/invalid entries remain misses and cannot imply source deletion. Keep existing locator/byte limits and durable cache format/recovery guarantees.

Diagnostics keep the existing synchronous public API and privacy whitelist. A bounded main-thread recorder may mirror sanitized worker events, using a recording generation and clock offset; late events from a stopped/cleared/replaced recording are ignored. Start/stop/background/account transitions preserve one coherent report. Distinguish worker readiness, first cached state, full restoration, local cache work, network time and publication work using safe stages/counts/timings. UI sampling remains opt-in and stops in background. No unbounded event mirroring or idle polling loop. Measurements must distinguish elapsed time from sums of concurrent durations, and fixture throughput from physical-device latency/temperature.

DIAG-03 adds the safe stage enums `worker-ready`, `first-checkpoint`, `full-restore` and `publication` to the existing whitelist. The pure recorder may expose an internal `recordAt(event,relativeMs)` adapter for worker events. It applies the identical field sanitizer and recording/cap rules, rejects nonfinite timestamps, clamps finite times to `[0,min(current elapsed,600000)]` and sorts exported events by timestamp, preserving insertion order for ties. The host validates recording generation before calling it; the public untrusted `recordDiagnostic` API does not accept a caller-supplied timestamp. No remote clock changes the session duration or bypasses Stop/Clear.

Worker diagnostic forwarding has at most256 queued sanitized events plus one in-flight batch of at most64 events. The presentation mirror acknowledges each accepted batch; a blocked presentation thread cannot accumulate unlimited messages. Overflow increments the report's existing `dropped` count. An internal `recordDropped(count)` adapter accepts only nonnegative safe integers up to5000 per call while recording; invalid values and calls after Stop/Clear are ignored. It is not a public event field or host command. Session/generation checks apply before recording events or drops. On background entry, stop UI sampling immediately, capture the worker's synchronous cancellation evidence, flush its bounded batch, then finalize the report with reason background. Late unrelated operations remain excluded. No timers run solely to forward diagnostics while recording is off.

### SYNC-08. Durable verified calendar projection checkpoints

An optional account-local DAV checkpoint accompanies the same validated durable source snapshot, never the public launch checkpoint or cloud organization files. Its shape is `{version:1,projectionVersion:1,accountKey:string,collections:DavCollectionCheckpoint[]}`. A collection entry has `href:string`, `token:{kind:'sync-token'|'ctag',value:string}`, `components:string[]` containing supported VEVENT/VTODO names, `readonly:boolean`, finite millisecond `from:number,to:number` with from<to, and `resources:{href:string,etag:string,taskKeys:string[],eventKeys:string[]}[]`. Resource keys are the existing stable native `record.identity.key`, not reconciled display IDs. Validate account, source, collection/resource origin/path, unique entries, strong ETags and every referenced row's source, native identity, href, raw baseline and revision. Empty key lists explicitly represent a fully processed resource with no projected rows. Unsupported/invalid/incomplete checkpoints are disposable and fall back to normal validated discovery/cache reading; never discard valid records/drafts with them.

For the cache-backed fallback reader, project the complete fixed UTC-day interval `[UTC midnight today minus14days, UTC midnight today plus91days)`. Persist all normalized records supporting that interval. This only broadens background availability by less than a day at each edge relative to the existing rolling14/90-day interval; visible calendar ranges and overlap rules do not change. A checkpoint's event coverage may be reused only for the same certified interval and projection version. Task projections do not depend on this interval. At day rollover, reproject affected event resources from validated raw cache, without downloading bodies whose fresh strong ETags still match. Preserve existing recurrence exceptions, all-day endpoints, timezone and readonly restrictions.

Fresh collection discovery always checks access, components, permissions, title/color and available sync-token/ctag. Skip that collection's resource inventory/body reads/projection only when a trustworthy change token matches, the checkpoint is complete, permissions/components are compatible and every required normalized baseline is present for the requested horizon. A matching token is not proof of authorization. Changed/absent tokens or invalid seeds fall back to fresh resource inventory; reuse a resource's already normalized projection only with matching strong ETag, native identity, compatible permissions/components and adequate coverage. Permission changes force reprojection rather than broadening a complex item's readonly restriction. Refresh source metadata without reparsing unchanged content. Removed or denied collections invalidate their seed/checkpoint immediately. Acknowledged native writes invalidate the affected collection checkpoint before later refreshes can reuse it.

Emit a completed collection checkpoint only after its entire authoritative inventory and required projection succeeds without cancellation, missing files, parse failures, byte/time limits or truncation. Commit it atomically with the exact durable source baseline it certifies. Partial results may retain successfully downloaded resource cache entries, but cannot advance a complete checkpoint or mark the source verified. Old complete checkpoints cannot be re-certified after an interrupted changed collection. Keep independently completed source-family results intact.

The optional resource cache may expose `list({kind:'dav',collection:string})` returning bounded validated `{href:string,etag:string}[]` metadata without bodies. This is a scheduling hint, never authority for remote membership. After a fresh resource inventory, prioritize missing/changed validators before cached unchanged resources so a cold reopen resumes useful download work rather than replaying the same prefix. Missing/truncated metadata is safe to treat as unknown. Keep finite per-request/pass/cache limits; do not solve timeout by unbounded retries, increased deadlines or fabricated success. Existing REPORT-capable and Files SSO transport boundaries remain; this milestone does not fabricate sync-collection REPORT support. No workspace/folder protocol version change is needed.

### PRESENT-17. Bounded publication, Board rendering and deferred editors

Consume the supplied host snapshot rather than fetching/cloning the same full state again. Permit at most one scheduled background adoption plus its latest pending snapshot; discard obsolete intermediate notifications, never the newest acknowledged edit or source state. Existing account/revision/draft guards and three-way merge semantics remain. Reuse unchanged record/collection branches and avoid retriggering the full planner projection for progress-only changes. Cached selection/panel opening must not require another source refresh.

Board rendering may window card groups to the visible vertical viewport with bounded overscan while preserving full column heights, empty columns, original custom order, counts, unified status mappings, linked-task stacks, drag/drop and highlighting. Render a selected, keyboard-focused or actively dragged card even outside the normal window. The window unit is a complete linked card/task stack; never split away its dependent controls. Variable-height cards/checklists require measured geometry or conservative estimates corrected without scroll jumps. Keyboard focus and dragging must be able to reach offscreen targets; windowing must not change source data, filters or order. Render at most the initial bounded viewport before measurements, not an unbounded fallback. Production layout/window helpers remain pure and deterministic; tests cover clipping, retention, empty columns and stable order.

Board window defaults are a640px unmeasured viewport,180px estimated complete-stack height,8px inter-stack gap and360px overscan on either side. Measured positive heights replace estimates. Intersections use exclusive end boundaries; explicitly retained stack IDs remain in logical order. Empty columns have zero stack height and keep their heading. Adjust scroll by the change in the first visible stack's top after measurement, retaining its relative screen position. These are presentation geometry defaults, not task fields or synced organization.

Rich text editors and heavy optional dialog bodies load on demand, after the surrounding shell can render. Failed loads offer retry and do not discard content. An unmounted editor or pending import cannot run a native save or apply a late draft to a different item/account.

Release authorization: after fast verification and source freeze, package this milestone once as Android 0.6.6/versionCode8. Preserve signing/application/storage identities. No Windows packaging, Web implementation, emulator launch or publication. The new APK is build evidence; physical cold-start, sync completion, scrolling, battery and thermal acceptance still require testing on the user's devices.

### EDIT-09. Android completion and touch booking preview (2026-11-13)

The owner now authorizes Android and its browser preview to implement the existing native completion actions, extending the earlier Notes/dates/scheduling milestone. Use the existing `setTaskCompleted({id:string,completed:boolean})` and `setCardCompleted({id:string,completed:boolean})` API contracts. Inputs require a valid loaded ID and an actual boolean; reject missing/wrong-source/read-only/unsupported resources before issuing a write. Tasks use the reference COMPLETED/NEEDS-ACTION status, COMPLETED timestamp and percentage rules; Deck uses its native done timestamp independently of its stack. Completion never finishes linked work, checklist rows or calendar bookings. Reopening does not move a Deck card's stack. Preserve native conditional writes/fresh readback, record serialization, account guards, exact revision baselines and failed-edit retry. Use the existing shared native protocols rather than a second implementation.

The existing private `nativeEdits:'notes-dates-scheduling'` profile identifier is retained; the current implementation may additionally advertise `setTaskCompleted` and `setCardCompleted` in its explicit public/runtime operation list only after those methods and transport guards are implemented. Per-operation presentation gates must check the matching implemented method, host allowlist and runtime allowlist, followed by current source and item/collection write permissions. The blanket mobile `canMutateNative:false` flag must not disable these supported actions. An explicit empty runtime list, stale/unverified source, unavailable authorization or read-only collection continues to disable them. Other unfinished status/creation/dependency operations remain gated. Show done continues to govern whether the acknowledged completed item remains visible.

Schedule in calendar's unsaved preview supports touch move and start/end resize as well as existing mouse and keyboard input. On its preview body or edge, use the shared 500ms stationary hold and 8px early-pan threshold: an early swipe scrolls; an armed hold-drag changes the local draft interval. Time slots retain 15-minute snapping and the existing minimum 15-minute span; all-day spans retain whole local-calendar days, a minimum one day and exclusive end. Moving preserves the interval's existing wall-time/day arithmetic. Extract interval transforms into pure helpers and use them from mouse, touch and keyboard paths. Pointer release updates only the form draft; a remote event is created only by Create & link. Preview text is nonselectable, while inputs, notes and unrelated context controls keep normal behavior.

After local date/time normalization, a transformed preview must still have a positive interval meeting its minimum span. A daylight-saving gap that normalizes the endpoints into an inverted, zero-length or shorter-than-minimum interval rejects that transform and retains the previous valid draft/preview; it must not emit or display an invalid replacement.

A second finger, pointer cancellation/lost capture, Escape, disposal, scope/item replacement, removed preview or a newly locked submitted/busy request cancels the gesture without writes or an accidental click. Preserve the original draft after cancellation. Draft editing does not require fresh source availability: a temporarily stale/unavailable destination may retain an editable draft, while submission still requires its existing writable verified destination and native-operation checks. A submitted/pending request retains its immutable journal payload and cannot be moved through the preview until the existing retry/cancel rules permit it. Keep the compact dialog's ordinary scroll behavior; this change does not add a new dialog zoom setting.

### SYNC-09. Accurate planner outcomes and reduced repeated work (2026-11-13)

Planner diagnostic completion must reflect the returned storage state, not merely a resolved synchronization Promise. A returned error/conflict is unsuccessful with its sanitized actual error code; offline/pending/saved-locally is not a verified cloud success. Preserve the last verified cloud timestamp and display the real retry state. Expected probe misses or existing-folder responses are not failures by themselves. Provider/network failure must not automatically revoke authorization, clear caches or replay an uncertain mutation. The sanitized recorder cannot establish another application's crash cause; do not report such a diagnosis without native crash evidence.

Cache and folder optimizations must retain current conditional-write, revision, import/merge, account, revocation, journal and recovery guarantees. A locally unchanged source archive need not be serialized and rewritten just because source freshness timestamps changed; persist freshness separately or through the existing compact launch state without falsely claiming changed source content is durable. Acknowledged native edits and scheduling intent remain recoverable. Never remove a durable booking journal or report an unpersisted link as completed. Native write acknowledgement and custom-cloud synchronization are separate outcomes; do not hold the booking form open solely for an automatic cloud upload after the event and its link are safely saved locally.

Folder reads may reuse cached parsed documents only after fresh strong-validator verification for that exact account/path. Conditional GET/304 or a fresh matching inventory ETag may avoid repeated bodies and parsing, including large legacy/import baselines. Changed/missing/weak validators require the established full validated read; no stale cache may conceal a remote change or removal. Preserve legacy conflict detection and post-write conditional/readback validation. Successfully verified parent folders may be reused within the current account session to avoid repeated creation probes; missing/replaced-folder responses invalidate that assumption. No cloud schema or identity change is required.

The parsed planner-document cache is account/client-instance-local, limited to32 entries and16MiB UTF-8 content, with the existing8MiB per-document limit. Eviction only loses a performance hint. Folder enumeration reads the generation root freshly before enumerating its known child directories; only children present as collections need a request. The complete before/after inventory comparison still detects directory/file additions, removals and concurrent edits. Do not treat an unlisted required file as optional or suppress permission errors.

Android may use a small acknowledged-native-edit overlay under the existing private two-slot cache, keyed by SHA-256 of `source-edits\0` followed by the account cache key. The validated value is `{version:1,accountKey:string,sequence:number,entries:{sequence:number,record:PrivateNativeRecord,collection:PrivateNativeCollection}[]}`. The top sequence is a nonnegative safe integer; entry sequences are positive safe integers no greater than it. Native identities are unique and retain exact validated raw edit baselines and collection locators. The overlay is at most128 entries and16MiB UTF-8, contains no credentials, and is never synced to the planner folder. Source-cache value version2 additionally permits optional `acknowledgedSequence:number`, a nonnegative safe integer defaulting to0. This is separate from cloud workspace/folder versions.

After native readback and identity reconciliation, persist the exact acknowledged row/collection in the overlay before returning edit success. Sequence allocation starts above both restored overlay sequence and archive watermark and remains monotonic across restart. Restore the validated archive and apply only newer overlay entries by stable native identity before exposing authoritative private edit state; native authorization/source verification gates still apply. If the archive is missing or unreadable but the overlay is valid, recover its acknowledged rows and watermark independently before a fresh source refresh. A subsequent authoritative refresh must persist that watermark so a later restart cannot replay an older overlay over newer server data. Invalidate affected DAV checkpoints after overlay application. Never assume the display ID alone identifies a native row. Missing overlay means no pending overlay; corrupt nonmissing overlay is a visible recovery condition that blocks native edits and preserves files, never an empty replacement or silent fallback to an older acknowledged edit.

A full archive fold includes all applied acknowledged edits and its watermark. Covered overlay entries must remain until BOTH validated durable archive generations cover their sequence, so corruption of the newest archive cannot resurrect a pre-edit fallback. It is acceptable to retain covered entries until capacity requires a double archive rotation; discard none after only one archive write. Capacity or an oversized acknowledged row uses the safe full-archive persistence path, without reporting success before required durability. Freshness-only syncs may skip an unchanged archive but still persist compact source status/last-success data; permissions, native bodies/fields, collections, checkpoint validity and watermark are not ignorable differences. Confirmed source permission revocation purges affected archive, launch and overlay resources through guarded cleanup; a failed purge remains an explicit recovery error. Ordinary disconnect invalidates authorization, active operations and launch hints while retaining account-qualified private recovery data and pending metadata for same-account reconnection. No retained account data is exposed in another account or a disconnected profile. An overlay cannot reintroduce revoked resources. Existing durable booking intent/created/linked journal rules remain unchanged.

An individual native request deadline owns its own cancellation token, HTTP call and acquired response stream. Timeout or cancellation of a queued/active request must not close the shared provider/API transport or cancel its siblings. Late-acquired streams are closed if their request was already cancelled; late results cannot publish. Account replacement, genuine authorization revocation and explicit lifecycle transport shutdown retain cancellation of all affected requests. Keep bounded worker pools, finite deadlines and no automatic mutation retries. A provider call that ignores interruption must not trigger unlimited replacement threads or requests. Treat this as request isolation, not proof of an external application's crash cause.

This feedback authorizes implementation and fast tests only. Android remains packaged at0.6.6/code8 until another explicit build request. Do not run full app/UI builds, package Windows, launch an emulator, publish, or implement the postponed Web client in this iteration.

### RELEASE-07. Requested Android package (2026-11-13)

The owner subsequently explicitly requested the APK. Package the frozen EDIT-09/SYNC-09 changes as Android 0.6.7/versionCode9, one patch increment for this release. The final asset build, native sync, APK assembly and package verification are authorized for this milestone. Preserve application ID, signing certificate, account/cache identifiers and cloud storage protocols; keep earlier APKs. No Windows packaging, emulator launch, live-account writes, Web implementation or publication. Package success is distinct from physical-device performance and provider stability acceptance.
### EDIT-10. Native attachments and explicit calendar deletion (2026-11-13)

The 0.6.7 follow-up enables the existing native attachment contract on Android, including its primary Files authorization transport. Keep the existing Notes-first multi-select dialog, Other files tab, create-note path and explicit upload picker. Capability gates are per operation: `listFiles`, `readDeckAttachments`, `attachDeckFile`, `removeDeckAttachment`, `uploadDeckAttachment`; a host's lack of unrelated native operations must not disable these. Native permissions, current authorization and account guards still apply. Non-Deck work keeps its existing supported note/reference relation flow. Never claim a native attachment succeeded by saving a planner-only relation.

Reuse the established Deck v1.1 attachment, shareType 12/read permission 1, immutable file identity, idempotence, readback, safe detach and 20 MiB upload rules. On a transport without SEARCH, the connector may select `fileLookupMode: 'notes-propfind'` instead of default `'search'` for immutable note-file lookup. Read the configured Notes folder from the Notes settings API, validate its account-relative path, and traverse only that folder with Depth-1 PROPFIND. Bound traversal to 256 directories, 10,000 entries and depth 16; no file-content reads, title matching or whole-account scan. Accept only an exact immutable file ID; ambiguous, inaccessible, missing settings/root, exhausted bounds or absent matches are explicit failures. Never silently attach a same-named file. Direct transports retain SEARCH. Explicitly selected Files paths retain their existing fresh validation.

Uploads use a host-owned explicit picker. Android's private bridge `chooseAttachment({accountName})` returns `{cancelled:true}` or `{token,name,size}`; `uploadAttachment({accountName,token,boardId,stackId,cardId})` consumes that short-lived single-use token and returns `{uploaded:true}` only after the bounded native multipart acknowledgement. Content URI, credentials and binary bodies never enter presentation state. Account/lifecycle changes invalidate tokens. The application verifies card writability before upload and refreshes attachments after it. Cancellation is not a save failure. Preview may retain the selected File in host memory and use its existing bounded loopback multipart transport.

Add optional `WorkspaceApi.deleteEvent(input: {id:string}): Promise<State>`. It deletes the selected native calendar event after an explicit confirmation naming the event. Read-only, unsupported or cached-unverified source state cannot grant deletion. The native adapter resolves the private stored identity and exact collection-member href, fetches a fresh resource/strong ETag, verifies that the baseline has not changed and performs conditional DELETE with If-Match. Only a single ordinary VEVENT is eligible: exactly one matching UID, no recurrence/master/exception rules, invitation/organizer/attendee/METHOD, or other content-bearing component (VTIMEZONE is allowed). Complex events offer Open in Nextcloud rather than deleting an entire series or a mixed resource. A conflict, permission loss or uncertain response preserves the local item and reports the actual failure; success requires a confirmed DELETE or verified remote absence. Do not replay uncertain writes blindly.

After confirmed deletion remove that native event from visible/source caches, update counts, and prevent an older in-flight refresh or fallback archive from resurrecting it. Persist deletion using existing guarded source-recovery mechanisms. The Android account-local acknowledged-edit envelope version 1 permits optional `deleted:true` only on a calendar-event entry containing the exact validated prior event and collection. Missing `deleted` retains replacement semantics; any other deletion flag value/type or source is invalid. Applying such an entry removes its native identity rather than adding a record and invalidates that collection's DAV checkpoint. It uses the existing monotonic sequence, strict corruption handling, 128-entry/16-MiB limits and two-generation coverage before retirement. This is a local acknowledged deletion, never a cloud workspace tombstone. A refresh begun before acknowledgement cannot reinsert that identity; only fresh validated post-deletion source evidence can establish a deliberately recreated server event. Do not replay an older deletion over a newer archive watermark. Linked tasks/cards/notes, identities, custom relations and scheduling receipts are retained; missing event references follow the existing unresolved-reference rules. Deleting a booking never completes/deletes its work or recreates the booking. No new cloud schema is introduced. Existing event date/duration editing remains available; this milestone does not authorize recurring-series or invitation editing.

### SYNC-10. Recoverable notices and bounded cache transfer (2026-11-13)

Routine refresh activity and recoverable planner/source NETWORK, TIMEOUT, LIMIT or other retryable failures use the cloud indicator with accessible status text and full Settings details, not a full-width banner. Offline and not-yet-checked data are also indicator states. Preserve last successful times, partial counts, safe error codes/stages and retry controls. Authorization/recovery required, planner conflict, permission review and local-cache/save recovery failures remain prominent actionable notices. Individual failed edits and unsaved drafts remain prominent; quiet retry must never conceal a lost write. A pure `syncNoticePresentation(notice)` returns `none`, `indicator` or `banner`, without changing the existing notice payload. The cloud remains an enabled details entry during syncing/errors, so users can inspect/retry instead of being trapped behind a disabled spinner. Retry success clears stale error presentation through actual state transitions, not an arbitrary timer.

Private source snapshots must not cross the presentation/native bridge as one multi-megabyte string. The Android storage adapter may expose a bounded `cacheFile` port with operations `size`, `read`, `beginWrite`, `append`, `commit`, `abort`, `remove`, accepting only the existing validated app-private `cache/<sha256>.[01].json` paths. Reads/writes transfer at most 256 KiB of raw bytes per chunk; base64 is transport encoding only. Total archive bound remains 50 MiB. Sequential offsets, length checks, native-held write tokens, a staged temporary file and atomic target commit prevent partial archives. Disk work runs away from the UI thread; cancellation/account-generation checks happen between chunks and before commit, abandoned stages are cleaned, and paths cannot escape the fixed cache directory. Serialise conflicting path operations and reject stale/foreign tokens. Cache restoration is local and must not depend on provider authorization.

The presentation bridge injects its current worker-session owner into private cache operations; callers cannot impersonate another owner. Reject overlapping same-path staged writes. Worker replacement can discard an abandoned uncommitted stage, never a committed journal/archive. A chunked read must observe one stable file generation (retained read handle or verified revision across all chunks); concurrent replacement cannot silently combine generations. UTF-8 chunk boundaries preserve exact content. The worker still performs complete envelope/JSON validation, exact acknowledged-edit handling and the existing two-slot generation selection. Keep fresh on-disk validation, corruption recovery, revocation safety, monotonic edit watermarks and two-generation retirement. Do not change workspace/folder/envelope formats or use unchecked in-memory heads as a shortcut. This port bounds main-thread bridge payloads; it does not justify claiming that storage latency or physical-device stalls have disappeared. Avoid rewriting unchanged source archives and keep source progress on the lightweight sync subscription. Keep public state detached and editor drafts preserved.

Presentation selectors depend on actual record/workspace/collection and username inputs, not refresh-only connection reference changes. Defer heavy Settings sections until needed; closed color sections do not mount every control, and stopped diagnostics do not run a permanent polling clock. Active recording may update a bounded elapsed-time display. These changes must retain accessibility, settings state, source messages and drafts.

### RELEASE-08. Both-client follow-up package (2026-11-13)

The owner explicitly requested both apps after EDIT-10/SYNC-10. After fast tests and source freeze, package Android 0.6.8/versionCode 10 and Windows 0.6.3 once. Full final UI/assets/native packaging is authorized for this milestone only; preserve old artifacts, application/signing/storage identities and private account data. Web remains on hold. Record build, signature/manifest/assets and checksum evidence separately from unperformed physical-device acceptance. No publication or deployment.

### ORG-06. Discoverable Space removal and scoped dependency selection (2026-11-13)

Every existing Space's navigation three-dot menu exposes **Delete Space**, including compact layouts. Keep the management-form removal entry. Confirm the Space name and explain that its groups/project definitions are removed while native sources/items and global links remain. Protect unsaved drafts before switching to confirmation. Reuse pure organization removal, prune only removed-scope local preferences/order references, and return to My overview if the active Space/group/project was removed. Persist through existing metadata conflict/save handling; never report a failed removal as saved. There is no deletion action for My overview.

Dependency picker candidates are loaded tasks/cards from the current Space's effective source pool (`organizationSourcePool`: Space sources plus its groups and nonarchived project sources). A selected group/project resolves to its owning Space; tag rules do not further narrow this source-based picker. My overview can choose from all loaded sources. Missing/removed current scope yields no candidates rather than all records. Existing cross-Space links stay visible/removable. Do not infer a Space from the selected item's source, and do not use page search/completion/assignment filters to narrow this picker. Candidate counts and text describe the current scope accurately. Keep the entire loaded graph for cycle/duplicate/permission checks, separately from candidate IDs. Recheck scope membership at submit and after scope/source changes; a formerly selected excluded target cannot be submitted. Native Deck direction and native-write requirements remain unchanged.

### FILTER-02. Page-local filters and Board completion visibility (2026-11-13)

Filters are device/account/scope/**page** local. Overview, Calendar, Timeline, Board and List each retain independent assignment/unassigned/source filters, search, attention, item kind, unified status IDs and completion visibility. Switching pages saves the departing filters and restores the destination's filters without changing sources, organization, dates, drafts or other pages. Reset affects only the current page and retains its completion setting and existing presentation options. New pages use scope-default assignment (`me` for My overview, `all` otherwise), empty query/status/source filters, attention/kind `all`, unassigned false and closed tasks hidden.

The existing account storage key is retained. The local preference store becomes `{version:2,scopes:Record<scopeId,ScopePages>}`. `ScopePages` is `{view:PlannerView,pages:Partial<Record<PlannerView,PageFilters>>,calendarMode:'day'|'week'|'month',timelineFloatingEvents:boolean,timelineListCollapsed:boolean,boardGroupTasks:boolean}`. `PageFilters` is `{assignment:'me'|'all',includeUnassigned:boolean,unassignedBoardIds:string[],hiddenCollectionIds:string[],showCompleted:boolean,query:string,attention:'all'|'overdue'|'today'|'undated'|'blocked',listKind:'all'|Source,statusIds:string[]}`. Retain existing bounds (2,000 query characters, 5,000 distinct safe IDs per array, 2,500 safe scopes and 2,000,000 serialized characters), known-page allowlisting and prototype protection. Resolved UI snapshots may remain flat; only this versioned map is persisted. Recognize v1: migrate its filters into its saved active page only, preserve explicit `showCompletedByView` choices on their pages, and use clean defaults for other pages. Do not spread the old search/source/status selection into every page. Android's existing local device-state value gains optional `scopePreferencesVersion:2`; absent means legacy1. Normalize and retain that marker with the scopes map through restart/checkpoints. It is independent of enclosing cache versions and never cloud metadata.

Board distinguishes completion from archival. Native archived/deleted Deck boards/cards remain excluded by the existing source ingestion; this request does not fetch archived data or introduce an archive-management UI. A loaded nonarchived Deck card remains on Board when marked done, independently of the task completion toggle. Label that Board toggle **Show completed/cancelled tasks**; default false unless explicitly saved. Other layouts keep their existing closed-work behavior.

On Board, a task with `completed:true` linked directly to an otherwise visible nonarchived Deck card may pass the completion filter even when that toggle is off. Recognize existing direct work-to-work `depends_on`, `related` or `reference` links in either direction; no transitive expansion. Cancelled-only tasks do not receive this exception. Source/scope/assignment/search/unified-status filters still apply: a hidden card cannot admit a task, and explicit task filters cannot be bypassed. Keep task completion styling and status, and never increase open counts. With Group linked tasks off, admitted tasks keep their own columns; when enabled, only directional `depends_on` links form the existing stacks. Non-Board pages must not inherit this exception. No native completion, stack, archive or custom relation is changed by visibility.

### EDIT-11. Calendar deletion representation equivalence (2026-11-13)

The same unchanged iCalendar resource may use LF in XML REPORT data and CRLF in GET, or equivalent content-line folding. For EDIT-10's full-resource baseline comparison, normalize CRLF to LF, unfold LF followed by exactly one SPACE/TAB, and ignore at most one terminal line ending. Do not trim other whitespace, sort properties, change case, drop unknown properties/timezone data or compare only projected fields. Preserve substantive-content conflict detection. Original strong ETag guards remain required on fresh GET and DELETE; a changed validator remains a conflict even if normalized content matches. Never silently adopt a new version or retry deletion against unseen changed content. Keep both-resource validation, recurrence/invitation restrictions, confirmed-delete recovery and all existing failure states.

These follow-up changes authorize implementation and fast checks only. The RELEASE-08 packages are historical completed artifacts; no new full build or patch increment is requested in this iteration.

### EDIT-12. Native event details and booking defaults (2026-11-13)

New calendar bookings expose an editable title, location, description and reminders alongside the existing date/time preview. Schedule in calendar keeps its current task/card-title default, but the user can replace that title without renaming or changing the linked work. Prefill its description once with the original linked task/card title, source name and safe native source URL when available. Use a pure `linkedEventDescription(record)` helper: `Scheduled work: <title>`, newline `Source: <collectionTitle or Tasks/Deck>`, then an optional newline and safe HTTP(S) URL without credentials. Do not invent a URL or insert passwords, IDs or hidden metadata. The description remains fully editable, may be cleared, and is not regenerated after the user edits it. The real scheduling relation is independent of the title/description. Existing events use their actual saved fields, never overwrite them with booking defaults.

Extend public event records with optional `location:string`, `reminders:number[]`, and `unsupportedReminderCount:number`. Reminders are whole minutes before DTSTART: 0 means at start, allowed range 0–40320 inclusive, at most five distinct entries, normalized ascending. Reject nonintegers, negative/out-of-range entries, duplicates, wrong types or excess entries in write input. Omitted legacy record values display as empty location/no known simple reminders, without assuming the event has a default alarm. Unsupported reminder count is a nonnegative integer representing preserved alarm forms outside this editor.

Extend `ScheduleRequest` and event creation input with optional `location:string` and `reminders:number[]`. A **new draft** explicitly defaults to `[15]`, including ordinary New event creation; the user may select no reminder (`[]`) or add/change supported offsets. Defaults are applied in draft creation only: absent fields on restored pending journals/legacy API calls stay absent, so their original digest and retry payload remain stable. All submitted title/description/location/reminder fields freeze with the existing immutable scheduling request. Retry must not change those fields or create a second event.

The pure `newEventDetails(record?)` helper returns `{title:record?.title or '',location:'',description:record ? linkedEventDescription(record) : '',reminders:[15]}` with a fresh array. This is the shared new-draft default, not an existing-event or restored-request normalizer.

`WorkspaceApi.updateEvent` accepts `{id:string,start?:string,end?:string,allDay?:boolean,title?:string,description?:string,location?:string,reminders?:number[],etag?:string}`. At least one edit is required. Date edits supply both start/end and retain existing interval/timezone/all-day validation; allDay cannot be changed without dates. Details-only edits preserve the original times and unrelated native properties. Title is trimmed, nonempty, at most500 characters. Location is a string of at most2000 characters; description at most500000; both may be empty to clear, and all text rejects NUL. Omitted fields preserve their exact native counterparts. The details editor submits its captured ETag; if provided, the protocol compares it to the current private baseline before any write, so a queued draft cannot silently adopt a background-refreshed version. Keep native permission/current-baseline/strong-validator checks and fresh readback; conflicts retain the draft and never silently overwrite a newer server event. Android advertises updateEvent only when the implemented exact operation and host transport are available.

Store editable reminders natively as DISPLAY VALARMs with a relative duration TRIGGER before DTSTART (0 at start), an absent or START RELATED parameter, and DESCRIPTION populated from the event title. No local-only substitute or custom cloud alarm metadata. On explicit reminders edits replace only simple supported alarms; preserve EMAIL/AUDIO alarms, absolute triggers, end-relative alarms, repeating alarms, and alarms with extra unsupported properties/parameters. Display that other native reminders are preserved when present. Leaving reminders untouched must preserve every original alarm, including its description and custom data. Parsing may report at most the supported editable limit; any additional/unsupported alarm remains counted and preserved, not silently dropped. Notifications are the native calendar alarm settings, not a newly introduced background notification scheduler.

Ordinary existing events expose an **Edit event** action opening these fields and the existing situational calendar/date preview; save updates the selected event. The same ordinary-event restrictions as existing date editing apply: recurring/invited/mixed resources stay delegated to Nextcloud. Preserve linked work, event identity, other source properties, optimistic failure/draft handling and per-operation capabilities. New event creation, linked scheduling and existing-event editing share the same pure field validation/default helpers and reminder controls. No new cloud schema or authorization endpoint is required.

Event-detail projection advances the disposable private DAV checkpoint `projectionVersion` from1 to2 (checkpoint envelope `version` stays1). Old projection checkpoints are incompatible hints, not damaged user data: retain valid source records/drafts and reproject resources from freshly validated cached raw content. Do not trust old normalized events to contain the new details, clear user caches, or redownload unchanged bodies merely to change the projection. Only a complete successful pass certifies a new version2 checkpoint. Workspace, folder and acknowledged-edit schema versions remain unchanged.

### RELEASE-09. Windows and Android packages after organization and event fixes (2026-11-13)

The owner explicitly requested both apps after ORG-06/FILTER-02/EDIT-11/EDIT-12 implementation and fast verification. Package the frozen changes as Windows **0.6.4** and Android **0.6.9/versionCode 11**. This authorizes the final asset/native builds, local package verification and isolated smoke tests for this release only; subsequent coding iterations retain the no-full-build policy. Preserve previous artifacts, application IDs, signing identities, account/profile locations and storage/protocol identifiers. Do not publish, install on a personal device, use live-account writes or implement the postponed Web client. Build success and fixture/smoke results do not establish physical-device acceptance.

### SYNC-11. Native cache bridge numeric interoperability (2026-11-13)

JSON integer fields crossing a native bridge are defined by their numeric value, not the host runtime's boxed number type. Chunk-cache `size`, `offset` and `ownerEpoch` must accept finite integral JSON numbers within their existing safe bounds whether decoded as a small integer or a larger integer. Reject fractional/nonfinite/negative/out-of-bound values, strings, booleans and missing required values. Preserve chunk limits, account and owner fencing, stable read revisions and atomic replacement. Do not turn a valid small integer into a missing/default sentinel because of a host getter's representation restriction.

Repairing this transport defect must make intact existing local files readable without resetting accounts, source caches, planner data, journals or cloud files. A failed local read must remain distinct from a successful source refresh. Retain specific bounded local-cache error codes in diagnostics where possible so transport/format/validation failures are distinguishable; never expose file contents or private paths. The owner permits discarding local test data if genuinely necessary for recovery, but this does not authorize modifying or deleting their Nextcloud data. Do not add automatic reset as a substitute for correcting the bridge.

### ORG-07. Independent My overview groups (2026-11-13)

My overview supports the same source and native-tag grouping rules as Space groups. This explicitly supersedes the earlier restriction forbidding Overview grouping. Reuse `Category` with reserved owner `spaceId:'all'`; do not create a synthetic Space, copy Space groups, or add a second grouping format. `all` remains the undeletable overview scope and cannot be an entity ID. Schema 2 and folder protocol 1 remain unchanged. Older clients that reject the newly valid owner must report incompatible organization rather than dropping its groups or overwriting cloud data.

Overview group source choices cover all loaded collections, including sources not selected in any Space. A tag-only Overview group searches all loaded Tasks/Deck/Calendar sources; an explicit collection selection narrows it. Match any selected normalized tag using the existing NFKC/case-insensitive rules; matching does not retag native items. Preserve unavailable selected source IDs and tags. Names are nonempty, trimmed, at most 200 characters and unique within the overview owner. Existing color, ID, tag count and collection validation applies. Source-only groups remain mutually exclusive within their owner; tag groups may overlap and use the existing deterministic grouping precedence without duplicate visible rows.

My overview remains the complete personal view subject to its existing assignment and per-page filters. Groups organize its rows without hiding unmatched sources or changing visibility, default destinations, status mappings, or any Space. With no Overview groups retain the current source-based layout; with groups, show their matching rows together and keep remaining rows accessible. Selecting an Overview group may narrow to its members, and returning to My overview restores the full scope. Its status mapping inherits the overview default. Do not enable standalone projects owned by `all`: this addition concerns groups only.

Expose Group sources beside My overview in its navigation menu, using the existing protected draft editor and optional suggestions. Save, rename, remove and reorder only this owner's groups; discard causes no metadata write or ID allocation. Removal preserves every native item, relation, other group and Space. Group definitions and their applicable saved arrangement synchronize through the existing planner folder/merge protocol. Device-local filters stay local. Preserve unrelated changes and reject stale organization drafts instead of overwriting remotely changed groups.

### EDIT-13. Existing calendar controls, native invitations and task descriptions (2026-11-13)

An event inspector always shows its saved location, description, simple reminders, unsupported-reminder notice and participants when present. Edit event opens the same details/date preview regardless of the originating layout; an event description edit routes through this editor and `updateEvent`. Show Delete event consistently, with an explicit unavailable reason instead of silently omitting it. Operation gates are independent: use `updateEvent` for event editing, `deleteEvent` for deletion, and source authorization/freshness/permissions for each. A repaired local cache must restore legitimately implemented operations. Confirmed native deletion invalidates raw resources and projection checkpoints immediately, including successful 200/204 responses; stale caches must not resurrect it.

Public event records may additionally contain `eventScheduling:{role:'none'|'organizer'|'attendee'|'unknown',organizer?:{uri:string,name?:string},attendees:{uri:string,name?:string,participation:string,role?:string,rsvp?:boolean,scheduleStatus?:string}[],ownAttendeeUri?:string}` and `eventAccess:{editDetails:boolean,editReminders:boolean,editAttendees:boolean,respond:boolean,delete:boolean,reason?:'recurring'|'mixed-resource'|'read-only-calendar'|'missing-validator'|'unknown-identity'|'not-organizer'|'unsupported-scheduling'|'not-calendar-owner'}`. These are protocol-projected evidence, not client guesses. Participant URI/name/status are native values rendered as text, never executable links or credentials. An absent access object retains the established ordinary-event eligibility. Unsupported resources remain readable with an explanation and Open in Nextcloud.

Separate resource safety from scheduling role. Keep generic invitation date-drag/content/status operations locked through `readonly`; explicit event operations may act only on independently validated eventAccess. Revalidate the private raw resource, current collection access, captured strong ETag and authenticated identity before writing. Discover the authenticated calendar principal's `calendar-user-address-set` and calendar ownership/privileges; never infer organizer mail from a username or accept arbitrary organizer input. Ordinary nonrecurring writable owned calendars support organizer invitation editing and attendee responses. Shared/delegated ownership, unavailable identity, recurring/RDATE/EXDATE/RECURRENCE-ID, METHOD or mixed/multiple-event resources remain protected. No broad removal of existing guards.

Add optional `attendees:{email:string,name?:string}[]` to event creation, ScheduleRequest and updateEvent. At most 100 distinct mail addresses, nonempty trimmed address of at most 254 characters, no whitespace/control characters, one nonempty local and domain part separated by `@`; display names optional, trimmed, at most 200 characters, no control characters. Reject duplicates case-insensitively, malformed entries and unexpected shapes. Omission preserves participants exactly; `[]` explicitly removes them. Adding attendees to an ordinary event uses the verified authenticated organizer. Keep existing participants' native parameters and responses; new attendees default NEEDS-ACTION with RSVP true. Preserve unrelated iCalendar properties, timestamps/SEQUENCE scheduling rules and unsupported alarms. A new draft starts with no attendees; restored booking requests without this field must keep their digest unchanged.

`respondToEvent({id:string,etag:string,participation:'ACCEPTED'|'TENTATIVE'|'DECLINED'})` edits only the verified matching attendee response, not the organizer or other attendees. Organizer-owned events allow details, reminders and participant changes and confirmed deletion; attendee-owned copies allow their own response and supported personal reminders, with restricted other controls clearly explained. The native CalDAV server performs scheduling delivery when the resource is changed/deleted. Do not send duplicate invitation mail, suppress scheduling headers or emulate invitations using custom metadata. An acknowledged save is not a guarantee that mail was delivered; show saved native scheduling status when available. Handle conflict/permission/network/uncertain acknowledgements without automatic mutation replay or duplicate creation. All operations remain capability-gated until their complete host path exists.

Task creation and existing task descriptions use the shared formatted/Markdown editor, including checklist syntax and direct checklist toggles where already supported. Preserve exact text and drafts through refresh, failure and mode changes. Android implements native `createTask` and task `updateDescription` through the existing guarded VTODO protocol, durable acknowledged-edit path and per-operation gates; never save task content solely into planner metadata. Existing card/note creation may reuse the same editor without altering native storage semantics. No live invitation, task or calendar writes are part of automated verification.

Calendar collections additionally expose `calendarScheduling?:{canInvite:boolean,organizer?:{uri:string,name?:string},reason?:string}`. Derive sending capability from freshly discovered principal mail addresses, matching DAV calendar owner and own scheduling outbox's schedule-send(-invite) or DAV:all privilege. No arbitrary organizer selection. Invitation write mailboxes use the ASCII mailbox subset described above; exclude an organizer duplicate. Malformed or duplicate native scheduling participants prevent edits, without hiding readable participant information. An attendee's response sets their PARTSTAT and RSVP false, updates DTSTAMP/LAST-MODIFIED and preserves SEQUENCE. Attendee reminder-only edits preserve organizer fields/SEQUENCE. Organizer edits follow native sequence/timestamp requirements. Confirming organizer deletion explains guests may receive a cancellation; attendee copies provide Decline and Open in Nextcloud instead of organizer deletion.

Advance disposable DAV `projectionVersion` to 3 for participant metadata, retaining envelope version 1 and existing upgrade behavior. Recompute scheduling authority from fresh collection/principal discovery even when cached normalized records can be reused by unchanged token; old cache eventAccess cannot certify present write authority. Native calendar access and recipient delivery are distinct. The invitation design follows [Nextcloud's calendar manual](https://docs.nextcloud.com/server/latest/user_manual/en/groupware/calendar.html#invite-attendees-to-an-event) and [RFC 6638](https://www.rfc-editor.org/rfc/rfc6638). Recurrence/series editing, delegated organizer accounts, people free/busy search and room/resource booking remain explicit follow-up features, not implied by this milestone's ordinary event/invitation operations.

A mutation's private protocol result may carry its freshly discovered `verifiedCollection`; validate identical account/source/collection ID and DAV collection href, then retain that evidence with the acknowledged record. Never adopt a user-supplied collection authority or reproject a successful operation using older permissions. If a new-event PUT is acknowledged but its readback fails, preserve the known native identity with an explicit refresh-required creation warning rather than turning it into an apparently unsaved draft that invites a duplicate. Linked scheduling retains its stable request UID and durable journal recovery rules.

Some native invitations also list the organizer as an ATTENDEE. Preserve that existing self-attendee and its parameters when editing guests; it is not a malformed duplicate merely because it matches ORGANIZER. Show it in the saved participant summary, but omit it from the editable guest list. New guest input cannot add the organizer again. Clearing guests removes the other attendees and retains the native self-attendee. Duplicate ATTENDEE rows for the same address remain unsupported.

### RELEASE-10. Cache repair, event controls and Overview grouping packages (2026-11-13)

The owner requests both apps after SYNC-11/EDIT-13/ORG-07 and fast verification. Package the frozen milestone once as Windows **0.6.5** and Android **0.6.10/versionCode 12**. Final asset/native packaging and isolated package smoke/verification are authorized only after implementation and targeted checks. Preserve all prior packages and native signing/application/account/storage identities; do not reset device data or cloud content as a packaging step. Both clients need this version to interpret overview-owned categories. Do not publish, install on a personal device, send real invitations or implement Web. Local regression evidence and artifact checks are distinct from phone/tablet upgrade and live-server delivery acceptance.

### EDIT-14 / PRESENT-18. Native Android Deck editing and accessible Board creation (2026-11-14)

Android implements the existing native `createCard` contract and extends `updateDescription` to Deck cards, in addition to tasks. Reuse the reference native protocol, validation, assignment/date rules, current card snapshot comparison, readback and acknowledged-edit recovery. Preserve other card fields and native Markdown/checklist storage; no custom-metadata substitute. If creation is acknowledged but optional readback fails, retain its known identity and refresh-required warning; never invite automatic duplicate creation. Enable only the exact implemented operations and retain independent account, source, board/stack and item write guards. Card creation and Markdown descriptions use the same shared form/editor as the reference client. Missing or denied permissions explain why an action is unavailable.

Every Board view provides a compact **Create card** action in the normal page toolbar/options, including touch layouts and empty boards. It opens regular native card creation with the current scope/destination context. A selected native Deck board preselects that board; an unambiguous selected native stack may preselect its stack. A combined mapped column must not be guessed as a native stack. With multiple writable destinations the user selects one; use existing scoped creation rules and draft protection. No new board or source is created implicitly. Existing global New item creation also offers Deck card when its native path is available.

The item inspector must appear above Board cards and their drag/highlight layers in tablet portrait as well as other responsive sizes. Preserve the shared shell layering and modal ordering; the fix must not add arbitrary per-card stacking overrides or obscure the inspector with the scroll surface.

### SYNC-12. Write readiness independent of full source refresh (2026-11-14)

Android may expose ephemeral `State.nativeWriteSources?:Source[]`, a duplicate-free list of recognized source names whose write prerequisites have been verified in the current account/process. It is separate from source freshness, records and sync progress. Never persist or restore this as authorization, and never infer it from the public launch checkpoint. Omission retains the reference client's existing connected-source gate; an explicit list is authoritative for this additional readiness gate. Runtime operation availability, connected authorized account, online state, complete durable local/journal restoration, selected item/collection permissions and supported operation rules all still apply.

A successful fresh collection/board discovery may enable its source family before downloading or projecting all its records. CalDAV discovery may enable Tasks and Calendar independently according to supported collections. Adopt only validated current metadata for the same account and source identity; do not broaden an item's structural readonly restriction. Keep source refresh status partial/unverified until the full data pass actually succeeds. Readiness is cleared on account change, revoked/expired authorization, unresolved durable-edit recovery or known source revocation. Ordinary refresh activity and unrelated source failures do not disable already verified native operations.

Successful authorized permission discovery establishes `connection.connected=true` even while source content remains unverified. Do not recompute it to false merely because no full source scan has finished when verified write prerequisites still exist. This does not mark the cloud icon fully synchronized. Authorization and authoritative local restoration may run concurrently after the early saved-view publication; native writes and planner mutations still wait for their required durable stores and account checks to finish.

Every actual mutation verifies the target's current native permission and captured version independently of bulk synchronization. Existing writes retain strong validators/snapshot conflicts; creation verifies the destination calendar or board/stack without scanning every item. A concurrent refresh cannot overwrite an acknowledged edit, recertify its stale checkpoint or reset a protected draft. Independent native writes must not queue behind the entire bulk scan or optional cache rewrite. Failures preserve drafts/acknowledged identities and never cause blind mutation replay. Readiness means the operation can be attempted safely, not that stale cached content is current or a server will accept the write.

Startup still renders a validated locally saved planner and appearance before authorization/network/full restoration. Measure first public state, durable restoration, discovery, projection and cache work separately. Optimize repeated parsing, serialization, permission lookup and bridge calls with actual equivalent-output/request-count evidence; do not substitute a cosmetic loading-screen removal, raised scan limits or fabricated freshness. Preserve finite deadlines, incremental cache reuse, bounded concurrency and account/cancellation fencing.

Invalidating a certified collection checkpoint after a native write must not discard every unchanged normalized projection. A separate process-local stale projection baseline may retain those rows and resource validators solely as acceleration hints. It must never be exported as a certified checkpoint or use its stale token to skip a fresh resource inventory. Reuse each unchanged resource only after current membership and its exact strong ETag, compatible permissions/components and projection coverage are verified. Changed/deleted resources and revoked collections cannot reappear from hints. Clear obsolete hints on account/source revocation. A newly certified checkpoint still requires a complete successful pass.

When only the event projection horizon changes at day rollover, a freshly discovered unchanged trusted collection token and compatible permissions/components may certify the old complete resource inventory, even though event projections need regeneration. Reproject those events from validated raw cache; task projections remain reusable. A changed/absent token or incomplete baseline requires fresh inventory as before. This optimization must not suppress recurrence exceptions, altered membership, permission changes or display horizon expansion. Request/parse-count regressions must distinguish zero-change refreshes, one-resource edits, rollover and partial/revoked cases.

Targeted ordinary calendar preflight uses the selected collection's fresh component/privilege properties, not a bulk item scan; invitation operations retain principal/owner/outbox checks. Deck creation validates the current board edit permission and selected stack identity. Deck edits retain fresh native card/version comparison and current board permission checks when card responses do not certify edit permission. A failed preflight issues no mutation and retains the draft. Validate all targets against the selected account's allowed source paths.

Early Deck discovery publishes the complete freshly read board inventory and its explicit edit permissions before reading stacks/cards/attachments. It may omit not-yet-refreshed stack choices; cached choices may remain displayed only for the same surviving board, and are never authority for a write. Creation revalidates the chosen stack against that board. Missing/revoked boards lose write eligibility immediately. Clear obsolete permission-error indicators after new affirmative discovery without marking the source content fully refreshed. Data-level/structural read-only restrictions on individual records remain intact.

Fresh server-confirmed destination permission failures carry internal error evidence `nativePermissionDenied:{source:Source,collectionId:string}`. Only the protocol's current target preflight can add this evidence; a local structural/validation failure must not imply that source access was revoked. The host validates the evidence against the current account and matching collection before marking that destination read-only and withdrawing its write eligibility. Preserve readable cached data, unrelated destinations and drafts. Reestablish eligibility only after new affirmative discovery; do not keep advertising a write that the server has just explicitly denied. This internal error evidence is not stored as cached authorization or custom cloud metadata.

### RELEASE-11. Android native usability and sync milestone (2026-11-14)

After SYNC-12/EDIT-14/PRESENT-18 implementation, focused checks and source freeze, the owner explicitly requests one final Android **0.6.11/versionCode 13** APK. Preserve prior artifacts, application/account/signing/storage identities. No full builds during development iterations; this authorizes final Android asset/native packaging only. Windows shared behavior receives fast regression checks, not a new executable in this milestone. Web remains on hold. No real-account writes, personal-device installation, emulator or publication. Fixture timing is not physical cold-start, sync or thermal acceptance.

### EDIT-15. Native operation parity and dependency removal (2026-11-14)

Android implements the existing reference contracts for `setDeckDependency`, `moveCard`, `updateTaskStatus`, `updateRecordAppearance`, `createDeckLabel`, `readRelatedResources` and `readPageAsset`. Reuse their specified native identities, payloads, validations, permission/version checks and native storage ownership. This milestone enables their full host paths; it creates no alternative relation, status, color or tag format. Reads remain scoped to the authorized account and allowed native endpoints. Native source discovery is not blanket mutation authority: every write must revalidate its target and destination permissions, and any operation requiring captured versions keeps its conflict protection. Missing or ambiguous permission evidence cannot authorize a write.

Incoming and outgoing dependency removal use the same canonical dependent-to-prerequisite edge (`fromId` is dependent, `toId` is prerequisite); the visual workflow arrow points in the reverse direction. Removing a native Deck edge calls `setDeckDependency` with its exact IDs and removal intent, then adopts the confirmed native result. Removing a planner-owned edge updates planner metadata through its existing guarded save/merge path. Neither kind may silently delete the other kind or fall back to planner-only removal after a native failure. A failed removal leaves the edge visible and gives a useful error; a successful removal updates both endpoint inspectors and the rendered relation. Touch controls must invoke the same operation as pointer/keyboard controls without accidentally navigating to the linked record.

Shared controls gate each action on its exact implemented operation plus existing authorization, source readiness, item/destination permission and local recovery rules. Do not use a blanket host mutation flag to disable implemented Android actions. Native acknowledgements use the existing durable edited-record adoption, cache invalidation and stale-refresh fencing. New labels use native board labels; source status moves and colors retain all existing mapping/interoperability semantics. These changes do not imply new recurring-event editing, delegated scheduling or unsupported server operations.

Android also implements the existing `exportWorkspace` user action: export one validated current planner metadata snapshot through a user-chosen file destination, with the same schema and exclusions as Windows. Never include account credentials, native source bodies or private caches. Wait for complete authoritative local planner restoration, preserve unsaved editor drafts, and return `{exported:false}` when the user cancels. Report success only after the file is written. Export does not synchronize, modify or reset cloud data; native destination selection is a host effect, not a different export format.

Waiting for the export destination picker is user interaction, not a network request. Keep it pending until the user saves/cancels or the owning session is disposed; do not report a network timeout while the picker can still complete. Apply this distinction across both command and host-effect boundaries without weakening deadlines for network work, permitting automatic replay, or retaining calls after session disposal.

### RELEASE-12. Repository preparation and aligned client packages (2026-11-14)

After EDIT-15, repository organization and parity verification, package both Windows and Android as **0.6.12, build 14**. The common visible product version is `0.6.12`; Android uses `versionName:0.6.12` and `versionCode:14`, Windows uses package version `0.6.12` and numeric executable build/file version `0.6.12.14`. Increment once for this milestone and preserve all existing technical application, package, account, signing and storage identifiers. Final asset/native/portable packaging is authorized after source freeze and fast checks, never during iterations. Keep prior packages unchanged.

Windows output belongs under `win/release/`, Android under `android/release/`; generated packages, private runtime evidence and caches remain Git-excluded. Root launch/build commands and verification paths must resolve the canonical client locations. Consolidate obsolete development/build documentation into a concise public-safe history while retaining private historical evidence outside publishable sources. Preserve authoritative specs, active instructions, useful test evidence and unrelated user work. GitHub preparation does not authorize a license choice, publishing, remote creation/push or deployment.

Verify actual operation coverage and shared behavior separately from compilation and packaging. Report remaining host-specific exceptions and unverified physical-device acceptance explicitly; identical versions and shared-vector success alone do not establish full parity. The future Web target stays an app installed inside Nextcloud using its existing session, shared UI/core/native sources and existing planner folder protocol. Review `web/README.md` for compatibility and unresolved decisions only; do not scaffold, add dependencies, implement, build or deploy Web.
