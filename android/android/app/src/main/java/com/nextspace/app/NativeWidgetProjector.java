package com.nextspace.app;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import com.google.gson.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

/** One-shot local projection after setup/date changes. No source requests or resident WebView. */
final class NativeWidgetProjector {
    private static final ExecutorService EXECUTOR=Executors.newSingleThreadExecutor();
    private static boolean running,again;
    private static final List<Runnable> callbacks=new ArrayList<>();
    static void schedule(Context context){schedule(context,null);}
    static void schedule(Context context,Runnable callback){android.app.job.JobScheduler jobs=context.getSystemService(android.app.job.JobScheduler.class);if(jobs!=null)jobs.schedule(new android.app.job.JobInfo.Builder(671203,new android.content.ComponentName(context,NativeWidgetUpdateService.class)).setMinimumLatency(0).setOverrideDeadline(30_000).build());if(callback!=null||jobs==null)run(context,callback);}
    static synchronized void run(Context context,Runnable callback){if(callback!=null)callbacks.add(callback);again=true;if(running)return;running=true;Context app=context.getApplicationContext();EXECUTOR.execute(()->{try{boolean next;do{synchronized(NativeWidgetProjector.class){again=false;}try{project(app);}catch(Exception ignored){}synchronized(NativeWidgetProjector.class){next=again;}}while(next);}finally{List<Runnable> done;synchronized(NativeWidgetProjector.class){running=false;done=new ArrayList<>(callbacks);callbacks.clear();}NativeWidgetProvider.refreshAll(app);Handler main=new Handler(Looper.getMainLooper());for(Runnable callbackDone:done)main.post(callbackDone);}});}
    static Map<String,String> revisions(Context context,String key)throws Exception{NativeCacheFile cache=new NativeCacheFile(context.getFilesDir());Map<String,String> out=new LinkedHashMap<>();for(String k:List.of(key,NativeLoginFlow.digest("metadata\0"+key),NativeLoginFlow.digest("launch\0"+key),NativeLoginFlow.digest("source-edits\0"+key)))for(int slot=0;slot<2;slot++){String path="cache/"+k+"."+slot+".json";out.put(path,cache.revision(path));}return out;}
    private static void project(Context context)throws Exception{
        if(!NativeHeadlessProjector.supported())return;
        var account=NativeSyncRuntime.savedAccount(context);if(account==null)return;var session=NativeSyncRuntime.session(context,account.name());String key=NativeWidgetStore.accountKey(context);NativeWidgetStore store=new NativeWidgetStore(context);JsonObject widgets=store.state(key);long deadline=SystemClock.elapsedRealtime()+45_000;
        NativeResourceCache.Guard guard=()->{session.check();if(SystemClock.elapsedRealtime()>deadline)throw NativeSyncPolicy.failure("TIMEOUT","Widget preparation reached its limit.");};
        NativeCacheFile cache=new NativeCacheFile(context.getFilesDir());Map<String,String> revisions=revisions(context,key);JsonObject files=new JsonObject();long total=0;
        for(var entry:revisions.entrySet()){guard.check();Long size=cache.size(entry.getKey());if(size==null)continue;total+=size;if(total>64L*1024*1024)throw NativeSyncPolicy.failure("LIMIT","Saved widget preparation exceeds its limit.");ByteArrayOutputStream out=new ByteArrayOutputStream(size.intValue());for(long offset=0;offset<size;offset+=NativeCacheFile.CHUNK)out.write(cache.read(entry.getKey(),offset,(int)Math.min(NativeCacheFile.CHUNK,size-offset),size,entry.getValue(),guard::check));files.addProperty(entry.getKey(),out.toString(StandardCharsets.UTF_8));}
        JsonObject input=new JsonObject();input.add("account",new Gson().toJsonTree(account));input.add("files",files);input.addProperty("kind","widgets");input.add("widgetConfigs",widgets.getAsJsonArray("configs"));input.addProperty("configRevision",NativeWidgetPolicy.number(widgets,"revision",0));input.addProperty("now",System.currentTimeMillis());input.addProperty("timeZone",java.time.ZoneId.systemDefault().getId());input.addProperty("locale",Locale.getDefault().toLanguageTag());input.add("readDenials",NativeSyncRuntime.readDenials(context,account));input.addProperty("seed",UUID.randomUUID().toString());
        String script;try(InputStream stream=context.getAssets().open("headless/projector.js")){ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] chunk=new byte[65536];int count;while((count=stream.read(chunk))!=-1){if(out.size()+count>8*1024*1024)throw new IOException("Widget projector exceeds its limit.");out.write(chunk,0,count);}script=out.toString(StandardCharsets.UTF_8);}
        byte[] payload=input.toString().getBytes(StandardCharsets.UTF_8);if(payload.length>96*1024*1024)throw new IOException("Widget input exceeds its limit.");
        try(NativeJavascriptRuntime js=new NativeJavascriptRuntime(context,()->{guard.check();return deadline-SystemClock.elapsedRealtime();},16*1024*1024)){
            JsonObject result=JsonParser.parseString(js.evaluate(script,payload,()->{guard.check();return deadline-SystemClock.elapsedRealtime();})).getAsJsonObject();
            if(!NativeWidgetPolicy.flag(result,"complete",false)||!key.equals(NativeWidgetPolicy.text(result,"accountKey","")))return;
            NativeReadGeneration.publish(revisions,cache::revision,guard,()->store.publish(key,NativeWidgetPolicy.number(result,"configRevision",-1),NativeWidgetPolicy.object(result,"widgetCatalog"),NativeWidgetPolicy.array(result,"widgetSnapshots"),input.getAsJsonArray("readDenials").toString()));
        }
    }
}
