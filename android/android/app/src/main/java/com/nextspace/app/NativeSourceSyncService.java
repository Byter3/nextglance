package com.nextspace.app;

import android.app.job.JobParameters;
import android.app.job.JobService;
import android.os.SystemClock;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicBoolean;

/** OS-scheduled read-only sync plus isolated shared projection; no Activity or WebView. */
public final class NativeSourceSyncService extends JobService {
    private static final java.util.concurrent.ThreadPoolExecutor WORK = NativeDeadline.executor("background-jobs", 1, 2);
    private final Map<Integer, Work> running = new ConcurrentHashMap<>();
    private final class Work implements Runnable {
        final JobParameters parameters; final AtomicBoolean cancelled = new AtomicBoolean();
        final AtomicBoolean completed = new AtomicBoolean(); volatile boolean stoppedBySystem;
        volatile long deadline; volatile boolean retry;
        volatile Future<?> future; volatile NativeSourceTransport transport; volatile NativeHeadlessProjector projector;
        String deniedCollection;
        final Runnable cancellation = this::cancel;
        Work(JobParameters parameters) { this.parameters = parameters; }
        void finish() { if (!stoppedBySystem && completed.compareAndSet(false, true)) jobFinished(parameters, retry); }
        void cancel() { cancelled.set(true); NativeHeadlessProjector projection=projector;if(projection!=null)projection.closeAsync(); NativeSourceTransport value = transport; if (value != null) value.close(); Future<?> pending = future; if (pending != null) pending.cancel(true); WORK.purge(); running.remove(parameters.getJobId(), this); NativeSyncRuntime.unregister(parameters.getJobId(), cancellation); finish(); }
        @Override public void run() {
            deadline=SystemClock.elapsedRealtime()+NativeSyncPolicy.JOB_MILLIS;
            NativeSyncRuntime.Session session = null; String attempt = null; String kind = parameters.getExtras().getString("kind");
            try {
                session = NativeSyncRuntime.session(NativeSourceSyncService.this, parameters.getExtras().getString("accountName"));
                if (!session.selection().equals(parameters.getExtras().getString("selection"))) return;
                NativeSyncRuntime.Session active = session;
                NativeResourceCache.Guard guard = () -> {
                    active.checkEpoch(); if (cancelled.get() || NativeSyncRuntime.isForeground()) throw NativeSyncPolicy.failure("CANCELLED", "Android paused this background check.");
                    if (SystemClock.elapsedRealtime() >= deadline) throw NativeSyncPolicy.failure("TIMEOUT", "Android background check reached its 90 second deadline. Completed downloads are retained for the next check.");
                    if (parameters.getExtras().getBoolean("wifiOnly", false)) {
                        android.net.ConnectivityManager manager = getSystemService(android.net.ConnectivityManager.class);
                        android.net.Network network = manager == null ? null : manager.getActiveNetwork();
                        android.net.NetworkCapabilities capabilities = manager == null ? null : manager.getNetworkCapabilities(network);
                        if (capabilities == null || !capabilities.hasTransport(android.net.NetworkCapabilities.TRANSPORT_WIFI)) throw NativeSyncPolicy.failure("CANCELLED", "Background checks are waiting for Wi-Fi.");
                    }
                };
                guard.check(); attempt = NativeSyncRuntime.started(active, kind); transport = new NativeSourceTransport(NativeSourceSyncService.this, active.account(), guard, NativeDeadline.Lane.BACKGROUND);
                projector=new NativeHeadlessProjector(active,guard,deadline);
                long[] lastProgress = {0};
                NativeSyncEngine engine = new NativeSyncEngine(active.account().serverUrl(), (url, method, headers, body, max, remaining) -> {
                    active.check();
                    NativeSourceTransport.Reply reply = transport.request(url, method, headers, body, max, Math.min(remaining, Math.max(1, deadline - SystemClock.elapsedRealtime())));
                    if(reply.status()==403)deniedCollection=NativeSyncPolicy.deniedCollection(active.account().serverUrl(),kind,url);
                    projector.capture(url,method,reply);
                    return new NativeSyncEngine.Reply(reply.status(), reply.headers(), new String(reply.body(), StandardCharsets.UTF_8));
                }, active.cacheBatch(guard), guard, SystemClock::elapsedRealtime, (stage, completed, total) -> {
                    long now = SystemClock.elapsedRealtime(); if (now - lastProgress[0] >= 500) { NativeSyncRuntime.progress(active, kind, stage, completed, total); lastProgress[0] = now; }
                },(url,reply)->projector.capture(url,"PROPFIND",new NativeSourceTransport.Reply(reply.status(),"inventory-checkpoint",reply.headers(),reply.body().getBytes(StandardCharsets.UTF_8))));
                engine.run(kind); guard.check(); NativeSyncRuntime.downloaded(active,kind); NativeSyncRuntime.progress(active,kind,"projection",0,0);boolean projected=projector.project(kind);guard.check();if(projected)engine.projected();NativeSyncRuntime.finished(active, kind, null);
            } catch (Exception error) {
                if(!cancelled.get()&&projector!=null&&error instanceof NativeLoginFlow.Failure denied&&java.util.Set.of("AUTH","PERMISSION").contains(denied.code)){
                    try{projector.deny(kind,denied.code,"AUTH".equals(denied.code)?null:deniedCollection);}catch(Exception purgeFailure){/* Launch invalidation precedes projection; original denial remains visible. */}
                }
                retry=!cancelled.get()&&(!(error instanceof NativeLoginFlow.Failure known)||java.util.Set.of("TIMEOUT","NETWORK","NEXTCLOUD").contains(known.code));
                if (session != null && !cancelled.get()) try { NativeSyncRuntime.finished(session, kind, error); } catch (Exception stale) { /* A replaced account must not receive the old job's state. */ }
            } finally {
                if(cancelled.get()&&session!=null&&attempt!=null){
                    // Only this worker performs local cancellation bookkeeping. Activity entry
                    // merely signals; a later attempt or completed publication always wins.
                    boolean interrupted=Thread.interrupted();
                    try{NativeSyncRuntime.interrupted(session,kind,attempt);}catch(Exception stale){/* Account replacement wins. */}
                    finally{if(interrupted)Thread.currentThread().interrupt();}
                }
                NativeHeadlessProjector projection=projector;if(projection!=null)projection.close();
                NativeSourceTransport value = transport; if (value != null) value.close();
                running.remove(parameters.getJobId(), this); NativeSyncRuntime.unregister(parameters.getJobId(), cancellation);
                finish();
            }
        }
    }
    @Override public boolean onStartJob(JobParameters parameters) {
        if (NativeSyncRuntime.isForeground()) return false;
        Work work = new Work(parameters); Work previous = running.put(parameters.getJobId(), work); if (previous != null) previous.cancel();
        NativeSyncRuntime.register(parameters.getJobId(), work.cancellation);
        try { work.future = WORK.submit(work); if (work.cancelled.get()) work.future.cancel(true); return true; }
        catch (java.util.concurrent.RejectedExecutionException busy) { running.remove(parameters.getJobId(), work); NativeSyncRuntime.unregister(parameters.getJobId(), work.cancellation); return false; }
    }
    @Override public boolean onStopJob(JobParameters parameters) {
        Work work = running.remove(parameters.getJobId()); if (work != null) { work.stoppedBySystem = true; work.cancel(); NativeSyncRuntime.unregister(parameters.getJobId(), work.cancellation); }
        return !NativeSyncRuntime.isForeground();
    }
    @Override public void onDestroy() { for (Work work : running.values()) work.cancel(); running.clear(); super.onDestroy(); }
}
