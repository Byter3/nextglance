package com.nextspace.app;

import java.util.concurrent.atomic.AtomicLong;

/** Session invalidation is distinct from ordinary, serialized cache maintenance. */
final class NativeCacheEpoch {
    private final AtomicLong revision = new AtomicLong();
    long capture() { return revision.get(); }
    void check(long captured) throws NativeLoginFlow.Failure {
        if (captured != revision.get() || Thread.currentThread().isInterrupted())
            throw NativeSyncPolicy.failure("CANCELLED", "The selected account or source session changed.");
    }
    void invalidate() { revision.incrementAndGet(); }
    boolean beforeMaintenance(String operation) {
        // Pruning a calendar or Deck inventory cannot invalidate a sibling
        // source's queued reads. Cache locking still serializes actual changes.
        if (!"clear".equals(operation)) return false;
        invalidate();
        return true;
    }
}
