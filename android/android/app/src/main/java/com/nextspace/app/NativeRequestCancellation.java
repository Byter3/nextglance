package com.nextspace.app;

/** Cancellation belongs to one request, never the shared provider connection. */
final class NativeRequestCancellation {
    private boolean cancelled;
    private Runnable owned;

    void attach(Runnable resource) {
        boolean close;
        synchronized (this) { close = cancelled; if (!close) owned = resource; }
        if (close) resource.run();
    }
    synchronized void release() { owned = null; }
    void cancel() {
        Runnable close;
        synchronized (this) { if (cancelled) return; cancelled = true; close = owned; owned = null; }
        if (close != null) close.run();
    }
    synchronized void check() throws NativeLoginFlow.Failure {
        if (cancelled || Thread.currentThread().isInterrupted()) throw NativeSyncPolicy.failure("CANCELLED", "The source request was cancelled.");
    }
}
