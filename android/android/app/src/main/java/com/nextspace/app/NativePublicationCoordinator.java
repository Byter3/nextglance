package com.nextspace.app;

import java.util.concurrent.Callable;
import java.util.concurrent.locks.ReentrantLock;

/** Lifecycle signals never wait for disk I/O; only worker operations acquire publication ownership. */
final class NativePublicationCoordinator {
    private final ReentrantLock publication = new ReentrantLock();
    private volatile boolean foreground;

    void foreground(boolean value) { foreground = value; }
    boolean isForeground() { return foreground; }

    <T> T files(Callable<T> operation) throws Exception {
        publication.lockInterruptibly();
        try { return operation.call(); }
        finally { publication.unlock(); }
    }

    void background(NativeResourceCache.Guard guard, NativeReadGeneration.Commit operation) throws Exception {
        files(() -> {
            guard.check();
            if (foreground) throw NativeSyncPolicy.failure("CANCELLED", "Foreground editing resumed.");
            operation.run();
            return null;
        });
    }
}
