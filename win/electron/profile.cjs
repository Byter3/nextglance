const path = require('node:path')
const { mkdirSync } = require('node:fs')

function configureProfile(app, { explicitDataDirectory = process.env.NEXTSPACE_DATA_DIR, createDirectory = mkdirSync } = {}) {
  if (explicitDataDirectory && !path.isAbsolute(explicitDataDirectory)) throw new Error('NEXTSPACE_DATA_DIR must be an absolute directory path.')
  // The display name must never move existing accounts, encrypted credentials,
  // or Chromium preferences into a new profile. Keep the historical directory.
  const directory = path.resolve(explicitDataDirectory || path.join(app.getPath('appData'), 'Nextspace'))
  createDirectory(directory, { recursive: true, mode: 0o700 })
  // Configure both paths before ready/process locking, including isolated tests.
  app.setPath('userData', directory)
  app.setPath('sessionData', directory)
  app.setName('NextGlance')
  return directory
}

module.exports = { configureProfile }
