package com.nextspace.app;

import android.content.Context;
import android.os.Build;
import android.os.SystemClock;
import com.google.gson.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.TimeUnit;

/** Headless shared core in an isolated JavaScript service; never creates an Activity or WebView. */
final class NativeHeadlessProjector implements AutoCloseable {
    static List<String> cacheKeys(String key)throws Exception {
        return List.of(key,NativeLoginFlow.digest("metadata\0"+key),NativeLoginFlow.digest("launch\0"+key),NativeLoginFlow.digest("source-edits\0"+key),NativeLoginFlow.digest("sync-settings\0"+key));
    }
    static boolean writablePath(String path,List<String> keys) {
        return keys.subList(0,3).stream().anyMatch(key->path.equals("cache/"+key+".0.json")||path.equals("cache/"+key+".1.json"));
    }
    private static final int MAX_INPUT = 96 * 1024 * 1024;
    private final NativeSyncRuntime.Session session;
    private final NativeResourceCache.Guard guard;
    private final long deadline;
    private final Map<String, JsonObject> replies = new LinkedHashMap<>();
    private int replyBytes;
    private final java.util.concurrent.atomic.AtomicReference<AutoCloseable> runtime=new java.util.concurrent.atomic.AtomicReference<>();
    private JsonObject denial;
    NativeHeadlessProjector(NativeSyncRuntime.Session session, NativeResourceCache.Guard guard, long deadline) {this.session=session;this.guard=guard;this.deadline=deadline;}
    static boolean supported() { return Build.VERSION.SDK_INT >= 26 && NativeJavascriptRuntime.supported(); }
    private long remaining() throws Exception {guard.check();long value=deadline-SystemClock.elapsedRealtime();if(value<=0)throw NativeSyncPolicy.failure("TIMEOUT","Background projection reached its time budget.");return value;}
    void capture(String url, String method, NativeSourceTransport.Reply reply) throws Exception {
        guard.check();
        if (reply.status()==304) return;
        String etag=reply.headers().getOrDefault("etag", "");
        // Strong/weak validated bodies are already durable resource entries.
        if ("GET".equals(method) && !url.contains("/boards?details=true") && NativeSyncPolicy.cacheEtag(url.contains("/apps/deck/")?"deck":"dav",etag)) return;
        String body=new String(reply.body(),StandardCharsets.UTF_8);
        replyBytes+=reply.body().length;
        if(replyBytes>64*1024*1024||replies.size()>=10000)throw NativeSyncPolicy.failure("LIMIT","Background source snapshot reached its bounded limit.");
        JsonObject value=new JsonObject();value.addProperty("url",url);value.addProperty("method",method);value.addProperty("status",reply.status());value.addProperty("body",body);value.add("headers",new Gson().toJsonTree(reply.headers()));
        replies.put(method+"\0"+url,value);
    }
    boolean project(String kind) throws Exception {
        if(!supported()){NativeSyncRuntime.projection(session,kind,"unavailable",null);return false;}
        remaining();
        NativeJavascriptRuntime active;
        try{active=new NativeJavascriptRuntime(session.context(),this::remaining,MAX_INPUT);}catch(NativeLoginFlow.Failure unavailable){if("UNAVAILABLE".equals(unavailable.code)){NativeSyncRuntime.projection(session,kind,"unavailable",null);return false;}throw unavailable;}
        runtime.set(active);
        try {
                String key=NativeLoginFlow.digest(session.account().serverUrl()+"\0"+session.account().username()+"\0"+session.account().name());
                List<String> keys=cacheKeys(key);
                NativeCacheFile cache=new NativeCacheFile(session.context().getFilesDir());
                Map<String,String> revisions=new LinkedHashMap<>();JsonObject files=new JsonObject();long loaded=0;
                for(String slotKey:keys)for(int slot=0;slot<2;slot++){
                    remaining();String path="cache/"+slotKey+"."+slot+".json";Long size=cache.size(path);String revision=cache.revision(path);revisions.put(path,revision);
                    if(size==null)continue;loaded+=size;if(loaded>64L*1024*1024)throw NativeSyncPolicy.failure("LIMIT","Saved data exceeds the background projection budget.");
                    java.io.ByteArrayOutputStream bytes=new java.io.ByteArrayOutputStream(size.intValue());
                    for(long offset=0;offset<size;offset+=NativeCacheFile.CHUNK){int length=(int)Math.min(NativeCacheFile.CHUNK,size-offset);bytes.write(cache.read(path,offset,length,size,revision,guard::check));}
                    files.addProperty(path,new String(bytes.toByteArray(),StandardCharsets.UTF_8));
                }
                var resources=denial==null?session.cacheBatch(guard).snapshot(kind,Set.of()):List.<NativeSyncPolicy.Entry>of();Set<String> cached=new HashSet<>();for(var resource:resources)cached.add(resource.href());
                JsonArray captured=new JsonArray();for(var reply:replies.values())if(!"GET".equals(reply.get("method").getAsString())||!cached.contains(reply.get("url").getAsString()))captured.add(reply);
                JsonObject snapshot=new JsonObject();snapshot.add("replies",captured);snapshot.add("resources",new Gson().toJsonTree(resources));
                JsonObject input=new JsonObject();input.add("account",new Gson().toJsonTree(session.account()));input.add("files",files);input.add("snapshot",snapshot);input.add("readDenials",NativeSyncRuntime.readDenials(session.context(),session.account()));input.addProperty("kind",kind);input.addProperty("now",System.currentTimeMillis());input.addProperty("seed",UUID.randomUUID().toString());if(denial!=null)input.add("denial",denial);
                JsonObject widgets=new NativeWidgetStore(session.context()).state(key);input.add("widgetConfigs",NativeWidgetPolicy.array(widgets,"configs"));input.addProperty("configRevision",NativeWidgetPolicy.number(widgets,"revision",0));input.addProperty("timeZone",java.time.ZoneId.systemDefault().getId());input.addProperty("locale",Locale.getDefault().toLanguageTag());
                byte[] payload=new Gson().toJson(input).getBytes(StandardCharsets.UTF_8);if(payload.length>MAX_INPUT)throw NativeSyncPolicy.failure("LIMIT","Background projection input exceeds its limit.");
                String script;try(var asset=session.context().getAssets().open("headless/projector.js")){java.io.ByteArrayOutputStream buffer=new java.io.ByteArrayOutputStream();byte[] chunk=new byte[65536];int length;while((length=asset.read(chunk))!=-1){if(buffer.size()+length>8*1024*1024)throw NativeSyncPolicy.failure("LIMIT","Background runtime asset exceeds its limit.");buffer.write(chunk,0,length);}script=new String(buffer.toByteArray(),StandardCharsets.UTF_8);}
                String output=active.evaluate(script,payload,this::remaining);
                remaining();JsonObject result=JsonParser.parseString(output).getAsJsonObject();
                if(!result.get("complete").getAsBoolean()){NativeSyncRuntime.projection(session,kind,"incomplete",null);return false;}
                if(!key.equals(result.get("accountKey").getAsString()))throw NativeSyncPolicy.failure("SECURITY","Background projection changed its account.");
                List<String[]> stages=new ArrayList<>();String owner=UUID.randomUUID().toString();long epoch=session.epoch();
                try{
                    for(JsonElement element:result.getAsJsonArray("writes")){
                        JsonObject write=element.getAsJsonObject();String path=write.get("path").getAsString();
                        if(!revisions.containsKey(path)||!writablePath(path,keys))throw NativeSyncPolicy.failure("SECURITY","Invalid background read-store destination.");
                        byte[] bytes=write.get("text").getAsString().getBytes(StandardCharsets.UTF_8);String token=cache.begin(path,bytes.length,epoch,owner,guard::check);stages.add(new String[]{path,token});
                        for(int offset=0;offset<bytes.length;offset+=NativeCacheFile.CHUNK)cache.append(path,token,epoch,owner,offset,Arrays.copyOfRange(bytes,offset,Math.min(bytes.length,offset+NativeCacheFile.CHUNK)),guard::check);
                    }
                    // Recheck EVERY input, including settings and acknowledged-edit slots, at publication.
                    NativeSyncRuntime.commitBackground(session,()->{
                        remaining();NativeReadGeneration.publish(revisions,cache::revision,guard,()->{
                            for(String[] stage:stages)cache.commit(stage[0],stage[1],epoch,owner,guard::check);
                            if(result.has("widgetCatalog"))try{new NativeWidgetStore(session.context()).publish(key,NativeWidgetPolicy.number(result,"configRevision",-1),NativeWidgetPolicy.object(result,"widgetCatalog"),NativeWidgetPolicy.array(result,"widgetSnapshots"),input.getAsJsonArray("readDenials").toString());}catch(Exception ignored){/* Changed widget configuration cannot invalidate a successful source read. */}
                        });
                    });
                    if(denial==null)NativeSyncRuntime.verifiedReads(session,"dav".equals(kind)?Set.of("tasks","calendar"):Set.of("deck"));
                    NativeSyncRuntime.projection(session,kind,denial==null?"ready":"incomplete",denial==null?System.currentTimeMillis():null);NativeWidgetProvider.refreshAll(session.context());if(!input.getAsJsonArray("readDenials").equals(NativeSyncRuntime.readDenials(session.context(),session.account())))NativeWidgetProjector.schedule(session.context());return true;
                }finally{cache.clearStages();}
        } finally {close();}
    }
    void deny(String kind,String code,String collection)throws Exception{
        NativeSyncRuntime.denyRead(session,kind,code,collection);
        session.cacheBatch(guard).invalidateInventories("AUTH".equals(code)?"dav":kind,"AUTH".equals(code)?null:collection);
        // Always invalidate the disposable launch view first, including old providers and interrupted projection.
        String key=NativeLoginFlow.digest(session.account().serverUrl()+"\0"+session.account().username()+"\0"+session.account().name());String launch=NativeLoginFlow.digest("launch\0"+key);
        NativeCacheFile cache=new NativeCacheFile(session.context().getFilesDir());
        NativeSyncRuntime.commitBackground(session,()->{for(int slot=0;slot<2;slot++)cache.remove("cache/"+launch+"."+slot+".json",guard::check);});
        denial=new JsonObject();denial.addProperty("code",code);if(collection==null)denial.add("collection",JsonNull.INSTANCE);else denial.addProperty("collection",collection);
        replies.clear();NativeSyncRuntime.projection(session,kind,"incomplete",null);project(kind);
    }
    void closeAsync(){NativeDeadline.cleanup(this::close);}
    @Override public void close(){AutoCloseable value=runtime.getAndSet(null);if(value!=null)try{value.close();}catch(Exception ignored){}}
}
