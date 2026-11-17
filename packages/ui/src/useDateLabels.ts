import {computed} from 'vue'

/** Locale formatting belongs to date changes, never selection/scroll renders. */
export function useDateLabels(days:()=>Date[]) {
  return computed(()=>{
    const weekday=new Intl.DateTimeFormat(undefined,{weekday:'short'})
    const short=new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric'})
    const full=new Intl.DateTimeFormat(undefined,{weekday:'long',year:'numeric',month:'long',day:'numeric'})
    const local=new Intl.DateTimeFormat()
    const month=new Intl.DateTimeFormat(undefined,{month:'short'})
    return new Map(days().map(day=>[+day,{weekday:weekday.format(day),short:short.format(day),full:full.format(day),local:local.format(day),number:day.getDate(),month:month.format(day)}]))
  })
}
