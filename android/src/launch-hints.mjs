import {normalizeTheme} from '@nextspace/core/theme-cache.mjs'

const KEY = 'nextspace-android-launch-appearance-v1'
const safeKey = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
/** Tiny disposable appearance hint. No account descriptor, content or credentials. */
export function createLaunchHints(storage) {
  const readValue = () => {
    try {
      const raw = storage?.getItem(KEY)
      if (!raw || raw.length > 8192) return null
      const value = JSON.parse(raw)
      if (value?.version !== 1 || !safeKey(value.accountKey)) return null
      const theme = normalizeTheme(value.theme)
      if (!theme || theme.backgroundDataUrl || theme.backgroundUrl || theme.logoUrl) return null
      return {accountKey: value.accountKey, theme}
    } catch {return null}
  }
  return {
    snapshot: () => readValue(),
    initial: () => readValue()?.theme,
    read: key => {const value = readValue(); return value?.accountKey === key ? value.theme : undefined},
    save: (accountKey, theme) => {
      if (!safeKey(accountKey)) return
      const {backgroundDataUrl, backgroundUrl, logoUrl, name, ...colors} = normalizeTheme(theme) || {}
      try {storage?.setItem(KEY, JSON.stringify({version: 1, accountKey, theme: colors}))} catch { /* Hint never blocks durable saving. */ }
    },
    clear: key => {try {if (!key || readValue()?.accountKey === key) storage?.removeItem(KEY)} catch {}},
  }
}
