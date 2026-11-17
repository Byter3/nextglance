import test from 'node:test'
import assert from 'node:assert/strict'
import {boardChecklist} from '@nextspace/core/board-checklist.mjs'
import {toggleMarkdownTask} from '@nextspace/core/markdown.mjs'

test('board checklist projects native nested markers without code examples and shows readable inline labels',()=>{
  const body='# Delivery\r\n\r\n- [ ] Confirm **delivery**\r\n- [X] Clear *floor*\r\n  - [ ] Check `dimensions`\r\n- [ ] [Client approval](https://example.invalid)\r\n\r\n```md\r\n- [ ] Example\r\n```\r\n\r\n    - [ ] Indented example\r\n'
  const result=boardChecklist(body)
  assert.equal(result.total,4);assert.equal(result.completed,1)
  assert.deepEqual(result.tasks.map(task=>task.label),['Confirm delivery','Clear floor','Check dimensions','Client approval'])
  const changed=toggleMarkdownTask(body,result.tasks[2].offset)
  assert.equal(changed,body.replace('  - [ ] Check','  - [x] Check'))
})

test('duplicate labels keep distinct native offsets, source formatting, and completion count',()=>{
  const body='- [ ] Same\r\n- [x] Same\r\n- [ ] Same\r\n'
  const result=boardChecklist(body)
  assert.equal(new Set(result.tasks.map(task=>task.offset)).size,3)
  const changed=toggleMarkdownTask(body,result.tasks[2].offset)
  assert.equal(changed,'- [ ] Same\r\n- [x] Same\r\n- [x] Same\r\n')
  assert.equal(boardChecklist(changed).completed,2)
  assert.equal(boardChecklist('Plain [ ] text\n\n`- [ ] Example`').total,0)
})

test('checklist labels remain plain text even for HTML and remote images',()=>{
  const result=boardChecklist('- [ ] <script>alert(1)</script>\n- [ ] ![Screenshot](https://example.invalid/image.png)')
  assert.equal(result.tasks[0].label,'<script>alert(1)</script>')
  assert.equal(result.tasks[1].label,'Screenshot')
})
