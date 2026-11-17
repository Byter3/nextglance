export function createRecordEdits<T extends {id:string}>(options: {
  read(id:string):T|undefined
  write(id:string, record:T):void
  changed?(pending:number):void
  failed?(id:string, error:unknown, patches:Partial<T>[]):void
}): {
  enqueue(id:string, patch:Partial<T>, save:(acknowledged:T)=>Promise<T|undefined>):Promise<boolean>
  protectedIds():string[]
  retry(id:string):Promise<boolean>
  discard(id:string):void
  idle():Promise<void>
}
