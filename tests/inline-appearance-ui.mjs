/** Inline editor verification. Fixture data only; every non-local request is blocked. */
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {plannerFixture} from './fixtures.mjs'
import {tagColorKey} from '@nextspace/core/record-presentation.mjs'

const fixture=plannerFixture(new Date(2026,10,11,9))
fixture.workspace.appearance.mode='dark';fixture.workspace.planner.view='list'
const board=fixture.collections.find(item=>item.id==='deck-work')
Object.assign(board,{color:'#3975ce',labels:[{id:'21',title:'Later',color:'#ffee00'},{id:'22',title:'Urgent',color:'#ff5533'},{id:'23',title:'Review',color:'#55cc88'}]})
fixture.collections.find(item=>item.id==='tasks-work').color='#218c6a'
Object.assign(fixture.records.find(item=>item.id==='card-mine'),{color:'#7755aa',tagDetails:[board.labels[0]],tags:['Later'],etag:'card-v1'})
Object.assign(fixture.records.find(item=>item.id==='task-today'),{tags:['Existing native'],etag:'task-v1'})
fixture.records.push({...fixture.records.find(item=>item.id==='task-today'),id:'appearance-readonly',title:'Read-only appearance',readonly:true})
fixture.records.push({...fixture.records.find(item=>item.id==='task-today'),id:'tag-library',title:'Tag library item',tags:['Peer label'],completed:true})
await mkdir('artifacts',{recursive:true})
const browser=await chromium.launch({headless:true,channel:'msedge'})
const page=await browser.newPage({viewport:{width:1652,height:1100},timezoneId:'Europe/Budapest'})
page.setDefaultTimeout(15000)
const checks=[],errors=[]
page.on('pageerror',error=>errors.push(error.message))
await page.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort())
await page.addInitScript(initial=>{
  let state=JSON.parse(sessionStorage.getItem('inline-appearance-state')||'null')||structuredClone(initial)
  window.__appearanceWrites=[];window.__appearanceAttempts=[];window.__appearanceCloud=null
  window.__failAppearance=false;window.__failMetadata=false;window.__holdAppearance=false
  const remember=()=>sessionStorage.setItem('inline-appearance-state',JSON.stringify(state))
  const read=async()=>structuredClone(state)
  window.workspaceApi={
    getState:read,refresh:read,openExternal:async()=>{},readPage:async()=>({body:''}),
    saveWorkspace:async(workspace,revision)=>{
      if(window.__failMetadata){window.__failMetadata=false;throw Error('Fixture metadata save failed')}
      if(revision!==state.revision)throw Error('Stale fixture metadata')
      state.workspace=structuredClone(workspace);state.revision++;state.storage.syncStatus='pending';remember()
      return {workspace:structuredClone(workspace),revision:state.revision,storage:state.storage}
    },
    syncWorkspace:async()=>{window.__appearanceCloud=structuredClone(state.workspace);state.storage.syncStatus='synced';remember();return read()},
    updateRecordAppearance:async input=>{
      window.__appearanceAttempts.push(structuredClone(input))
      if(window.__holdAppearance)await new Promise(resolve=>window.__releaseAppearance=resolve)
      const record=state.records.find(item=>item.id===input.id)
      if(!record||record.readonly)throw Error('Read-only fixture item')
      if(input.etag!==record.etag)throw Error('Stale fixture native version')
      if(window.__failAppearance){window.__failAppearance=false;throw Error('Fixture appearance save failed; draft remains safe')}
      window.__appearanceWrites.push(structuredClone(input))
      if(input.color!==undefined)record.color=input.color||undefined
      if(input.tags!==undefined)record.tags=[...input.tags]
      if(input.tagIds!==undefined){record.tagDetails=state.collections.find(item=>item.id===record.collectionId).labels.filter(tag=>input.tagIds.includes(tag.id));record.tags=record.tagDetails.map(tag=>tag.title)}
      record.etag=`appearance-${window.__appearanceWrites.length}`;remember();return read()
    },
  }
},fixture)
const inspector=()=>page.getByRole('complementary',{name:'Item details'})
const appearance=()=>inspector().getByRole('region',{name:'Item color and tags'})
const backend=()=>page.evaluate(()=>window.workspaceApi.getState())
const writes=()=>page.evaluate(()=>window.__appearanceWrites)
const attempts=()=>page.evaluate(()=>window.__appearanceAttempts)
const stripe=()=>appearance().getByRole('button',{name:'Change item color',exact:true})
const tagsButton=()=>appearance().getByRole('button',{name:'Choose tags',exact:true})
const tagsDialog=()=>appearance().getByRole('dialog',{name:'Choose tags',exact:true})
const colorDialog=()=>appearance().getByRole('dialog',{name:'Item color',exact:true})
const setColor=async(locator,value)=>locator.evaluate((element,color)=>{element.value=color;element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}))},value)
async function until(predicate,message){const end=Date.now()+15000;while(Date.now()<end){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,35))}assert.fail(message)}
async function item(title){await page.getByRole('tab',{name:'List',exact:true}).click();await page.getByLabel('Search this view',{exact:true}).fill(title);await page.locator('.list-table-row').filter({hasText:title}).click();await inspector().getByRole('heading',{name:title,exact:true,level:2}).waitFor()}
async function away(){await inspector().locator('.inspector-kind').click()}
async function saved(){await appearance().locator('.appearance-popover').waitFor({state:'hidden'});assert.equal(await appearance().getByRole('alert').count(),0)}
const rgb=(locator,property)=>locator.evaluate((element,key)=>getComputedStyle(element)[key],property)
try{
  await page.goto(process.env.NEXTSPACE_TEST_URL||'http://127.0.0.1:5173')
  await item('Edit the opening sequence')
  const heading=await appearance().getByRole('heading',{name:'Edit the opening sequence'}).boundingBox(),stripeBox=await stripe().boundingBox(),tagsBox=await tagsButton().boundingBox(),datesBox=await inspector().getByRole('region',{name:'Item dates'}).boundingBox()
  assert.ok(stripeBox.x<heading.x&&stripeBox.width<=20)
  assert.ok(tagsBox.y<heading.y&&heading.y<datesBox.y)
  assert.equal(await appearance().getByRole('button',{name:'Edit',exact:true}).count(),0)
  assert.equal(await appearance().getByRole('button',{name:/save appearance/i}).count(),0)
  await stripe().click();await setColor(colorDialog().getByLabel('Item color',{exact:true}),'#cc4477')
  assert.equal((await writes()).length,0)
  assert.equal(await rgb(stripe().locator('span'),'backgroundColor'),'rgb(204, 68, 119)')
  await appearance().getByRole('heading',{name:'Edit the opening sequence',exact:true}).click();await saved()
  assert.deepEqual((await writes()).at(-1),{id:'card-mine',color:'#cc4477',etag:'card-v1'})
  assert.equal(await rgb(appearance().locator('.appearance-source>i'),'backgroundColor'),'rgb(57, 117, 206)')
  checks.push('Tags are at the top, the item color is a compact title stripe, and clicking the title saves without an Edit/Save step')

  await tagsButton().click()
  await tagsDialog().getByRole('checkbox',{name:'Later',exact:true}).uncheck()
  await tagsDialog().getByRole('checkbox',{name:'Urgent',exact:true}).check()
  await tagsDialog().getByRole('checkbox',{name:'Review',exact:true}).check()
  assert.equal((await writes()).length,1,'Multiselect changes stay one draft until leaving the dropdown')
  // Exercise the same-component source target directly; the open dropdown may
  // geometrically cover it, while ordinary outside/title clicks are tested above.
  await appearance().locator('.appearance-source').dispatchEvent('pointerdown',{bubbles:true});await saved()
  assert.deepEqual((await writes()).at(-1).tagIds,['22','23'])
  assert.deepEqual((await backend()).records.find(item=>item.id==='card-mine').tags,['Urgent','Review'])
  assert.equal(await rgb(appearance().locator('.appearance-tag').filter({hasText:'Urgent'}).locator('i'),'backgroundColor'),'rgb(255, 85, 51)')
  const countAfterTags=(await writes()).length
  await tagsButton().click();await tagsDialog().getByRole('checkbox',{name:'Later',exact:true}).check();await page.keyboard.press('Escape')
  await saved();assert.equal((await writes()).length,countAfterTags)
  assert.equal(await inspector().isVisible(),true,'Escape cancels the popover, not the inspector')
  checks.push('The colored tag dropdown supports multi-selection, clicking the source label saves, and Escape cancels only the unsaved appearance draft')

  await stripe().click();await setColor(colorDialog().getByLabel('Item color',{exact:true}),'#22aacc')
  await page.evaluate(()=>window.__failAppearance=true)
  await away();await appearance().getByRole('alert').filter({hasText:'Fixture appearance save failed'}).waitFor()
  const failedAttemptCount=(await attempts()).length
  await inspector().getByRole('button',{name:'Close item details',exact:true}).click()
  assert.equal(await inspector().isVisible(),true)
  assert.equal((await attempts()).length,failedAttemptCount,'Navigation must not silently retry a failed draft')
  assert.equal(await colorDialog().count(),0,'A failed popover closes so the recovery controls stay accessible')
  assert.equal(await rgb(stripe().locator('span'),'backgroundColor'),'rgb(34, 170, 204)','The retained draft remains visible in the title stripe')
  await stripe().click()
  assert.equal(await colorDialog().getByLabel('Item color',{exact:true}).inputValue(),'#22aacc')
  await away();await colorDialog().waitFor({state:'hidden'})
  assert.equal((await attempts()).length,failedAttemptCount,'Leaving a reopened failed draft must not silently retry it')
  assert.equal((await backend()).records.find(item=>item.id==='card-mine').color,'#cc4477')
  await appearance().getByRole('button',{name:'Retry',exact:true}).click();await saved()
  assert.equal((await backend()).records.find(item=>item.id==='card-mine').color,'#22aacc')
  await stripe().click();await setColor(colorDialog().getByLabel('Item color',{exact:true}),'#aa1122')
  await page.evaluate(()=>window.__failAppearance=true);await away();await appearance().getByRole('alert').waitFor()
  await appearance().getByRole('button',{name:'Keep saved values',exact:true}).click()
  await saved();assert.equal(await rgb(stripe().locator('span'),'backgroundColor'),'rgb(34, 170, 204)')
  await inspector().getByRole('button',{name:'Close item details',exact:true}).click();await inspector().waitFor({state:'hidden'})
  checks.push('Failed saves retain the inline draft, block dismissal, and provide explicit Retry or Keep saved values recovery')

  await item('Edit the opening sequence')
  const savedCard=(await backend()).records.find(item=>item.id==='card-mine'),beforeCombined=(await writes()).length
  await stripe().click();await setColor(colorDialog().getByLabel('Item color',{exact:true}),'#8844cc')
  await tagsButton().click();await tagsDialog().getByRole('checkbox',{name:'Later',exact:true}).check()
  await page.evaluate(()=>window.__failAppearance=true)
  await away();await appearance().getByRole('alert').filter({hasText:'Fixture appearance save failed'}).waitFor()
  const combinedAttemptCount=(await attempts()).length
  assert.equal((await attempts()).at(-1).color,'#8844cc')
  assert.deepEqual((await attempts()).at(-1).tagIds,['22','23','21'])
  assert.equal((await writes()).length,beforeCombined)
  await stripe().click();await setColor(colorDialog().getByLabel('Item color',{exact:true}),savedCard.color)
  await away();await colorDialog().waitFor({state:'hidden'})
  assert.equal((await attempts()).length,combinedAttemptCount,'Undoing one field in a failed draft does not auto-retry')
  await appearance().getByRole('button',{name:'Retry',exact:true}).click();await saved()
  const combinedRetry=(await attempts()).at(-1)
  assert.equal(combinedRetry.color,savedCard.color,'Retry must include the reverted value of every originally failed field')
  assert.deepEqual(combinedRetry.tagIds,['22','23','21'])
  assert.equal((await writes()).length,beforeCombined+1,'A revised failed edit succeeds in one explicit retry')
  assert.equal((await backend()).records.find(item=>item.id==='card-mine').color,savedCard.color)
  assert.deepEqual((await backend()).records.find(item=>item.id==='card-mine').tags,['Later','Urgent','Review'])
  checks.push('Retrying a failed color-and-tags edit carries the current value of both fields even after one field is reverted')

  await item('Edit the opening sequence')
  await page.getByLabel('Search this view',{exact:true}).fill('')
  await stripe().click();await setColor(colorDialog().getByLabel('Item color',{exact:true}),'#5588aa')
  await page.evaluate(()=>window.__holdAppearance=true)
  await page.locator('.list-table-row').filter({hasText:'Prepare review notes'}).click()
  await until(()=>page.evaluate(()=>typeof window.__releaseAppearance==='function'),'A held appearance write should begin')
  assert.equal(await inspector().getByRole('heading',{name:'Edit the opening sequence',exact:true}).isVisible(),true)
  await page.evaluate(()=>{window.__holdAppearance=false;window.__releaseAppearance()})
  await inspector().getByRole('heading',{name:'Prepare review notes',exact:true}).waitFor()
  assert.equal((await backend()).records.find(item=>item.id==='card-mine').color,'#5588aa')
  checks.push('Switching to another item waits for the old item’s pending appearance save before replacing the inspector')

  await tagsButton().click()
  await tagsDialog().getByRole('checkbox',{name:'Peer label',exact:true}).check()
  await tagsDialog().getByLabel('Find or add a tag',{exact:true}).fill('Review, delivery')
  await tagsDialog().getByRole('button',{name:'Create tag “Review, delivery”',exact:true}).click()
  await setColor(tagsDialog().getByLabel('Color for Review, delivery',{exact:true}),'#eeaa33')
  await away();await saved()
  const key=tagColorKey('tasks-work','Review, delivery')
  assert.deepEqual((await backend()).records.find(item=>item.id==='task-today').tags,['Existing native','Peer label','Review, delivery'])
  assert.equal((await backend()).workspace.properties['tag-colors'][key],'#eeaa33')
  await until(()=>page.evaluate(key=>window.__appearanceCloud?.properties['tag-colors']?.[key]==='#eeaa33',key),'Tag colors should auto-sync')
  const beforeQuery=(await writes()).length
  await tagsButton().click();await tagsDialog().getByLabel('Find or add a tag',{exact:true}).fill('Only searching')
  await away();await saved();assert.equal((await writes()).length,beforeQuery)
  assert.ok(!(await backend()).records.find(item=>item.id==='task-today').tags.includes('Only searching'))
  checks.push('Task tags use known source categories and explicit new-tag creation; tag colors save as synced metadata, while search text is never added accidentally')

  await tagsButton().click();await tagsDialog().getByLabel('Find or add a tag',{exact:true}).fill('Metadata retry')
  await tagsDialog().getByRole('button',{name:'Create tag “Metadata retry”',exact:true}).click()
  await setColor(tagsDialog().getByLabel('Color for Metadata retry',{exact:true}),'#4466dd')
  await page.evaluate(()=>window.__failMetadata=true)
  const beforePartial=(await writes()).length
  await away();await appearance().getByRole('alert').filter({hasText:'Tag colors could not be saved'}).waitFor()
  assert.equal((await writes()).length,beforePartial+1,'Native tags acknowledged before metadata failure')
  assert.ok((await backend()).records.find(item=>item.id==='task-today').tags.includes('Metadata retry'))
  assert.equal((await backend()).workspace.properties['tag-colors'][tagColorKey('tasks-work','Metadata retry')],undefined)
  await appearance().getByRole('button',{name:'Retry',exact:true}).click();await saved()
  assert.equal((await writes()).length,beforePartial+1,'Metadata retry must not repeat the acknowledged native write')
  assert.equal((await backend()).workspace.properties['tag-colors'][tagColorKey('tasks-work','Metadata retry')],'#4466dd')
  checks.push('A metadata save failure keeps the color draft and retries only metadata after native tag changes are acknowledged')

  await tagsButton().click();await tagsDialog().getByLabel('Find or add a tag',{exact:true}).fill('Metadata discard')
  await tagsDialog().getByRole('button',{name:'Create tag “Metadata discard”',exact:true}).click()
  await setColor(tagsDialog().getByLabel('Color for Metadata discard',{exact:true}),'#3377aa')
  await page.evaluate(()=>window.__failMetadata=true)
  const beforeDiscard=(await writes()).length
  await away();await appearance().getByRole('alert').filter({hasText:'Tag colors could not be saved'}).waitFor()
  assert.equal((await writes()).length,beforeDiscard+1)
  assert.equal((await backend()).workspace.properties['tag-colors'][tagColorKey('tasks-work','Metadata discard')],undefined)
  await appearance().getByRole('button',{name:'Keep saved values',exact:true}).click();await saved()
  assert.equal((await writes()).length,beforeDiscard+1,'Discarding the color draft keeps the already acknowledged native tag')
  assert.ok((await backend()).records.find(item=>item.id==='task-today').tags.includes('Metadata discard'))
  assert.equal(await rgb(appearance().locator('.appearance-tag').filter({hasText:'Metadata discard'}).locator('i'),'backgroundColor'),'rgb(33, 140, 106)')
  checks.push('Keep saved values after a metadata failure restores the acknowledged tag color while retaining its successful native tag creation')

  await stripe().click();await setColor(colorDialog().getByLabel('Item color',{exact:true}),'#8866cc');await away();await saved()
  assert.equal((await backend()).records.find(item=>item.id==='task-today').color,'#8866cc')
  assert.equal(await rgb(appearance().locator('.appearance-source>i'),'backgroundColor'),'rgb(33, 140, 106)')
  await page.reload();await item('Prepare review notes')
  assert.equal(await rgb(appearance().locator('.appearance-tag').filter({hasText:'Review, delivery'}).locator('i'),'backgroundColor'),'rgb(238, 170, 51)')
  await item('Client review');await stripe().click();await setColor(colorDialog().getByLabel('Item color',{exact:true}),'#ee9900');await away();await saved()
  assert.equal((await backend()).records.find(item=>item.id==='event-review').color,'#ee9900')
  await item('Read-only appearance')
  assert.equal(await stripe().isDisabled(),true);assert.equal(await tagsButton().isDisabled(),true)
  checks.push('Task/event item colors remain separate from source color; tag colors survive reload and readonly source controls stay disabled')

  await item('Edit the opening sequence');await tagsButton().click()
  await page.screenshot({path:'artifacts/inline-appearance-dark.png'})
  await page.keyboard.press('Escape')
  await page.setViewportSize({width:1100,height:850})
  await tagsButton().click()
  const popup=await tagsDialog().boundingBox(),panel=await inspector().boundingBox()
  assert.ok(popup.x>=panel.x&&popup.x+popup.width<=panel.x+panel.width+1)
  assert.equal(await appearance().evaluate(element=>element.scrollWidth<=element.clientWidth),true)
  assert.deepEqual(errors,[])
  checks.push('The compact multi-select stays within a narrow inspector without horizontal overflow or renderer errors')
  await writeFile('artifacts/inline-appearance-ui-results.json',JSON.stringify({passed:checks.length,checks,rendererErrors:errors},null,2))
  console.log(JSON.stringify({passed:checks.length,checks,rendererErrors:errors},null,2))
}finally{await browser.close()}
