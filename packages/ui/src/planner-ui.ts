import type { Source, WorkspaceRecord } from '@nextspace/contracts'
import { isClosed } from '@nextspace/core/planner.mjs'

export const sourceLabels: Record<Source, string> = {tasks: 'Tasks', calendar: 'Calendar', deck: 'Deck', notes: 'Notes', collectives: 'Collectives'}
// Formatting hundreds of labels must not construct an Intl formatter per label.
// Refresh at most once a minute so a running client follows host time-zone changes.
let formatterMinute=-1,shortDateFormatter:Intl.DateTimeFormat,clockTimeFormatter:Intl.DateTimeFormat
function prepareDateFormatters(){
  const minute=Math.floor(Date.now()/60000)
  if(minute===formatterMinute)return
  shortDateFormatter=new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric'})
  clockTimeFormatter=new Intl.DateTimeFormat(undefined,{hour:'2-digit',minute:'2-digit'})
  formatterMinute=minute
}
export function dateValue(value?: string) { return value ? new Date(value.includes('T') ? value : `${value}T00:00:00`) : new Date(NaN) }
export function dayKey(value: Date | string) {
  const date = typeof value === 'string' ? dateValue(value) : value
  return Number.isFinite(+date) ? `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}` : ''
}
export function shortDate(value?: string) {
  if (!value) return 'No date'
  const date = dateValue(value)
  if (!Number.isFinite(+date)) return 'Invalid date'
  if (dayKey(date) === dayKey(new Date())) return 'Today'
  prepareDateFormatters()
  return shortDateFormatter.format(date)
}
export function clockTime(value?: string) {
  const date = dateValue(value)
  if(!Number.isFinite(+date))return ''
  prepareDateFormatters()
  return clockTimeFormatter.format(date)
}
export function eventLabel(record: WorkspaceRecord) {
  if (record.allDay || !record.start?.includes('T')) return 'All day'
  return `${clockTime(record.start)}${record.end ? ` – ${clockTime(record.end)}` : ''}`
}
export function isOverdue(record: WorkspaceRecord) { return !isClosed(record) && Boolean(record.due && dayKey(record.due) && dayKey(record.due) < dayKey(new Date())) }
export function inputDateTime(value?: string) {
  const date = value ? dateValue(value) : new Date()
  if (!Number.isFinite(+date)) return ''
  return `${dayKey(date)}T${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`
}
export function excerpt(value?: string) { return (value || '').replace(/[#*_>`\[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0,140) }
export function safeColor(value?: string) { return value && /^#(?:[\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i.test(value) ? value : undefined }

type RGB = [number, number, number]
function rgb(value: string): RGB | null {
  const hex=value.trim().replace(/^#/,'')
  if (/^[\da-f]{3}$/i.test(hex)) return hex.split('').map(v=>parseInt(v+v,16)) as RGB
  if (/^(?:[\da-f]{6}|[\da-f]{8})$/i.test(hex)) return [0,2,4].map(i=>parseInt(hex.slice(i,i+2),16)) as RGB
  const match=/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(value)
  return match ? [Number(match[1]),Number(match[2]),Number(match[3])] : null
}
function luminance(color: RGB) {
  const [r,g,b]=color.map(value=>{const v=value/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4})
  return r!*.2126+g!*.7152+b!*.0722
}
function ratio(a: RGB,b: RGB) {const first=luminance(a),last=luminance(b);return (Math.max(first,last)+.05)/(Math.min(first,last)+.05)}
/** Keep mapped status colors exact while choosing readable label text. */
export function textOnColor(value:string) {
  const background=rgb(value)||[139,147,159] as RGB
  return ratio(background,[0,0,0])>=ratio(background,[255,255,255])?'#000000':'#ffffff'
}
function hexColor(color:RGB) {return '#'+color.map(v=>Math.round(v).toString(16).padStart(2,'0')).join('')}
function hsl(color: RGB): [number,number,number] {
  const [r,g,b]=color.map(v=>v/255) as RGB,max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min,l=(max+min)/2
  if (!delta) return [0,0,l]
  const h=(max===r?(g-b)/delta+(g<b?6:0):max===g?(b-r)/delta+2:(r-g)/delta+4)*60
  return [h,delta/(1-Math.abs(2*l-1)),l]
}
function fromHsl(h:number,s:number,l:number):RGB {
  const c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs((h/60)%2-1)),m=l-c/2
  const base=h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x]
  return base.map(v=>Math.round((v+m)*255)) as RGB
}
/** Adapt only UI accents; source calendar colors are never passed through this helper. */
export function accessibleAccent(value:string|undefined, backgrounds:string[], dark:boolean) {
  const original=rgb(value||'')||[0,130,201] as RGB
  const surfaces=backgrounds.map(rgb).filter((color):color is RGB=>color!==null)
  if(!surfaces.length)surfaces.push(dark?[29,37,50]:[255,255,255])
  const [h,s,l]=hsl(original)
  const readable=(color:RGB)=>surfaces.every(background=>{
    // Active navigation uses the same accent over a nine-percent tint.
    const tinted=background.map((channel,i)=>Math.round(channel*.91+color[i]!*.09)) as RGB
    return ratio(color,background)>=4.5&&ratio(color,tinted)>=4.5
  })
  let color=original
  for(let step=0;!readable(color)&&step<=1024;step++)color=fromHsl(h,s,Math.min(1,Math.max(0,l+(dark?1:-1)*step/1024)))
  const onPrimary=ratio(color,[0,0,0])>=ratio(color,[255,255,255])?'#000000':'#ffffff'
  const [adjustedH,adjustedS,adjustedL]=hsl(color)
  const hover=fromHsl(adjustedH,adjustedS,Math.max(0,Math.min(1,adjustedL+(onPrimary==='#000000'?.06:-.06))))
  return {primary:hexColor(color),onPrimary,hover:hexColor(hover)}
}
