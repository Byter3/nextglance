import {readFileSync} from 'node:fs'

/** Copy the maintained license texts into the UI assets packaged by Capacitor. */
export function distributionNotices() {
  return {
    name: 'nextglance-distribution-notices',
    generateBundle() {
      for (const [input, output] of [
        ['NOTICE.md', 'legal/NOTICE.md'],
        ['LICENSE', 'legal/LICENSE'],
        ['LICENSES/Apache-2.0.txt', 'legal/LICENSES/Apache-2.0.txt'],
      ]) {
        this.emitFile({type: 'asset', fileName: output, source: readFileSync(new URL(`../../${input}`, import.meta.url))})
      }
    },
  }
}
