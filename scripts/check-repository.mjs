/** Source hygiene only: no network, account reads, builds or file mutations. */
import {execFileSync} from 'node:child_process'
import {readFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const generated = /(?:^|\/)(?:node_modules|\.pnpm-store|\.runtime|\.gradle|\.idea|dist|build|release|artifacts|output|tmp|vendor|__pycache__)(?:\/|$)/
const privateFile = /(?:^|\/)(?:\.env(?!\.example$)[^/]*|local\.properties|active-account\.json|credentials\.json|NextGlance-diagnostics-[^/]*|Screenshot_[^/]*|codex-clipboard-[^/]*)$|\.(?:encrypted\.json|jks|keystore|p12|pfx|pem|key|db|sqlite3?|apk|aab|exe|msi|log|tsbuildinfo)$/i
const generatedNative = new Set(['android/android/capacitor.settings.gradle', 'android/android/app/capacitor.build.gradle'])
const contentRules = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g],
  ['provider-token', /\b(?:gh[pousr]_[A-Za-z0-9]{25,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{30,})\b/g],
  ['personal-home-path', /\b[A-Z]:[\\/]+Users[\\/]+[^\s\\/"'<>]+|\/(?:Users|home)\/[A-Za-z0-9_.-]+\//g],
]

/** Findings deliberately omit matched values: audit output must not copy secrets. */
export function inspectSourceFile(file, bytes) {
  const name = file.replaceAll('\\', '/')
  const issues = []
  if (generated.test(name) || privateFile.test(name) || generatedNative.has(name)) issues.push({file, rule: 'private-or-generated-path'})
  if (bytes.length > 5_000_000) issues.push({file, rule: 'large-file-review'})
  if (bytes.includes(0)) return issues
  const text = bytes.toString('utf8')
  for (const [rule, pattern] of contentRules) {
    pattern.lastIndex = 0
    for (const match of text.matchAll(pattern)) issues.push({file, rule, line: text.slice(0, match.index).split('\n').length})
  }
  // A diagnostics fixture may mention the format; an exported report is a JSON object.
  if (/\.json$/i.test(name)) {
    try {
      const data = JSON.parse(text)
      if (data?.format === 'nextglance-diagnostics' || data?.format === 'nextspace-diagnostics') issues.push({file, rule: 'diagnostics-export'})
    } catch { /* Syntax is checked by each format's own tooling. */ }
  }
  return issues
}

export function inspectRepository(root, staged = false) {
  const git = args => execFileSync('git', args, {cwd: root, maxBuffer: 64 * 1024 * 1024})
  const files = [...new Set(git(['ls-files', '-z', '--cached', ...(staged ? [] : ['--others', '--exclude-standard'])]).toString('utf8').split('\0').filter(Boolean))]
  const findings = []
  let checked = 0, totalBytes = 0
  // Read the index itself in staged mode, so unstaged edits cannot hide staged secrets.
  let stagedContent, offset = 0
  if (staged) {
    if (files.some(file => /[\r\n]/.test(file))) throw new Error('Unsupported newline in a Git path.')
    stagedContent = execFileSync('git', ['cat-file', '--batch'], {cwd: root, input: files.map(file => `:${file}\n`).join(''), maxBuffer: 64 * 1024 * 1024})
  }
  for (const file of files) {
    let bytes
    if (staged) {
      const end = stagedContent.indexOf(10, offset)
      const header = stagedContent.subarray(offset, end).toString('utf8')
      const match = header.match(/^[a-f0-9]+ blob (\d+)$/)
      if (!match) throw new Error('Could not inspect a staged blob.')
      const size = Number(match[1])
      bytes = stagedContent.subarray(end + 1, end + 1 + size)
      offset = end + size + 2
    } else {
      try { bytes = readFileSync(path.join(root, file)) }
      catch (error) { if (error.code === 'ENOENT') continue; throw error }
    }
    checked++; totalBytes += bytes.length
    findings.push(...inspectSourceFile(file, bytes))
  }
  return {mode: staged ? 'staged' : 'working-tree', checked, totalBytes, findings}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = inspectRepository(path.resolve(import.meta.dirname, '..'), process.argv.includes('--staged'))
    console.log(JSON.stringify(report, null, 2))
    if (report.findings.length) process.exitCode = 1
  } catch {
    console.error('Repository inspection failed; no content was printed.')
    process.exitCode = 1
  }
}
