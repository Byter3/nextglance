package com.nextspace.app;

import com.google.gson.JsonObject;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import org.junit.Test;
import static org.junit.Assert.*;

public class NativeWidgetRolloverPolicyTest {
    @Test public void springAndAutumnUseTheNextCivilDateInsteadOfTwentyFourHours() {
        ZoneId eastern = ZoneId.of("America/New_York");
        var spring = NativeWidgetRolloverPolicy.nextMidnight(Instant.parse("2026-03-08T05:00:00Z"), eastern, 17_000);
        assertEquals(Instant.parse("2026-03-09T04:00:00Z").toEpochMilli(), spring.wallMillis());
        assertEquals(Duration.ofHours(23).toMillis(), spring.delayMillis());
        assertEquals(17_000 + spring.delayMillis(), spring.elapsedMillis());

        var autumn = NativeWidgetRolloverPolicy.nextMidnight(Instant.parse("2026-11-01T04:00:00Z"), eastern, 0);
        assertEquals(Instant.parse("2026-11-02T05:00:00Z").toEpochMilli(), autumn.wallMillis());
        assertEquals(Duration.ofHours(25).toMillis(), autumn.delayMillis());
    }

    @Test public void unchangedClockSamplesCoalesceAndAClockChangeRealigns() {
        ZoneId utc = ZoneId.of("UTC");
        Instant now = Instant.parse("2026-11-23T15:00:00Z");
        var existing = NativeWidgetRolloverPolicy.nextMidnight(now, utc, 100_000);
        var later = NativeWidgetRolloverPolicy.nextMidnight(now.plusSeconds(7), utc, 107_045);
        assertTrue(later.matches(existing.wallMillis(), existing.elapsedMillis()));

        var timeSet = NativeWidgetRolloverPolicy.nextMidnight(now.plusSeconds(300), utc, 107_045);
        assertEquals(existing.wallMillis(), timeSet.wallMillis());
        assertFalse(timeSet.matches(existing.wallMillis(), existing.elapsedMillis()));

        var timezoneChanged = NativeWidgetRolloverPolicy.nextMidnight(now, ZoneId.of("Asia/Kathmandu"), 100_000);
        assertEquals(Instant.parse("2026-11-23T18:15:00Z").toEpochMilli(), timezoneChanged.wallMillis());
        assertFalse(timezoneChanged.matches(existing.wallMillis(), existing.elapsedMillis()));
    }

    @Test public void launcherUpdatesKeepDelayedDeliveryAndCompletionRearmsTomorrow() {
        ZoneId utc = ZoneId.of("UTC");
        var scheduled = NativeWidgetRolloverPolicy.nextMidnight(Instant.parse("2026-11-23T23:57:00Z"), utc, 100_000);
        Instant nextDay = Instant.parse("2026-11-24T00:05:00Z");
        var next = NativeWidgetRolloverPolicy.nextMidnight(nextDay, utc, 580_000);
        assertTrue(NativeWidgetRolloverPolicy.preservePending(next, scheduled.wallMillis(), scheduled.elapsedMillis(), nextDay, true));
        assertFalse(NativeWidgetRolloverPolicy.preservePending(next, scheduled.wallMillis(), scheduled.elapsedMillis(), nextDay, false));
        assertFalse(NativeWidgetRolloverPolicy.preservePending(next, 0, 0, nextDay, true));
        assertEquals(Instant.parse("2026-11-25T00:00:00Z").toEpochMilli(), next.wallMillis());
    }

    @Test public void onlyValidCurrentAccountTimeframeWidgetsAreEligible() {
        String account = "a".repeat(64);
        JsonObject config = new JsonObject();
        config.addProperty("version", 1); config.addProperty("widgetId", 7); config.addProperty("generation", 1);
        config.addProperty("scopeId", "test"); config.addProperty("title", "Fixture widget"); config.addProperty("accountKey", account);
        for (String page : new String[]{"timeline", "overview", "calendar", "board", "list"}) {
            config.addProperty("page", page);
            assertEquals(page.equals("timeline") || page.equals("overview"), NativeWidgetRolloverPolicy.eligible(config, account));
        }
        config.addProperty("page", "timeline");
        assertFalse(NativeWidgetRolloverPolicy.eligible(config, "b".repeat(64)));
        assertFalse(NativeWidgetRolloverPolicy.eligible(config, ""));
        config.remove("generation");
        assertFalse(NativeWidgetRolloverPolicy.eligible(config, account));
    }
}
