package com.nextspace.app;

import static org.junit.Assert.*;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.Test;

public class NativeRequestCancellationTest {
    @Test public void cancellingOneCallNeverClosesSiblingResources() throws Exception {
        NativeRequestCancellation first = new NativeRequestCancellation(), second = new NativeRequestCancellation();
        AtomicInteger closed = new AtomicInteger(), siblingClosed = new AtomicInteger();
        first.attach(closed::incrementAndGet); second.attach(siblingClosed::incrementAndGet);
        first.cancel(); first.cancel();
        assertEquals(1, closed.get()); assertEquals(0, siblingClosed.get()); second.check();
        assertEquals("CANCELLED", assertThrows(NativeLoginFlow.Failure.class, first::check).code);
        second.cancel(); assertEquals(1, siblingClosed.get());
    }
    @Test public void lateResponsePipeIsClosedAndCannotPublish() {
        NativeRequestCancellation request = new NativeRequestCancellation(); AtomicInteger closed = new AtomicInteger();
        request.cancel(); request.attach(closed::incrementAndGet);
        assertEquals(1, closed.get()); assertEquals("CANCELLED", assertThrows(NativeLoginFlow.Failure.class, request::check).code);
    }
    @Test public void completedResourceIsNotClosedAgain() {
        NativeRequestCancellation request = new NativeRequestCancellation(); AtomicInteger closed = new AtomicInteger();
        request.attach(closed::incrementAndGet); request.release(); request.cancel(); assertEquals(0, closed.get());
    }
    @Test public void queuedDeadlineCannotCancelTheActiveProviderCall() throws Exception {
        ThreadPoolExecutor lane = NativeDeadline.executor("owned-cancellation", 1, 1);
        CountDownLatch started = new CountDownLatch(1), release = new CountDownLatch(1);
        NativeRequestCancellation active = new NativeRequestCancellation(), queued = new NativeRequestCancellation();
        AtomicInteger activeClosed = new AtomicInteger(); active.attach(activeClosed::incrementAndGet);
        try {
            lane.submit(() -> { started.countDown(); try { release.await(); } catch (InterruptedException ignored) {} });
            assertTrue(started.await(1, TimeUnit.SECONDS));
            assertEquals("TIMEOUT", assertThrows(NativeLoginFlow.Failure.class, () -> NativeDeadline.run(lane, () -> true, queued::cancel, 25)).code);
            active.check(); assertEquals(0, activeClosed.get()); assertEquals(0, lane.getQueue().size());
        } finally { release.countDown(); lane.shutdownNow(); }
    }
}
