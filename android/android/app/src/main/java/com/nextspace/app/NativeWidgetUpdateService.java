package com.nextspace.app;

import android.app.job.*;
import android.content.Context;

/** One-shot preparation and date rollover both use the same saved-data projector. */
public class NativeWidgetUpdateService extends JobService {
    private JobParameters rollover;

    @Override public boolean onStartJob(JobParameters params) {
        Context context = getApplicationContext();
        if (params.getJobId() != NativeWidgetRollover.JOB_ID) {
            NativeWidgetProjector.run(context, () -> jobFinished(params, false));
            return true;
        }
        if (!NativeWidgetRollover.start(context)) return false;
        rollover = params;
        NativeWidgetProjector.run(context, () -> {
            if (rollover != params) return;
            rollover = null;
            jobFinished(params, false);
            NativeWidgetRollover.finish(context);
        });
        return true;
    }

    @Override public boolean onStopJob(JobParameters params) {
        if (params.getJobId() == NativeWidgetRollover.JOB_ID) {
            rollover = null;
            NativeWidgetRollover.stop();
        }
        return true;
    }
}
