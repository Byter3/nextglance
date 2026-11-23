package com.nextspace.app;

import org.junit.Test;
import java.util.Map;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.Assert.*;

public class NativePublicationCoordinatorTest {
    @Test public void foregroundSignalDoesNotWaitForBlockedBackgroundDiskWork() throws Exception {
        NativePublicationCoordinator coordinator=new NativePublicationCoordinator();
        ExecutorService workers=Executors.newFixedThreadPool(2);
        CountDownLatch writing=new CountDownLatch(1),release=new CountDownLatch(1);
        try {
            Future<?> background=workers.submit(()->{coordinator.background(()->{},()->{writing.countDown();release.await();});return null;});
            assertTrue(writing.await(2,TimeUnit.SECONDS));
            Future<?> signal=workers.submit(()->coordinator.foreground(true));
            signal.get(1,TimeUnit.SECONDS); // Deliberately before the simulated fsync is released.
            assertTrue(coordinator.isForeground());assertFalse(background.isDone());
            release.countDown();background.get(2,TimeUnit.SECONDS);
        } finally {release.countDown();workers.shutdownNow();}
    }
    @Test public void foregroundCacheOperationsWaitOffThreadAndCancellationPreventsPublication() throws Exception {
        NativePublicationCoordinator coordinator=new NativePublicationCoordinator();
        ExecutorService workers=Executors.newFixedThreadPool(2);
        CountDownLatch staged=new CountDownLatch(1),release=new CountDownLatch(1),requested=new CountDownLatch(1);
        AtomicBoolean published=new AtomicBoolean(),foregroundRead=new AtomicBoolean();
        NativeResourceCache.Guard guard=()->{if(coordinator.isForeground())throw NativeSyncPolicy.failure("CANCELLED","fixture");};
        try {
            Future<?> background=workers.submit(()->{coordinator.background(guard,()->{staged.countDown();release.await();guard.check();published.set(true);});return null;});
            assertTrue(staged.await(2,TimeUnit.SECONDS));coordinator.foreground(true);
            Future<?> foreground=workers.submit(()->{requested.countDown();return coordinator.files(()->{foregroundRead.set(true);return null;});});
            assertTrue(requested.await(2,TimeUnit.SECONDS));assertFalse(foregroundRead.get());
            release.countDown();
            ExecutionException cancelled=assertThrows(ExecutionException.class,()->background.get(2,TimeUnit.SECONDS));
            assertEquals("CANCELLED",((NativeLoginFlow.Failure)cancelled.getCause()).code);
            foreground.get(2,TimeUnit.SECONDS);assertTrue(foregroundRead.get());assertFalse(published.get());
        } finally {release.countDown();workers.shutdownNow();}
    }
    @Test public void queuedBackgroundFamiliesRecheckAllRevisionsBeforePublishing() throws Exception {
        NativePublicationCoordinator coordinator=new NativePublicationCoordinator();
        ExecutorService workers=Executors.newFixedThreadPool(2);
        CountDownLatch firstEntered=new CountDownLatch(1),release=new CountDownLatch(1);
        AtomicInteger revision=new AtomicInteger(),writes=new AtomicInteger();
        try {
            Future<?> first=workers.submit(()->{coordinator.background(()->{},()->{firstEntered.countDown();release.await();revision.incrementAndGet();});return null;});
            assertTrue(firstEntered.await(2,TimeUnit.SECONDS));
            Future<?> second=workers.submit(()->{coordinator.background(()->{},()->NativeReadGeneration.publish(Map.of("acknowledged-slot","0"),path->String.valueOf(revision.get()),()->{},writes::incrementAndGet));return null;});
            release.countDown();first.get(2,TimeUnit.SECONDS);
            ExecutionException stale=assertThrows(ExecutionException.class,()->second.get(2,TimeUnit.SECONDS));
            assertEquals("CANCELLED",((NativeLoginFlow.Failure)stale.getCause()).code);assertEquals(0,writes.get());
        } finally {release.countDown();workers.shutdownNow();}
    }
    @Test public void foregroundAndAccountDenialRejectLateBackgroundCommit() throws Exception {
        NativePublicationCoordinator coordinator=new NativePublicationCoordinator();AtomicBoolean wrote=new AtomicBoolean();
        coordinator.foreground(true);
        assertEquals("CANCELLED",assertThrows(NativeLoginFlow.Failure.class,()->coordinator.background(()->{},()->wrote.set(true))).code);
        coordinator.foreground(false);
        assertEquals("AUTH",assertThrows(NativeLoginFlow.Failure.class,()->coordinator.background(()->{throw NativeSyncPolicy.failure("AUTH","fixture");},()->wrote.set(true))).code);
        assertFalse(wrote.get());
    }
}
