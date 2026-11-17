import assert from 'node:assert/strict'
import test from 'node:test'
import {timelineLinkPath, timelineLinkPoints} from '@nextspace/core/timeline-link.mjs'

test('Forward dependencies leave the end and enter the start horizontally with rounded corners', () => {
  const points = timelineLinkPoints(100, 72, 260, 168)
  assert.deepEqual(points[0], [100, 72])
  assert.deepEqual(points.at(-1), [260, 168])
  assert.ok(points[1][0] > points[0][0])
  assert.equal(points[1][1], points[0][1])
  assert.ok(points.at(-2)[0] < points.at(-1)[0])
  assert.equal(points.at(-2)[1], points.at(-1)[1])
  assert.match(timelineLinkPath(100, 72, 260, 168), /^M 100 72 .* Q .* L 260 168$/)
})

test('Overlapping and backwards dates loop through a row gutter, still entering the start from the left', () => {
  for (const [x2, y2] of [[100, 216], [250, 216], [100, 24], [250, 24]]) {
    const points = timelineLinkPoints(250, 72, x2, y2)
    assert.deepEqual(points[1], [268, 72])
    assert.deepEqual(points.at(-2), [x2 - 18, y2])
    assert.equal(points[2][1] % 48, 0, 'The horizontal return belongs on a row border')
    assert.equal(points[3][1], points[2][1])
    assert.match(timelineLinkPath(250, 72, x2, y2), /Q/)
  }
})

test('Undated anchors, adjacent rows, and clipped endpoints retain their exact coordinates', () => {
  for (const [x1, y1, x2, y2] of [[800, 72, 20, 120], [20, 72, 20, 120], [20, 120, 0, 72], [800, 72, 0, 24]]) {
    const path = timelineLinkPath(x1, y1, x2, y2)
    assert.ok(path.startsWith(`M ${x1} ${y1} `))
    assert.ok(path.endsWith(`L ${x2} ${y2}`))
    assert.doesNotMatch(path, /NaN|Infinity/)
  }
  assert.equal(timelineLinkPath(NaN, 24, 100, 72), '')
})
