package com.nextspace.app;

import static org.junit.Assert.*;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class NativeCacheEpochTest {
    @Rule public TemporaryFolder temporary = new TemporaryFolder();
    private final String base = "https://cloud.example/nextcloud";
    private final String calendar = base + "/remote.php/dav/calendars/user/work/";
    private final String board = base + "/index.php/apps/deck/api/v1.0/boards/12";
    private NativeSyncPolicy.Entry entry(String kind, String collection, String href, String body) {
        return new NativeSyncPolicy.Entry(1, kind, collection, href, "\"v1\"", body, body.getBytes(StandardCharsets.UTF_8).length);
    }
    @Test public void deckMaintenanceCannotCancelAlreadyQueuedDavCacheLookup() throws Exception {
        NativeCacheEpoch epoch = new NativeCacheEpoch(); long davSession = epoch.capture(), deckSession = epoch.capture();
        NativeResourceCache dav = new NativeResourceCache(temporary.getRoot(), "account", base, () -> epoch.check(davSession));
        NativeResourceCache deck = new NativeResourceCache(temporary.getRoot(), "account", base, () -> epoch.check(deckSession));
        var task = entry("dav", calendar, calendar + "work.ics", "BEGIN:VCALENDAR\nEND:VCALENDAR");
        var card = entry("deck", board, board + "/stacks", "[]"); dav.put(task); deck.put(card);
        var executor = Executors.newSingleThreadExecutor(); var queued = new CountDownLatch(1); var release = new CountDownLatch(1);
        try {
            var reading = executor.submit(() -> { queued.countDown(); release.await(); return dav.getMany(List.of(task.locator())); });
            assertTrue(queued.await(2, TimeUnit.SECONDS));
            assertFalse(epoch.beforeMaintenance("prune")); deck.prune("deck", board, Set.of(card.href()));
            assertFalse(epoch.beforeMaintenance("retainCollections")); deck.retain("deck", Set.of(board));
            assertFalse(epoch.beforeMaintenance("remove")); deck.remove(card.locator());
            release.countDown(); assertEquals(List.of(task), reading.get(2, TimeUnit.SECONDS));
            assertNull(deck.get(card.locator())); epoch.check(deckSession);
        } finally { release.countDown(); executor.shutdownNow(); }
    }
    @Test public void davMaintenancePreservesSiblingDeckReadsAndStillPrunesMissingItems() throws Exception {
        NativeCacheEpoch epoch = new NativeCacheEpoch(); long captured = epoch.capture();
        NativeResourceCache cache = new NativeResourceCache(temporary.getRoot(), "account", base, () -> epoch.check(captured));
        var task = entry("dav", calendar, calendar + "removed.ics", "BEGIN:VCALENDAR\nEND:VCALENDAR");
        var card = entry("deck", board, board + "/stacks", "[]"); cache.put(task); cache.put(card);
        assertFalse(epoch.beforeMaintenance("prune")); cache.prune("dav", calendar, Set.of());
        assertFalse(epoch.beforeMaintenance("retainCollections")); cache.retain("dav", Set.of(calendar));
        assertNull(cache.get(task.locator())); assertEquals(card, cache.get(card.locator()));
    }
    @Test public void clearAndExplicitMutationOrAccountInvalidationRejectOldSessions() throws Exception {
        NativeCacheEpoch epoch = new NativeCacheEpoch(); long original = epoch.capture();
        assertTrue(epoch.beforeMaintenance("clear"));
        assertEquals("CANCELLED", assertThrows(NativeLoginFlow.Failure.class, () -> epoch.check(original)).code);
        long beforeMutation = epoch.capture(); epoch.invalidate();
        assertEquals("CANCELLED", assertThrows(NativeLoginFlow.Failure.class, () -> epoch.check(beforeMutation)).code);
        long beforeLogout = epoch.capture(); epoch.invalidate();
        assertEquals("CANCELLED", assertThrows(NativeLoginFlow.Failure.class, () -> epoch.check(beforeLogout)).code);
        epoch.check(epoch.capture());
    }
    @Test public void pluginMaintenanceEntryUsesRuntimePolicyWithoutCancellingSiblingJobs() throws Exception {
        // Exercise the exact runtime entry called by NextcloudSsoPlugin, in
        // addition to the real cache-operation races above. No Android service
        // or provider is needed for the session epoch and running-job boundary.
        var field = NativeSyncRuntime.class.getDeclaredField("EPOCH"); field.setAccessible(true);
        NativeCacheEpoch epoch = (NativeCacheEpoch) field.get(null);
        AtomicInteger cancellations = new AtomicInteger(); Runnable cancel = cancellations::incrementAndGet;
        NativeSyncRuntime.register(99, cancel);
        try {
            long captured = epoch.capture();
            for (String operation : List.of("get", "getMany", "put", "remove", "prune", "retainCollections")) {
                assertFalse(NativeSyncRuntime.beforeCacheMaintenance(operation)); epoch.check(captured);
            }
            assertEquals(0, cancellations.get());
            assertTrue(NativeSyncRuntime.beforeCacheMaintenance("clear"));
            assertEquals(1, cancellations.get());
            assertEquals("CANCELLED", assertThrows(NativeLoginFlow.Failure.class, () -> epoch.check(captured)).code);
            long beforeMutationOrLogout = epoch.capture(); NativeSyncRuntime.invalidate();
            assertEquals(2, cancellations.get());
            assertEquals("CANCELLED", assertThrows(NativeLoginFlow.Failure.class, () -> epoch.check(beforeMutationOrLogout)).code);
        } finally {NativeSyncRuntime.unregister(99, cancel);}
    }

    @Test public void batchUsesOneFullEntryCheckAndRetainsInnerEpochChecks() throws Exception {
        NativeCacheEpoch epoch=new NativeCacheEpoch();long captured=epoch.capture();AtomicInteger full=new AtomicInteger(),quick=new AtomicInteger();
        var guard=NativeSyncRuntime.batchGuard(()->{full.incrementAndGet();epoch.check(captured);},()->{quick.incrementAndGet();epoch.check(captured);});
        NativeResourceCache cache=new NativeResourceCache(temporary.getRoot(),"batch-account",base,guard);
        var keys=new java.util.ArrayList<NativeSyncPolicy.Locator>();
        for(int i=0;i<32;i++){var task=entry("dav",calendar,calendar+i+".ics","BEGIN:VCALENDAR\nEND:VCALENDAR");cache.put(task);keys.add(task.locator());}
        assertEquals(32,cache.getMany(keys).size());assertEquals(1,full.get());assertTrue(quick.get()>32);
        epoch.invalidate();assertEquals("CANCELLED",assertThrows(NativeLoginFlow.Failure.class,()->cache.getMany(keys)).code);
    }
    @Test public void metadataInventoryTracksWritesPruningAndCorruptEntriesWithoutReturningBodies() throws Exception {
        NativeResourceCache cache=new NativeResourceCache(temporary.getRoot(),"index-account",base,()->{},(from,to)->{java.nio.file.Files.move(from.toPath(),to.toPath(),java.nio.file.StandardCopyOption.ATOMIC_MOVE,java.nio.file.StandardCopyOption.REPLACE_EXISTING);return true;});
        var first=entry("dav",calendar,calendar+"one.ics","BEGIN:VCALENDAR\nEND:VCALENDAR");cache.put(first);
        assertEquals(List.of(new NativeResourceCache.Metadata(first.href(),first.etag())),cache.list("dav",calendar));
        var changed=new NativeSyncPolicy.Entry(1,"dav",calendar,first.href(),"\"v2\"",first.body(),first.bytes());cache.put(changed);
        assertEquals("\"v2\"",cache.list("dav",calendar).get(0).etag());
        cache.prune("dav",calendar,Set.of());assertTrue(cache.list("dav",calendar).isEmpty());
        cache.put(first);cache.clear();assertTrue(cache.list("dav",calendar).isEmpty());
        assertThrows(Exception.class,()->cache.list("dav","https://different.example/remote.php/dav/calendars/user/work/"));
    }
}
