package com.nextspace.app;

import com.google.gson.*;
import java.util.*;
import org.junit.Test;
import static org.junit.Assert.*;

public class NativeWeekendTest {
    private JsonObject json(String value) { return JsonParser.parseString(value).getAsJsonObject(); }
    @Test public void defaultsAndInvalidValuesMatchTheSevenBitAppearanceContract() {
        for (Object value : Arrays.asList(null, "65", true, -1, 128, 2.5, Double.NaN, Double.POSITIVE_INFINITY)) assertEquals(65, NativeWeekend.normalize(value));
        for (int value : List.of(0, 1, 2, 32, 65, 127)) assertEquals(value, NativeWeekend.normalize(value));
        assertEquals(65, NativeWeekend.normalize(65.0));
    }
    @Test public void defaultCustomAndEmptyWeekendsUseTheDisplayedCivilDate() {
        assertTrue(NativeWeekend.contains("2026-11-28", 65));
        assertTrue(NativeWeekend.contains("2026-11-29", 65));
        assertFalse(NativeWeekend.contains("2026-11-30", 65));
        assertTrue(NativeWeekend.contains("2026-11-27", 32));
        assertFalse(NativeWeekend.contains("2026-11-28", 32));
        for(int mask : List.of(0, 65, 127)) assertFalse(NativeWeekend.contains("2026-11-29T23:00:00Z", mask));
        assertFalse(NativeWeekend.contains("2026-11-29", 0));
    }
    @Test public void invalidDatesNeverBecomeWeekendCells() {
        for(String date:List.of("", "2026-02-29", "2026-13-01", "2026-11-31", "2026-1-1", "Sunday")) assertFalse(NativeWeekend.contains(date,127));
        assertTrue(NativeWeekend.contains("2028-02-29", 127));
    }
    @Test public void dateBadgesPreferProjectedKeysWithoutReinterpretingUtcInstants() {
        assertEquals("2026-11-29",NativeWeekend.rowDate(json("{\"kind\":\"task\",\"dateKey\":\"2026-11-29\",\"due\":\"2026-11-28T23:00:00Z\"}")));
        assertEquals("",NativeWeekend.rowDate(json("{\"kind\":\"task\",\"due\":\"2026-11-28T23:00:00Z\"}")));
        assertEquals("2026-11-29",NativeWeekend.rowDate(json("{\"kind\":\"event\",\"start\":\"2026-11-29\"}")));
        assertEquals("",NativeWeekend.rowDate(json("{\"kind\":\"task\",\"dateKey\":\"\",\"due\":\"2026-11-29\"}")));
        assertEquals("",NativeWeekend.rowDate(json("{\"kind\":\"card\"}")));
    }
    @Test public void weekendBandsUseTheExistingTimelineCoordinatesAndExclusiveEnd() {
        JsonObject axis=json("{\"start\":\"2026-11-27\",\"ticks\":[{\"offset\":0},{\"offset\":25},{\"offset\":50},{\"offset\":75},{\"offset\":100}]}");
        assertEquals(List.of(new NativeWeekend.Band(25,50),new NativeWeekend.Band(50,75)),NativeWeekend.timelineBands(axis,65));
        assertEquals(List.of(new NativeWeekend.Band(0,25)),NativeWeekend.timelineBands(axis,32));
        assertTrue(NativeWeekend.timelineBands(axis,0).isEmpty());
        assertEquals(4,NativeWeekend.timelineBands(axis,127).size());
        assertTrue(NativeWeekend.timelineBands(json("{\"start\":\"invalid\",\"ticks\":[{\"offset\":0},{\"offset\":100}]}"),127).isEmpty());
    }
    @Test public void corruptOffsetsCannotShadeOutsideTheChart() {
        JsonObject axis=json("{\"start\":\"2026-11-28\",\"ticks\":[{\"offset\":-1},{\"offset\":30},{\"offset\":20},{\"offset\":101},{\"offset\":\"NaN\"}]}");
        assertTrue(NativeWeekend.timelineBands(axis,127).isEmpty());
    }
    @Test public void weekendOverlayLeavesTextAndSourceMarksUntouched() {
        assertEquals(0x00ffffff,NativeWeekend.OVERLAY & 0x00ffffff);
        double opacity=(NativeWeekend.OVERLAY >>> 24)/255.0;
        assertTrue(opacity>=.02&&opacity<=.03);
        JsonObject grid=json("{\"days\":[{\"date\":\"2026-11-29\",\"label\":\"Sun 29\",\"today\":true}],\"timed\":[{\"recordId\":\"review\",\"dayIndex\":0,\"startMinute\":600,\"endMinute\":720}],\"hourStart\":8,\"hourEnd\":18}");
        var layout=NativeWidgetChartLayout.grid(grid,360,400,false);
        assertTrue(NativeWeekend.contains(layout.days().get(0).date(),65));
        assertTrue(layout.days().get(0).today());
        assertEquals("review",NativeWidgetChartLayout.actionable(layout).get(0).recordId());
    }
}
