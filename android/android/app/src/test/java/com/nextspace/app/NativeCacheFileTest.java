package com.nextspace.app;
import org.junit.Test;
import static org.junit.Assert.*;
import java.nio.file.Files;
import java.io.File;
public class NativeCacheFileTest {
    private final String path="cache/"+"a".repeat(64)+".0.json",owner="a".repeat(32);
    private final NativeCacheFile.Guard guard=()->{};
    private NativeCacheFile cache(File root){return new NativeCacheFile(root,(from,to)->Files.move(from.toPath(),to.toPath(),java.nio.file.StandardCopyOption.ATOMIC_MOVE,java.nio.file.StandardCopyOption.REPLACE_EXISTING));}
    @Test public void commitRevisionAndSequentialBounds()throws Exception{
        File root=Files.createTempDirectory("cache-fixture").toFile();NativeCacheFile cache=cache(root);cache.owner(owner,1);
        String token=cache.begin(path,3,0,owner,guard);cache.append(path,token,0,owner,0,new byte[]{1,2,3},guard);cache.commit(path,token,0,owner,guard);
        String revision=cache.revision(path);assertArrayEquals(new byte[]{1,2,3},cache.read(path,0,3,3,revision,guard));
        token=cache.begin(path,3,0,owner,guard);cache.append(path,token,0,owner,0,new byte[]{4,5,6},guard);cache.commit(path,token,0,owner,guard);
        try{cache.read(path,0,3,3,revision,guard);fail();}catch(NativeLoginFlow.Failure expected){assertEquals("CACHE_FORMAT",expected.code);}
    }
    @Test public void removalAndWorkerReplacementRejectOldStage()throws Exception{
        NativeCacheFile cache=cache(Files.createTempDirectory("cache-fixture").toFile());cache.owner(owner,1);
        String token=cache.begin(path,1,0,owner,guard);cache.append(path,token,0,owner,0,new byte[]{1},guard);cache.remove(path,guard);
        try{cache.commit(path,token,0,owner,guard);fail();}catch(NativeLoginFlow.Failure expected){assertEquals("CANCELLED",expected.code);}
        cache.owner("b".repeat(32),2);try{cache.owner(owner,1);fail();}catch(NativeLoginFlow.Failure expected){assertEquals("CANCELLED",expected.code);}
    }
    @Test public void backgroundAndForegroundInstancesShareRevisionEvenAtEqualLengthAndTimestamp()throws Exception{
        File root=Files.createTempDirectory("cache-fixture").toFile();NativeCacheFile first=cache(root),background=cache(root);
        String token=first.begin(path,1,0,owner,guard);first.append(path,token,0,owner,0,new byte[]{1},guard);first.commit(path,token,0,owner,guard);
        File file=new File(root,path);long timestamp=file.lastModified();String before=first.revision(path);
        token=background.begin(path,1,0,owner,guard);background.append(path,token,0,owner,0,new byte[]{2},guard);background.commit(path,token,0,owner,guard);assertTrue(file.setLastModified(timestamp));
        assertNotEquals(before,first.revision(path));assertEquals(background.revision(path),first.revision(path));
    }
    @Test public void orphanCleanupNeverRemovesSlots()throws Exception{
        File root=Files.createTempDirectory("cache-fixture").toFile(),dir=new File(root,"cache");dir.mkdirs();File orphan=new File(dir,"stage-11111111-1111-4111-8111-111111111111"),slot=new File(root,path);Files.write(orphan.toPath(),new byte[]{1});orphan.setLastModified(System.currentTimeMillis()-200000);Files.write(slot.toPath(),new byte[]{2});
        NativeCacheFile cache=cache(root);assertEquals(Long.valueOf(1),cache.size(path));assertFalse(orphan.exists());assertTrue(slot.exists());
        try{cache.size("../private");fail();}catch(NativeLoginFlow.Failure expected){assertEquals("SECURITY",expected.code);}
    }
    @Test public void incompleteAndOutOfOrderWritesNeverReplaceCommittedFile()throws Exception{
        NativeCacheFile cache=cache(Files.createTempDirectory("cache-fixture").toFile());String token=cache.begin(path,3,0,owner,guard);
        try{cache.append(path,token,0,owner,1,new byte[]{1},guard);fail();}catch(NativeLoginFlow.Failure expected){assertEquals("CACHE_FORMAT",expected.code);}
        try{cache.commit(path,token,0,owner,guard);fail();}catch(NativeLoginFlow.Failure expected){assertEquals("CACHE_FORMAT",expected.code);}
        assertNull(cache.size(path));cache.abort(path,token,0,owner);
    }
}
