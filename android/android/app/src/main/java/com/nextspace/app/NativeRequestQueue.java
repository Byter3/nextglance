package com.nextspace.app;

import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;

/** Bounded, two-lane FIFO. Queued user edits precede background reads without increasing concurrency. */
final class NativeRequestQueue extends ThreadPoolExecutor {
    private static final AtomicLong SEQUENCE = new AtomicLong();
    private static final class Work<T> extends FutureTask<T> implements Comparable<Work<?>> {
        final boolean low; final long sequence = SEQUENCE.incrementAndGet();
        Work(Runnable run, T result, boolean low) { super(run, result); this.low = low; }
        Work(Callable<T> run) { super(run); low = false; }
        @Override public int compareTo(Work<?> other) { int priority = Boolean.compare(low, other.low); return priority != 0 ? priority : Long.compare(sequence, other.sequence); }
    }
    private static final class Pending extends PriorityBlockingQueue<Runnable> {
        final int limit;
        Pending(int limit) { super(limit, (a, b) -> ((Work<?>) a).compareTo((Work<?>) b)); this.limit = limit; }
        @Override public synchronized boolean offer(Runnable value) { return size() < limit && super.offer(value); }
    }
    NativeRequestQueue(int threads, int pending) { super(threads, threads, 30, TimeUnit.SECONDS, new Pending(pending)); allowCoreThreadTimeOut(true); }
    @Override protected <T> RunnableFuture<T> newTaskFor(Runnable task, T value) { return new Work<>(task, value, false); }
    @Override protected <T> RunnableFuture<T> newTaskFor(Callable<T> task) { return new Work<>(task); }
    Future<?> submitRead(Runnable task, boolean low) { Work<?> work = new Work<>(task, null, low); execute(work); return work; }
}
