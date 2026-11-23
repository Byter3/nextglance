package com.nextspace.app;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import java.util.ArrayList;
import java.util.BitSet;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.function.BiPredicate;

/** Chooses a bounded set of projected dependency edges and preserves each row's counts. */
final class NativeWidgetDependencies {
    private static final int LANES = 3;
    private static final int MAX_EDGES = 60;

    record Route(int prerequisiteRow, int dependentRow, int lane) {}
    private record Row(int prerequisiteCount, int dependentCount, int hiddenPrerequisites, int hiddenDependents) {}
    record Plan(List<Route> routes, List<Row> rows) {
        String fallback(int index) {
            Row row = rows.get(index);
            return label(row.hiddenPrerequisites, row.hiddenDependents, false);
        }
        String description(int index) {
            Row row = rows.get(index);
            return label(row.prerequisiteCount, row.dependentCount, true);
        }
    }
    private record Endpoints(int prerequisite, int dependent) {
        int first() { return Math.min(prerequisite, dependent); }
        int last() { return Math.max(prerequisite, dependent); }
        int span() { return last() - first(); }
    }
    private record Count(int prerequisites, int dependents) {}
    private static final Count NO_COUNT = new Count(0, 0);
    static int connectorColor(boolean dark) { return dark ? 0xff67bbe7 : 0xff075e8a; }

    static String workId(JsonObject row) {
        String kind = NativeWidgetPolicy.text(row, "kind", "");
        return "task".equals(kind) || "card".equals(kind) ? NativeWidgetPolicy.text(row, "recordId", "") : "";
    }

    static Plan plan(JsonObject snapshot, List<String> rowIds, BiPredicate<Integer, Integer> canRoute) {
        JsonObject dependencies = NativeWidgetPolicy.object(snapshot, "dependencies");
        Map<String, Integer> rowPositions = new HashMap<>();
        for (int i = 0; i < rowIds.size(); i++) {
            String id = rowIds.get(i);
            if (!id.isBlank()) rowPositions.putIfAbsent(id, i);
        }
        Map<String, Count> counts = new HashMap<>();
        for (JsonElement value : NativeWidgetPolicy.array(dependencies, "counts")) {
            if (!value.isJsonObject()) continue;
            JsonObject count = value.getAsJsonObject();
            String id = NativeWidgetPolicy.text(count, "recordId", "");
            if (rowPositions.containsKey(id)) counts.putIfAbsent(id, new Count(
                Math.max(0, NativeWidgetPolicy.number(count, "prerequisites", 0)),
                Math.max(0, NativeWidgetPolicy.number(count, "dependents", 0))));
        }
        List<Route> routes = routes(dependencies, rowPositions, canRoute);
        int[] visiblePrerequisites = new int[rowIds.size()];
        int[] visibleDependents = new int[rowIds.size()];
        for (Route route : routes) {
            visiblePrerequisites[route.dependentRow]++;
            visibleDependents[route.prerequisiteRow]++;
        }
        List<Row> rows = new ArrayList<>(rowIds.size());
        for (int i = 0; i < rowIds.size(); i++) {
            Count count = counts.getOrDefault(rowIds.get(i), NO_COUNT);
            rows.add(new Row(Math.max(count.prerequisites, visiblePrerequisites[i]),
                Math.max(count.dependents, visibleDependents[i]), Math.max(0, count.prerequisites - visiblePrerequisites[i]),
                Math.max(0, count.dependents - visibleDependents[i])));
        }
        return new Plan(routes, List.copyOf(rows));
    }

    private static List<Route> routes(JsonObject dependencies, Map<String, Integer> rowPositions,
                                      BiPredicate<Integer, Integer> canRoute) {
        LinkedHashSet<Endpoints> candidates = new LinkedHashSet<>();
        int examined = 0;
        for (JsonElement value : NativeWidgetPolicy.array(dependencies, "edges")) {
            if (examined++ >= MAX_EDGES) break;
            if (!value.isJsonObject()) continue;
            JsonObject edge = value.getAsJsonObject();
            Integer prerequisite = rowPositions.get(NativeWidgetPolicy.text(edge, "prerequisiteId", ""));
            Integer dependent = rowPositions.get(NativeWidgetPolicy.text(edge, "dependentId", ""));
            if (prerequisite != null && dependent != null && !prerequisite.equals(dependent)
                && canRoute.test(prerequisite, dependent)) {
                candidates.add(new Endpoints(prerequisite, dependent));
            }
        }
        List<Endpoints> ordered = candidates.stream().sorted(Comparator.comparingInt(Endpoints::span)
            .thenComparingInt(Endpoints::first).thenComparingInt(Endpoints::prerequisite).thenComparingInt(Endpoints::dependent)).toList();
        List<BitSet> used = List.of(new BitSet(), new BitSet(), new BitSet());
        List<Route> routes = new ArrayList<>();
        for (Endpoints edge : ordered) {
            for (int lane = 0; lane < LANES; lane++) {
                BitSet occupied = used.get(lane);
                int next = occupied.nextSetBit(edge.first());
                if (next >= 0 && next <= edge.last()) continue;
                occupied.set(edge.first(), edge.last() + 1);
                routes.add(new Route(edge.prerequisite, edge.dependent, lane));
                break;
            }
        }
        return List.copyOf(routes);
    }

    private static String label(int prerequisites, int dependents, boolean accessible) {
        String needs = prerequisites == 0 ? "" : prerequisites + (prerequisites == 1 ? " prerequisite" : " prerequisites");
        String waiting = dependents == 0 ? "" : dependents + (accessible
            ? dependents == 1 ? " item waiting for this item" : " items waiting for this item" : " waiting");
        if (needs.isEmpty()) return waiting;
        return waiting.isEmpty() ? needs : needs + " · " + waiting;
    }
}
