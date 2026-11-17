import test from 'node:test'
import {readFileSync} from 'node:fs'
import {validateTestVectors, assertSpecVector} from '../../tests/helpers/spec-vectors.mjs'

const document = JSON.parse(readFileSync(new URL('../../specs/TEST_VECTORS.json', import.meta.url), 'utf8'))
for (const vector of validateTestVectors(document)) test(`Android spec vector: ${vector.id}`, () => assertSpecVector(vector))
