/** Run the shared behavior vectors against the Web client's portable core. */
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {validateTestVectors, assertSpecVector} from '../../tests/helpers/spec-vectors.mjs'

const document = JSON.parse(readFileSync(new URL('../../specs/TEST_VECTORS.json', import.meta.url), 'utf8'))
const cases = validateTestVectors(document)
for (const vector of cases) test(`Web portable-core specification: ${vector.id}`, () => assertSpecVector(vector))
