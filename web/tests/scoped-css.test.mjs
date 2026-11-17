import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {readFile,readdir} from 'node:fs/promises'
import {scopeHostCss,scopeSelector,splitSelectors} from '../scripts/scoped-css.mjs'
const require=createRequire(import.meta.url),postcss=require(require.resolve('postcss',{paths:[require.resolve('vite')]}))
test('selector lists respect functional selectors and quoted commas',()=>{
  assert.deepEqual(splitSelectors('.one:is(.a,.b),[title="a,b"], :root[data-theme=dark]'),['.one:is(.a,.b)','[title="a,b"]',':root[data-theme=dark]'])
  assert.equal(scopeSelector('body'),'#nextglance-root')
  assert.equal(scopeSelector(':root[data-theme=dark]'),'#nextglance-root[data-theme=dark]')
  assert.equal(scopeSelector('button:hover'),'#nextglance-root button:hover')
})
test('web transform confines every imported shared selector and animation',async()=>{
  const dir=new URL('../../packages/ui/src/',import.meta.url)
  for(const name of await readdir(dir)){
    if(!name.endsWith('.css'))continue
    const result=await postcss([scopeHostCss()]).process(await readFile(new URL(name,dir),'utf8'),{from:name})
    result.root.walkRules(rule=>{
      if(rule.parent.type==='atrule'&&/keyframes$/.test(rule.parent.name))return
      for(const selector of splitSelectors(rule.selector))assert.ok(selector.startsWith('#nextglance-root'),`${name}: ${selector}`)
    })
    result.root.walkAtRules(/keyframes$/,rule=>assert.ok(rule.params.startsWith('nextglance-')))
  }
})
