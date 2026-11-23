package com.nextspace.app;

import android.content.Context;
import android.util.AtomicFile;
import com.google.gson.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Tiny per-instance render files, separate from configuration catalogs and native source archives. */
final class NativeWidgetStore {
    record RenderState(JsonObject config,JsonObject snapshot,String monthDate){}
    private static final Object LOCK=new Object();
    private final Context context;
    NativeWidgetStore(Context context){this.context=context.getApplicationContext();}
    static String accountKey(Context context){try{var a=NativeSyncRuntime.savedAccount(context);return a==null?"":NativeLoginFlow.digest(a.serverUrl()+"\0"+a.username()+"\0"+a.name());}catch(Exception ignored){return "";}}
    private AtomicFile file(String name){return new AtomicFile(new File(context.getFilesDir(),name));}
    private String snapshotName(int id){if(id<=0)throw new IllegalArgumentException("Invalid widget ID.");return "nextspace-widget-"+id+".json";}
    private String catalogName(String account){if(!account.matches("[a-f0-9]{64}"))throw new IllegalArgumentException("Invalid widget account.");return "nextspace-widget-catalog-"+account+".json";}
    private JsonObject readFile(String name,int limit)throws Exception{
        AtomicFile file=file(name);File base=file.getBaseFile(),backup=new File(base.getPath()+".bak");if(!base.exists()&&!backup.exists())return new JsonObject();
        try(InputStream in=file.openRead()){ByteArrayOutputStream bytes=new ByteArrayOutputStream();byte[] chunk=new byte[8192];int n;while((n=in.read(chunk))!=-1){if(bytes.size()+n>limit)throw new IOException("Widget data exceeds its storage limit.");bytes.write(chunk,0,n);}return JsonParser.parseString(bytes.toString(StandardCharsets.UTF_8)).getAsJsonObject();}
    }
    private void writeFile(String name,JsonObject value,int limit)throws Exception{byte[] bytes=value.toString().getBytes(StandardCharsets.UTF_8);if(bytes.length>limit)throw new IOException("Widget data exceeds its storage limit.");AtomicFile file=file(name);FileOutputStream out=null;try{out=file.startWrite();out.write(bytes);file.finishWrite(out);}catch(Exception error){if(out!=null)file.failWrite(out);throw error;}}
    private JsonObject read()throws Exception{JsonObject s=readFile("nextspace-widgets-v1.json",8*1024*1024);if(s.isEmpty())return NativeWidgetState.empty();if(NativeWidgetPolicy.number(s,"version",0)!=1)throw new IOException("Unsupported widget settings version.");return s;}
    private void write(JsonObject state)throws Exception{writeFile("nextspace-widgets-v1.json",state,8*1024*1024);}
    private JsonArray currentDenials()throws Exception{var account=NativeSyncRuntime.savedAccount(context);return account==null?new JsonArray():NativeSyncRuntime.readDenials(context,account);}
    private String currentAccessProof()throws Exception{return NativeLoginFlow.digest(currentDenials().toString());}
    JsonObject state(String account)throws Exception{synchronized(LOCK){JsonObject s=read(),out=new JsonObject();out.addProperty("revision",NativeWidgetPolicy.number(s,"revision",0));JsonArray configs=new JsonArray();for(var entry:NativeWidgetPolicy.object(s,"configs").entrySet())if(entry.getValue().isJsonObject()&&account.equals(NativeWidgetPolicy.text(entry.getValue().getAsJsonObject(),"accountKey","")))configs.add(entry.getValue().deepCopy());out.add("configs",configs);out.add("catalog",NativeWidgetPolicy.openProjection(readFile(catalogName(account),4*1024*1024),currentAccessProof()));return out;}}
    JsonObject config(int id){synchronized(LOCK){try{return NativeWidgetState.config(read(),id);}catch(Exception ignored){return new JsonObject();}}}
    private JsonObject readSnapshot(int id,JsonObject config,String account)throws Exception{
        JsonObject snapshot=NativeWidgetPolicy.openProjection(readFile(snapshotName(id),1_001_000),currentAccessProof());
        return NativeWidgetPolicy.snapshotMatches(snapshot,config,account)?snapshot:new JsonObject();
    }
    JsonObject snapshot(int id){synchronized(LOCK){try{return readSnapshot(id,NativeWidgetState.config(read(),id),accountKey(context));}catch(Exception ignored){return new JsonObject();}}}
    RenderState renderState(int id)throws Exception{synchronized(LOCK){
        JsonObject state=read(),config=NativeWidgetState.config(state,id),snapshot=readSnapshot(id,config,accountKey(context));
        JsonObject month=NativeWidgetPolicy.object(snapshot,"month"),selection=NativeWidgetState.monthSelection(state,id);
        if(!month.isEmpty()&&!selection.isEmpty()&&(!NativeWidgetMonth.matches(selection,config,month)||NativeWidgetMonth.cell(month,NativeWidgetPolicy.text(selection,"date","")).isEmpty())){
            try{write(NativeWidgetState.withMonthSelection(state,id,new JsonObject()));}catch(Exception ignored){/* The obsolete selection cannot affect rendering. */}
        }
        return new RenderState(config,snapshot,NativeWidgetMonth.selectedDate(month,selection,config));
    }}
    boolean selectMonthDate(int id,int generation,String account,String month,String date)throws Exception{synchronized(LOCK){
        if(!account.equals(accountKey(context)))return false;
        JsonObject state=read(),config=NativeWidgetState.config(state,id),snapshot=readSnapshot(id,config,account);
        JsonObject selection=NativeWidgetMonth.select(config,snapshot,account,month,date,generation);
        if(selection.isEmpty()||selection.equals(NativeWidgetState.monthSelection(state,id)))return false;
        write(NativeWidgetState.withMonthSelection(state,id,selection));return true;
    }}
    JsonObject save(int id,JsonObject config)throws Exception{synchronized(LOCK){JsonObject next=NativeWidgetState.save(read(),id,config,accountKey(context));write(next);file(snapshotName(id)).delete();return NativeWidgetState.config(next,id);}}
    void delete(int[] ids)throws Exception{synchronized(LOCK){write(NativeWidgetState.delete(read(),ids));for(int id:ids)if(id>0)file(snapshotName(id)).delete();}}
    void restore(int[] oldIds,int[] newIds)throws Exception{synchronized(LOCK){write(NativeWidgetState.restore(read(),oldIds,newIds,accountKey(context)));for(int id:oldIds)if(id>0)file(snapshotName(id)).delete();for(int id:newIds)if(id>0)file(snapshotName(id)).delete();}}
    void publish(String account,int revision,JsonObject catalog,JsonArray snapshots,String preparedReadDenials)throws Exception{synchronized(LOCK){if(!account.equals(accountKey(context)))throw new IOException("The selected account changed.");NativeWidgetPolicy.requireUnchangedAccess(preparedReadDenials,currentDenials());String accessProof=NativeLoginFlow.digest(preparedReadDenials);JsonObject s=read();NativeWidgetState.requirePublication(s,account,revision,catalog,snapshots);writeFile(catalogName(account),NativeWidgetPolicy.sealProjection(catalog,accessProof),4*1024*1024);for(JsonElement e:snapshots){JsonObject snapshot=e.getAsJsonObject();int id=NativeWidgetPolicy.number(snapshot,"widgetId",0);JsonObject old;try{old=NativeWidgetPolicy.openProjection(readFile(snapshotName(id),1_001_000),accessProof);}catch(Exception unreadable){old=new JsonObject();}if(!NativeWidgetPolicy.text(old,"fingerprint","").equals(NativeWidgetPolicy.text(snapshot,"fingerprint","missing")))writeFile(snapshotName(id),NativeWidgetPolicy.sealProjection(snapshot,accessProof),1_001_000);}}}
    void invalidateAccount(String account)throws Exception{synchronized(LOCK){JsonObject s=read();for(var e:NativeWidgetPolicy.object(s,"configs").entrySet())if(e.getValue().isJsonObject()&&account.equals(NativeWidgetPolicy.text(e.getValue().getAsJsonObject(),"accountKey",""))){file(snapshotName(NativeWidgetPolicy.number(e.getValue().getAsJsonObject(),"widgetId",0))).delete();NativeWidgetPolicy.object(s,"monthSelections").remove(e.getKey());}file(catalogName(account)).delete();s.addProperty("revision",Math.addExact(NativeWidgetPolicy.number(s,"revision",0),1));write(s);}}
}
