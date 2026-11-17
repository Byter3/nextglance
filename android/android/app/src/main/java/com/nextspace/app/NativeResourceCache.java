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
    private static final class SizeIndex {final Map<String,Long> files=new HashMap<>();long bytes;}
    private static final Map<String, SizeIndex> SIZES = new HashMap<>();
    private final File root, directory;
    private final String base;
    private final Guard guard;
    private final AtomicReplace replace;
    private final Gson gson = new Gson();
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
                try (InputStreamReader reader = new InputStreamReader(new FileInputStream(file), StandardCharsets.UTF_8)) { entry = NativeSyncPolicy.parseEntry(com.google.gson.JsonParser.parseReader(reader).getAsJsonObject()); }
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
                String etag=VALIDATORS.getOrDefault(directory.getAbsolutePath(),Map.of()).get(file(entry).getAbsolutePath());
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
    void remove(NativeSyncPolicy.Locator key) throws Exception { locked(() -> { guard.check(); delete(file(key)); return null; }); }
    void prune(String kind, String collection, Set<String> hrefs) throws Exception {
        locked(() -> { for (NativeSyncPolicy.Locator entry : entries()) { guard.check(); if (kind.equals(entry.kind()) && collection.equals(entry.collection()) && !hrefs.contains(entry.href())) delete(file(entry)); } return null; });
    }
    void retain(String kind, Set<String> collections) throws Exception {
        locked(() -> { for (NativeSyncPolicy.Locator entry : entries()) { guard.check(); if (kind.equals(entry.kind()) && !collections.contains(entry.collection())) delete(file(entry)); } return null; });
    }
    void clear() throws Exception { locked(() -> { guard.check(); File[] files = directory.listFiles(); if (files != null) for (File file : files) { guard.check(); if (file.isFile()) delete(file); } INVENTORIES.remove(directory.getAbsolutePath()); VALIDATORS.remove(directory.getAbsolutePath()); return null; }); }
    private List<NativeSyncPolicy.Locator> entries() throws Exception {
        guard.check();
        Map<String, NativeSyncPolicy.Locator> indexed = INVENTORIES.get(directory.getAbsolutePath());
        if (indexed != null) return new ArrayList<>(indexed.values());
        // Files are exclusively owned by this cache. Scan prefixes once per process, then update
        // the index on atomic puts/deletes rather than reopening every resource for each calendar.
        Map<String, NativeSyncPolicy.Locator> result = new HashMap<>(); Map<String,String> validators=new HashMap<>(); File[] files = directory.listFiles();
        if (files == null) return List.of();
        for (File file : files) {
            guard.check(); if (!file.getName().matches("[a-f0-9]{64}\\.json")) continue;
            try {
                if (file.length() > NativeSyncPolicy.RESPONSE_BYTES * 6L + 65536) throw new IllegalArgumentException();
                String kind = null, collection = null, href = null, etag = null;
                try (com.google.gson.stream.JsonReader reader = new com.google.gson.stream.JsonReader(new InputStreamReader(new FileInputStream(file), StandardCharsets.UTF_8))) {
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
        if (file.exists() && !file.delete()) throw NativeSyncPolicy.failure("CACHE_WRITE", "A source cache entry could not be removed.");
        SizeIndex sizes = SIZES.get(root.getAbsolutePath()); if (sizes != null) {Long removed=sizes.files.remove(file.getAbsolutePath());if(removed!=null)sizes.bytes-=removed;}
        Map<String, NativeSyncPolicy.Locator> inventory = INVENTORIES.get(file.getParentFile().getAbsolutePath()); if (inventory != null) inventory.remove(file.getAbsolutePath());
        Map<String,String> validators=VALIDATORS.get(file.getParentFile().getAbsolutePath());if(validators!=null)validators.remove(file.getAbsolutePath());
    }
}
