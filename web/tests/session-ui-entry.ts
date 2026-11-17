import {mountSessionPlanner,type SessionApi} from '../src/session-view'
const api=(window as unknown as {fixtureApi:SessionApi}).fixtureApi
mountSessionPlanner(document.getElementById('nextglance-root')!,api,[])
