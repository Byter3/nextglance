import test from 'node:test'
import assert from 'node:assert/strict'
import {markdownTasks,toggleMarkdownTask,markdownVisualIssue,markdownEquivalent} from '@nextspace/core/markdown.mjs'

test('checklist toggles change only the selected character, preserving CRLF and duplicate labels',()=>{
  const body='# Work\r\n\r\n- [ ] Same\r\n- [X] Same\r\n'
  const tasks=markdownTasks(body)
  assert.equal(tasks.length,2)
  assert.equal(toggleMarkdownTask(body,tasks[0].offset),body.replace('- [ ] Same','- [x] Same'))
  assert.equal(toggleMarkdownTask(body,tasks[1].offset),body.replace('- [X] Same','- [ ] Same'))
})
test('fenced, indented, quoted code and inline code never become actionable checkboxes',()=>{
  const body='```md\n- [ ] fenced\n```\n\n    - [ ] indented\n\n> ```\n> - [ ] quoted fence\n> ```\n\n`- [ ] inline`\n\n- [ ] actual'
  const tasks=markdownTasks(body)
  assert.deepEqual(tasks.map(item=>item.text),['actual'])
  assert.equal(toggleMarkdownTask(body,body.indexOf('[ ] fenced')+1),body)
})
test('nested, ordered and blockquoted lists retain their exact containers',()=>{
  const body='- [ ] Outer\n  - [x] Inner\n\n> 3. [ ] Quoted\n\n- > - [ ] Deep quote'
  const tasks=markdownTasks(body)
  assert.deepEqual(tasks.map(item=>item.text),['Outer','Inner','Quoted','Deep quote'])
  for(const task of tasks){const changed=toggleMarkdownTask(body,task.offset);assert.equal(changed.length,body.length);assert.equal([...body].filter((char,index)=>char!==changed[index]).length,1)}
})
test('unicode before tasks and mixed newline styles retain the correct offsets',()=>{
  const body='Árvíztűrő 🦊\r\n\r\n- [ ] Első\n- [x] Második\r'
  const tasks=markdownTasks(body)
  assert.equal(toggleMarkdownTask(body,tasks[1].offset),'Árvíztűrő 🦊\r\n\r\n- [ ] Első\n- [ ] Második\r')
  assert.equal(toggleMarkdownTask(body,-1),body)
})
test('a checklist line can begin on a list continuation and empty tasks are mapped',()=>{
  const body='-\n  [ ] Continued\n\n- [x]'
  assert.deepEqual(markdownTasks(body).map(item=>item.text),['Continued',''])
})
test('visual guard rejects unsupported source rather than silently dropping it',()=>{
  for(const body of ['![photo](https://example.com/track.png)','<img src="https://example.com/track.png">','<script>alert(1)</script>','[a][ref]\n\n[ref]: https://example.com','---\ntitle: Keep\n---\nBody','Text[^note]\n\n[^note]: Keep'])assert.ok(markdownVisualIssue(body),body)
  assert.equal(markdownVisualIssue('```html\n<img src="example">\n```'),'')
})
test('round-trip comparison permits equivalent Markdown syntax and detects lost content',()=>{
  assert.equal(markdownEquivalent('__Bold__ and _italic_','**Bold** and *italic*'),true)
  assert.equal(markdownEquivalent('- [X] Done','- [x] Done'),true)
  assert.equal(markdownEquivalent('# Heading\n\nText','## Heading\n\nText'),false)
  assert.equal(markdownEquivalent('Text\nnext','Text next'),false)
  assert.equal(markdownEquivalent('[Link](https://one.example)','[Link](https://two.example)'),false)
})
