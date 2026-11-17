/* Runs before the application module. Appearance only; never authorizes access. */
(() => {
  try {
    const text = localStorage.getItem('nextspace-android-launch-appearance-v1')
    if (!text || text.length > 8192) return
    const hint = JSON.parse(text)
    if (hint?.version !== 1 || !/^[a-f0-9]{64}$/.test(hint.accountKey)) return
    const theme = hint.theme
    if (!theme || typeof theme !== 'object' || Array.isArray(theme)) return
    const color = value => typeof value === 'string' && /^#[a-f0-9]{6}$/i.test(value) ? value : undefined
    const dark = theme.mode === 'dark' || theme.mode !== 'light' && (typeof theme.dark === 'boolean' ? theme.dark : matchMedia('(prefers-color-scheme: dark)').matches)
    const palette = dark ? theme.darkPalette : theme.light
    const root = document.documentElement
    root.dataset.theme = dark ? 'dark' : 'light'
    for (const [key, value] of Object.entries({
      '--cloud-background': color(theme.backgroundColor) || color(theme.color),
      '--cloud-foreground': color(theme.backgroundTextColor),
      '--primary': color(palette?.primaryColor) || color(theme.color),
      '--surface': color(palette?.surfaceColor), '--canvas': color(palette?.surfaceColor),
      '--text': color(palette?.textColor), '--heading': color(palette?.textColor),
    })) if (value) root.style.setProperty(key, value)
    if (color(theme.backgroundColor) || color(theme.color)) root.style.backgroundColor = 'var(--cloud-background)'
  } catch { /* Missing/blocked/corrupt hints leave the ordinary connection shell. */ }
})()
