# Approved NextGlance icon

**Status: approved by the owner on 2026-11-17 — BRAND-01.**

<img src="../packages/ui/src/branding/nextglance-icon.svg" width="144" height="144" alt="Approved NextGlance app icon">

The approved symbol is the stacked Calendar with a rear card, two timeline bars, and a large angular Tasks tick across the lower-right frame. The tick has transparent clearance from the shapes behind it. Earlier icon experiments are not the product identity.

The canonical assets are in [packages/ui/src/branding](../packages/ui/src/branding/). The [manifest](../packages/ui/src/branding/manifest.json) records approval, file hashes, geometry bounds, and the default treatment. The [editable master](../packages/ui/src/branding/nextglance-master.svg) preserves the chosen layered composition; delivery SVGs use the same geometry flattened into a mask-free path for native host compatibility.

| Surface | Approved treatment |
| --- | --- |
| Windows executable/window and browser favicon | [White symbol on solid Nextcloud blue](../packages/ui/src/branding/nextglance-icon.svg), with platform-size raster exports |
| Android legacy launcher | The same blue-and-white badge |
| Android adaptive launcher | Solid `#0082C9` background plus the [safely inset white foreground](../packages/ui/src/branding/nextglance-adaptive-foreground.svg); the same geometry supplies the themed monochrome layer |
| Shared in-app branding | Monochrome symbol inheriting the existing foreground color through `NextGlanceIcon.vue` |
| Nextcloud app navigation | [White glyph](../packages/ui/src/branding/nextglance-mark.svg) and [host-foreground glyph](../packages/ui/src/branding/nextglance-mark-current.svg), selected by the host; the [fixed dark glyph](../packages/ui/src/branding/nextglance-mark-dark.svg) remains an approved alternative |
| Optional branded badge surfaces | [Dark on blue gradient](../packages/ui/src/branding/nextglance-gradient-dark.svg) or [white on blue gradient](../packages/ui/src/branding/nextglance-gradient-white.svg) |

The silhouette is fixed across treatments. Preserve its proportions, two bars, rear card and tick position. Platform padding, raster size and foreground color can vary with the surface. Do not bake a second circle into an adaptive foreground or paint a fixed-color patch into the tick clearance.

The compact monochrome viewBox trims unused margins for navigation and toolbars. The adaptive viewBox places the complete symbol inside Android's central safe area. Neither changes the underlying geometry. Functional Calendar/Deck/Tasks icons and synchronization indicators keep their existing meanings; the application mark identifies NextGlance itself.

The Tasks checkmark comes from Google Material Symbols (Apache-2.0), via the [Nextcloud Tasks source icon](https://github.com/nextcloud/tasks/blob/master/img/tasks.svg) and its [recorded upstream change](https://github.com/nextcloud/tasks/commit/e6d669a830b229c50019c57b51510a7dd54f8e8e). NextGlance composes it with calendar/timeline shapes, scales and transforms it, adds transparent clearance, flattens paths and exports platform variants. Preserve [NOTICE.md](../NOTICE.md) and [the Apache license](../LICENSES/Apache-2.0.txt) with the artwork. SVG change/provenance comments and current manifest hashes reflect this attribution; they do not change the approved geometry or PNG pixels.

This approval is a visual identity/source-asset change. It does not alter package IDs, account storage, protocol paths, versions or saved preferences. Existing release binaries remain historical artifacts until a separately authorized build incorporates the icon.
