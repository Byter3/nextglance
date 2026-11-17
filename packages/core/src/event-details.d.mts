export interface EventDetails {title?:string;location?:string;description?:string;reminders?:number[]}
export function normalizeEventReminders(value:unknown):number[];
export function normalizeEventDetails(input:unknown, options?:{requireTitle?:boolean}):EventDetails;
export function linkedEventDescription(record: {title?:string;collectionTitle?:string;source?:string;url?:string} | null | undefined):string;
export function newEventDetails(record?:{title?:string;collectionTitle?:string;source?:string;url?:string} | null):Required<EventDetails>;
