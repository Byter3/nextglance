export function buildNoteContentUpdate(
  draft: {id: string; title: string; content: string; etag?: string; category?: string},
  base: {title: string; content: string; category?: string},
): {
  id: string
  title: string
  content: string
  etag?: string
  base: {title: string; content: string; category?: string}
}
