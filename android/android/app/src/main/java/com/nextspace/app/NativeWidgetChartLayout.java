package com.nextspace.app;

import com.google.gson.*;
import java.util.*;

/** Pure pixel-independent chart layout. Shared projection owns all membership and calendar semantics. */
final class NativeWidgetChartLayout {
    static final int MAX_BITMAP_BYTES = 2 * 1024 * 1024;
    private static final int MIN_WORK_TARGET_HEIGHT = 32;
    record Size(int width, int height) {}
    record Chrome(int content, int work, int calendar, boolean context, boolean footer) {}
    record Rect(double x, double y, double width, double height) {
        boolean intersects(Rect other) { return x < other.x + other.width && other.x < x + width && y < other.y + other.height && other.y < y + height; }
        boolean actionable() { return width >= 44 && height >= 44; }
    }
    record Mark(String recordId, String title, String color, String kind, Rect rect, boolean point) {}
    record Day(String date, String label, boolean today, Rect rect) {}
    record Rule(double y, String label) {}
    record OverviewLine(JsonObject row, int y, int height, boolean heading) {}
    record OverviewPlan(int header, List<OverviewLine> lines, int hidden, boolean details, boolean columns,
                        NativeWidgetWorkLayout.Columns workColumns) {}
    record OverviewDetail(String source, String status, String dates) {
        String inline() { return String.join(" · ", List.of(status, dates, source).stream().filter(value -> !value.isBlank()).toList()); }
    }
    record Grid(int width, int height, double gutter, double header, double timedTop, List<Day> days,
                List<Rule> hours, List<Mark> marks, int hiddenAllDay, String label) {}
    record Raster(int width, int height) { long bytes() { return (long) width * height * 4; } }
    record Fit(double scale, double x, double y) {
        Rect map(Rect value) { return new Rect(x + value.x * scale, y + value.y * scale, value.width * scale, value.height * scale); }
    }

    static List<Size> sizes(List<Size> supplied, Size fallback) {
        LinkedHashSet<Size> unique = new LinkedHashSet<>();
        for (Size size : supplied) if (size.width >= 80 && size.height >= 80 && size.width <= 4096 && size.height <= 4096) unique.add(size);
        if (unique.isEmpty()) unique.add(new Size(Math.max(80, Math.min(4096, fallback.width)), Math.max(80, Math.min(4096, fallback.height))));
        Comparator<Size> area = Comparator.comparingLong(s -> (long) s.width * s.height);
        List<Size> ordered = unique.stream().sorted(area).toList();
        if (ordered.size() <= 4) return ordered;
        LinkedHashSet<Size> selected = new LinkedHashSet<>();
        selected.add(ordered.get(0)); selected.add(ordered.get(ordered.size() - 1));
        selected.add(ordered.stream().min(Comparator.comparingDouble(s -> s.width / (double) s.height)).orElseThrow());
        selected.add(ordered.stream().max(Comparator.comparingDouble(s -> s.width / (double) s.height)).orElseThrow());
        while (selected.size() < 4) selected.add(ordered.stream().filter(s -> !selected.contains(s)).max(Comparator.comparingDouble(s -> selected.stream().mapToDouble(chosen -> Math.hypot(Math.log(s.width / (double) chosen.width), Math.log(s.height / (double) chosen.height))).min().orElse(0))).orElseThrow());
        return selected.stream().sorted(area).toList();
    }
    static Size legacySize(boolean landscape, int minWidth, int minHeight, int maxWidth, int maxHeight) {
        return new Size(Math.max(80, landscape ? maxWidth : minWidth), Math.max(80, landscape ? minHeight : maxHeight));
    }
    static int contentWidth(int width) { return Math.max(1, width - (width < 240 ? 8 : 20)); }
    static Chrome chrome(String page, int height) {
        return chrome(page, height, 1);
    }
    static Chrome chrome(String page, int height, float fontScale) {
        boolean secondaryFits = fontScale <= 1.35f;
        boolean context = height >= 300 && secondaryFits, footer = height >= 240 && secondaryFits;
        int content = Math.max(1, height - 60 - (context ? 20 : 0) - (footer ? 18 : 0));
        int work = "overview".equals(page) && content >= 68 ? Math.min(content - 44, Math.round(content * .45f)) : 0;
        return new Chrome(content, work, content - work, context, footer);
    }
    static Raster raster(int widthDp, int heightDp, double density, long budget) {
        int width = Math.max(1, widthDp), height = Math.max(1, heightDp);
        double pixels = Math.max(1, budget / 4), safeDensity = Double.isFinite(density) ? Math.max(0.25, Math.min(8, density)) : 1;
        double scale = Math.min(safeDensity, Math.sqrt(pixels / (width * (double) height)));
        int rasterWidth = Math.max(1, (int) Math.floor(width * scale)), rasterHeight = Math.max(1, (int) Math.floor(height * scale));
        // Extreme aspect ratios may round the shorter dimension up to one pixel.
        if ((long) rasterWidth * rasterHeight > pixels) {
            if (rasterWidth > rasterHeight) rasterWidth = Math.max(1, (int) Math.floor(pixels / rasterHeight));
            else rasterHeight = Math.max(1, (int) Math.floor(pixels / rasterWidth));
        }
        return new Raster(rasterWidth, rasterHeight);
    }
    static Fit fit(double sourceWidth, double sourceHeight, double targetWidth, double targetHeight) {
        double width = Math.max(1, sourceWidth), height = Math.max(1, sourceHeight);
        double scale = Math.min(Math.max(0, targetWidth) / width, Math.max(0, targetHeight) / height);
        return new Fit(scale, (targetWidth - width * scale) / 2, (targetHeight - height * scale) / 2);
    }
    /** The exact composition of uniform Canvas rasterization followed by ImageView FIT_CENTER. */
    static Fit displayFit(int width, int height, Raster raster, int viewportWidth, int viewportHeight) {
        Fit draw = fit(width, height, raster.width, raster.height), display = fit(raster.width, raster.height, viewportWidth, viewportHeight);
        return new Fit(draw.scale * display.scale, display.x + draw.x * display.scale, display.y + draw.y * display.scale);
    }
    static Rect target(Rect rect, Fit fit, double density) {
        Rect mapped = fit.map(rect); double pixel = Double.isFinite(density) && density > 0 ? density : 1;
        double left = Math.ceil(mapped.x * pixel - 1e-7) / pixel, top = Math.ceil(mapped.y * pixel - 1e-7) / pixel;
        double right = Math.floor((mapped.x + mapped.width) * pixel + 1e-7) / pixel, bottom = Math.floor((mapped.y + mapped.height) * pixel + 1e-7) / pixel;
        return new Rect(left, top, Math.max(0, right - left), Math.max(0, bottom - top));
    }
    static long bitmapBudget(int screenWidth, int screenHeight) {
        // Leave half the platform ceiling for icon artwork and non-chart content.
        return Math.max(4, Math.min(MAX_BITMAP_BYTES, 3L * Math.max(1, screenWidth) * Math.max(1, screenHeight)));
    }
    static boolean gridPage(String page, JsonObject config, JsonObject snapshot) {
        String mode = NativeWidgetPolicy.text(config, "calendarLayout", "week");
        return !NativeWidgetPolicy.object(snapshot, "calendarGrid").isEmpty() && ("overview".equals(page) || "calendar".equals(page) && Set.of("day", "week").contains(mode));
    }
    static List<JsonObject> overviewRows(JsonObject snapshot) {
        Set<String> ids = new HashSet<>();
        for (JsonElement value : NativeWidgetPolicy.array(snapshot, "overviewRangeIds")) if (value.isJsonPrimitive()) ids.add(value.getAsString());
        List<JsonObject> rows = new ArrayList<>(); List<String> headings = new ArrayList<>();
        for (JsonElement value : NativeWidgetPolicy.array(snapshot, "rows")) if (value.isJsonObject()) {
            JsonObject row = value.getAsJsonObject();
            if ("heading".equals(NativeWidgetPolicy.text(row, "type", ""))) {
                int depth = Math.min(20, Math.max(0, NativeWidgetPolicy.number(row, "depth", 0)));
                while (headings.size() > depth) headings.remove(headings.size() - 1);
                headings.add(NativeWidgetPolicy.text(row, "title", ""));
            } else if (ids.contains(NativeWidgetPolicy.text(row, "recordId", ""))) {
                JsonObject presented = row.deepCopy(); presented.addProperty("presentationGroup", String.join(" / ", headings)); rows.add(presented);
            }
        }
        return rows;
    }
    static List<JsonObject> overviewEntries(JsonObject snapshot) {
        return overviewEntries(overviewRows(snapshot));
    }
    private static List<JsonObject> overviewEntries(List<JsonObject> rows) {
        List<JsonObject> entries=new ArrayList<>();String previous="";
        for(JsonObject row:rows){
            String group=NativeWidgetPolicy.text(row,"presentationGroup","");
            if(!group.isBlank()&&!group.equals(previous)){
                JsonObject heading=new JsonObject();heading.addProperty("type","presentationHeading");heading.addProperty("title",group);entries.add(heading);
            }
            entries.add(row);previous=group;
        }
        return entries;
    }
    private static List<JsonObject> splitOverviewEntries(JsonObject snapshot) {
        Set<String> ids = new HashSet<>();
        for (JsonElement value : NativeWidgetPolicy.array(snapshot, "overviewRangeIds")) {
            if (value.isJsonPrimitive()) ids.add(value.getAsString());
        }
        List<JsonObject> entries = new ArrayList<>();
        List<JsonObject> ancestors = new ArrayList<>();
        Set<JsonObject> shown = Collections.newSetFromMap(new IdentityHashMap<>());
        for (JsonElement value : NativeWidgetPolicy.array(snapshot, "rows")) {
            if (!value.isJsonObject()) continue;
            JsonObject row = value.getAsJsonObject();
            if ("heading".equals(NativeWidgetPolicy.text(row, "type", ""))) {
                int depth = NativeWidgetPolicy.number(row, "depth", 0);
                while (!ancestors.isEmpty() && NativeWidgetPolicy.number(ancestors.get(ancestors.size() - 1), "depth", 0) >= depth) {
                    ancestors.remove(ancestors.size() - 1);
                }
                ancestors.add(row);
            } else if (ids.contains(NativeWidgetPolicy.text(row, "recordId", ""))) {
                for (JsonObject ancestor : ancestors) {
                    if (!shown.add(ancestor)) continue;
                    JsonObject heading = ancestor.deepCopy();
                    heading.addProperty("type", "presentationHeading");
                    entries.add(heading);
                }
                entries.add(row);
            }
        }
        return entries;
    }
    static OverviewDetail overviewDetail(JsonObject row) {
        boolean event = "event".equals(NativeWidgetPolicy.text(row, "kind", ""));
        String source = NativeWidgetPolicy.text(row, "secondaryLabel", NativeWidgetPolicy.text(row, "subtitle", ""));
        String status = event ? NativeWidgetPolicy.text(row, "leadingLabel", "") : NativeWidgetPolicy.text(row, "statusLabel", "");
        String dates = NativeWidgetPolicy.text(row, "displayDay", NativeWidgetPolicy.text(row, "trailingLabel", ""));
        return new OverviewDetail(source, status, dates);
    }
    static OverviewPlan overviewPlan(JsonObject snapshot,int width,int height,float fontScale) {
        JsonObject calendarGrid = NativeWidgetPolicy.object(snapshot, "calendarGrid");
        int days = Math.min(7, NativeWidgetPolicy.array(calendarGrid, "days").size());
        return overviewPlan(snapshot, width, height, fontScale, NativeWidgetWorkLayout.columns(width, days, fontScale));
    }
    private static OverviewPlan overviewPlan(JsonObject snapshot, int width, int height, float fontScale,
                                             NativeWidgetWorkLayout.Columns workColumns) {
        List<JsonObject> rows=overviewRows(snapshot);
        List<JsonObject> entries=height>=88*fontScale?(workColumns.split()?splitOverviewEntries(snapshot):overviewEntries(rows)):rows;
        boolean details=width>=180*fontScale&&height>=76*fontScale;
        boolean columns=workColumns.split()?workColumns.metadataColumns():details&&width>=420*fontScale;
        int rowHeight=NativeWidgetWorkLayout.workRowHeight(fontScale);
        int headingHeight=NativeWidgetWorkLayout.sectionHeight(fontScale);
        int dateHeadingHeight=NativeWidgetWorkLayout.dateHeadingHeight(fontScale);
        int header=height>=rowHeight+dateHeadingHeight?dateHeadingHeight:0;
        int moreHeight=Math.round(13*fontScale);
        boolean more=entries.stream().mapToInt(row->"presentationHeading".equals(NativeWidgetPolicy.text(row,"type",""))?headingHeight:rowHeight).sum()>height-header;
        int bottom=height-(more&&height>=header+rowHeight+moreHeight?moreHeight:0),top=header,shown=0;List<OverviewLine> lines=new ArrayList<>();
        for(int index=0;index<entries.size();index++){
            JsonObject row=entries.get(index);
            boolean heading="presentationHeading".equals(NativeWidgetPolicy.text(row,"type",""));
            if (heading) {
                int end = index + 1;
                while (end < entries.size() && "presentationHeading".equals(NativeWidgetPolicy.text(entries.get(end), "type", ""))) end++;
                if (top + (end - index) * headingHeight + rowHeight > bottom) {
                    if (shown > 0) break;
                    index = end - 1;
                    continue;
                }
            }
            if(!heading&&shown>0&&top+rowHeight>bottom)break;
            int size=Math.min(heading?headingHeight:rowHeight,Math.max(0,height-top));if(size==0)break;
            lines.add(new OverviewLine(row,top,size,heading));top+=size;if(!heading)shown++;
        }
        return new OverviewPlan(header,List.copyOf(lines),rows.size()-shown,details,columns,workColumns);
    }
    static List<Mark> overviewActionable(JsonObject snapshot, Grid grid, int workHeight, float fontScale, Fit fit, double density) {
        if (workHeight <= 0) return List.of();
        OverviewPlan plan = overviewPlan(snapshot, grid.width, workHeight, fontScale);
        double start = plan.workColumns.split() ? 0 : grid.gutter;
        return plan.lines.stream().filter(line -> !line.heading)
            .map(line -> mark(line.row, target(new Rect(start,line.y,grid.width-start,line.height),fit,density), false))
            .filter(mark -> mark.rect.width >= 44 && mark.rect.height >= MIN_WORK_TARGET_HEIGHT && !mark.recordId.isBlank()).toList();
    }
    static NativeWidgetPlotLinks.Plan overviewDependencies(JsonObject snapshot, OverviewPlan layout, int width, float fontScale) {
        int gutter = layout.workColumns.split() ? layout.workColumns.labelWidth() : timeGutter(width);
        List<NativeWidgetPlotLinks.Row> rows = layout.lines.stream().map(line -> new NativeWidgetPlotLinks.Row(
            line.heading || line.height < 9 ? "" : NativeWidgetDependencies.workId(line.row),
            NativeWidgetPresentation.range(NativeWidgetPolicy.object(line.row, "timeline")),
            overviewRangeCenter(line, layout.workColumns.split()))).toList();
        return NativeWidgetPlotLinks.plan(snapshot, rows, width - gutter, fontScale);
    }
    static float overviewRangeCenter(OverviewLine line, boolean split) {
        return split ? line.y + line.height / 2f : line.y + line.height - 4.5f;
    }
    private static int timeGutter(int width) { return width < 220 ? 24 : 36; }
    static Grid grid(JsonObject value, int width, int height, boolean overview) {
        return grid(value, width, height, overview, 1f);
    }
    static Grid grid(JsonObject value, int width, int height, boolean overview, float fontScale) {
        JsonArray sourceDays = NativeWidgetPolicy.array(value, "days");
        int dayCount = Math.max(1, Math.min(7, sourceDays.size()));
        var columns = overview ? NativeWidgetWorkLayout.columns(width, Math.min(7, sourceDays.size()), fontScale) : NativeWidgetWorkLayout.COMPACT;
        double gutter = columns.split() ? columns.labelWidth() : timeGutter(width);
        double header = height >= 200 ? 46 : height >= 90 ? 26 : 18;
        double column = Math.max(1, (width - gutter) / dayCount);
        int suppliedLanes = Math.max(0, NativeWidgetPolicy.number(value, "allDayLanes", 0));
        int visibleLanes = overview ? 0 : Math.min(suppliedLanes, height >= 140 ? 2 : height >= 80 ? 1 : 0);
        double allDayHeight = visibleLanes * 18.0, timedTop = header + allDayHeight;
        double timedHeight = Math.max(1, height - timedTop - 2);
        double start = Math.max(0, Math.min(23, number(value, "hourStart", 8))) * 60;
        double end = Math.max(start + 60, Math.min(1440, number(value, "hourEnd", 18) * 60));
        List<Day> days = new ArrayList<>();
        for (int i = 0; i < dayCount; i++) {
            JsonObject day = i < sourceDays.size() && sourceDays.get(i).isJsonObject() ? sourceDays.get(i).getAsJsonObject() : new JsonObject();
            days.add(new Day(NativeWidgetPolicy.text(day, "date", ""), NativeWidgetPolicy.text(day, "label", ""), NativeWidgetPolicy.flag(day, "today", false), new Rect(gutter + i * column, 0, column, header)));
        }
        List<Rule> rules = new ArrayList<>();
        for (JsonElement element : NativeWidgetPolicy.array(value, "ticks")) if (element.isJsonObject()) {
            JsonObject tick = element.getAsJsonObject(); double minute = number(tick, "minute", -1);
            if (minute >= start && minute <= end) rules.add(new Rule(timedTop + (minute - start) / (end - start) * timedHeight, NativeWidgetPolicy.text(tick, "label", "")));
        }
        List<Mark> marks = new ArrayList<>(); int examined = 0, hidden = 0;
        for (JsonElement element : NativeWidgetPolicy.array(value, "allDay")) if (element.isJsonObject() && examined++ < 175) {
            JsonObject item = element.getAsJsonObject(); int lane = NativeWidgetPolicy.number(item, "lane", 0);
            if (lane < 0 || lane >= visibleLanes) { hidden++; continue; }
            double first = clamp(number(item, "startDay", 0), 0, dayCount), last = clamp(number(item, "endDay", first), first, dayCount);
            if (last > first) marks.add(mark(item, new Rect(gutter + first * column + 1, header + lane * 18 + 1, Math.max(1, (last - first) * column - 2), 16), false));
        }
        examined = 0;
        for (JsonElement element : NativeWidgetPolicy.array(value, "timed")) if (element.isJsonObject() && examined++ < 175) {
            JsonObject item = element.getAsJsonObject(); int day = NativeWidgetPolicy.number(item, "dayIndex", -1);
            int laneCount = Math.max(1, NativeWidgetPolicy.number(item, "laneCount", 1)), lane = NativeWidgetPolicy.number(item, "lane", 0);
            if (day < 0 || day >= dayCount || lane < 0 || lane >= laneCount) continue;
            double from = clamp(number(item, "startMinute", start), start, end), to = clamp(number(item, "endMinute", from), from, end);
            boolean point = NativeWidgetPolicy.flag(item, "point", false);
            if (to <= from && !point) continue;
            double y = timedTop + (from - start) / (end - start) * timedHeight;
            double h = point ? Math.min(3, height - y) : Math.max(1, (to - from) / (end - start) * timedHeight);
            double laneWidth = column / laneCount, inset = Math.min(1, laneWidth / 4);
            marks.add(mark(item, new Rect(gutter + (day + lane / (double) laneCount) * column + inset, y, laneWidth - inset * 2, h), point));
        }
        return new Grid(width, height, gutter, header, timedTop, List.copyOf(days), List.copyOf(rules), List.copyOf(marks), hidden, NativeWidgetPolicy.text(value, "label", "Calendar"));
    }
    static List<Mark> actionable(Grid grid) {
        return grid.marks.stream().filter(mark -> mark.rect.actionable() && !mark.recordId.isBlank()
            && grid.marks.stream().noneMatch(other -> other != mark && mark.rect.intersects(other.rect))).toList();
    }
    static List<Mark> actionable(Grid grid, Fit fit, double density) {
        return actionable(grid,fit,density,0);
    }
    static List<Mark> actionable(Grid grid, Fit fit, double density, int verticalOffset) {
        return actionable(grid).stream().map(mark -> new Mark(mark.recordId, mark.title, mark.color, mark.kind, target(new Rect(mark.rect.x,mark.rect.y+verticalOffset,mark.rect.width,mark.rect.height), fit, density), mark.point)).filter(mark -> mark.rect.actionable()).toList();
    }
    private static Mark mark(JsonObject value, Rect rect, boolean point) {
        return new Mark(NativeWidgetPolicy.text(value, "recordId", ""), NativeWidgetPolicy.text(value, "title", ""), NativeWidgetPolicy.text(value, "color", "#70bfce"), NativeWidgetPolicy.text(value, "kind", "event"), rect, point);
    }
    private static double number(JsonObject value, String name, double fallback) { try { double result = value.get(name).getAsDouble(); return Double.isFinite(result) ? result : fallback; } catch (Exception ignored) { return fallback; } }
    private static double clamp(double value, double min, double max) { return Math.max(min, Math.min(max, value)); }
}
