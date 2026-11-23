# License and third-party code

Project-owned NextGlance code is licensed under **AGPL-3.0-or-later**. See [LICENSE](LICENSE). This selection covers the project source; it does not replace third-party licenses or notices. Dependencies and tooling retain their own licenses.

The approved NextGlance application icon includes a checkmark from **Google Material Symbols**, licensed under **Apache-2.0**, through the [Nextcloud Tasks app artwork](https://github.com/nextcloud/tasks/blob/master/img/tasks.svg). Tasks records its Material Symbols origin in [commit e6d669a](https://github.com/nextcloud/tasks/commit/e6d669a830b229c50019c57b51510a7dd54f8e8e). Google's [licensing guide](https://developers.google.com/fonts/docs/material_symbols#licensing) and the accompanying [Apache-2.0 text](LICENSES/Apache-2.0.txt) apply to that component; project licensing does not replace it.

**NextGlance modifications:** composed the tick with calendar/rear-card shapes and timeline bars, transformed and scaled it, added transparent clearance, flattened vector paths, and exported monochrome, colored, adaptive and raster variants. This attribution covers the canonical files in `packages/ui/src/branding/`, copied host SVGs, Windows ICO and Android vector/PNG launcher and splash derivatives. Preserve this notice and the Apache license with those assets. Source details and treatments are recorded in [docs/BRANDING.md](docs/BRANDING.md).

The committed Gradle wrapper JAR retains its Apache-2.0 license in `META-INF/LICENSE`; wrapper scripts retain their upstream copyright and license headers. Dependency packages downloaded during setup are not committed here.

Android widget action and item icons (`widget_icon_*.xml`) adapt the `plus`, `settings-2`, `panels-top-left`, `circle`, `circle-check` and `calendar-days` paths from **Lucide 0.468.0**. The paths were translated into Android VectorDrawable commands and styled to match the widget. Preserve the upstream copyright and [ISC license](LICENSES/Lucide.txt) with these derivatives.

The intended distribution model is a public source repository and a free Nextcloud server app, with possible paid Google Play and Microsoft Store packages. Charging does not remove source, notice or redistribution obligations. No publication is implied by this document.

Concrete dependencies requiring inclusion in distribution review include AndroidX JavaScriptEngine and fast-text-encoding (Apache-2.0), whatwg-url (MIT), Nextcloud Android SingleSignOn (GPL-3.0-or-later), ical.js (MPL-2.0), and DOMPurify (MPL-2.0 OR Apache-2.0). Preserve their notices and the licenses of all other bundled dependencies. This short note is not a complete generated third-party notice inventory; produce that inventory from locked dependencies before public binary distribution. Do not assume that separating client repositories changes licensing obligations.

A deployed modified Web app must provide its users the corresponding source as required by AGPL section 13. Until a public repository exists, keep the matching source archive with the private test deployment and make it available to its users; do not invent a public source URL.
