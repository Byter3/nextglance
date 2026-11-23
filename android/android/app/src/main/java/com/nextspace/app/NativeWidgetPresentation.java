package com.nextspace.app;

import com.google.gson.*;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;

/** Pure presentation decisions. Membership, status and date selection remain in shared core. */
final class NativeWidgetPresentation {
    static final int ROW_LAYOUT_COUNT = 8;
    private static final int PLOT_UNIT = 4;
    static final int COMPACT_TIMELINE_AXIS_HEIGHT = 22;
    static final int COMPACT_TIMELINE_BAR_HEIGHT = 12;
    enum Style { SECTION, BOOKING, CARD, TASK, TIMELINE }
    record Layout(boolean narrow, boolean compact, boolean context, boolean overview, boolean timeline, int width) {}
    record Row(Style style, String title, String secondary, String leading, String trailing,
               boolean completed, boolean linked, String color, String accessible) {}
    record Tick(double offset, String label) {}
    record Range(double offset, double length) {}
    record Choices(List<String> ids, List<String> labels) {}
    record Timeline(NativeWidgetPlotLinks.Plan dependencies, List<Integer> rowTops, long chartBudget,
                    NativeWidgetWorkLayout.Columns columns, int titleWidth, int chartWidth,
                    int headerHeight, int groupHeight, int rowHeight, boolean alignedRaster) {
        boolean split() { return columns.split(); }
        int rowTop(int position) { return rowTops.get(position); }
    }
    record TimelineLabel(String source, String status, String due, boolean overdue, String secondary) {}

    static Timeline timeline(JsonObject snapshot, int width, float fontScale, long budget) {
        return timeline(snapshot, width, fontScale, budget, false);
    }

    static Timeline timeline(JsonObject snapshot, int width, float fontScale, long budget, boolean canSizeColumns) {
        JsonObject axis = NativeWidgetPolicy.object(snapshot, "timelineAxis");
        int days = NativeWidgetPolicy.array(axis, "ticks").size() - 1;
        var columns = NativeWidgetWorkLayout.columns(canSizeColumns ? width : 0, days, fontScale);
        int header = plotSize(NativeWidgetWorkLayout.dateHeadingHeight(fontScale));
        int group = plotSize(NativeWidgetWorkLayout.sectionHeight(fontScale));
        int row = plotSize(NativeWidgetWorkLayout.workRowHeight(fontScale));
        int chartWidth = columns.split() ? (width - columns.labelWidth()) / PLOT_UNIT * PLOT_UNIT : width;
        int titleWidth = columns.split() ? width - chartWidth - columns.statusWidth() - columns.dueWidth() : 0;
        List<NativeWidgetPlotLinks.Row> rows = new ArrayList<>();
        List<Integer> rowTops = new ArrayList<>();
        int itemCount = 0;
        int top = 0;
        for (JsonElement element : NativeWidgetPolicy.array(snapshot, "rows")) {
            JsonObject entry = element.isJsonObject() ? element.getAsJsonObject() : new JsonObject();
            boolean item = "item".equals(NativeWidgetPolicy.text(entry, "type", ""));
            int height = item ? row : group;
            rowTops.add(top);
            rows.add(new NativeWidgetPlotLinks.Row(item ? NativeWidgetDependencies.workId(entry) : "",
                range(NativeWidgetPolicy.object(entry, "timeline")), top + height / 2f));
            top += element.isJsonObject() ? height : 0;
            if (item) itemCount++;
        }
        long chartBudget = budget / (1 + (columns.split() ? rows.size() : itemCount));
        long minimumTile = 4L * (chartWidth / PLOT_UNIT) * (Math.max(row, header) / PLOT_UNIT);
        boolean alignedRaster = columns.split() && chartBudget >= minimumTile;
        var dependencies = NativeWidgetPlotLinks.plan(snapshot, rows, alignedRaster ? chartWidth : 0, fontScale);
        return new Timeline(dependencies, List.copyOf(rowTops), chartBudget, columns, titleWidth, chartWidth,
            header, group, row, alignedRaster);
    }

    private static int plotSize(int size) { return (size + PLOT_UNIT - 1) / PLOT_UNIT * PLOT_UNIT; }

    /** Use one exact raster scale across differently sized rows to avoid jogs at the seams. */
    static NativeWidgetChartLayout.Raster timelineRaster(Timeline timeline, int height, float density) {
        int width = timeline.chartWidth();
        long budget = timeline.chartBudget();
        if (!timeline.alignedRaster()) return NativeWidgetChartLayout.raster(width, height, density, budget);
        int tallest = Math.max(timeline.rowHeight(), timeline.headerHeight());
        double maximum = Math.sqrt(budget / (4.0 * width * tallest));
        int scale = Math.max(1, (int) Math.floor(PLOT_UNIT * Math.min(density, maximum)));
        return new NativeWidgetChartLayout.Raster(width / PLOT_UNIT * scale, height / PLOT_UNIT * scale);
    }

    static TimelineLabel timelineLabel(JsonObject row, boolean metadataColumns) {
        String source = NativeWidgetPolicy.text(row, "secondaryLabel", NativeWidgetPolicy.text(row, "subtitle", ""));
        String status = NativeWidgetPolicy.text(row, "statusLabel", "");
        String savedDue = NativeWidgetPolicy.text(row, "due", "");
        String oldLabel = savedDue.isBlank() ? "" : NativeWidgetPolicy.text(row, "dateLabel", "");
        String due = "event".equals(NativeWidgetPolicy.text(row, "kind", "")) ? "" : NativeWidgetPolicy.text(row, "trailingLabel", oldLabel);
        boolean overdue = due.startsWith("Overdue · ");
        String secondary = metadataColumns ? source : String.join(" · ", List.of(status, due, source).stream().filter(value -> !value.isBlank()).toList());
        return new TimelineLabel(source, status, overdue ? due.substring("Overdue · ".length()) : due, overdue, secondary);
    }

    static String timelineContext(String secondary, String dependencies) {
        if (secondary.isBlank()) return dependencies;
        return dependencies.isBlank() ? secondary : dependencies + " · " + secondary;
    }
    static int panelColor(boolean dark) { return dark ? 0xE61b2836 : 0xEBf6f9fc; }
    record Cluster(boolean parent, boolean child, boolean last, String title, String color, int count, String relationship) {
        static Cluster none() { return new Cluster(false, false, false, "", "", 0, ""); }
    }
    /** Adjacent projected rows form a visual plate; native code never selects or reparents work. */
    static Cluster cluster(JsonObject value, JsonObject snapshot, String page) {
        if (!"board".equals(page) || !"item".equals(NativeWidgetPolicy.text(value,"type",""))) return Cluster.none();
        String id=NativeWidgetPolicy.text(value,"recordId",""), parentId=NativeWidgetPolicy.text(value,"parentId","");
        JsonArray rows=NativeWidgetPolicy.array(snapshot,"rows"); int index=-1;
        for(int i=0;i<rows.size();i++)if(rows.get(i).isJsonObject()){
            JsonObject row=rows.get(i).getAsJsonObject();
            if(id.equals(NativeWidgetPolicy.text(row,"recordId",""))&&parentId.equals(NativeWidgetPolicy.text(row,"parentId",""))){index=i;break;}
        }
        if(index<0)return Cluster.none();
        int parent=index;
        if(!parentId.isEmpty()){
            while(parent>0&&rows.get(parent).isJsonObject()&&parentId.equals(NativeWidgetPolicy.text(rows.get(parent).getAsJsonObject(),"parentId","")))parent--;
        }
        if(!rows.get(parent).isJsonObject())return Cluster.none();
        JsonObject card=rows.get(parent).getAsJsonObject();
        if(!"card".equals(NativeWidgetPolicy.text(card,"kind",""))||!parentId.isEmpty()&&!parentId.equals(NativeWidgetPolicy.text(card,"recordId","")))return Cluster.none();
        String cardId=NativeWidgetPolicy.text(card,"recordId","");int end=parent+1;
        while(end<rows.size()&&rows.get(end).isJsonObject()&&cardId.equals(NativeWidgetPolicy.text(rows.get(end).getAsJsonObject(),"parentId","")))end++;
        int count=end-parent-1;if(count==0||index>=end)return Cluster.none();
        String relationship="outgoing".equals(NativeWidgetPolicy.text(value,"direction",""))?"Follow-up to":"Prerequisite for";
        return new Cluster(index==parent,index!=parent,index==end-1,NativeWidgetPolicy.text(card,"title",""),NativeWidgetPolicy.text(card,"color","#70bfce"),count,relationship);
    }
    static Choices calendarChoices(String page, String saved) {
        return "overview".equals(page)
            ? new Choices(List.of("day", Set.of("agenda", "month").contains(saved) ? saved : "week"), List.of("Today", "Week"))
            : new Choices(List.of("agenda", "day", "week", "month"), List.of("Agenda", "Today", "Week", "Month"));
    }

    static Layout layout(String page, int width, int height) {
        return new Layout(width < 240, height < 240, height >= 240 || "overview".equals(page), "overview".equals(page) && height >= 260,
            "timeline".equals(page), Math.max(104, width - (width < 240 && height < 240 ? 8 : 20)));
    }
    static boolean compactFooter(String page, int height) { return !"timeline".equals(page) || height >= 220; }
    static boolean monthAgenda(int height, int weeks) {
        return monthAgenda(height,weeks,1);
    }
    static boolean monthAgenda(int height,int weeks,float fontScale) {
        int itinerary=Math.round(100+Math.max(0,fontScale-1)*34);
        return height - (16 + 44 + 18 + 20 + (weeks + 1) * 44) >= itinerary;
    }
    static Row row(JsonObject value, String page, int contentWidth) {
        Row row = row(value, page);
        if (contentWidth >= 220 || row.style() == Style.SECTION || row.trailing().isEmpty()) return row;
        String secondary = row.trailing() + (row.secondary().isEmpty() ? "" : " \u00b7 " + row.secondary());
        return new Row(row.style(), row.title(), secondary, row.leading(), "", row.completed(), row.linked(), row.color(), row.accessible());
    }
    static Row row(JsonObject value, String page) {
        boolean section = "heading".equals(NativeWidgetPolicy.text(value, "type", ""));
        String kind = NativeWidgetPolicy.text(value, "kind", "task");
        Style style = section ? Style.SECTION : "timeline".equals(page) ? Style.TIMELINE
            : "event".equals(kind) ? Style.BOOKING : "card".equals(kind) ? Style.CARD : Style.TASK;
        String title = NativeWidgetPolicy.text(value, "title", "");
        String leading = NativeWidgetPolicy.text(value, "leadingLabel", "");
        String secondary = NativeWidgetPolicy.text(value, "secondaryLabel", NativeWidgetPolicy.text(value, "subtitle", ""));
        String trailing = section ? String.valueOf(NativeWidgetPolicy.number(value, "sectionCount", NativeWidgetPolicy.number(value, "subtitle", 0)))
            : NativeWidgetPolicy.text(value, "trailingLabel", "event".equals(kind) ? "" : NativeWidgetPolicy.text(value, "dateLabel", ""));
        boolean completed = NativeWidgetPolicy.flag(value, "completed", false);
        boolean linked = !section && "task".equals(kind) && !NativeWidgetPolicy.text(value, "parentId", "").isBlank();
        String status = NativeWidgetPolicy.text(value, "statusLabel", "");
        String day = NativeWidgetPolicy.text(value, "displayDay", "");
        if ((linked || style==Style.TIMELINE&&!"event".equals(kind)) && !status.isBlank())
            secondary = status + (secondary.isBlank() ? "" : " \u00b7 " + secondary);
        if(style==Style.TIMELINE)trailing=day.isBlank()?trailing:day;
        String accessible = List.of(title, day, leading, secondary, style==Style.TIMELINE&&trailing.equals(day)?"":trailing, completed ? "Completed" : "", linked ? "Linked task" : "").stream().filter(part -> !part.isBlank()).collect(java.util.stream.Collectors.joining(". "));
        return new Row(style, title, secondary, leading, trailing, completed, linked,
            NativeWidgetPolicy.text(value, "color", "#70bfce"), accessible);
    }
    static List<Tick> ticks(JsonObject axis) {
        List<Tick> result = new ArrayList<>();
        for (JsonElement value : NativeWidgetPolicy.array(axis, "ticks")) {
            if (!value.isJsonObject()) continue;
            try {
                double offset = value.getAsJsonObject().get("offset").getAsDouble();
                if (Double.isFinite(offset) && offset >= 0 && offset <= 100)
                    result.add(new Tick(offset, NativeWidgetPolicy.text(value.getAsJsonObject(), "label", "")));
            } catch (Exception ignored) { }
        }
        return result;
    }
    static List<Tick> labeledTicks(List<Tick> ticks, int width) {
        return compactLabels(dateLabels(ticks), width);
    }
    private static List<Tick> dateLabels(List<Tick> ticks) {
        // The final boundary remains available for shading and bar alignment in legacy snapshots too.
        return ticks.stream().filter(tick -> tick.offset() < 100 && !tick.label().isBlank()).toList();
    }
    private static List<Tick> compactLabels(List<Tick> ticks, int width) {
        if (ticks.size() < 3) return ticks;
        List<Tick> labels = new ArrayList<>(List.of(ticks.get(0)));
        if (width >= 240) labels.add(ticks.stream().min(Comparator.comparingDouble(t -> Math.abs(t.offset() - 50))).orElse(ticks.get(0)));
        labels.add(ticks.get(ticks.size() - 1));
        return labels;
    }
    static List<Tick> labeledTicks(List<Tick> ticks, int width, float fontScale) {
        ticks=dateLabels(ticks);
        if (ticks.size() < 3 || width < 320) return compactLabels(ticks, Math.round(width / Math.max(1, fontScale)));
        double spacing = 88 * Math.max(1, fontScale); List<Tick> labels = new ArrayList<>();
        Tick first = ticks.get(0), last = ticks.get(ticks.size() - 1); labels.add(first);
        for (int i = 1; i < ticks.size() - 1; i++) {
            Tick tick = ticks.get(i);
            if (position(tick.offset, width) - position(labels.get(labels.size() - 1).offset, width) >= spacing && position(last.offset, width) - position(tick.offset, width) >= spacing) labels.add(tick);
        }
        labels.add(last); return labels;
    }
    static Range range(JsonObject value) {
        try {
            double offset = value.get("offset").getAsDouble(), length = value.get("length").getAsDouble();
            if (!Double.isFinite(offset) || !Double.isFinite(length)) return new Range(0, 0);
            offset = Math.max(0, Math.min(100, offset));
            return new Range(offset, Math.max(0, Math.min(100 - offset, length)));
        } catch (Exception ignored) { return new Range(0, 0); }
    }
    static double position(double offset, int width) { return Math.max(0, Math.min(100, offset)) * Math.max(0, width - 2) / 100.0 + 1; }
    static String compactFreshness(JsonObject snapshot, Locale locale, ZoneId zone) {
        String source = shortStamp(NativeWidgetPolicy.text(snapshot, "sourceVerifiedAt", ""), locale, zone);
        String metadata = shortStamp(NativeWidgetPolicy.text(snapshot, "metadataVerifiedAt", ""), locale, zone);
        return "Data " + source + " \u00b7 Space " + metadata;
    }
    private static String shortStamp(String stamp, Locale locale, ZoneId zone) {
        try { return DateTimeFormatter.ofPattern("MMM d HH:mm", locale).withZone(zone).format(Instant.parse(stamp)); }
        catch (Exception ignored) { return "unchecked"; }
    }
}
