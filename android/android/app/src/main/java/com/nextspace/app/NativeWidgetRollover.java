package com.nextspace.app;

import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;
import android.os.PersistableBundle;
import android.os.SystemClock;
import java.time.Instant;
import java.time.ZoneId;

/** An Android-managed, local-only preparation trigger for rolling widget dates. */
final class NativeWidgetRollover {
    static final int JOB_ID = 671204;
    private static final String WALL_TARGET = "wallTarget";
    private static final String ELAPSED_TARGET = "elapsedTarget";
    private static boolean running;

    static synchronized void reconcile(Context context) {
        reconcile(context, true);
    }

    static synchronized void reconcileClockChange(Context context) {
        reconcile(context, false);
    }

    private static void reconcile(Context context, boolean retainDueJob) {
        try {
            JobScheduler jobs = context.getSystemService(JobScheduler.class);
            if (jobs == null) return;
            JobInfo existing = jobs.getPendingJob(JOB_ID);
            if (!hasEligibleWidget(context)) {
                if (existing != null || running) jobs.cancel(JOB_ID);
                return;
            }
            if (running) return;
            Instant now = Instant.now();
            var target = NativeWidgetRolloverPolicy.nextMidnight(now, ZoneId.systemDefault(), SystemClock.elapsedRealtime());
            if (existing != null && NativeWidgetRolloverPolicy.preservePending(target, existing.getExtras().getLong(WALL_TARGET),
                existing.getExtras().getLong(ELAPSED_TARGET), now, retainDueJob)) return;

            PersistableBundle extras = new PersistableBundle();
            extras.putLong(WALL_TARGET, target.wallMillis());
            extras.putLong(ELAPSED_TARGET, target.elapsedMillis());
            jobs.schedule(new JobInfo.Builder(JOB_ID, new ComponentName(context, NativeWidgetUpdateService.class))
                .setExtras(extras).setPersisted(true).setMinimumLatency(target.delayMillis()).build());
        } catch (RuntimeException unavailable) {
            // A launcher refresh can retry scheduling even if the OS temporarily rejects a job.
        }
    }

    static synchronized boolean start(Context context) {
        try {
            running = hasEligibleWidget(context);
            return running;
        } catch (RuntimeException unavailable) {
            running = false;
            return false;
        }
    }

    static synchronized void stop() { running = false; }

    static synchronized void finish(Context context) {
        running = false;
        reconcile(context, false);
    }

    private static boolean hasEligibleWidget(Context context) {
        String account = NativeWidgetStore.accountKey(context);
        if (account.isEmpty()) return false;
        NativeWidgetStore store = new NativeWidgetStore(context);
        for (int id : NativeWidgetProvider.ids(context)) {
            if (NativeWidgetRolloverPolicy.eligible(store.config(id), account)) return NativeHeadlessProjector.supported();
        }
        return false;
    }
}
