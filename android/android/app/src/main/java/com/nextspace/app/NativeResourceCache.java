package com.nextspace.app;

import com.google.gson.Gson;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileInputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Device-private, per-resource atomic files. No source projection or cloud metadata is stored here. */
final class NativeResourceCache {
    interface Guard { void check() throws Exception; }
    interface AtomicReplace { boolean replace(File from, File to) throws Exception; }
    private static final java.util.concurrent.locks.ReentrantLock LOCK = new java.util.concurrent.locks.ReentrantLock();
    private static final Map<String, Map<String, NativeSyncPolicy.Locator>> INVENTORIES = new HashMap<>();
    private static final Map<String, Map<String, String>> VALIDATORS = new HashMap<>();
    record Metadata(String href, String etag) {}
    record ResourceProof(String href, String etag, String revision) {}
    record InventoryProof(int version, String collection, String properties, String tokenKind, String token, List<ResourceProof> resources, boolean complete, long mutation) {}
    private static final Map<String,Long> MUTATIONS=new HashMap<>();
    private static final int INVENTORY_BYTES = 4 * 1024 * 1024;
    private static final class SizeIndex {final Map<String,Long> files=new HashMap<>();long bytes;}
    private static final Map<String, SizeIndex> SIZES = new HashMap<>();
    private final File root, directory;
    private final String base;
    private final Guard guard;
    private final AtomicReplace replace;
    private final Gson gson = new Gson();
    private int rawMetadataReads, rawBodyReads;
    record IoCounts(int metadataReads,int bodyReads){}
    IoCounts ioCounts(){return new IoCounts(rawMetadataReads,rawBodyReads);}
    NativeResourceCache(File root, String accountKey, String base, Guard guard) throws Exception {
        this(root,accountKey,base,guard,File::renameTo);
    }
    NativeResourceCache(File root, String accountKey, String base, Guard guard, AtomicReplace replace) throws Exception {
        this.root = root; this.base = base; this.guard = guard; this.replace = replace;
        directory = new File(root, NativeLoginFlow.digest(accountKey));
        if (!directory.isDirectory() && !directory.mkdirs()) throw NativeSyncPolicy.failure("CACHE_WRITE", "Source cache storage is unavailable.");
    }
    private File file(NativeSyncPolicy.Locator key) throws Exception {
        NativeSyncPolicy.locator(base, key);
        return new File(directory, NativeLoginFlow.digest(key.kind() + "\0" + key.collection() + "\0" + key.href()) + ".json");
    }
    NativeSyncPolicy.Entry get(NativeSyncPolicy.Locator key) throws Exception {
        return locked(() -> {
            guard.check(); File file = file(key);
            if (!file.isFile()) return null;
            NativeSyncPolicy.Entry entry;
            try {
                if (file.length() > NativeSyncPolicy.RESPONSE_BYTES * 6L + 65536) throw new IllegalArgumentException();
                rawBodyReads++;try (InputStreamReader reader = new InputStreamReader(new FileInputStream(file), StandardCharsets.UTF_8)) { entry = NativeSyncPolicy.parseEntry(com.google.gson.JsonParser.parseReader(reader).getAsJsonObject()); }
                NativeSyncPolicy.entry(base, entry);
                if (!entry.locator().equals(key)) throw new IllegalArgumentException();
            } catch (NativeLoginFlow.Failure error) {
                if ("CANCELLED".equals(error.code)) throw error;
                delete(file); return null;
            } catch (Exception corrupt) { delete(file); return null; }
            guard.check(); return entry;
        });
    }
    List<NativeSyncPolicy.Entry> getMany(List<NativeSyncPolicy.Locator> keys) throws Exception {
        if(keys==null||keys.size()>32)throw NativeSyncPolicy.failure("VALIDATION","A cache lookup may contain at most 32 resources.");
        for(var key:keys)NativeSyncPolicy.locator(base,key);
        return locked(()->{
            List<NativeSyncPolicy.Entry> result=new ArrayList<>();long bytes=0;
            for(var key:keys){guard.check();var entry=get(key);
                if(entry!=null&&bytes+entry.bytes()>4*1024*1024)break;
                result.add(entry);if(entry!=null)bytes+=entry.bytes();
            }
            return result;
        });
    }
    List<Metadata> list(String kind, String collection) throws Exception {
        if(!"dav".equals(kind))throw NativeSyncPolicy.failure("VALIDATION","Only calendar metadata may be listed.");
        NativeSyncPolicy.locator(base,new NativeSyncPolicy.Locator(kind,collection,collection+"validation.ics"));
        return locked(()->{
            List<Metadata> result=new ArrayList<>();
            for(var entry:entries()){
                guard.check();if(!kind.equals(entry.kind())||!collection.equals(entry.collection()))continue;
                File source=file(entry);if(!source.isFile()){delete(source);continue;}
                String etag=VALIDATORS.getOrDefault(directory.getAbsolutePath(),Map.of()).get(source.getAbsolutePath());
                if(NativeSyncPolicy.strongEtag(etag)){if(result.size()>=10000)throw NativeSyncPolicy.failure("LIMIT","The calendar cache inventory exceeds its limit.");result.add(new Metadata(entry.href(),etag));}
            }
            return result;
        });
    }
    List<NativeSyncPolicy.Entry> snapshot(String kind, Set<String> freshUrls) throws Exception {
        return locked(() -> {
            List<NativeSyncPolicy.Entry> result = new ArrayList<>(); long bytes = 0;
            for (var locator : entries()) {
                guard.check(); if (!kind.equals(locator.kind()) || freshUrls.contains(locator.href())) continue;
                var entry = get(locator); if (entry == null) continue;
                bytes += entry.bytes();
                if (bytes > 64 * 1024 * 1024 || result.size() >= 10000) throw NativeSyncPolicy.failure("LIMIT", "Background projection reached its bounded resource limit.");
                result.add(entry);
            }
            return result;
        });
    }
    void put(NativeSyncPolicy.Entry entry) throws Exception {
        locked(() -> {
            guard.check(); NativeSyncPolicy.entry(base, entry); File target = file(entry.locator());
            if ("dav".equals(entry.kind())) invalidateInventory(entry.collection());
            // Metadata comes before body, allowing prune/eviction to inspect only a tiny file prefix.
            com.google.gson.JsonObject object = new com.google.gson.JsonObject(); object.addProperty("version", 1); object.addProperty("kind", entry.kind()); object.addProperty("collection", entry.collection());
            object.addProperty("href", entry.href()); object.addProperty("etag", entry.etag()); object.addProperty("bytes", entry.bytes()); object.addProperty("body", entry.body());
            byte[] content = gson.toJson(object).getBytes(StandardCharsets.UTF_8);
            SizeIndex index=sizes();Map<String, Long> sizes=index.files;
            long total = index.bytes - sizes.getOrDefault(target.getAbsolutePath(), 0L) + content.length;
            if (content.length > NativeSyncPolicy.CACHE_BYTES) throw NativeSyncPolicy.failure("LIMIT", "The source cache resource is too large.");
            if (total > NativeSyncPolicy.CACHE_BYTES) {
                List<File> candidates = sizes.keySet().stream().filter(path -> !path.equals(target.getAbsolutePath())).map(File::new).sorted(Comparator.comparingLong(File::lastModified)).toList();
                for (File candidate : candidates) { long size = sizes.getOrDefault(candidate.getAbsolutePath(), 0L); delete(candidate); total -= size; if (total <= NativeSyncPolicy.CACHE_BYTES) break; }
            }
            File temporary = new File(directory, target.getName() + ".tmp");
            try {
                try (FileOutputStream output = new FileOutputStream(temporary)) { output.write(content); output.getFD().sync(); }
                guard.check();
                // rename(2) atomically replaces the old entry in the same private directory.
                if (!replace.replace(temporary,target)) throw NativeSyncPolicy.failure("CACHE_WRITE", "The source cache could not be saved.");
                index.bytes+=content.length-sizes.getOrDefault(target.getAbsolutePath(),0L);sizes.put(target.getAbsolutePath(), (long) content.length);
                Map<String, NativeSyncPolicy.Locator> inventory = INVENTORIES.get(directory.getAbsolutePath());
                if (inventory != null) inventory.put(target.getAbsolutePath(), entry.locator());
                Map<String,String> validators=VALIDATORS.get(directory.getAbsolutePath());if(validators!=null)validators.put(target.getAbsolutePath(),entry.etag());
            } finally { if (temporary.exists()) temporary.delete(); }
            return null;
        });
    }
    void remove(NativeSyncPolicy.Locator key) throws Exception { locked(() -> { guard.check(); if("dav".equals(key.kind()))invalidateInventory(key.collection());delete(file(key)); return null; }); }
    void prune(String kind, String collection, Set<String> hrefs) throws Exception {
        locked(() -> { for (NativeSyncPolicy.Locator entry : entries()) { guard.check(); if (kind.equals(entry.kind()) && collection.equals(entry.collection()) && !hrefs.contains(entry.href())) delete(file(entry)); } return null; });
    }
    void retain(String kind, Set<String> collections) throws Exception {
        locked(() -> { for (NativeSyncPolicy.Locator entry : entries()) { guard.check(); if (kind.equals(entry.kind()) && !collections.contains(entry.collection())) delete(file(entry)); }
            if("dav".equals(kind)){File[] proofs=directory.listFiles(value->value.getName().endsWith(".inventory.json"));if(proofs!=null)for(File proof:proofs){guard.check();try{InventoryProof value=readInventory(proof);if(!collections.contains(value.collection()))delete(proof);}catch(Exception invalid){if(invalid instanceof NativeLoginFlow.Failure known&&"CANCELLED".equals(known.code))throw invalid;delete(proof);}}}
            return null; });
    }
    private File inventoryFile(String collection)throws Exception{
        NativeSyncPolicy.locator(base,new NativeSyncPolicy.Locator("dav",collection,collection+"validation.ics"));
        return new File(directory,NativeLoginFlow.digest(collection)+".inventory.json");
    }
    private String mutationKey(String collection){return directory.getAbsolutePath()+"\0"+collection;}
    void invalidateInventory(String collection)throws Exception{locked(()->{guard.check();MUTATIONS.merge(mutationKey(collection),1L,Long::sum);delete(inventoryFile(collection));return null;});}
    void invalidateInventories(String kind,String collection)throws Exception{
        if(!"dav".equals(kind))return;
        if(collection!=null){invalidateInventory(collection);return;}
        locked(()->{guard.check();String prefix=directory.getAbsolutePath()+"\0";for(String key:new ArrayList<>(MUTATIONS.keySet()))if(key.startsWith(prefix))MUTATIONS.merge(key,1L,Long::sum);
            File[] proofs=directory.listFiles(file->file.getName().endsWith(".inventory.json"));if(proofs!=null)for(File proof:proofs)delete(proof);return null;});
    }
    private String resourceRevision(File value){return value.isFile()?value.lastModified()+":"+value.length():"missing";}
    private InventoryProof readInventory(File source)throws Exception{
        if(!source.isFile()||source.length()>INVENTORY_BYTES)throw new IllegalArgumentException();
        InventoryProof value;try(InputStreamReader reader=new InputStreamReader(new FileInputStream(source),StandardCharsets.UTF_8)){value=gson.fromJson(reader,InventoryProof.class);}
        if(value==null||value.version()!=1||!value.complete()||value.properties()==null||!value.properties().matches("[a-f0-9]{64}")||!Set.of("sync-token","ctag").contains(value.tokenKind())||value.token()==null||value.token().isBlank()||value.token().length()>4096||value.resources()==null||value.resources().size()>10000||!source.equals(inventoryFile(value.collection())))throw new IllegalArgumentException();
        Set<String> seen=new java.util.HashSet<>();for(var resource:value.resources()){
            NativeSyncPolicy.locator(base,new NativeSyncPolicy.Locator("dav",value.collection(),resource.href()));
            if(!seen.add(resource.href())||!NativeSyncPolicy.strongEtag(resource.etag())||resource.revision()==null||!resource.revision().matches("[0-9]+:[0-9]+"))throw new IllegalArgumentException();
        }
        return value;
    }
    private boolean exactResources(InventoryProof value)throws Exception{
        // All legitimate writes/removals invalidate this collection's marker before
        // changing a resource. A certified inventory can therefore check exact file
        // revisions without opening every resource's JSON prefix in a cold process.
        for(var resource:value.resources()){
            guard.check();File source=file(new NativeSyncPolicy.Locator("dav",value.collection(),resource.href()));
            if(!resource.revision().equals(resourceRevision(source)))return false;
        }
        return true;
    }
    InventoryProof reuseInventory(String collection,String properties,String tokenKind,String token)throws Exception{
        return locked(()->{
            guard.check();File source=inventoryFile(collection);if(!source.exists())return null;
            try{InventoryProof value=readInventory(source);if(value.properties().equals(properties)&&value.tokenKind().equals(tokenKind)&&value.token().equals(token)&&exactResources(value))return value;}
            catch(Exception invalid){if(invalid instanceof NativeLoginFlow.Failure known&&"CANCELLED".equals(known.code))throw invalid;}
            delete(source);return null;
        });
    }
    InventoryProof prepareInventory(String collection,String properties,String tokenKind,String token,List<Metadata> inventory)throws Exception{
        return locked(()->{
            if(tokenKind==null||token==null||token.isBlank()||token.length()>4096||inventory.size()>10000)return null;
            List<ResourceProof> resources=new ArrayList<>();Set<String> seen=new java.util.HashSet<>();
            // This is only a pending proof. Shared headless publication must validate the
            // actual bodies before commit; do not parse every raw body twice here.
            for(var item:inventory){guard.check();var key=new NativeSyncPolicy.Locator("dav",collection,item.href());String revision=resourceRevision(file(key));
                if(!seen.add(item.href())||!NativeSyncPolicy.strongEtag(item.etag())||"missing".equals(revision))return null;
                resources.add(new ResourceProof(item.href(),item.etag(),revision));
            }
            MUTATIONS.putIfAbsent(mutationKey(collection),0L);
            InventoryProof proof=new InventoryProof(1,collection,properties,tokenKind,token,List.copyOf(resources),true,MUTATIONS.getOrDefault(mutationKey(collection),0L));
            return exactResources(proof)?proof:null;
        });
    }
    /** Called only after the shared headless projector has successfully published this pass. */
    void commitInventory(InventoryProof proof)throws Exception{
        locked(()->{
            guard.check();if(proof==null||proof.mutation()!=MUTATIONS.getOrDefault(mutationKey(proof.collection()),0L)||!exactResources(proof))return null;
            byte[] content=gson.toJson(proof).getBytes(StandardCharsets.UTF_8);if(content.length>INVENTORY_BYTES)return null;
            File target=inventoryFile(proof.collection());SizeIndex index=sizes();long old=index.files.getOrDefault(target.getAbsolutePath(),0L);
            if(index.bytes-old+content.length>NativeSyncPolicy.CACHE_BYTES)return null;
            File temporary=new File(directory,target.getName()+".tmp");
            try{try(FileOutputStream output=new FileOutputStream(temporary)){output.write(content);output.getFD().sync();}guard.check();if(!exactResources(proof))return null;
                if(!replace.replace(temporary,target))throw NativeSyncPolicy.failure("CACHE_WRITE","The calendar inventory checkpoint could not be saved.");
                index.bytes+=content.length-old;index.files.put(target.getAbsolutePath(),(long)content.length);
            }finally{if(temporary.exists())temporary.delete();}
            return null;
        });
    }
    void clear() throws Exception { locked(() -> { guard.check();invalidateInventories("dav",null); File[] files = directory.listFiles(); if (files != null) for (File file : files) { guard.check(); if (file.isFile()) delete(file); } INVENTORIES.remove(directory.getAbsolutePath()); VALIDATORS.remove(directory.getAbsolutePath()); return null; }); }
    private List<NativeSyncPolicy.Locator> entries() throws Exception {
        guard.check();
        Map<String, NativeSyncPolicy.Locator> indexed = INVENTORIES.get(directory.getAbsolutePath());
        if (indexed != null) return new ArrayList<>(indexed.values());
        // Files are exclusively owned by this cache. Scan prefixes once per process, then update
        // the index on atomic puts/deletes rather than reopening every resource for each calendar.
        Map<String, NativeSyncPolicy.Locator> result = new HashMap<>(); Map<String,String> validators=new HashMap<>(); File[] files = directory.listFiles();
        if (files == null) return List.of();
        for(File proofFile:files){
            guard.check();if(!proofFile.getName().matches("[a-f0-9]{64}\\.inventory\\.json"))continue;
            try{var proof=readInventory(proofFile);if(!exactResources(proof)){delete(proofFile);continue;}
                for(var resource:proof.resources()){var locator=new NativeSyncPolicy.Locator("dav",proof.collection(),resource.href());String path=file(locator).getAbsolutePath();result.put(path,locator);validators.put(path,resource.etag());}
            }catch(Exception invalid){if(invalid instanceof NativeLoginFlow.Failure known&&"CANCELLED".equals(known.code))throw invalid;delete(proofFile);}
        }
        for (File file : files) {
            guard.check(); if (!file.getName().matches("[a-f0-9]{64}\\.json")||result.containsKey(file.getAbsolutePath())) continue;
            try {
                if (file.length() > NativeSyncPolicy.RESPONSE_BYTES * 6L + 65536) throw new IllegalArgumentException();
                String kind = null, collection = null, href = null, etag = null;
                rawMetadataReads++;try (com.google.gson.stream.JsonReader reader = new com.google.gson.stream.JsonReader(new InputStreamReader(new FileInputStream(file), StandardCharsets.UTF_8))) {
                    reader.beginObject(); int fields = 0;
                    while (reader.hasNext() && ++fields <= 10) {
                        String name = reader.nextName(); if ("body".equals(name)) break;
                        switch (name) { case "kind": kind = reader.nextString(); break; case "collection": collection = reader.nextString(); break; case "href": href = reader.nextString(); break; case "etag": etag = reader.nextString(); break; default: reader.skipValue(); }
                    }
                }
                NativeSyncPolicy.Locator locator = new NativeSyncPolicy.Locator(kind, collection, href);
                NativeSyncPolicy.locator(base, locator); if (!file(locator).equals(file)) throw new IllegalArgumentException(); result.put(file.getAbsolutePath(), locator); if(NativeSyncPolicy.cacheEtag(kind,etag))validators.put(file.getAbsolutePath(),etag);
            } catch (Exception corrupt) { delete(file); }
        }
        guard.check(); INVENTORIES.put(directory.getAbsolutePath(), result); VALIDATORS.put(directory.getAbsolutePath(),validators);
        return new ArrayList<>(result.values());
    }
    private <T> T locked(java.util.concurrent.Callable<T> work) throws Exception {
        try { LOCK.lockInterruptibly(); }
        catch (InterruptedException stopped) { Thread.currentThread().interrupt(); throw NativeSyncPolicy.failure("CANCELLED", "Local source cache work was stopped. Saved entries are preserved."); }
        try { guard.check(); return work.call(); } finally { LOCK.unlock(); }
    }
    private SizeIndex sizes() {
        return SIZES.computeIfAbsent(root.getAbsolutePath(), ignored -> {
            SizeIndex found = new SizeIndex(); File[] accounts = root.listFiles();
            if (accounts != null) for (File account : accounts) { File[] files = account.listFiles(); if (files != null) for (File file : files) if (file.isFile() && file.getName().endsWith(".json")) {long size=file.length();found.files.put(file.getAbsolutePath(),size);found.bytes+=size;} }
            return found;
        });
    }
    private void delete(File file) throws Exception {
        guard.check();
        if(file.exists()&&file.getName().matches("[a-f0-9]{64}\\.json")){
            // Eviction may target another account's file. Invalidate its marker in
            // that same private directory before the resource disappears.
            NativeSyncPolicy.Locator locator=INVENTORIES.getOrDefault(file.getParentFile().getAbsolutePath(),Map.of()).get(file.getAbsolutePath());
            String kind=locator==null?null:locator.kind(),collection=locator==null?null:locator.collection();
            if(locator==null)try(com.google.gson.stream.JsonReader reader=new com.google.gson.stream.JsonReader(new InputStreamReader(new FileInputStream(file),StandardCharsets.UTF_8))){
                reader.beginObject();int fields=0;while(reader.hasNext()&&++fields<=10){String name=reader.nextName();if("body".equals(name))break;if("kind".equals(name))kind=reader.nextString();else if("collection".equals(name))collection=reader.nextString();else reader.skipValue();}
            }catch(Exception corrupt){kind=null;}
            if("dav".equals(kind)&&collection!=null){MUTATIONS.merge(file.getParentFile().getAbsolutePath()+"\0"+collection,1L,Long::sum);delete(new File(file.getParentFile(),NativeLoginFlow.digest(collection)+".inventory.json"));}
            else if(kind==null){File[] proofs=file.getParentFile().listFiles(value->value.getName().matches("[a-f0-9]{64}\\.inventory\\.json"));if(proofs!=null)for(File proof:proofs)delete(proof);}
        }
        if (file.exists() && !file.delete()) throw NativeSyncPolicy.failure("CACHE_WRITE", "A source cache entry could not be removed.");
        SizeIndex sizes = SIZES.get(root.getAbsolutePath()); if (sizes != null) {Long removed=sizes.files.remove(file.getAbsolutePath());if(removed!=null)sizes.bytes-=removed;}
        Map<String, NativeSyncPolicy.Locator> inventory = INVENTORIES.get(file.getParentFile().getAbsolutePath()); if (inventory != null) inventory.remove(file.getAbsolutePath());
        Map<String,String> validators=VALIDATORS.get(file.getParentFile().getAbsolutePath());if(validators!=null)validators.remove(file.getAbsolutePath());
    }
}
