package com.nextspace.app;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.util.List;
import org.junit.Test;
import static org.junit.Assert.*;

public class NativeWidgetDependenciesTest {
    private static JsonObject json(String source) { return JsonParser.parseString(source).getAsJsonObject(); }

    @Test public void projectedEdgesKeepDirectionAcrossHeadingsAndBackwardLinks() {
        JsonObject snapshot = json("""
            {"dependencies":{"edges":[{"prerequisiteId":"proof","dependentId":"release"},{"prerequisiteId":"release","dependentId":"share"}],
              "counts":[{"recordId":"proof","prerequisites":0,"dependents":1},{"recordId":"release","prerequisites":1,"dependents":1},
                {"recordId":"share","prerequisites":1,"dependents":0}]}}
            """);
        var plan = NativeWidgetDependencies.plan(snapshot, List.of("release", "", "proof", "share"), (from,to) -> true);
        assertEquals(List.of(new NativeWidgetDependencies.Route(2, 0, 0), new NativeWidgetDependencies.Route(0, 3, 1)), plan.routes());
        assertEquals("", plan.description(1));
        assertEquals("", plan.fallback(0));
        assertEquals("1 prerequisite · 1 item waiting for this item", plan.description(0));
    }

    @Test public void fourthOverlappingLinkKeepsOnlyItsMissingCount() {
        JsonObject snapshot = json("""
            {"dependencies":{"edges":[{"prerequisiteId":"a","dependentId":"ship"},{"prerequisiteId":"b","dependentId":"ship"},
              {"prerequisiteId":"c","dependentId":"ship"},{"prerequisiteId":"d","dependentId":"ship"}],
              "counts":[{"recordId":"a","prerequisites":0,"dependents":1},{"recordId":"ship","prerequisites":4,"dependents":0}]}}
            """);
        var plan = NativeWidgetDependencies.plan(snapshot, List.of("a", "b", "c", "d", "ship"), (from,to) -> true);
        assertEquals(List.of(0, 1, 2), plan.routes().stream().map(NativeWidgetDependencies.Route::lane).toList());
        assertEquals("1 waiting", plan.fallback(0));
        assertEquals("1 prerequisite", plan.fallback(4));
        assertEquals("4 prerequisites", plan.description(4));
    }

    @Test public void compactOrMissingRowsUseCountsAndOldSnapshotsStayEmpty() {
        JsonObject snapshot = json("""
            {"dependencies":{"edges":[{"prerequisiteId":"proof","dependentId":"release"}],
              "counts":[{"recordId":"proof","prerequisites":0,"dependents":2},{"recordId":"release","prerequisites":1,"dependents":0}]}}
            """);
        List<String> pair = List.of("proof", "release");
        var compact = NativeWidgetDependencies.plan(snapshot, pair, (from,to) -> false);
        assertTrue(compact.routes().isEmpty());
        assertEquals("2 waiting", compact.fallback(0));
        assertEquals("1 prerequisite", compact.fallback(1));
        var limited = NativeWidgetDependencies.plan(snapshot, List.of("release"), (from,to) -> true);
        assertTrue(limited.routes().isEmpty());
        assertEquals("1 prerequisite", limited.fallback(0));
        var visible = NativeWidgetDependencies.plan(snapshot, pair, (from,to) -> true);
        assertEquals("1 waiting", visible.fallback(0));
        assertEquals("", visible.fallback(1));
        var previous = NativeWidgetDependencies.plan(new JsonObject(), pair, (from,to) -> true);
        assertTrue(previous.routes().isEmpty());
        assertEquals("", previous.description(1));
    }

    @Test public void headingsEventsAndMalformedEdgesNeverCreateEndpoints() {
        JsonObject snapshot = json("""
            {"dependencies":{"edges":[{"prerequisiteId":"a","dependentId":"b"},{"prerequisiteId":"a","dependentId":"b"},
              {"prerequisiteId":"a","dependentId":"a"},{"prerequisiteId":"event","dependentId":"a"},{}]}}
            """);
        var event = json("""
            {"type":"item","kind":"event","recordId":"event"}
            """);
        var plan = NativeWidgetDependencies.plan(snapshot, List.of("", NativeWidgetDependencies.workId(event), "a", "b"),
            (from,to) -> true);
        assertEquals(List.of(new NativeWidgetDependencies.Route(2, 3, 0)), plan.routes());
        assertEquals("", plan.description(0));
        assertEquals("", plan.description(1));
    }

    @Test public void overviewRoutesOnlyRowsThatFitItsWorkLayout() {
        JsonObject snapshot = json("""
            {"overviewRangeIds":["proof","release","calendar"],"rows":[{"type":"heading","title":"Launch"},
              {"type":"item","kind":"task","recordId":"proof","timeline":{"offset":0,"length":25}},
              {"type":"item","kind":"card","recordId":"release","timeline":{"offset":50,"length":25}},
              {"type":"item","kind":"event","recordId":"calendar"}],
              "dependencies":{"edges":[{"prerequisiteId":"proof","dependentId":"release"}],
                "counts":[{"recordId":"proof","prerequisites":0,"dependents":1},{"recordId":"release","prerequisites":1,"dependents":0}]}}
            """);
        var expanded = NativeWidgetChartLayout.overviewPlan(snapshot, 360, 212, 1);
        var route = NativeWidgetChartLayout.overviewDependencies(snapshot, expanded, 360, 1).routes().get(0);
        assertEquals(1, route.prerequisiteRow());
        assertEquals(2, route.dependentRow());
        assertEquals(NativeWidgetChartLayout.overviewRangeCenter(expanded.lines().get(1), false), route.start().y(), 0);
        assertEquals(NativeWidgetChartLayout.overviewRangeCenter(expanded.lines().get(2), false), route.end().y(), 0);
        var heightLimited = NativeWidgetChartLayout.overviewPlan(snapshot, 360, 29, 1);
        var limited = NativeWidgetChartLayout.overviewDependencies(snapshot, heightLimited, 360, 1);
        assertTrue(limited.routes().isEmpty());
        assertEquals("1 waiting", limited.fallback(0));
    }
}
