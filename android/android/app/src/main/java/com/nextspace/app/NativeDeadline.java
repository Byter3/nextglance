package com.nextspace.app;

import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Future;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.CancellationException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.LongSupplier;

/** Finite caller deadline even when an external Binder provider stops responding. */
final class NativeDeadline {
    // Files Binder and direct HTTP use separate capacity. The provider can ignore interruption.
    enum Lane { AUTHORIZATION, FOREGROUND, BACKGROUND }
    private static final ThreadPoolExecutor AUTH = executor("authorization", 1, 4);
    private static final ThreadPoolExecutor FOREGROUND = executor("foreground-io", 2, 8);
    private static final ThreadPoolExecutor BACKGROUND = executor("background-io", 2, 2);
    private static final ThreadPoolExecutor CLEANUP = executor("transport-cleanup", 2, 8);
    private static final FilesLane FILES = new FilesLane(executor("files-provider", 1, 2), System::nanoTime);

    static final class FilesLane {
        private static final long COOLDOWN = TimeUnit.SECONDS.toNanos(30);
        private final ThreadPoolExecutor executor;
        private final LongSupplier clock;
        private volatile Long lastFailure;

        FilesLane(ThreadPoolExecutor executor, LongSupplier clock) { this.executor = executor; this.clock = clock; }

        private void checkCooldown() throws NativeLoginFlow.Failure {
            Long failedAt = lastFailure;
            if (failedAt != null && clock.getAsLong() - failedAt < COOLDOWN)
                throw filesUnavailable();
        }

        <T> T run(Callable<T> work, Runnable cancel, long milliseconds) throws Exception {
            checkCooldown();
            AtomicBoolean running = new AtomicBoolean();
            return NativeDeadline.run(executor, () -> {
                checkCooldown();
                running.set(true);
                try { return work.call(); }
                catch (NativeLoginFlow.Failure error) {
                    if ("FILES_TRANSPORT".equals(error.code)) lastFailure = clock.getAsLong();
                    throw error;
                } finally { running.set(false); }
            }, cancel, milliseconds, () -> {
                if (running.get()) lastFailure = clock.getAsLong();
            }, true);
        }
    }

    static NativeLoginFlow.Failure filesUnavailable() {
        return NativeSyncPolicy.failure("FILES_TRANSPORT", "The Nextcloud Files connection is unavailable. Retry shortly or use a direct connection in Settings.");
    }
    static ThreadPoolExecutor executor(String name, int threads, int queued) {
        return new ThreadPoolExecutor(threads, threads, 30, TimeUnit.SECONDS,
                new ArrayBlockingQueue<>(queued), runnable -> {
                    Thread thread = new Thread(runnable, "nextglance-" + name); thread.setDaemon(true); return thread;
                });
    }
    private static ThreadPoolExecutor executor(Lane lane) {
        return switch (lane) { case AUTHORIZATION -> AUTH; case FOREGROUND -> FOREGROUND; case BACKGROUND -> BACKGROUND; };
    }
    static void cleanup(Runnable work) {
        try { CLEANUP.execute(work); } catch (RejectedExecutionException busy) { /* Already cancelled; do not block the caller on provider cleanup. */ }
    }
    static <T> T run(Lane lane, Callable<T> work, Runnable cancel, long milliseconds) throws Exception {
        return run(executor(lane), work, cancel, milliseconds);
    }
    static <T> T runFiles(Callable<T> work, Runnable cancel, long milliseconds) throws Exception {
        return FILES.run(work, cancel, milliseconds);
    }
    static <T> T run(ThreadPoolExecutor executor, Callable<T> work, Runnable cancel, long milliseconds) throws Exception {
        return run(executor, work, cancel, milliseconds, () -> {}, false);
    }
    private static <T> T run(ThreadPoolExecutor executor, Callable<T> work, Runnable cancel, long milliseconds,
                             Runnable onTimeout, boolean files) throws Exception {
        long expires = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(Math.max(1, Math.min(milliseconds, NativeSyncPolicy.REQUEST_MILLIS)));
        Future<T> pending;
        try { pending = executor.submit(() -> {
            if (Thread.currentThread().isInterrupted() || System.nanoTime() >= expires) throw NativeSyncPolicy.failure("TIMEOUT", "The queued Nextcloud request expired before it started. Retry shortly.");
            return work.call();
        }); }
        catch (RejectedExecutionException busy) {
            if (files) throw filesUnavailable();
            throw NativeSyncPolicy.failure("NETWORK", "Nextcloud transport is still releasing earlier requests. Retry shortly.");
        }
        try { return pending.get(Math.max(1, expires - System.nanoTime()), TimeUnit.NANOSECONDS); }
        catch (TimeoutException timeout) { onTimeout.run(); stop(executor, pending, cancel); throw NativeSyncPolicy.failure("TIMEOUT", "Nextcloud did not finish this request within 45 seconds. Saved data remains available; retry the source check."); }
        catch (InterruptedException stopped) { if (System.nanoTime() >= expires) onTimeout.run(); stop(executor, pending, cancel); Thread.currentThread().interrupt(); throw NativeSyncPolicy.failure("CANCELLED", "The source check was stopped. Saved downloads are retained."); }
        catch (CancellationException stopped) { throw NativeSyncPolicy.failure("CANCELLED", "The source check was stopped. Saved downloads are retained."); }
        catch (ExecutionException failed) { if (failed.getCause() instanceof Exception error) throw error; throw NativeSyncPolicy.failure("NETWORK", "Nextcloud could not complete the request."); }
    }
    private static void stop(ThreadPoolExecutor executor, Future<?> pending, Runnable cancel) {
        pending.cancel(true); executor.purge(); cancel.run(); // Cancellation callbacks must only signal and enqueue cleanup.
    }
}
