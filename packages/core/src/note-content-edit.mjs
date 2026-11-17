/** Ordinary note edits change text/title, never the native folder or Files tags.
 * Keep the editor-start version and baseline for conditional field merging.
 * Validation remains at the native mutation boundary; do not normalize a
 * baseline here, since it must describe exactly what the editor started from.
 */
export function buildNoteContentUpdate(draft, base) {
  return {
    id: draft.id,
    title: draft.title,
    content: draft.content,
    ...(draft.etag !== undefined ? {etag: draft.etag} : {}),
    base: {
      title: base.title,
      content: base.content,
      ...(base.category !== undefined ? {category: base.category} : {}),
    },
  }
}
