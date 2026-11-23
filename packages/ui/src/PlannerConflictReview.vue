<script setup lang="ts">
import {computed, ref} from 'vue'
import type {PlannerConflict, PlannerConflictChoice} from '@nextspace/contracts'

const props = defineProps<{conflict: PlannerConflict; disabled: boolean}>()
const emit = defineEmits<{resolve: [choice: PlannerConflictChoice, revision: number]}>()
const reviewedRevision = ref<number>()
const stale = computed(() => reviewedRevision.value !== undefined && reviewedRevision.value !== props.conflict.revision)

const areaLabels: Record<string, string> = {
  spaces: 'Spaces', categories: 'Source groups', projects: 'Projects',
  relations: 'Links and dependencies', plans: 'Work plans', properties: 'Item settings',
  'planner.workflow': 'Workflow', 'planner.arrangements': 'Item order', 'planner.statusMapping': 'Board status mapping',
  planner: 'Planner settings', appearance: 'Appearance', identities: 'Linked item identities',
  'combined-organization-or-settings': 'Organization and settings',
}
const areas = computed(() => [...new Set(props.conflict.paths.map(path => {
  const key = Object.keys(areaLabels).find(prefix => path === prefix || path.startsWith(`${prefix}.`) || path.startsWith(`${prefix}[`))
  return key ? areaLabels[key] : 'Planner settings'
}))])

function resolve(choice: PlannerConflictChoice) {
  if (props.disabled || stale.value || reviewedRevision.value === undefined) return
  emit('resolve', choice, reviewedRevision.value)
}
</script>

<template>
  <section class="planner-conflict-review" aria-labelledby="planner-conflict-heading">
    <strong id="planner-conflict-heading">Overlapping planner changes</strong>
    <p v-if="stale" role="status">The saved copies changed. Review the latest conflict before choosing.</p>
    <button v-if="reviewedRevision === undefined || stale" class="button" type="button" :disabled="disabled" @click="reviewedRevision = conflict.revision">
      {{ stale ? 'Review latest conflict' : 'Review planner conflict' }}
    </button>
    <template v-else>
      <p>Choose which version to keep for the affected areas. Compatible changes from both copies are kept.</p>
      <ul aria-label="Affected planner areas">
        <li v-for="area in areas" :key="area">{{ area }}</li>
      </ul>
      <p v-if="conflict.organizationChoice">Source assignments overlap. Spaces, source groups and projects will be kept together from the version you choose.</p>
      <p v-if="conflict.dependencyChoice">The combined dependencies form a cycle. The dependency graph will be kept together from the version you choose.</p>
      <div class="form-actions">
        <button class="button" type="button" :disabled="disabled" @click="resolve('local')">Keep device changes</button>
        <button class="button" type="button" :disabled="disabled" @click="resolve('remote')">Use Nextcloud changes</button>
        <button class="button quiet" type="button" :disabled="disabled" @click="reviewedRevision = undefined">Cancel review</button>
      </div>
    </template>
  </section>
</template>

<style scoped>
.planner-conflict-review { display: grid; gap: .65rem; padding: .8rem; border: 1px solid var(--border); border-radius: .6rem; }
.planner-conflict-review p, .planner-conflict-review ul { margin: 0; }
.planner-conflict-review > button { justify-self: start; }
.planner-conflict-review .form-actions { flex-wrap: wrap; }
</style>
