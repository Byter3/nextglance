import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {mkdir,writeFile} from 'node:fs/promises'
const require = createRequire(import.meta.url)
const {build} = createRequire(require.resolve('vite/package.json'))('esbuild')
// A portable core artifact, deliberately separate from the Vite UI build.
export async function headlessBundle() {
  const result = await build({entryPoints:[fileURLToPath(new URL('../src/headless-entry.mjs',import.meta.url))],bundle:true,write:false,format:'iife',platform:'browser',target:'es2022',define:{global:'globalThis'},minify:false,legalComments:'inline'})
  return result.outputFiles[0].text
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const directory = new URL('../android/app/src/main/assets/headless/',import.meta.url)
  await mkdir(directory,{recursive:true}); await writeFile(new URL('projector.js',directory),await headlessBundle())
}
