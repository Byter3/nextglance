import {validateWorkspace} from '@nextspace/core/planner-schema.mjs'

/** The export is the shared metadata schema, never a native-data/cache envelope. */
export function plannerExportDocument(workspace) {
  return JSON.stringify(validateWorkspace(workspace))
}

export function checkedPlannerExport(document) {
  if (typeof document !== 'string' || new TextEncoder().encode(document).length > 8 * 1024 * 1024) throw Object.assign(new Error('Planner export exceeds the metadata limit.'), {code: 'VALIDATION'})
  return plannerExportDocument(JSON.parse(document))
}

export async function savePlannerInBrowser(document, picker = globalThis.showSaveFilePicker) {
  const checked = checkedPlannerExport(document)
  if (typeof picker !== 'function') throw Object.assign(new Error('This browser cannot choose an export destination. Use the installed app to export your planner.'), {code: 'UNAVAILABLE'})
  let handle
  try { handle = await picker({suggestedName: 'NextGlance-planner.json', types: [{description: 'Planner metadata', accept: {'application/json': ['.json']}}]}) }
  catch (error) { if (error?.name === 'AbortError') return {exported: false}; throw error }
  const writer = await handle.createWritable()
  try { await writer.write(checked); await writer.close(); return {exported: true} }
  catch (error) { await writer.abort?.().catch(() => {}); throw error }
}
