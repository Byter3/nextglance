/** Explicit packaging only: consumes existing assets, never invokes a UI build. */
import {cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const ownRoot = fileURLToPath(new URL('../..', import.meta.url))
const excluded = new Set(['node_modules', 'dist', 'release', '.runtime', '.git', 'vendor', 'build', 'artifacts', 'output', 'tmp', '.gradle', '.idea', '.pnpm-store'])
function copySource(from, to) {
  const stat = lstatSync(from)
  if (stat.isSymbolicLink()) throw new Error(`Source archive refuses symbolic links: ${path.basename(from)}`)
  if (stat.isDirectory()) {
    mkdirSync(to, {recursive: true})
    for (const name of readdirSync(from)) {
      if (excluded.has(name) || name === 'local.properties' || name.startsWith('.env') || /\.(?:log|apk|exe|keystore|jks|p12|mobileprovision)$/i.test(name)) continue
      copySource(path.join(from, name), path.join(to, name))
    }
  } else cpSync(from, to)
}

export function packageWeb({root = ownRoot, run = execFileSync} = {}) {
  root = path.resolve(root)
  const web = path.join(root, 'web'), release = path.join(web, 'release')
  const {version} = JSON.parse(readFileSync(path.join(web, 'package.json'), 'utf8'))
  if (!/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(version)) throw new Error('Invalid Web package version')
  for (const file of ['dist/js/nextglance.js', 'dist/css/nextglance.css', 'appinfo/info.xml', 'appinfo/routes.php', 'templates/main.php']) {
    if (!existsSync(path.join(web, file))) throw new Error(`Missing ${file}. Build the Web assets at an explicitly requested milestone before packaging.`)
  }
  for (const file of ['LICENSE', 'NOTICE.md', 'LICENSES/Apache-2.0.txt']) {
    if (!existsSync(path.join(root, file))) throw new Error(`Missing required distribution notice: ${file}`)
  }
  const metadata = readFileSync(path.join(web, 'appinfo/info.xml'), 'utf8')
  if (!metadata.includes('<id>nextglance</id>') || !metadata.includes(`<version>${version}</version>`) || !metadata.includes('<licence>AGPL-3.0-or-later</licence>')) throw new Error('App identity, version or license does not match the package')
  mkdirSync(release, {recursive: true})
  const staging = mkdtempSync(path.join(release, '.stage-'))
  const app = path.join(staging, 'nextglance'), source = path.join(staging, 'nextglance-source')
  const archive = path.join(release, `NextGlance-${version}-Nextcloud.tar.gz`)
  try {
    mkdirSync(app)
    for (const directory of ['appinfo', 'lib', 'templates', 'img']) copySource(path.join(web, directory), path.join(app, directory))
    for (const directory of ['js', 'css']) copySource(path.join(web, 'dist', directory), path.join(app, directory))
    for (const entry of ['LICENSE', 'NOTICE.md', 'LICENSES']) copySource(path.join(root, entry), path.join(app, entry))
    for (const file of ['README.md', 'DEPLOYMENT.md']) if (existsSync(path.join(web, file))) copySource(path.join(web, file), path.join(app, file))
    mkdirSync(source)
    for (const entry of ['LICENSE', 'NOTICE.md', 'LICENSES', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json', 'web', 'packages', 'specs', 'tests']) copySource(path.join(root, entry), path.join(source, entry))
    mkdirSync(path.join(app, 'source'))
    run('tar', ['-czf', path.join(app, 'source', `NextGlance-${version}-source.tar.gz`), '-C', staging, 'nextglance-source'], {stdio: 'pipe'})
    run('tar', ['-czf', archive, '-C', staging, 'nextglance'], {stdio: 'pipe'})
    const sha256 = createHash('sha256').update(readFileSync(archive)).digest('hex')
    writeFileSync(`${archive}.sha256`, `${sha256}  ${path.basename(archive)}\n`)
    return {archive, sha256}
  } finally {
    // Only remove the unique staging directory this invocation created.
    const relative = path.relative(release, staging)
    if (!relative.startsWith('.stage-') || relative.includes(path.sep) || path.dirname(staging) !== release) throw new Error('Unsafe staging cleanup target')
    rmSync(staging, {recursive: true, force: true})
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {console.log(JSON.stringify(packageWeb(), null, 2))}
  catch (error) {console.error(error.message); process.exitCode = 1}
}
