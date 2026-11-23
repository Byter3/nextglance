package com.nextspace.app;

import com.google.gson.JsonObject;
import java.util.List;

/** Shared work-bar bounds and dependency paths in logical date-plot coordinates. */
final class NativeWidgetPlotLinks {
    private static final float EDGE_PADDING = 6;
    private static final float ENTRY_LENGTH = 5;
    private static final float MIN_PLOT_WIDTH = 36;

    record Row(String id, NativeWidgetPresentation.Range range, float centerY) {}
    record Bounds(float left, float right) {
        boolean visible() { return right > left; }
    }
    record Point(float x, float y) {}
    record Route(int prerequisiteRow, int dependentRow, List<Point> points) {
        Point start() { return points.get(0); }
        Point end() { return points.get(points.size() - 1); }
        boolean crosses(float top, float height) {
            return Math.max(start().y, end().y) + 3 >= top && Math.min(start().y, end().y) - 3 <= top + height;
        }
    }
    record Plan(List<Route> routes, NativeWidgetDependencies.Plan dependencies) {
        String fallback(int index) { return dependencies.fallback(index); }
        String description(int index) { return dependencies.description(index); }
    }

    static Bounds bounds(NativeWidgetPresentation.Range range, int plotWidth) {
        if (plotWidth < 2 * EDGE_PADDING + 1 || range.length() <= 0) return new Bounds(0, 0);
        float left = (float) (range.offset() * plotWidth / 100);
        float right = (float) ((range.offset() + range.length()) * plotWidth / 100);
        left = Math.max(EDGE_PADDING, Math.min(plotWidth - EDGE_PADDING - 1, left + 1));
        right = Math.min(plotWidth - EDGE_PADDING, Math.max(left + 1, right - 1));
        return new Bounds(left, right);
    }

    static Plan plan(JsonObject snapshot, List<Row> rows, int plotWidth, float fontScale) {
        List<String> ids = rows.stream().map(Row::id).toList();
        List<Bounds> bars = rows.stream().map(row -> bounds(row.range, plotWidth)).toList();
        boolean plotFits = plotWidth >= MIN_PLOT_WIDTH * Math.max(1, fontScale);
        var dependencies = NativeWidgetDependencies.plan(snapshot, ids, (prerequisite, dependent) ->
            plotFits && bars.get(prerequisite).visible() && bars.get(dependent).visible()
                && Math.abs(rows.get(prerequisite).centerY - rows.get(dependent).centerY) >= 8);
        List<Route> routes = dependencies.routes().stream().map(edge -> route(edge, rows, bars, plotWidth)).toList();
        return new Plan(routes, dependencies);
    }

    private static Route route(NativeWidgetDependencies.Route edge, List<Row> rows, List<Bounds> bars,
                               int plotWidth) {
        int from = edge.prerequisiteRow(), to = edge.dependentRow();
        float x1 = bars.get(from).right, x2 = bars.get(to).left;
        float y1 = rows.get(from).centerY, y2 = rows.get(to).centerY;
        float exit = Math.min(plotWidth - 1, x1 + ENTRY_LENGTH + edge.lane() * 2);
        float entry = Math.max(1, x2 - ENTRY_LENGTH - edge.lane() * 2);
        float turn = y1 + Math.copySign(Math.min(Math.abs(y2 - y1) / 2, 9 + edge.lane() * 3), y2 - y1);
        return new Route(from, to, List.of(new Point(x1, y1), new Point(exit, y1), new Point(exit, turn),
            new Point(entry, turn), new Point(entry, y2), new Point(x2, y2)));
    }
}
