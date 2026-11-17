package com.nextspace.app;

import org.junit.Test;
import static org.junit.Assert.*;
import java.util.*;
import java.util.concurrent.*;

public class NativeRequestQueueTest {
    @Test public void userRequestsPassQueuedReadsWithoutExtraWorkers() throws Exception {
        NativeRequestQueue queue = new NativeRequestQueue(1, 4);
        CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
        List<String> order = Collections.synchronizedList(new ArrayList<>());
        try {
            Future<?> first = queue.submitRead(() -> {entered.countDown(); try {release.await();} catch (InterruptedException error) {Thread.currentThread().interrupt();}}, true);
            assertTrue(entered.await(2, TimeUnit.SECONDS));
            Future<?> read1 = queue.submitRead(() -> order.add("read1"), true);
            Future<?> read2 = queue.submitRead(() -> order.add("read2"), true);
            Future<?> edit1 = queue.submit(() -> order.add("edit1"));
            Future<?> edit2 = queue.submit(() -> order.add("edit2"));
            assertThrows(RejectedExecutionException.class, () -> queue.submit(() -> {}));
            release.countDown();
            for (Future<?> done : List.of(first, read1, read2, edit1, edit2)) done.get(2, TimeUnit.SECONDS);
            assertEquals(List.of("edit1", "edit2", "read1", "read2"), order);
            assertEquals(1, queue.getLargestPoolSize());
        } finally {release.countDown(); queue.shutdownNow();}
    }
}
