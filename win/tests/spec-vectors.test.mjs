import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {validateTestVectors, assertSpecVector} from '../../tests/helpers/spec-vectors.mjs'

const document = JSON.parse(readFileSync(new URL('../../specs/TEST_VECTORS.json', import.meta.url), 'utf8'))
const cases = validateTestVectors(document)
for (const vector of cases) test(`Windows specification: ${vector.id}`, () => assertSpecVector(vector))

test('Specification harness fails malformed, empty, duplicate, unknown and skipped cases', () => {
  for (const change of [
    value => { value.version = 2 },
    value => { value.cases = [] },
    value => { value.cases.push(structuredClone(value.cases[0])) },
    value => { value.cases[0].input.operation = 'unknown.operation' },
    value => { value.cases[0].expected = {} },
    value => { value.cases[0].expected = {error: {}} },
    value => { value.cases[0].expected.error = {messageIncludes: 'error'} },
    value => { value.cases[0].skip = true },
  ]) {
    const invalid = structuredClone(document)
    change(invalid)
    assert.throws(() => validateTestVectors(invalid))
  }
  const wrongOutput = structuredClone(cases[0])
  wrongOutput.expected = {output: {fabricated: true}}
  assert.throws(() => assertSpecVector(wrongOutput), /output/)
  const wrongError = structuredClone(cases.find(vector => vector.expected.error))
  wrongError.expected = {error: {messageIncludes: 'This is not the production error'}}
  assert.throws(() => assertSpecVector(wrongError), /unexpected error/)
})
