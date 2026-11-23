<script setup lang="ts">
import {useIsWeekend} from './useWeekendDays'
import {usePortalTarget} from "./portal-target"
const portalTarget=usePortalTarget()
import { computed, nextTick, ref, watch } from 'vue'
import { CalendarDays, Check, X, ChevronDown, FolderKanban, Link2, UserRound, SlidersHorizontal, Info, RotateCcw, Layers, Plus } from 'lucide-vue-next'
import { boardColumns, isClosed } from '@nextspace/core/planner.mjs'
import {defaultStatusMapping,mappedColumnForRecord,statusMoveTargets,UNMAPPED_COLUMN,unifiedStatus,boardModeAfterMappingChange} from '@nextspace/core/status-mapping.mjs'
import type {StatusMoveIntent,StatusMoveTarget} from '@nextspace/core/status-mapping.mjs'
import type { Collection, Relation, StatusMapping, WorkspaceRecord } from '@nextspace/contracts'
import { dayKey, isOverdue, shortDate, sourceLabels } from './planner-ui'
import BoardChecklist from './BoardChecklist.vue'
import BoardTaskLayers from './BoardTaskLayers.vue'
import {boardTaskStacks,boardOrderKey,orderBoardRecords,reorderIds,buildLinkIndex,boardHighlightState,boardColumnDropAllowed} from '@nextspace/core/planning-order.mjs'
import {useListReorder,type ListReorderPoint,type ListReorderVisual} from './useListReorder'
import {useBoardWindow} from './useBoardWindow'
import type {ScopeArrangement} from '@nextspace/contracts'

const isWeekend=useIsWeekend()
const props=withDefaults(defineProps<{records:WorkspaceRecord[];collections:Collection[];relations:Relation[];workflow:Record<string,string>;scopeId:string;selectedId?:string|null;username?:string;canCreateCard?:boolean;createCardReason?:string;canMoveNative?:boolean;canCompleteNative?:boolean;canMoveTasks?:boolean;canEditRecord?:(record:WorkspaceRecord)=>boolean;locked?:boolean;colorFor:(record:WorkspaceRecord)=>string;sourceColorFor?:(record:WorkspaceRecord)=>string;tagsFor?:(record:WorkspaceRecord)=>{id:string;title:string;color?:string}[];statusMapping?:StatusMapping;hasCustomMapping?:boolean;toolbarTarget?:string;arrangement?:ScopeArrangement;groupTasks?:boolean}>(),{hasCustomMapping:undefined,canCompleteNative:undefined})
const emit=defineEmits<{open:[record:WorkspaceRecord];createCard:[boardId?:string];workflow:[id:string,column:'inbox'|'planned'|'doing'|'done'];move:[id:string,stackId:string];checklistEdit:[edit:{id:string;body:string}];configureStatuses:[];statusMove:[intent:StatusMoveIntent];reorder:[intent:{key:string;ids:string[]}];resetOrder:[];'update:groupTasks':[value:boolean]}>()
const configuredMapping=computed(()=>props.hasCustomMapping??Boolean(props.statusMapping))
const boardId=ref(configuredMapping.value?'__unified__':'')
const dragged=ref<string|null>(null),over=ref('')
const moveNotice=ref(''),pendingMove=ref<{id:string;columnId:string;title:string;targets:StatusMoveTarget[]}|null>(null),chosenTarget=ref('')
let returnFocus:HTMLElement|null=null
const boards=computed(()=>props.collections.filter(c=>c.source==='deck'))
const board=computed(()=>boards.value.find(b=>b.id===boardId.value))
const createDisabled=computed(()=>props.locked||!props.canCreateCard||Boolean(board.value&&(board.value.readonly||!board.value.stacks?.length)))
const createReason=computed(()=>board.value?.readonly?'This Deck board is read only.':board.value&&!board.value.stacks?.length?'Create a stack in Nextcloud Deck first.':createDisabled.value?props.createCardReason:'Create a card in Nextcloud Deck')
const planning=computed(()=>boardId.value==='__planning__')
const unified=computed(()=>boardId.value==='__unified__')
const native=computed(()=>Boolean(board.value))
const actions=computed(()=>props.records.filter(r=>r.kind==='task'||r.kind==='card'))
const mapping=computed(()=>props.statusMapping||defaultStatusMapping(props.collections))
const sourceColumns=computed(()=>boardColumns(props.records,props.collections,{mode:unified.value?'mapped':planning.value?'planning':native.value?'deck':'source',boardId:board.value?.id,workflow:props.workflow,statusMapping:props.statusMapping}))

const boardRoot=ref<HTMLElement>(),hovered=ref<string|null>(null),focused=ref<string|null>(null),expanded=ref(new Set<string>())
const orderMode=()=>unified.value?'mapped':planning.value?'planning':native.value?'deck':'source'
const orderKey=(column:string)=>boardOrderKey(orderMode(),native.value?board.value!.id:'',column)
const eligibleStackRecords=computed(()=>{
  const cards=new Set(sourceColumns.value.flatMap(column=>column.records.filter(record=>record.kind==='card').map(record=>record.id)))
  return props.records.filter(record=>record.kind==='task'||cards.has(record.id))
})
const stacks=computed(()=>props.groupTasks?boardTaskStacks(eligibleStackRecords.value,props.relations):{parentByTask:{},byCard:{}})
const columns=computed(()=>sourceColumns.value.map(column=>({...column,records:orderBoardRecords(column.records.filter(record=>!stacks.value.parentByTask[record.id]),props.arrangement?.boardCards?.[orderKey(column.id)]||[])})))
const retainedStacks=computed(()=>[props.selectedId,focused.value,dragged.value].filter((id):id is string=>Boolean(id)).map(id=>stacks.value.parentByTask[id]||id))
const windowed=useBoardWindow(boardRoot,columns,retainedStacks)
const renderedColumns=computed(()=>columns.value.map(column=>({...column,height:windowed.layouts.value.get(column.id)?.totalHeight||0,rows:(windowed.windows.value.get(column.id)||[]).map(position=>({position,record:column.records[position.index]!}))})))
const linkIndex=computed(()=>buildLinkIndex(props.relations))
const highlights=computed(()=>boardHighlightState(linkIndex.value,[hovered.value,focused.value,props.selectedId]))
const emptyChildren={incoming:[] as WorkspaceRecord[],outgoing:[] as WorkspaceRecord[]}
const children=(id:string)=>stacks.value.byCard[id]||emptyChildren
const childCount=(id:string)=>children(id).incoming.length+children(id).outgoing.length
const expandedStackIds=computed(()=>{const ids=new Set(expanded.value);for(const id of [hovered.value,focused.value,props.selectedId])if(id)ids.add(stacks.value.parentByTask[id]||id);return ids})
const stackExpanded=(id:string)=>expandedStackIds.value.has(id)
function toggleStack(id:string){const value=new Set(expanded.value);value.has(id)?value.delete(id):value.add(id);expanded.value=value}
function leaveFocus(event:FocusEvent){if(!(event.relatedTarget instanceof Node)||!boardRoot.value?.contains(event.relatedTarget))focused.value=null}
const dragPreview=ref<HTMLElement>()
let grabOffset:{x:number;y:number}|undefined
// A disposable inert DOM image follows the pointer. It is not another rendered
// record, and pointer frames never update records, queries or Board columns.
function previewDrag(point:ListReorderVisual|null){
  const layer=dragPreview.value
  if(!layer)return
  if(!point){layer.hidden=true;layer.replaceChildren();grabOffset=undefined;return}
  if(!grabOffset){
    const bounds=point.element.getBoundingClientRect(),card=point.element.cloneNode(true) as HTMLElement
    grabOffset={x:point.startX-bounds.left,y:point.startY-bounds.top}
    for(const element of [card,...card.querySelectorAll<HTMLElement>('*')]){
      for(const name of Array.from(element.attributes).map(attribute=>attribute.name))if(name==='id'||name.startsWith('data-record')||name.startsWith('data-order')||name==='aria-controls'||name==='aria-describedby')element.removeAttribute(name)
      element.removeAttribute('autofocus')
    }
    card.classList.remove('moving');card.setAttribute('inert','');card.style.margin='0'
    const style=getComputedStyle(point.element)
    for(const name of Array.from(style))if(name.startsWith('--'))layer.style.setProperty(name,style.getPropertyValue(name))
    layer.style.width=bounds.width+'px';layer.replaceChildren(card);layer.hidden=false
  }
  dragged.value=point.id
  layer.style.transform=`translate3d(${point.x-grabOffset.x}px,${point.y-grabOffset.y}px,0)`
}
const reorder=useListReorder(boardRoot,{
  onVisual:previewDrag,
  canReorder:()=>!props.locked,
  items:()=>Array.from(boardRoot.value?.querySelectorAll<HTMLElement>('.board-order-item')||[]).map(element=>({id:element.dataset.orderId!,group:element.dataset.orderGroup!,element})),
  commit:({id,targetId,placement,group})=>{const column=columns.value.find(column=>orderKey(column.id)===group);if(!column)return;emit('reorder',{key:group,ids:reorderIds(props.arrangement?.boardCards?.[group]||[],column.records.map(record=>record.id),id,targetId,placement)})},
  onMoveOther:point=>{dragged.value=point?.id||null;windowed.drag(point);const target=point&&externalColumn(point);over.value=target?.id||'';return Boolean(point&&(!visibleColumn(point)||target))},
  onDropOther:point=>{const target=externalColumn(point);if(!target)return false;move(point.id,target.id);return true},
  pan:(dx,dy)=>{
    let horizontal=boardRoot.value?.querySelector<HTMLElement>('.board-columns')||boardRoot.value,vertical:HTMLElement|undefined=horizontal
    while(horizontal&&horizontal.scrollWidth<=horizontal.clientWidth+1)horizontal=horizontal.parentElement||undefined
    while(vertical&&(vertical.scrollHeight<=vertical.clientHeight+1||!/(auto|scroll)/.test(getComputedStyle(vertical).overflowY)))vertical=vertical.parentElement||undefined
    if(horizontal)horizontal.scrollLeft+=dx
    if(vertical)vertical.scrollTop+=dy
  },
})
function visibleColumn(point:ListReorderPoint){
  // Hit-test the visible page, not offscreen column rectangles behind an inspector.
  const element=document.elementFromPoint(point.x,point.y)?.closest<HTMLElement>('.board-column')
  if(!element||!boardRoot.value?.contains(element))return
  return columns.value.find(column=>column.id===element.dataset.columnId)
}
function externalColumn(point:ListReorderPoint){
  const record=actions.value.find(item=>item.id===point.id),current=columns.value.find(column=>orderKey(column.id)===point.sourceGroup)
  if(!record||!current?.records.some(item=>item.id===point.id))return
  const target=visibleColumn(point)
  if(target&&boardColumnDropAllowed({mode:orderMode(),currentColumnId:current.id,columnId:target.id,canMove:canMove(record),statusTargetCount:unified.value?statusMoveTargets(record,target.id,mapping.value,props.collections).length:0}))return target
}
function cardBodyTarget(target:EventTarget|null){return target instanceof Element&&!target.closest('.board-checklist,.board-card-controls select,.stack-expand,a,input,textarea,[contenteditable="true"],button:not(.board-card-main):not(.board-task-layer)')}
function beginCard(event:PointerEvent,record:WorkspaceRecord,columnId:string){if(cardBodyTarget(event.target))reorder.begin(event,record.id,orderKey(columnId))}
function cardKeydown(event:KeyboardEvent,record:WorkspaceRecord,columnId:string){
  if(!cardBodyTarget(event.target)||!['ArrowUp','ArrowDown','Home','End'].includes(event.key))return
  const column=columns.value.find(item=>item.id===columnId);if(!column)return
  const index=column.records.findIndex(item=>item.id===record.id),target=column.records[event.key==='Home'?0:event.key==='End'?column.records.length-1:index+(event.key==='ArrowUp'?-1:1)]
  if(!target||event.altKey&&props.locked)return
  event.preventDefault();event.stopPropagation()
  if(event.altKey){reorder.cancel();const key=orderKey(columnId);emit('reorder',{key,ids:reorderIds(props.arrangement?.boardCards?.[key]||[],column.records.map(item=>item.id),record.id,target.id,event.key==='ArrowUp'||event.key==='Home'?'before':'after')});focused.value=record.id;void nextTick(()=>windowed.reveal(columnId,record.id))}
  else{focused.value=target.id;void windowed.reveal(columnId,target.id)}
}
function dropClass(id:string,group:string){const marker=reorder.marker.value;return marker?.targetId===id&&marker.group===group?'order-drop-'+marker.placement:''}
watch(()=>props.scopeId,()=>{expanded.value=new Set();hovered.value=null;focused.value=null;reorder.cancel()})
watch(()=>boardId.value,()=>{reorder.cancel();expanded.value=new Set()})

watch(()=>props.scopeId,()=>{boardId.value=configuredMapping.value?'__unified__':'';dragged.value=null;over.value='';closeStatusChoice()})
watch(configuredMapping,(value,previous)=>{boardId.value=boardModeAfterMappingChange(boardId.value,previous,value)})
watch(()=>boards.value.map(b=>b.id).join(','),()=>{if(boardId.value&&!planning.value&&!unified.value&&!boards.value.some(b=>b.id===boardId.value))boardId.value=configuredMapping.value?'__unified__':''})
function canMove(record:WorkspaceRecord){return !props.locked&&(planning.value&&!isClosed(record)||Boolean(native.value&&props.canMoveNative&&!record.readonly&&board.value?.stacks?.length)||Boolean(unified.value&&!record.readonly&&(record.source==='deck'?props.canMoveNative&&(props.canCompleteNative??props.canMoveNative):record.source==='tasks'&&props.canMoveTasks)&&columns.value.some(column=>statusMoveTargets(record,column.id,mapping.value,props.collections).length)))}
function move(id:string,column:string){
  const record=actions.value.find(r=>r.id===id)
  if(!record||!canMove(record)||planning.value&&column==='cancelled')return
  moveNotice.value=''
  if(native.value)emit('move',id,column)
  else if(planning.value)emit('workflow',id,column as 'inbox'|'planned'|'doing'|'done')
  else if(unified.value){
    if(mappedColumnForRecord(record,mapping.value)===column)return
    const targets=statusMoveTargets(record,column,mapping.value,props.collections)
    if(!targets.length){moveNotice.value=`No writable status from ${record.collectionTitle||'this source'} maps to ${columns.value.find(item=>item.id===column)?.title||'this column'}. Map a status from this source first.`;return}
    if(targets.length===1){emitStatusMove(record.id,targets[0]!);return}
    returnFocus=document.activeElement instanceof HTMLElement?document.activeElement:null
    pendingMove.value={id:record.id,columnId:column,title:record.title,targets};chosenTarget.value=''
    void nextTick(()=>document.querySelector<HTMLInputElement>('.board-status-choice input')?.focus())
  }
}
function emitStatusMove(id:string,target:StatusMoveTarget){const {key,title,...intent}=target;emit('statusMove',{id,...intent})}
function moveSelect(event:Event,id:string,currentColumn:string){const select=event.target as HTMLSelectElement,target=select.value;select.value=currentColumn;move(id,target)}
function closeStatusChoice(){pendingMove.value=null;chosenTarget.value='';void nextTick(()=>returnFocus?.isConnected&&returnFocus.focus())}
function chooseStatus(){const pending=pendingMove.value,record=actions.value.find(item=>item.id===pending?.id);if(!pending||!record||props.locked)return;const target=statusMoveTargets(record,pending.columnId,mapping.value,props.collections).find(item=>item.key===chosenTarget.value);if(!target)return;emitStatusMove(record.id,target);closeStatusChoice()}
function choiceKeyboard(event:KeyboardEvent){if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeStatusChoice()}if(event.key==='Tab'){const items=Array.from(document.querySelectorAll<HTMLElement>('.board-status-choice button:not(:disabled),.board-status-choice input:not(:disabled)'));const first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}}}
function nativeLabel(record:WorkspaceRecord){if(props.statusMapping)return unifiedStatus(record,props.statusMapping)?.title||'';if(record.completed)return 'Completed';if(record.kind==='task')return record.status==='CANCELLED'?'Cancelled':record.status==='IN-PROCESS'?'In progress':'To do';return props.collections.find(collection=>collection.id===record.collectionId)?.stacks?.find(stack=>stack.id===record.stackId)?.title||record.status||'Unknown stack'}
function editChecklist(record:WorkspaceRecord,body:string){if(record.kind==='card'&&!record.readonly&&!props.locked&&props.canEditRecord?.(record))emit('checklistEdit',{id:record.id,body})}
function assigneeLabel(record:WorkspaceRecord){if(!record.assignmentKnown)return 'Assignment unknown';if(!record.assignmentCount&&!record.assigneeIds?.length)return 'Unassigned';const mine=record.assigneeIds?.includes(props.username||'');return mine?(record.assignmentCount||record.assigneeIds?.length||0)>1?'You + others':'You':`${record.assignmentCount||record.assigneeIds?.length||0} assigned`}
</script>
<template>
  <section ref="boardRoot" class="board-view" :class="{'is-ordering':reorder.active.value}" aria-label="Kanban board" @focusout="leaveFocus" @click.capture="reorder.captureClick">
    <Teleport :to="toolbarTarget||'body'" :disabled="!toolbarTarget" defer><div class="board-toolbar">
      <label><FolderKanban :size="15"/><select v-model="boardId" aria-label="Board source"><option value="__unified__">Unified statuses</option><option value="">All sources · source status</option><option v-for="item in boards" :key="item.id" :value="item.id">{{item.title}} · Deck</option><option value="__planning__">Personal planning</option></select><ChevronDown :size="13"/></label>
      <button class="text-button board-create-card" :disabled="createDisabled" :title="createReason" @click="emit('createCard',board?.id)"><Plus :size="15"/>Create card</button>
      <button class="text-button mapping-open-button" :disabled="locked" @click="emit('configureStatuses')"><SlidersHorizontal :size="14"/>Map statuses</button>
      <label class="board-group-toggle"><input type="checkbox" :checked="groupTasks" @change="emit('update:groupTasks',($event.target as HTMLInputElement).checked)"/><Layers :size="14"/>Group linked tasks</label><button v-if="Object.keys(arrangement?.boardCards||{}).length" class="text-button" :disabled="locked" @click="emit('resetOrder')"><RotateCcw :size="14"/>Reset order</button><details class="board-help"><summary aria-label="About this board" title="About this board"><Info :size="16"/></summary><p>{{unified?'Each column can group several Deck stacks and task statuses. Moving work updates the original source. When several target statuses match, choose the one to use. Unmapped work remains visible.':planning?'These optional columns organize your work separately from source status. Completing an item still happens in Nextcloud.':native?'Columns are the stacks on this Deck board. Use a card’s move control or drag it to another stack.':'Deck cards follow their actual stacks. Tasks follow their task status. Open an item to change its status, or choose Unified statuses to move tasks and cards between mapped columns.'}}</p></details>
    </div></Teleport>
    <p v-if="moveNotice" class="board-move-notice" role="alert">{{moveNotice}} <button class="text-button" @click="emit('configureStatuses')">Map statuses</button></p>
    <p v-if="unified&&!configuredMapping" class="board-mapping-hint">Map your Deck stacks into these columns to combine them with tasks. Unmapped work stays visible.</p>
    <div v-if="!columns.length" class="panel-empty"><strong>No work in this view</strong><p>Adjust filters to include other items.</p></div>
    <div class="board-columns">
      <section v-for="(column,index) in renderedColumns" :key="column.id" class="board-column" :data-column-id="column.id" :class="{'drop-over':over===column.id}">
        <header><span class="column-mark" :class="`column-${index%4}`" :style="column.color?{background:column.color}:undefined"></span><h3>{{column.title}}</h3><span>{{column.records.length}}</span></header>
        <div class="column-cards" :data-window-column="column.id" :style="{height:Math.max(95,column.height)+'px'}">
          <div v-for="{record,position} in column.rows" :key="record.id" :ref="element=>windowed.rowRef(record.id,element)" class="board-stack board-order-item" :style="{top:position.top+'px'}" :class="[dropClass(record.id,orderKey(column.id)),{expanded:stackExpanded(record.id)}]" :data-order-id="record.id" :data-order-group="orderKey(column.id)" @keydown="cardKeydown($event,record,column.id)" @pointerenter="$event.pointerType!=='touch'&&(hovered=record.id)" @pointerleave="hovered=null" @focusin="focused=($event.target as HTMLElement).closest<HTMLElement>('[data-task-id]')?.dataset.taskId||record.id">
          <BoardTaskLayers :records="children(record.id).incoming" placement="incoming" :expanded="stackExpanded(record.id)" :selected-id="selectedId" :primary-ids="highlights.primary" :highlighted="highlights.linked" :color-for="colorFor" :source-color-for="sourceColorFor" :status-for="nativeLabel" @open="emit('open',$event)" @hover="hovered=$event||record.id" @focus="focused=$event"/>
          <article class="board-card" :data-record-id="record.id" :style="{'--item-color':colorFor(record),'--source-color':sourceColorFor?.(record)||colorFor(record)}" :class="{selected:record.id===selectedId,completed:isClosed(record),primary:highlights.primary.has(record.id),linked:highlights.linked.has(record.id),'can-drag':!locked,moving:reorder.active.value&&dragged===record.id}" draggable="false" @pointerdown="beginCard($event,record,column.id)" @dragstart.prevent>
            <button class="board-card-main" aria-keyshortcuts="ArrowUp ArrowDown Home End Alt+ArrowUp Alt+ArrowDown" @focus="focused=record.id" @click="emit('open',record)">
              <strong><Check v-if="record.completed" :size="14" class="complete-label"/><X v-else-if="isClosed(record)" :size="13" class="muted"/>{{record.title}}</strong>
              <span class="board-card-source"><span class="source-color-dot" :style="{background:sourceColorFor?.(record)||colorFor(record)}" title="Original source color"></span>{{record.collectionTitle||sourceLabels[record.source]}}</span>
              <span v-if="unified" class="board-native-status">{{nativeLabel(record)}}</span>
              <span v-if="tagsFor?.(record).length" class="board-card-tags"><span v-for="tag in tagsFor?.(record)" :key="tag.id" :style="{'--tag-color':tag.color||'var(--muted)'}"><i></i>{{tag.title}}</span></span>
              <span v-if="record.due||isClosed(record)||linkIndex.has(record.id)" class="card-meta"><span v-if="isClosed(record)" :class="record.completed?'complete-label':'muted'">{{record.completed?'Completed':'Cancelled'}}</span><span v-else-if="record.due" :class="{overdue:isOverdue(record),'weekend-date':isWeekend(record.due)}" :data-date="dayKey(record.due)"><CalendarDays :size="12"/>{{shortDate(record.due)}}</span><Link2 v-if="linkIndex.has(record.id)" :size="12" aria-label="Has linked items"/></span>
            </button>
            <button v-if="childCount(record.id)" class="text-button stack-expand" :aria-expanded="stackExpanded(record.id)" :aria-label="(stackExpanded(record.id)?'Collapse':'Expand')+' linked tasks for '+record.title" @click.stop="toggleStack(record.id)"><Layers :size="12"/>{{childCount(record.id)}} tasks<ChevronDown :size="12"/></button>
            <BoardChecklist v-if="record.kind==='card'&&record.body" :body="record.body" :record-id="record.id" :title="record.title" :editable="!record.readonly&&!locked&&Boolean(canEditRecord?.(record))" @edit="editChecklist(record,$event)"/>
            <footer v-if="planning||native||unified" class="board-card-controls"><span v-if="record.kind==='card'" class="card-assignee"><UserRound :size="12"/>{{assigneeLabel(record)}}</span><span v-else class="card-assignee">Task</span><select :value="column.id" :disabled="!canMove(record)" :aria-label="`Move ${record.title}`" @change="moveSelect($event,record.id,column.id)"><option v-for="target in columns" :key="target.id" :value="target.id" :disabled="planning&&target.id==='cancelled'||unified&&(target.id===UNMAPPED_COLUMN||!statusMoveTargets(record,target.id,mapping,collections).length)">{{target.title}}</option></select></footer>
          </article>
          <BoardTaskLayers :records="children(record.id).outgoing" placement="outgoing" :expanded="stackExpanded(record.id)" :selected-id="selectedId" :primary-ids="highlights.primary" :highlighted="highlights.linked" :color-for="colorFor" :source-color-for="sourceColorFor" :status-for="nativeLabel" @open="emit('open',$event)" @hover="hovered=$event||record.id" @focus="focused=$event"/>
          </div>
          <div v-if="!column.records.length" class="empty-column">No items</div>
        </div>
      </section>
    </div>
    <Teleport :to="portalTarget"><div ref="dragPreview" class="board-drag-preview" aria-hidden="true" inert hidden></div></Teleport>
    <Teleport :to="portalTarget"><div v-if="pendingMove" class="board-status-choice-backdrop" @click.self="closeStatusChoice">
      <section class="board-status-choice" role="dialog" aria-modal="true" aria-labelledby="board-status-choice-title" @keydown="choiceKeyboard">
        <h2 id="board-status-choice-title">Choose the native status</h2><p>Several statuses from this source map to <strong>{{columns.find(column=>column.id===pendingMove?.columnId)?.title}}</strong>. Choose the status for <strong>{{pendingMove.title}}</strong>.</p>
        <label v-for="target in pendingMove.targets" :key="target.key"><input v-model="chosenTarget" type="radio" name="mapped-status-target" :value="target.key" :disabled="locked"/><span>{{target.title}}</span></label>
        <div class="form-actions"><button class="button quiet" @click="closeStatusChoice">Cancel</button><button class="button primary" :disabled="locked||!chosenTarget" @click="chooseStatus">Update status</button></div>
      </section>
    </div></Teleport>
  </section>
</template>
<style scoped>
.board-drag-preview{position:fixed;left:0;top:0;z-index:2000;pointer-events:none;will-change:transform;filter:drop-shadow(0 10px 16px #0006)}.board-drag-preview[hidden]{display:none}.board-drag-preview :deep(.board-card){opacity:.96;outline:2px solid var(--primary);outline-offset:0;cursor:grabbing}.board-column.drop-over{outline:2px solid var(--primary);outline-offset:-2px;background:color-mix(in srgb,var(--primary) 12%,var(--surface))}
.column-cards{position:relative;overflow-anchor:none}.board-stack{position:absolute;left:var(--shell-inset,8px);right:var(--shell-inset,8px);margin-bottom:0}.board-stack>.board-card{position:relative;z-index:40;margin-bottom:0}
.board-stack.order-drop-before:before,.board-stack.order-drop-after:after{content:"";display:block;height:3px;background:var(--primary);position:absolute;left:0;right:0;z-index:60}.board-stack.order-drop-before:before{top:-4px}.board-stack.order-drop-after:after{bottom:-4px}
.board-card.linked:not(.primary){outline:2px dashed color-mix(in srgb,var(--primary) 70%,var(--muted));outline-offset:-2px;box-shadow:inset 0 0 0 3px color-mix(in srgb,var(--primary) 10%,transparent)}
.board-card.primary,.board-card.selected{outline:2px solid var(--primary);outline-offset:-2px}
.board-card.can-drag,.board-card.can-drag>.board-card-main{cursor:grab;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}.board-card.can-drag>.board-card-main{touch-action:none}.is-ordering .board-card.can-drag,.is-ordering .board-card-main{cursor:grabbing}.board-card.moving{opacity:.32}
.board-group-toggle{display:flex!important;align-items:center;gap:6px;font-size:12px;white-space:nowrap}.board-group-toggle input{width:auto;margin:0}.stack-expand{font-size:11px;min-height:28px;margin:0 8px 4px}.completed .board-card-main>strong{text-decoration:line-through;text-decoration-thickness:2px}@media(pointer:coarse){.stack-expand{min-height:40px;min-width:40px}}

.board-card{border-inline-start:4px solid var(--source-color);background:color-mix(in srgb,var(--item-color) 11%,var(--surface))}.board-card.selected{border-inline-start-color:var(--source-color)}.board-card-main{background:transparent}.board-native-status{display:block;font-size:11px;color:var(--muted);margin-top:6px}.board-card-tags{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}.board-card-tags>span{display:inline-flex;align-items:center;gap:5px;max-width:100%;font-size:10px;line-height:1.5;padding:3px 6px;border:1px solid color-mix(in srgb,var(--tag-color) 55%,var(--border));border-radius:6px;background:color-mix(in srgb,var(--tag-color) 14%,var(--surface));color:var(--text);overflow-wrap:anywhere}.board-card-tags i{width:6px;height:6px;flex:none;border-radius:50%;background:var(--tag-color)}.board-move-notice,.board-mapping-hint{font-size:12px;color:var(--muted);line-height:1.6;margin:0 0 16px}.board-move-notice{padding:10px 12px;border:1px solid var(--border);border-radius:7px}.board-move-notice .text-button{display:inline-flex;margin-left:7px}.mapping-open-button{white-space:nowrap}.board-status-choice-backdrop{position:fixed;inset:0;z-index:1200;background:#0008;display:grid;place-items:center;padding:20px}.board-status-choice{width:min(460px,100%);padding:26px;border:1px solid var(--border);border-radius:14px;background:var(--surface);box-shadow:0 15px 60px #0004}.board-status-choice h2{font-size:21px;margin:0 0 12px}.board-status-choice>p{font-size:13px;color:var(--muted);line-height:1.6;margin:0 0 18px}.board-status-choice>label{display:flex;align-items:center;gap:10px;padding:12px;margin:8px 0;border:1px solid var(--border);border-radius:8px;font-size:14px;cursor:pointer}.board-status-choice>label:has(input:checked){border-color:var(--primary);background:var(--primary-soft)}.board-status-choice input{width:16px;height:16px;accent-color:var(--primary)}.board-status-choice .form-actions{margin-top:20px}
</style>
