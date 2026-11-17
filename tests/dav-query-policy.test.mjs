import test from 'node:test'
import assert from 'node:assert/strict'
import {checkCalendarQuery} from '../packages/nextcloud/src/dav-query-policy.mjs'

const headers = {'content-type': 'application/xml; charset=utf-8'}
const query = '<c:calendar-query xmlns:c="urn:ietf:params:xml:ns:caldav"><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"/></c:comp-filter></c:filter></c:calendar-query>'

test('calendar REPORT policy accepts the reference namespace with any prefix or a default namespace', () => {
  for (const body of [query, `<?xml version="1.0"?>${query}`, query.replaceAll('c:', 'x:').replace('xmlns:c', 'xmlns:x'), '<calendar-query xmlns="urn:ietf:params:xml:ns:caldav"/>']) assert.doesNotThrow(() => checkCalendarQuery(headers, body))
  assert.doesNotThrow(() => checkCalendarQuery({'content-type': 'text/xml'}, query))
})

test('calendar REPORT policy rejects malformed, unrelated, ambiguous and unsafe XML', () => {
  for (const body of [undefined, '', ' ', '<calendar-query', '<calendar-query/>', query.replace('urn:ietf:params:xml:ns:caldav', 'DAV:'), '<d:expand-property xmlns:d="DAV:"/>', query + query]) assert.throws(() => checkCalendarQuery(headers, body), {code: 'VALIDATION'})
  for (const body of [`<!DOCTYPE calendar-query>${query}`, `<!ENTITY external SYSTEM "https://evil.test">${query}`]) assert.throws(() => checkCalendarQuery(headers, body), {code: 'SECURITY'})
  assert.throws(() => checkCalendarQuery({'content-type': 'text/plain'}, query), {code: 'VALIDATION'})
  assert.throws(() => checkCalendarQuery(headers, query + 'é'.repeat(524288)), {code: 'LIMIT'})
})
