package com.nextspace.app;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.util.List;
import org.junit.Test;
import static org.junit.Assert.*;

public class NativeWidgetPlotLinksTest {
    private static JsonObject graph() {
        return JsonParser.parseString("""
            {"dependencies":{"edges":[{"prerequisiteId":"proof","dependentId":"release"}],
              "counts":[{"recordId":"proof","dependents":1},{"recordId":"release","prerequisites":1}]}}
            """).getAsJsonObject();
    }

    private static NativeWidgetPlotLinks.Row row(String id, double offset, double length, float center) {
        return new NativeWidgetPlotLinks.Row(id, new NativeWidgetPresentation.Range(offset, length), center);
    }

    @Test public void clippedEdgeRangesStillProvideRoomForTheArrowInsideThePlot() {
        int plotWidth = 200;
        var release = row("release", 0, 10, 23);
        var proof = row("proof", 90, 10, 105);
        var rows = List.of(release, row("", 0, 0, 58), proof);
        var plan = NativeWidgetPlotLinks.plan(graph(), rows, plotWidth, 1);
        var route = plan.routes().get(0);
        assertEquals(2, route.prerequisiteRow());
        assertEquals(0, route.dependentRow());
        assertEquals(NativeWidgetPlotLinks.bounds(proof.range(), plotWidth).right(), route.start().x(), 0);
        assertEquals(NativeWidgetPlotLinks.bounds(release.range(), plotWidth).left(), route.end().x(), 0);
        assertEquals(proof.centerY(), route.start().y(), 0);
        assertEquals(release.centerY(), route.end().y(), 0);
        assertTrue(route.end().x() - 5 >= 0);
        assertEquals("", plan.fallback(0));
        assertEquals("1 prerequisite", plan.description(0));
        assertEquals("", plan.description(1));
        for (int i = 1; i < route.points().size(); i++) {
            var previous = route.points().get(i - 1);
            var next = route.points().get(i);
            assertTrue(previous.x() == next.x() || previous.y() == next.y());
            assertTrue(next.x() > 0 && next.x() < plotWidth);
            assertTrue(next.y() >= release.centerY() && next.y() <= proof.centerY());
        }
        assertTrue(route.points().get(route.points().size() - 2).x() < route.end().x());
    }

    @Test public void aSingleAbsoluteRouteCrossesEveryMatchingRowClip() {
        var rows = List.of(row("proof", 10, 18, 17), row("", 0, 0, 41), row("release", 70, 20, 72));
        var route = NativeWidgetPlotLinks.plan(graph(), rows, 240, 1).routes().get(0);
        assertTrue(route.crosses(0, 34));
        assertTrue(route.crosses(34, 14));
        assertTrue(route.crosses(48, 41));
        assertFalse(route.crosses(89, 34));
        // Check the same continuous segment passes both shared clip boundaries.
        var points = route.points();
        assertEquals(points.get(3).x(), points.get(4).x(), 0);
        assertTrue(points.get(3).y() < 34);
        assertTrue(points.get(4).y() > 48);
    }

    @Test public void missingShortOrUnplottableRangesKeepFallbackAndAccessibleCounts() {
        var proof = row("proof", 0, 8, 17);
        var release = row("release", 20, 2, 54);
        var differentScales = NativeWidgetPlotLinks.plan(graph(), List.of(proof, release), 55, 2);
        var missingRange = NativeWidgetPlotLinks.plan(graph(), List.of(proof, row("release", 20, 0, 54)), 240, 1);
        var noVerticalRoom = NativeWidgetPlotLinks.plan(graph(), List.of(proof, row("release", 20, 2, 21)), 240, 1);
        for (var plan : List.of(differentScales, missingRange, noVerticalRoom)) {
            assertTrue(plan.routes().isEmpty());
            assertEquals("1 waiting", plan.fallback(0));
            assertEquals("1 item waiting for this item", plan.description(0));
            assertEquals("1 prerequisite", plan.fallback(1));
        }
        assertEquals("1 waiting", NativeWidgetPlotLinks.plan(graph(), List.of(proof), 240, 1).fallback(0));
    }
}
