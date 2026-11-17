package com.nextspace.app;

import org.junit.Test;
import static org.junit.Assert.*;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

public class NativeReadGenerationTest {
    @Test public void permissionScopeComesFromTheActualDeniedEndpoint()throws Exception{
        String base="https://cloud.example/nextcloud";
        assertEquals(base+"/remote.php/dav/calendars/user/work/",NativeSyncPolicy.deniedCollection(base,"dav",base+"/remote.php/dav/calendars/user/work/event.ics"));
        assertEquals(base+"/index.php/apps/deck/api/v1.0/boards/12",NativeSyncPolicy.deniedCollection(base,"deck",base+"/index.php/apps/deck/api/v1.0/boards/12/stacks"));
        assertNull(NativeSyncPolicy.deniedCollection(base,"deck",base+"/index.php/apps/deck/api/v1.0/boards?details=true"));
        assertThrows(Exception.class,()->NativeSyncPolicy.deniedCollection(base,"dav","https://other.example/calendars/user/work/"));
    }
    @Test public void changedAcknowledgementOrAccountCannotPublishOldReadGeneration() throws Exception {
        AtomicBoolean committed=new AtomicBoolean();Map<String,String> expected=Map.of("archive","1","acknowledged-edit","2");
        assertThrows(NativeLoginFlow.Failure.class,()->NativeReadGeneration.publish(expected,path->path.equals("acknowledged-edit")?"3":"1",()->{},()->committed.set(true)));
        assertFalse(committed.get());
        assertThrows(NativeLoginFlow.Failure.class,()->NativeReadGeneration.publish(expected,expected::get,()->{throw NativeSyncPolicy.failure("CANCELLED","Account changed");},()->committed.set(true)));
        assertFalse(committed.get());
        NativeReadGeneration.publish(expected,expected::get,()->{},()->committed.set(true));assertTrue(committed.get());
    }
}
