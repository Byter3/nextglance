import fs from 'node:fs/promises'
import path from 'node:path'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'

// Asset-only conversion: does not build or package the Android application.
// Supply --sharp-module=<installed sharp module path> when sharp is not local.
const require = createRequire(import.meta.url)
const sharpModule = process.argv.find(argument => argument.startsWith('--sharp-module='))?.slice('--sharp-module='.length) || 'sharp'
const sharp = require(sharpModule)
const client = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const branding = path.resolve(client, '../packages/ui/src/branding')
const resources = path.join(client, 'android/app/src/main/res')
const read = name => fs.readFile(path.join(branding, name), 'utf8')
const writeResource = async (relative, contents) => {
  const target = path.join(resources, relative)
  await fs.mkdir(path.dirname(target), {recursive: true})
  await fs.writeFile(target, contents)
}

const badgeSvg = await read('nextglance-icon.svg')
const foregroundSvg = await read('nextglance-adaptive-foreground.svg')
const foregroundPath = foregroundSvg.match(/<path\b[^>]*\bd="([^"]+)"/)?.[1]
if (!foregroundPath || !foregroundSvg.includes('viewBox="-300 -300 1854 1854"') || /<(mask|use|image)\b/.test(foregroundSvg)) {
  throw new Error('The approved adaptive foreground must be the mask-free canonical path in its 1854-unit safe-area frame.')
}
const vector = (viewBox, body) => `<?xml version="1.0" encoding="utf-8"?>
<!-- Derived from packages/ui/src/branding, approved by BRAND-01.
     Checkmark: Google Material Symbols via Nextcloud Tasks, Apache-2.0.
     Modified by combining, flattening and resizing with NextGlance artwork.
     See repository NOTICE.md and LICENSES/Apache-2.0.txt. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp" android:height="108dp"
    android:viewportWidth="${viewBox}" android:viewportHeight="${viewBox}">
${body}
</vector>
`

await writeResource('drawable-v24/ic_launcher_foreground.xml', vector(1854,
  `    <group android:translateX="300" android:translateY="300">
        <path android:fillColor="#FFFFFF" android:fillType="nonZero" android:pathData="${foregroundPath}" />
    </group>`))
// Preserve the existing splash/legacy resource identifier. The badge is a true
// vector; the foreground path already includes the transparent tick clearance.
await writeResource('drawable/nextspace_icon.xml', vector(1254,
  `    <path android:fillColor="#0082C9" android:pathData="M627,47 A580,580 0,1 1,627,1207 A580,580 0,1 1,627,47 Z" />
    <path android:fillColor="#FFFFFF" android:fillType="nonZero" android:pathData="${foregroundPath}" />`))

const adaptive = monochrome => `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
${monochrome ? '    <monochrome android:drawable="@drawable/ic_launcher_foreground" />\n' : ''}</adaptive-icon>
`
for (const name of ['ic_launcher', 'ic_launcher_round']) {
  await writeResource(`mipmap-anydpi-v26/${name}.xml`, adaptive(false))
  await writeResource(`mipmap-anydpi-v33/${name}.xml`, adaptive(true))
}

for (const [density, factor] of [['mdpi', 1], ['hdpi', 1.5], ['xhdpi', 2], ['xxhdpi', 3], ['xxxhdpi', 4]]) {
  const directory = path.join(resources, `mipmap-${density}`)
  await fs.mkdir(directory, {recursive: true})
  const badge = await sharp(Buffer.from(badgeSvg)).resize(48 * factor).png().toBuffer()
  await fs.writeFile(path.join(directory, 'ic_launcher.png'), badge)
  await fs.writeFile(path.join(directory, 'ic_launcher_round.png'), badge)
  await sharp(Buffer.from(foregroundSvg)).resize(108 * factor).png().toFile(path.join(directory, 'ic_launcher_foreground.png'))
}

await fs.mkdir(path.join(client, 'public'), {recursive: true})
await fs.writeFile(path.join(client, 'public/nextglance.svg'), badgeSvg)
console.log('Updated Android legacy/adaptive/monochrome/splash and preview icon assets from BRAND-01.')
