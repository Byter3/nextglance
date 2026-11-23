import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, readFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const release = fileURLToPath(new URL(`../${manifest.build.directories.output}/`, import.meta.url))
const artifact = manifest.build.portable.artifactName.replace('${version}', manifest.version)
const latest = join(release, 'NextGlance-Latest.exe')
const temporary = join(release, `.NextGlance-Latest-${randomUUID()}.tmp`)

try {
  await copyFile(join(release, artifact), temporary, constants.COPYFILE_EXCL)
  // Replace the shortcut target only after the full copy is ready.
  await rename(temporary, latest)
  console.log(`Updated ${latest} from ${artifact}`)
} catch (error) {
  console.error(`Could not update NextGlance-Latest.exe: ${error.message}`)
  if (['EACCES', 'EBUSY', 'EPERM'].includes(error.code)) {
    console.error('Close any running copy and retry with node win/scripts/update-latest.mjs from the repository root.')
  }
  process.exitCode = 1
} finally {
  await rm(temporary, { force: true })
}
