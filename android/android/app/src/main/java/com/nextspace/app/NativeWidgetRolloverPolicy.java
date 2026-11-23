package com.nextspace.app;

import com.google.gson.JsonObject;
import java.time.Instant;
import java.time.ZoneId;

/** Civil-date scheduling and current-account eligibility without Android dependencies. */
final class NativeWidgetRolloverPolicy {
    private static final long CLOCK_SAMPLE_TOLERANCE_MILLIS = 1_000;

    record Target(long wallMillis, long elapsedMillis, long delayMillis) {
        boolean matches(long wall, long elapsed) {
            return wall == wallMillis && elapsed >= elapsedMillis - CLOCK_SAMPLE_TOLERANCE_MILLIS
                && elapsed <= elapsedMillis + CLOCK_SAMPLE_TOLERANCE_MILLIS;
        }
    }

    static Target nextMidnight(Instant now, ZoneId zone, long elapsedMillis) {
        long wall = now.atZone(zone).toLocalDate().plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli();
        long delay = Math.max(1, wall - now.toEpochMilli());
        return new Target(wall, elapsedMillis + delay, delay);
    }

    static boolean preservePending(Target next, long wall, long elapsed, Instant now, boolean retainDueJob) {
        return next.matches(wall, elapsed) || retainDueJob && wall > 0 && wall <= now.toEpochMilli();
    }

    static boolean eligible(JsonObject config, String account) {
        if (account.isEmpty() || !NativeWidgetPolicy.validConfig(config) || !account.equals(NativeWidgetPolicy.text(config, "accountKey", ""))) return false;
        String page = NativeWidgetPolicy.text(config, "page", "");
        return "overview".equals(page) || "timeline".equals(page);
    }
}
