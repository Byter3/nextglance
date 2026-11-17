import {hexColor} from './planner-schema.mjs'

const MAX_THEME_IMAGE_BYTES = 2 * 1024 * 1024
const THEME_PALETTE_KEYS = ['surfaceColor', 'textColor', 'mutedColor', 'hoverColor', 'borderColor', 'primaryColor', 'primaryTextColor', 'primaryLightColor', 'primaryLightTextColor']

function safeBackgroundDataUrl(value) {
  // Check the encoded limit before allocating decoded data. Only canonical
  // base64 raster images can cross the cache/renderer boundary; SVG is excluded.
  if (typeof value !== 'string' || value.length > 4 * Math.ceil(MAX_THEME_IMAGE_BYTES / 3) + 32) return undefined
  const header = /^data:image\/(png|jpeg|gif|webp);base64,/.exec(value)
  if (!header) return undefined
  const encoded = value.slice(header[0].length)
  if (!encoded || encoded.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return undefined
  let data
  try { data = atob(encoded) } catch { return undefined }
  if (data.length > MAX_THEME_IMAGE_BYTES || btoa(data) !== encoded) return undefined
  // Preserve the existing Node cache validator's ASCII decoding semantics.
  const ascii = (start, end) => Array.from(data.slice(start, end), character => String.fromCharCode(character.charCodeAt(0) & 0x7f)).join('')
  const signatures = {
    png: data.slice(0, 8) === '\x89PNG\r\n\x1a\n',
    jpeg: data.length >= 3 && data.charCodeAt(0) === 0xff && data.charCodeAt(1) === 0xd8 && data.charCodeAt(2) === 0xff,
    gif: ['GIF87a', 'GIF89a'].includes(ascii(0, 6)),
    webp: data.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP',
  }
  return signatures[header[1]] ? value : undefined
}

/** Remote theming is data, never arbitrary CSS or executable URLs. */
export function normalizeTheme(theme) {
  if (!theme || typeof theme !== 'object' || Array.isArray(theme)) return undefined
  const normalized = {}
  if (typeof theme.name === 'string' && theme.name.length <= 200 && !/[\u0000-\u001f]/.test(theme.name)) normalized.name = theme.name
  for (const key of ['color', 'textColor', 'backgroundColor', 'backgroundTextColor']) if (hexColor(theme[key])) normalized[key] = theme[key].toLowerCase()
  if (typeof theme.dark === 'boolean') normalized.dark = theme.dark
  if (typeof theme.highContrast === 'boolean') normalized.highContrast = theme.highContrast
  if (['light', 'dark', 'system'].includes(theme.mode)) normalized.mode = theme.mode
  const backgroundDataUrl = safeBackgroundDataUrl(theme.backgroundDataUrl)
  if (backgroundDataUrl) normalized.backgroundDataUrl = backgroundDataUrl
  for (const key of ['light', 'darkPalette']) {
    const palette = theme[key]
    if (!palette || typeof palette !== 'object' || Array.isArray(palette)) continue
    const safePalette = {}
    for (const field of THEME_PALETTE_KEYS) if (hexColor(palette[field])) safePalette[field] = palette[field].toLowerCase()
    if (Object.keys(safePalette).length) normalized[key] = safePalette
  }
  for (const key of ['logoUrl', 'backgroundUrl']) {
    if (typeof theme[key] !== 'string' || theme[key].length > 4096) continue
    try {
      const url = new URL(theme[key])
      if (url.username || url.password || url.hash || !(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) continue
      normalized[key] = url.href
    } catch {}
  }
  return Object.keys(normalized).length ? normalized : undefined
}
