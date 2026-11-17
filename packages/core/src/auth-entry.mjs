import {canRefreshSources} from './source-refresh.mjs'

/** Authorization and source health are separate. Hosts explicitly flag lost credentials. */
export function isConnectionAuthorized(connection) {
  return canRefreshSources(connection)
}

/** A startup prompt never initiates external authorization or runs on background updates. */
export function connectionEntry({connection, mobileHost=false, nativeFilesAvailable=false, initialStartup=false}={}) {
  const nativeFiles=mobileHost===true&&nativeFilesAvailable===true
  return {
    promptReconnect:Boolean(mobileHost&&initialStartup&&connection?.serverUrl&&connection?.username&&!isConnectionAuthorized(connection)),
    primary:nativeFiles?'files':'browser',
    browserLabel:nativeFiles?'Sign in using browser':'Sign in with Nextcloud',
  }
}
