import {defineComponent,h,nextTick,onBeforeUnmount,onMounted,shallowRef,type Component} from 'vue'
import {createAfterPaint} from './after-paint.mjs'

/** Loading is presentation-only; all draft values/events remain owned by callers. */
export function deferredComponent<T extends Component>(loader:()=>Promise<{default:T}>,label:string,fallback?:Component):T{
  return defineComponent({
    name:'DeferredContent',inheritAttrs:false,
    setup(_props,{attrs,slots}){
      const component=shallowRef<Component>(),failed=shallowRef(false)
      let alive=true,generation=0
      const afterPaint=createAfterPaint({afterRender:callback=>{void nextTick(callback)},requestFrame:callback=>requestAnimationFrame(callback),cancelFrame:id=>cancelAnimationFrame(id as number),schedule:callback=>setTimeout(callback,0),cancelScheduled:id=>clearTimeout(id as ReturnType<typeof setTimeout>)})
      function load(){const token=++generation;failed.value=false;afterPaint.run(()=>{void loader().then(module=>{if(alive&&token===generation)component.value=module.default}).catch(()=>{if(alive&&token===generation)failed.value=true})})}
      onMounted(load)
      onBeforeUnmount(()=>{alive=false;generation++;afterPaint.dispose()})
      return()=>component.value?h(component.value,attrs,slots):h('div',{class:'deferred-content','aria-busy':!failed.value},[
        h('div',{class:'deferred-content-status',role:failed.value?'alert':'status'},failed.value?[`${label} could not load. `,h('button',{type:'button',class:'text-button',onClick:load},'Retry')]:`Loading ${label.toLowerCase()}…`),
        fallback?h(fallback,attrs):null,
      ])
    },
  }) as T
}
