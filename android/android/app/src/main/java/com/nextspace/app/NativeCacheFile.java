package com.nextspace.app;

import java.io.File;
import java.io.RandomAccessFile;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/** App-private two-slot bytes only. Envelope interpretation remains in the worker. */
final class NativeCacheFile {
    static final int CHUNK=256*1024, MAX=50*1024*1024;
    interface Guard {void check() throws Exception;}
    private record Stage(String path,File file,long size,long epoch,String owner,long created){}
    interface AtomicReplace {void move(File from,File to)throws Exception;}
    private final File root;private final AtomicReplace atomic;
    private final Map<String,Stage> stages=new HashMap<>();
    private volatile String owner;private volatile long ownerEpoch=-1;private final Object ownerLock=new Object();
    void owner(String value,long epoch)throws Exception{synchronized(ownerLock){if(value==null||!value.matches("[a-f0-9-]{16,80}")||epoch<0||epoch<ownerEpoch||epoch==ownerEpoch&&!value.equals(owner))throw error("CANCELLED","The cache worker changed.");if(epoch>ownerEpoch){owner=value;ownerEpoch=epoch;}}}
    void checkOwner(String value,long epoch)throws Exception{if(epoch!=ownerEpoch||!java.util.Objects.equals(owner,value))throw error("CANCELLED","The cache worker changed.");}
    private static final Map<String,Map<String,Long>> PROCESS_REVISIONS=new java.util.concurrent.ConcurrentHashMap<>();
    private final Map<String,Long> revisions;
    synchronized String revision(String path)throws Exception{File f=target(path);return f.lastModified()+":"+f.length()+":"+revisions.getOrDefault(path,0L);}
    private long cleanedAt;
    NativeCacheFile(File dataRoot){this(dataRoot,(from,to)->android.system.Os.rename(from.getAbsolutePath(),to.getAbsolutePath()));}
    NativeCacheFile(File dataRoot,AtomicReplace atomic){root=new File(dataRoot,"cache");this.atomic=atomic;revisions=PROCESS_REVISIONS.computeIfAbsent(root.getAbsolutePath(),ignored->new java.util.concurrent.ConcurrentHashMap<>());}
    private static void removeFile(File file)throws java.io.IOException{if(file.exists()&&!file.delete())throw new java.io.IOException("Private cache file could not be removed.");}
    private void orphans(){long now=System.currentTimeMillis();if(now-cleanedAt<120000)return;cleanedAt=now;File[] files=root.listFiles(file->file.isFile()&&file.getName().matches("stage-[a-f0-9-]{36}")&&System.currentTimeMillis()-file.lastModified()>120000&&!stages.values().stream().anyMatch(stage->stage.file.equals(file)));if(files!=null)for(File file:files)file.delete();}

    private File target(String path)throws Exception{
        if(path==null||!path.matches("cache/[a-f0-9]{64}\\.[01]\\.json"))throw error("SECURITY","Invalid private cache path.");
        File file=new File(root,path.substring(6));
        if(!file.getCanonicalFile().getParentFile().equals(root.getCanonicalFile()))throw error("SECURITY","Invalid private cache path.");
        return file;
    }
    synchronized Long size(String path)throws Exception{orphans();File file=target(path);if(!file.exists())return null;long size=file.length();if(size>MAX)throw error("CACHE_TOO_LARGE","Saved cache exceeds its limit.");return size;}
    synchronized byte[] read(String path,long offset,int length,long expected,String revision,Guard guard)throws Exception{
        guard.check();Long size=size(path);if(size==null||size!=expected||!revision(path).equals(revision)||offset<0||length<0||length>CHUNK||offset+length>size)throw error("CACHE_FORMAT","Saved cache changed while being read.");
        byte[] bytes=new byte[length];try(RandomAccessFile input=new RandomAccessFile(target(path),"r")){input.seek(offset);input.readFully(bytes);}guard.check();return bytes;
    }
    synchronized String begin(String path,long size,long epoch,String owner,Guard guard)throws Exception{
        target(path);if(owner==null||!owner.matches("[a-f0-9-]{16,80}"))throw error("SECURITY","Invalid cache owner.");guard.check();if(size<0||size>MAX)throw error("CACHE_TOO_LARGE","Saved cache exceeds its limit.");
        orphans();cleanup();stages.entrySet().removeIf(entry->{Stage stage=entry.getValue();if(!stage.owner.equals(owner)||stage.epoch!=epoch){stage.file.delete();return true;}return false;});if(stages.size()>=8)throw error("LIMIT","Too many private cache writes.");
        stages.entrySet().removeIf(entry->{Stage stage=entry.getValue();if(stage.path.equals(path)&&(!stage.owner.equals(owner)||stage.epoch!=epoch)){stage.file.delete();return true;}return false;});
        for(Stage stage:stages.values())if(stage.path.equals(path))throw error("CACHE_WRITE","A cache write is already pending.");
        if(!root.isDirectory()&&!root.mkdirs())throw error("CACHE_WRITE","Private cache directory is unavailable.");
        String token=UUID.randomUUID().toString();File file=new File(root,"stage-"+token);if(!file.createNewFile())throw error("CACHE_WRITE","Private cache stage is unavailable.");
        stages.put(token,new Stage(path,file,size,epoch,owner,System.currentTimeMillis()));return token;
    }
    private Stage stage(String path,String token,long epoch,String owner)throws Exception{
        target(path);Stage stage=stages.get(token);
        if(stage==null||!stage.path.equals(path)||stage.epoch!=epoch||!stage.owner.equals(owner)||System.currentTimeMillis()-stage.created>120000)throw error("CANCELLED","Private cache write expired or changed account.");return stage;
    }
    synchronized void append(String path,String token,long epoch,String owner,long offset,byte[] bytes,Guard guard)throws Exception{
        guard.check();Stage stage=stage(path,token,epoch,owner);if(bytes.length>CHUNK||offset!=stage.file.length()||offset+bytes.length>stage.size)throw error("CACHE_FORMAT","Invalid sequential cache chunk.");
        try(RandomAccessFile output=new RandomAccessFile(stage.file,"rw")){output.seek(offset);output.write(bytes);}guard.check();
    }
    synchronized void commit(String path,String token,long epoch,String owner,Guard guard)throws Exception{
        guard.check();Stage stage=stage(path,token,epoch,owner);if(stage.file.length()!=stage.size)throw error("CACHE_FORMAT","Private cache write is incomplete.");
        try(RandomAccessFile output=new RandomAccessFile(stage.file,"rw")){output.getFD().sync();}guard.check();
        atomic.move(stage.file,target(path));stages.remove(token);revisions.merge(path,1L,Long::sum);
    }
    synchronized void abort(String path,String token,long epoch,String owner)throws Exception{Stage stage=stage(path,token,epoch,owner);removeFile(stage.file);stages.remove(token);}
    synchronized void remove(String path,Guard guard)throws Exception{guard.check();stages.entrySet().removeIf(entry->{if(entry.getValue().path.equals(path)){entry.getValue().file.delete();return true;}return false;});removeFile(target(path));revisions.merge(path,1L,Long::sum);}
    synchronized void clearStages(){for(Stage stage:stages.values())stage.file.delete();stages.clear();}
    private void cleanup(){long now=System.currentTimeMillis();stages.entrySet().removeIf(entry->{if(now-entry.getValue().created>120000){entry.getValue().file.delete();return true;}return false;});}
    private static NativeLoginFlow.Failure error(String code,String message){return new NativeLoginFlow.Failure(code,message);}
}
