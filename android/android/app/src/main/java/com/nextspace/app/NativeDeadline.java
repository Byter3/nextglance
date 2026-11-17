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

/** Finite caller deadline even when an external Binder provider stops responding. */
final class NativeDeadline {
    // A provider Binder call may ignore interruption. Bound each lane independently: a stuck
    // background download must never consume authorization or foreground capacity.
    enum Lane { AUTHORIZATION, FOREGROUND, BACKGROUND }
    private static final ThreadPoolExecutor AUTH = executor("authorization", 1, 4);
    private static final ThreadPoolExecutor FOREGROUND = executor("foreground-io", 2, 8);
    private static final ThreadPoolExecutor BACKGROUND = executor("background-io", 2, 2);
    private static final ThreadPoolExecutor CLEANUP = executor("transport-cleanup", 2, 8);
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
    static <T> T run(ThreadPoolExecutor executor, Callable<T> work, Runnable cancel, long milliseconds) throws Exception {
        long expires = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(Math.max(1, Math.min(milliseconds, NativeSyncPolicy.REQUEST_MILLIS)));
        Future<T> pending;
        try { pending = executor.submit(() -> {
            if (Thread.currentThread().isInterrupted() || System.nanoTime() >= expires) throw NativeSyncPolicy.failure("TIMEOUT", "The queued Nextcloud request expired before it started. Retry shortly.");
            return work.call();
        }); }
        catch (RejectedExecutionException busy) { throw NativeSyncPolicy.failure("NETWORK", "Nextcloud transport is still releasing earlier requests. Retry shortly."); }
        try { return pending.get(Math.max(1, expires - System.nanoTime()), TimeUnit.NANOSECONDS); }
        catch (TimeoutException timeout) { stop(executor, pending, cancel); throw NativeSyncPolicy.failure("TIMEOUT", "Nextcloud did not finish this request within 45 seconds. Saved data remains available; retry the source check."); }
        catch (InterruptedException stopped) { stop(executor, pending, cancel); Thread.currentThread().interrupt(); throw NativeSyncPolicy.failure("CANCELLED", "The source check was stopped. Saved downloads are retained."); }
        catch (CancellationException stopped) { throw NativeSyncPolicy.failure("CANCELLED", "The source check was stopped. Saved downloads are retained."); }
        catch (ExecutionException failed) { if (failed.getCause() instanceof Exception error) throw error; throw NativeSyncPolicy.failure("NETWORK", "Nextcloud could not complete the request."); }
    }
    private static void stop(ThreadPoolExecutor executor, Future<?> pending, Runnable cancel) {
        pending.cancel(true); executor.purge(); cancel.run(); // Cancellation callbacks must only signal and enqueue cleanup.
    }
}
