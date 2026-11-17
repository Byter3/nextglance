import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {deferredComponent} from '../packages/ui/src/deferred-component.ts'
const {createRenderer,defineComponent,h,nextTick,ref}=createRequire(new URL('../packages/ui/package.json',import.meta.url))('vue')

test('deferred content keeps latest draft, offers retry, and never mounts after disposal',async()=>{
  const saved={requestAnimationFrame:globalThis.requestAnimationFrame,cancelAnimationFrame:globalThis.cancelAnimationFrame},frames=new Map();let id=0,calls=0,resolve,reject,childAttrs,mounts=0
  globalThis.requestAnimationFrame=fn=>{frames.set(++id,fn);return id};globalThis.cancelAnimationFrame=key=>frames.delete(key)
  const renderer=createRenderer({insert(){},remove(){},patchProp(){},createElement:()=>({}),createText:()=>({}),createComment:()=>({}),setText(){},setElementText(){},parentNode:()=>null,nextSibling:()=>null})
  const child=defineComponent({inheritAttrs:false,setup(_,{attrs}){mounts++;childAttrs=attrs;return()=>null}})
  const Deferred=deferredComponent(()=>{calls++;return new Promise((yes,no)=>{resolve=yes;reject=no})},'Fixture editor')
  const draft=ref('Original'),visible=ref(true),app=renderer.createApp({setup(){return()=>visible.value?h(Deferred,{modelValue:draft.value,'onUpdate:modelValue':value=>draft.value=value}):null}})
  try{
    const vm=app.mount({}),advance=async()=>{await nextTick();const callbacks=[...frames.values()];frames.clear();callbacks.forEach(fn=>fn(0));await new Promise(resolve=>setTimeout(resolve,0));await nextTick()}
    assert.equal(calls,0);await advance();assert.equal(calls,1)
    reject(new Error('Fixture load failure'));await nextTick();await Promise.resolve();await nextTick()
    const status=vm.$.subTree.component.subTree.children[0]
    assert.equal(status.props.role,'alert');status.children[1].props.onClick()
    draft.value='Edited during retry';await advance();resolve({default:child});await nextTick();await Promise.resolve();await nextTick()
    assert.equal(childAttrs.modelValue,'Edited during retry');childAttrs['onUpdate:modelValue']('Native draft unchanged');assert.equal(draft.value,'Native draft unchanged')
    visible.value=false;await nextTick();visible.value=true;await nextTick();await advance();assert.equal(calls,3)
    app.unmount();resolve({default:child});await nextTick();await Promise.resolve();assert.equal(mounts,1,'late import must not instantiate old item editor')
  }finally{app.unmount();Object.assign(globalThis,saved)}
})
