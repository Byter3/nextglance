export interface SchedulePreviewSlot {start:string;end:string;allDay:boolean}
export function schedulePreviewBounds(anchor:string|Date,slot:SchedulePreviewSlot):{first:number;last:number}|null
export function shiftSchedulePreview(anchor:string|Date,slot:SchedulePreviewSlot,mode:'move'|'start'|'end',deltaDays:number):SchedulePreviewSlot|null
