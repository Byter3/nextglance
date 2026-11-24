package com.nextspace.app;

import static org.junit.Assert.*;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Future;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/** Real native executor/cache regression with deliberately uninterruptible fake providers. */
public class NativeDeadlineTest {
    @Rule public TemporaryFolder temporary = new TemporaryFolder();
    private final String base = "https://cloud.example/nextcloud";
    private final String collection = base + "/remote.php/dav/calendars/user/personal/";
    private NativeSyncPolicy.Entry entry() {
        String body = "BEGIN:VCALENDAR\nEND:VCALENDAR";
        return new NativeSyncPolicy.Entry(1, "dav", collection, collection + "a.ics", "\"one\"", body, body.getBytes(StandardCharsets.UTF_8).length);
    }
    private NativeResourceCache cache(NativeResourceCache.Guard guard) throws Exception {
        return new NativeResourceCache(temporary.getRoot(), "fixture", base, guard);
    }
    private static void uninterruptibly(CountDownLatch latch) {
        boolean interrupted = false;
        while (true) try { latch.await(); break; } catch (InterruptedException ignored) { interrupted = true; }
        if (interrupted) Thread.currentThread().interrupt();
    }

    @Test public void hungForegroundAndBackgroundCannotStarveAuthorizationOrLocalWork() throws Exception {
        CountDownLatch started = new CountDownLatch(4), release = new CountDownLatch(1), returned = new CountDownLatch(4);
        ThreadPoolExecutor callers = NativeDeadline.executor("fixture-callers", 4, 4);
        ThreadPoolExecutor cacheLane = NativeDeadline.executor("fixture-cache", 2, 32);
        ThreadPoolExecutor controlLane = NativeDeadline.executor("fixture-control", 1, 4);
        List<Future<String>> waits = new ArrayList<>();
        try {
            for (NativeDeadline.Lane lane : List.of(NativeDeadline.Lane.FOREGROUND, NativeDeadline.Lane.FOREGROUND, NativeDeadline.Lane.BACKGROUND, NativeDeadline.Lane.BACKGROUND)) {
                waits.add(callers.submit(() -> {
                    try { return NativeDeadline.run(lane, () -> { started.countDown(); try { uninterruptibly(release); return "late"; } finally { returned.countDown(); } }, () -> {}, 350); }
                    catch (NativeLoginFlow.Failure failure) { return failure.code; }
                }));
            }
            assertTrue(started.await(2, TimeUnit.SECONDS));
            for (Future<String> wait : waits) assertEquals("TIMEOUT", wait.get(2, TimeUnit.SECONDS));
            assertEquals(4, returned.getCount()); // Provider threads still occupied despite interruption.
            assertEquals("authorized", NativeDeadline.run(NativeDeadline.Lane.AUTHORIZATION, () -> "authorized", () -> {}, 1000));
            Future<Boolean> cached = cacheLane.submit(() -> { NativeResourceCache cache = cache(() -> {}); cache.put(entry()); return entry().equals(cache.get(entry().locator())); });
            assertTrue(cached.get(1, TimeUnit.SECONDS));
            assertEquals("status", controlLane.submit(() -> "status").get(1, TimeUnit.SECONDS));
        } finally { release.countDown(); assertTrue(returned.await(2, TimeUnit.SECONDS)); callers.shutdownNow(); cacheLane.shutdownNow(); controlLane.shutdownNow(); }
    }

    @Test public void expiredQueuedWorkIsRemovedAndNeverStarts() throws Exception {
        ThreadPoolExecutor lane = NativeDeadline.executor("fixture-queue", 1, 1);
        CountDownLatch started = new CountDownLatch(1), release = new CountDownLatch(1);
        AtomicBoolean ran = new AtomicBoolean(), cancelled = new AtomicBoolean();
        try {
            lane.submit(() -> { started.countDown(); uninterruptibly(release); }); assertTrue(started.await(1, TimeUnit.SECONDS));
            NativeLoginFlow.Failure failure = assertThrows(NativeLoginFlow.Failure.class, () -> NativeDeadline.run(lane, () -> { ran.set(true); return true; }, () -> cancelled.set(true), 25));
            assertEquals("TIMEOUT", failure.code); assertTrue(cancelled.get()); assertEquals(0, lane.getQueue().size());
            release.countDown(); assertEquals("next", lane.submit(() -> "next").get(1, TimeUnit.SECONDS)); assertFalse(ran.get());
        } finally { release.countDown(); lane.shutdownNow(); }
    }

    @Test public void filesTimeoutPausesRequestsAndKeepsTheSlotUntilTheProviderReturns() throws Exception {
        ThreadPoolExecutor provider = NativeDeadline.executor("fixture-files", 1, 2);
        ThreadPoolExecutor callers = NativeDeadline.executor("fixture-files-caller", 1, 1);
        CountDownLatch started = new CountDownLatch(1), release = new CountDownLatch(1);
        AtomicLong clock = new AtomicLong();
        AtomicBoolean obsolete = new AtomicBoolean();
        NativeDeadline.FilesLane files = new NativeDeadline.FilesLane(provider, clock::get);
        try {
            Future<String> first = callers.submit(() -> assertThrows(NativeLoginFlow.Failure.class, () -> files.run(() -> {
                started.countDown(); uninterruptibly(release); return true;
            }, () -> {}, 450)).code);
            assertTrue(started.await(2, TimeUnit.SECONDS));
            assertEquals("TIMEOUT", first.get(2, TimeUnit.SECONDS));
            assertEquals("FILES_TRANSPORT", assertThrows(NativeLoginFlow.Failure.class, () -> files.run(() -> false, () -> {}, 100)).code);
            assertEquals("direct", NativeDeadline.run(NativeDeadline.Lane.FOREGROUND, () -> "direct", () -> {}, 1000));
            assertEquals("authorized", NativeDeadline.run(NativeDeadline.Lane.AUTHORIZATION, () -> "authorized", () -> {}, 1000));

            clock.addAndGet(TimeUnit.SECONDS.toNanos(31));
            assertEquals("TIMEOUT", assertThrows(NativeLoginFlow.Failure.class, () -> files.run(() -> {
                obsolete.set(true); return false;
            }, () -> {}, 50)).code);
            assertEquals(0, provider.getQueue().size());
            release.countDown();
            assertEquals("ready", files.run(() -> "ready", () -> {}, 1000));
            assertFalse(obsolete.get());
            assertEquals(1, provider.getLargestPoolSize());
        } finally { release.countDown(); callers.shutdownNow(); provider.shutdownNow(); }
    }

    @Test public void filesFailureCoolingIsSeparateFromHttpAndCancellation() throws Exception {
        ThreadPoolExecutor provider = NativeDeadline.executor("fixture-files-health", 1, 2);
        AtomicLong clock = new AtomicLong();
        NativeDeadline.FilesLane files = new NativeDeadline.FilesLane(provider, clock::get);
        try {
            assertEquals(Integer.valueOf(401), files.run(() -> 401, () -> {}, 1000));
            assertEquals("CANCELLED", assertThrows(NativeLoginFlow.Failure.class, () -> files.run(() -> {
                throw NativeSyncPolicy.failure("CANCELLED", "Cancelled fixture request.");
            }, () -> {}, 1000)).code);
            assertEquals(Integer.valueOf(503), files.run(() -> 503, () -> {}, 1000));
            assertEquals("FILES_TRANSPORT", assertThrows(NativeLoginFlow.Failure.class, () -> files.run(() -> {
                throw NativeDeadline.filesUnavailable();
            }, () -> {}, 1000)).code);
            assertEquals("FILES_TRANSPORT", assertThrows(NativeLoginFlow.Failure.class, () -> files.run(() -> 200, () -> {}, 1000)).code);
            clock.addAndGet(TimeUnit.SECONDS.toNanos(30));
            assertEquals(Integer.valueOf(200), files.run(() -> 200, () -> {}, 1000));
        } finally { provider.shutdownNow(); }
    }

    @Test public void saturatedQueueRejectsWithoutClaimingAuthorizationWasLost() throws Exception {
        ThreadPoolExecutor lane = NativeDeadline.executor("fixture-bounded", 1, 1);
        CountDownLatch started = new CountDownLatch(1), release = new CountDownLatch(1);
        try {
            lane.submit(() -> { started.countDown(); uninterruptibly(release); }); assertTrue(started.await(1, TimeUnit.SECONDS));
            lane.submit(() -> {});
            NativeLoginFlow.Failure failure = assertThrows(NativeLoginFlow.Failure.class, () -> NativeDeadline.run(lane, () -> true, () -> {}, 1000));
            assertEquals("NETWORK", failure.code); assertEquals(1, lane.getQueue().size()); assertEquals(1, lane.getLargestPoolSize());
        } finally { release.countDown(); lane.shutdownNow(); }
    }

    @Test public void interruptedCallerIsCancelledWithoutWaitingForProvider() throws Exception {
        ThreadPoolExecutor lane = NativeDeadline.executor("fixture-interrupt", 1, 1);
        CountDownLatch started = new CountDownLatch(1), release = new CountDownLatch(1), done = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>(); AtomicBoolean cancelled = new AtomicBoolean();
        Thread caller = new Thread(() -> {
            try { NativeDeadline.run(lane, () -> { started.countDown(); uninterruptibly(release); return true; }, () -> cancelled.set(true), 2000); }
            catch (NativeLoginFlow.Failure failure) { result.set(failure.code); }
            catch (Exception failure) { result.set(failure.getClass().getSimpleName()); }
            finally { done.countDown(); }
        });
        try { caller.start(); assertTrue(started.await(1, TimeUnit.SECONDS)); caller.interrupt(); assertTrue(done.await(1, TimeUnit.SECONDS)); assertEquals("CANCELLED", result.get()); assertTrue(cancelled.get()); }
        finally { release.countDown(); lane.shutdownNow(); caller.join(1000); }
    }

    @Test public void lateProviderCannotWriteCacheAfterItsGenerationWasCancelled() throws Exception {
        ThreadPoolExecutor lane = NativeDeadline.executor("fixture-late", 1, 1);
        CountDownLatch release = new CountDownLatch(1), returned = new CountDownLatch(1); AtomicBoolean current = new AtomicBoolean(true);
        NativeResourceCache protectedCache = cache(() -> { if (!current.get()) throw NativeSyncPolicy.failure("CANCELLED", "Old generation"); });
        try {
            assertEquals("TIMEOUT", assertThrows(NativeLoginFlow.Failure.class, () -> NativeDeadline.run(lane, () -> {
                uninterruptibly(release);
                try { protectedCache.put(entry()); return true; } finally { returned.countDown(); }
            }, () -> current.set(false), 25)).code);
            release.countDown(); assertTrue(returned.await(1, TimeUnit.SECONDS)); assertNull(cache(() -> {}).get(entry().locator()));
        } finally { release.countDown(); lane.shutdownNow(); }
    }

    @Test public void cacheLockWaitIsInterruptibleAndDoesNotHoldControlLane() throws Exception {
        CountDownLatch locked = new CountDownLatch(1), release = new CountDownLatch(1), waiterDone = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        NativeResourceCache holder = cache(() -> { locked.countDown(); uninterruptibly(release); });
        Thread first = new Thread(() -> { try { holder.get(entry().locator()); } catch (Exception ignored) {} });
        Thread waiter = new Thread(() -> { try { cache(() -> {}).get(entry().locator()); result.set("read"); } catch (NativeLoginFlow.Failure failure) { result.set(failure.code); } catch (Exception failure) { result.set("other"); } finally { waiterDone.countDown(); } });
        ThreadPoolExecutor controls = NativeDeadline.executor("fixture-control", 1, 4);
        try {
            first.start(); assertTrue(locked.await(1, TimeUnit.SECONDS)); waiter.start(); waiter.interrupt();
            assertTrue(waiterDone.await(1, TimeUnit.SECONDS)); assertEquals("CANCELLED", result.get());
            assertEquals("ready", controls.submit(() -> "ready").get(1, TimeUnit.SECONDS));
        } finally { release.countDown(); first.join(1000); waiter.join(1000); controls.shutdownNow(); }
    }

    @Test public void cacheDeadlineAfterReadDoesNotDeleteValidEntry() throws Exception {
        NativeResourceCache cache = cache(() -> {}); cache.put(entry());
        java.util.concurrent.atomic.AtomicInteger checks = new java.util.concurrent.atomic.AtomicInteger();
        NativeResourceCache expired = cache(() -> { if (checks.incrementAndGet() >= 3) throw NativeSyncPolicy.failure("TIMEOUT", "Expired local operation"); });
        assertEquals("TIMEOUT", assertThrows(NativeLoginFlow.Failure.class, () -> expired.get(entry().locator())).code);
        assertEquals(entry(), cache.get(entry().locator()));
    }

    @Test public void indexedPruningTracksOtherInstancesAndAccountIsolation() throws Exception {
        NativeResourceCache first = cache(() -> {}), second = cache(() -> {});
        first.put(entry()); first.retain("dav", java.util.Set.of(collection)); // Create the directory index.
        NativeSyncPolicy.Entry another = new NativeSyncPolicy.Entry(1, "dav", collection, collection + "b.ics", "\"two\"", "second", 6);
        second.put(another); first.prune("dav", collection, java.util.Set.of(another.href()));
        assertNull(second.get(entry().locator())); assertEquals(another, second.get(another.locator()));
        first.clear(); second.put(entry()); first.prune("dav", collection, java.util.Set.of()); assertNull(second.get(entry().locator()));
    }
    @Test public void foregroundEntryPausesBothBackgroundPassesAndCanResumeLater() {
        AtomicBoolean dav = new AtomicBoolean(), deck = new AtomicBoolean();
        Runnable cancelDav = () -> dav.set(true), cancelDeck = () -> deck.set(true);
        try {
            NativeSyncRuntime.foreground(false);
            NativeSyncRuntime.register(NativeSyncRuntime.DAV_JOB, cancelDav); NativeSyncRuntime.register(NativeSyncRuntime.DECK_JOB, cancelDeck);
            NativeSyncRuntime.foreground(true); assertTrue(NativeSyncRuntime.isForeground()); assertTrue(dav.get()); assertTrue(deck.get());
            NativeSyncRuntime.foreground(false); assertFalse(NativeSyncRuntime.isForeground());
        } finally { NativeSyncRuntime.unregister(NativeSyncRuntime.DAV_JOB, cancelDav); NativeSyncRuntime.unregister(NativeSyncRuntime.DECK_JOB, cancelDeck); NativeSyncRuntime.foreground(false); }
    }
}
