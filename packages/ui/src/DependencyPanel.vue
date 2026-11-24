<script setup lang="ts">
import {computed} from 'vue'
import {ArrowDownLeft,ArrowUpRight,ChevronRight,Plus,X} from 'lucide-vue-next'
import type {PlannerView,Relation,StatusMapping,WorkspaceRecord} from '@nextspace/contracts'
import LinkedJump from './LinkedJump.vue'
import {textOnColor} from './planner-ui'
import {dependencyGroups} from '@nextspace/core/dependency-groups.mjs'
const props=withDefaults(defineProps<{record:WorkspaceRecord;records:WorkspaceRecord[];relations:Relation[];statusMapping:StatusMapping;view?:PlannerView;locked?:boolean;pending:Record<string,boolean>;canRemove:(edge:Relation)=>boolean;problem:(edge:Relation)=>string;isDeck:(edge:Relation)=>boolean;failure?:(edge:Relation)=>string}>(),{view:'overview'})
const emit=defineEmits<{add:[];open:[record:WorkspaceRecord];jump:[intent:{id:string;view?:'calendar'|'timeline'}];remove:[edge:Relation];publish:[edge:Relation];retry:[edge:Relation]}>()
const groups=computed(()=>dependencyGroups(props.record.id,props.records,props.relations,props.statusMapping))
const columns=computed(()=>[
  {id:'incoming',title:'Waits for',subtitle:'Incoming',icon:ArrowDownLeft,empty:'No prerequisites',links:groups.value.incoming},
  {id:'outgoing',title:'Needed by',subtitle:'Outgoing',icon:ArrowUpRight,empty:'Nothing waiting on this',links:groups.value.outgoing},
])
const count=computed(()=>columns.value.reduce((sum,column)=>sum+column.links.length,0))
const saving=(edge:Relation)=>Object.hasOwn(props.pending,JSON.stringify([edge.fromId,edge.toId]))
</script>
<template>
  <section class="inspector-section dependencies-section" aria-label="Dependencies">
    <header><h3>Dependencies <span v-if="count">{{count}}</span></h3><button class="text-button" aria-label="Add dependency" :disabled="locked" @click="emit('add')"><Plus :size="15"/>Add</button></header>
    <div v-if="$slots.actions" class="dependency-actions"><slot name="actions"/></div>
    <div class="dependency-columns">
      <div v-for="column in columns" :key="column.id" class="dependency-group" :data-direction="column.id">
        <h4><component :is="column.icon" :size="17"/><span>{{column.title}}<small>{{column.subtitle}}</small></span><span class="dependency-count">{{column.links.length}}</span></h4>
        <p v-if="!column.links.length" class="dependency-empty">{{column.empty}}</p>
        <div v-for="link in column.links" :key="link.id" class="inspector-linked-row dependency-tile">
          <button class="dependency-open" :disabled="!link.record" @click="link.record&&emit('open',link.record)">
            <span>
              <strong>{{link.record?.title||'Unavailable item'}}</strong>
              <small>{{link.record?.kind==='task'?'Task':link.record?.kind==='card'?'Deck card':''}}<template v-if="link.record?.collectionTitle"> · {{link.record.collectionTitle}}</template></small>
              <span v-if="link.status" class="dependency-status" :style="{backgroundColor:link.status.color,color:textOnColor(link.status.color)}">{{link.status.title}}</span>
            </span>
            <ChevronRight :size="14"/>
          </button>
          <LinkedJump v-if="link.record" class="dependency-jump" :record-id="link.record.id" :title="link.record.title" :view="view" @jump="emit('jump',$event)"/>
          <div class="dependency-tile-footer"><span v-if="link.native" class="native-badge">{{saving(link)?'Saving…':'From Deck'}}</span><button v-else-if="isDeck(link)" class="text-button" :disabled="locked||Boolean(problem(link))" :title="problem(link)||'Save in Deck'" @click="emit('publish',link)">Save to Deck</button><span v-else class="native-badge">Planner link</span><button v-if="!link.native||isDeck(link)" class="icon-button" :disabled="!canRemove(link)" :aria-label="'Remove dependency '+(link.record?.title||'unavailable item')" :title="isDeck(link)?problem(link)||'Remove dependency from Deck':'Remove dependency'" @click="emit('remove',link)"><X :size="13"/></button></div>
          <div v-if="failure?.(link)" class="dependency-error" role="alert"><p>{{failure(link)}}</p><button class="text-button" :disabled="locked||saving(link)||isDeck(link)&&Boolean(problem(link))" @click="emit('retry',link)">Retry change</button></div>
        </div>
      </div>
    </div>
  </section>
</template>
<style scoped>
.dependency-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:8px}.dependency-jump{padding:0 9px}
.dependency-columns{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-top:14px}
.dependency-columns .dependency-group{min-width:0;margin:0;padding:14px 10px;background:color-mix(in srgb,var(--hover) 35%,transparent)}
.dependency-group+.dependency-group{border-left:1px solid var(--border)}
.dependency-columns h4{display:flex;align-items:center;gap:7px;margin:0 0 14px;font-size:13px;line-height:1.5;color:var(--text)}
.dependency-columns h4>svg{color:var(--primary);flex:none}.dependency-columns h4 span{min-width:0}.dependency-columns h4 small{display:block;font-size:11px;font-weight:400;color:var(--muted)}
.dependency-columns .dependency-count{margin-left:auto;color:var(--muted);font-size:11px}.dependency-empty{color:var(--muted);font-size:12px;line-height:1.5;margin:0}
.dependency-columns .dependency-tile{display:block;border:1px solid var(--border);border-radius:8px;background:var(--surface);padding:0;margin-bottom:9px;min-width:0}
.dependency-columns .dependency-open{display:flex;width:100%;padding:10px;gap:4px;align-items:flex-start;text-align:left}.dependency-open>span{min-width:0;flex:1}.dependency-open strong{display:block;font-size:13px;line-height:1.5;white-space:normal;overflow-wrap:anywhere}.dependency-open small{display:block;color:var(--muted);font-size:11px;line-height:1.5;margin-top:4px;overflow-wrap:anywhere}
.dependency-status{display:inline-block;max-width:100%;margin-top:4px;padding:1px 6px;border-radius:5px;font-size:11px;font-weight:600;line-height:1.5;white-space:normal;overflow-wrap:anywhere}
.dependency-tile-footer{display:flex;align-items:center;justify-content:space-between;gap:4px;padding:0 8px 7px}.dependency-tile-footer .native-badge{font-size:10px;white-space:normal}.dependency-tile-footer .text-button{font-size:10px}.dependency-tile-footer .icon-button{width:24px;min-width:24px;height:24px}
.dependency-error{padding:0 9px 9px;color:var(--error,#f28b82);font-size:12px;overflow-wrap:anywhere}.dependency-error p{margin:0 0 5px}
</style>
