package com.nextspace.app;

import android.graphics.*;
import android.text.*;
import android.util.LruCache;
import com.google.gson.*;
import java.util.*;

/** Bounded native painting. Shared snapshots own membership, dates, lanes and completion. */
final class NativeWidgetCharts {
    private static final Typeface MEDIUM = Typeface.create("sans-serif-medium", Typeface.NORMAL);
    private static final LruCache<String,Bitmap> CACHE = new LruCache<>(4 * 1024 * 1024) {
        @Override protected int sizeOf(String key, Bitmap value) { return value.getAllocationByteCount(); }
    };
    /** Overview uses one raster and one transform for both regions, including their common day axis. */
    static synchronized Bitmap calendar(JsonObject snapshot, NativeWidgetChartLayout.Grid grid, int workHeight, NativeWidgetChartLayout.Raster size, boolean dark, float fontScale, int weekendMask) {
        int height = grid.height() + workHeight;
        String key = key("calendar:" + weekendMask + ':' + workHeight, snapshot, grid.width(), height, size, dark, fontScale);
        Bitmap saved = CACHE.get(key); if (saved != null) return saved;
        Bitmap image = image(size); Canvas canvas = canvas(image, grid.width(), height); TextPaint paint = paint();
        boolean overview = workHeight > 0;
        boolean split = false;
        if (overview) {
            var work = NativeWidgetChartLayout.overviewPlan(snapshot, grid.width(), workHeight, fontScale);
            split = work.workColumns().split();
            if (split) paintSplitRanges(canvas, paint, snapshot, grid, work, workHeight, dark, fontScale, weekendMask);
            else paintRanges(canvas, paint, snapshot, grid, work, workHeight, dark, fontScale, weekendMask);
            canvas.translate(0, workHeight);
        }
        int bookings = NativeWidgetPolicy.number(NativeWidgetPolicy.object(snapshot, "overview"), "bookings", 0);
        paintCalendar(canvas, paint, grid, dark, fontScale, weekendMask, overview, split, bookings);
        CACHE.put(key, image); return image;
    }
    private static void paintCalendar(Canvas canvas, TextPaint paint, NativeWidgetChartLayout.Grid grid, boolean dark, float fontScale,
                                      int weekendMask, boolean overview, boolean split, int bookings) {
        int ink = color(dark ? "#eff4fb" : "#243044"), muted = color(dark ? "#bacbdc" : "#526579"), blue = color(dark ? "#41b5f4" : "#0076b5");
        canvas.save(); canvas.clipRect(0, 0, grid.width(), grid.height());
        paint.setColor(NativeWidgetPresentation.panelColor(dark)); canvas.drawRoundRect(0, 0, grid.width(), grid.height(), 8, 8, paint);
        if (split) {
            clipRoundedPanel(canvas, grid.width(), grid.height());
            paint.setColor(labelTint(dark));
            canvas.drawRect(0, 0, (float) grid.gutter(), grid.height(), paint);
            paint.setColor(headerTint(dark));
            canvas.drawRect(0, 0, (float) grid.gutter(), (float) grid.header(), paint);
            paint.setColor(ink); paint.setTypeface(MEDIUM); paint.setTextSize(11 * fontScale);
            boolean countFits = grid.header() >= 35 * fontScale;
            text(canvas, paint, "Calendar", 8, (float) grid.header() / 2 + (countFits ? -2 : 4) * fontScale, (float) grid.gutter() - 16);
            if (countFits) {
                paint.setColor(muted); paint.setTypeface(Typeface.DEFAULT); paint.setTextSize(9 * fontScale);
                text(canvas, paint, bookings + (bookings == 1 ? " booking" : " bookings"), 8, (float) grid.header() / 2 + 11 * fontScale, (float) grid.gutter() - 16);
            }
        }
        paint.setColor(NativeWeekend.OVERLAY);
        for (var day : grid.days()) if (NativeWeekend.contains(day.date(), weekendMask)) canvas.drawRect((float) day.rect().x(), 0, (float) (day.rect().x() + day.rect().width()), grid.height(), paint);
        for (var day : grid.days()) {
            var rect = day.rect(); paint.setColor(day.today() ? (blue & 0xffffff) | 0x20000000 : color(dark ? "#08ffffff" : "#0b243044"));
            canvas.drawRect((float) rect.x(), 0, (float) (rect.x() + rect.width()), (float) rect.height(), paint);
            paint.setColor(day.today() ? blue : muted); paint.setTypeface(MEDIUM); paint.setTextSize(11 * fontScale);
            String label = rect.width() < 64 * fontScale && day.date().matches("\\d{4}-\\d{2}-\\d{2}") ? day.date().substring(8) : day.label();
            if(rect.height()>=42*fontScale&&rect.width()>=30*fontScale){
                try{
                    var date=java.time.LocalDate.parse(day.date());
                    paint.setTextSize(9*fontScale);centered(canvas,paint,date.getDayOfWeek().getDisplayName(java.time.format.TextStyle.SHORT,Locale.getDefault()),rect.x()+2,2,rect.width()-4,15*fontScale);
                    paint.setTextSize(15*fontScale);centered(canvas,paint,String.valueOf(date.getDayOfMonth()),rect.x()+2,17*fontScale,rect.width()-4,rect.height()-18*fontScale);
                }catch(Exception ignored){centered(canvas,paint,label,rect.x()+3,0,rect.width()-6,rect.height());}
            }else centered(canvas, paint, label, rect.x() + 3, 0, rect.width() - 6, rect.height());
            if (day.today()) { paint.setStrokeWidth(2); canvas.drawLine((float) rect.x() + 1, (float) rect.height() - 1, (float) (rect.x() + rect.width()) - 1, (float) rect.height() - 1, paint); }
        }
        paint.setTypeface(Typeface.DEFAULT); paint.setStrokeWidth(.6f); paint.setColor(color(dark ? "#20ffffff" : "#20243044"));
        for (var day : grid.days()) canvas.drawLine((float) day.rect().x(), 0, (float) day.rect().x(), grid.height(), paint);
        double lastLabel = -100; paint.setTextSize(9 * fontScale);
        if (overview && !split && grid.gutter() >= 36 && grid.header() >= 26) { paint.setColor(muted); paint.setTextSize(8 * fontScale); centered(canvas, paint, "Time", 1, 0, grid.gutter() - 3, grid.header()); }
        for (var hour : grid.hours()) {
            float y = (float) hour.y(); paint.setColor(color(dark ? "#1affffff" : "#1c243044")); canvas.drawLine((float) grid.gutter(), y, grid.width(), y, paint);
            paint.setTextSize(9 * fontScale); float line = paint.getFontMetrics().descent - paint.getFontMetrics().ascent;
            if (hour.y() - lastLabel >= line + 5 && y + line < grid.height()) {
                paint.setColor(muted);
                float left = split ? Math.max(4, (float) grid.gutter() - 5 - paint.measureText(hour.label())) : 2;
                text(canvas, paint, hour.label(), left, y - paint.getFontMetrics().ascent + 2, (float) grid.gutter() - left - 3);
                lastLabel = hour.y();
            }
        }
        for (var mark : grid.marks()) {
            var rect = mark.rect(); int accent = color(mark.color());
            canvas.save(); canvas.clipRect((float) rect.x(), (float) rect.y(), (float) (rect.x() + rect.width()), (float) (rect.y() + rect.height()));
            paint.setColor((accent & 0xffffff) | (dark ? 0x85000000 : 0x55000000));
            canvas.drawRoundRect((float) rect.x(), (float) rect.y(), (float) (rect.x() + rect.width()), (float) (rect.y() + rect.height()), 4, 4, paint);
            paint.setColor(accent); canvas.drawRect((float) rect.x(), (float) rect.y(), (float) rect.x() + 2, (float) (rect.y() + rect.height()), paint);
            if (rect.width() >= 32) {
                paint.setColor(ink); paint.setTypeface(MEDIUM); paint.setTextSize((rect.width() > 120 ? 12 : 11) * fontScale);
                textBlock(canvas, paint, mark.title(), (float) rect.x() + 5, (float) rect.y() + 1, (float) rect.width() - 8, (float) rect.height() - 2, 3);
            }
            canvas.restore();
        }
        paint.setTypeface(Typeface.DEFAULT);
        String open = overview ? "open Overview" : "open Calendar";
        if (grid.marks().isEmpty()) {
            paint.setColor(muted); paint.setTextSize(11 * fontScale);
            String message = grid.hiddenAllDay() > 0 ? "All-day items · " + open : "No items in this period";
            textBlock(canvas, paint, message, (float) grid.gutter() + 6, (float) grid.timedTop() + 5, grid.width() - (float) grid.gutter() - 12, grid.height() - (float) grid.timedTop() - 8, 2);
        }
        if (!grid.marks().isEmpty() && grid.hiddenAllDay() > 0 && grid.height() >= 68) {
            paint.setColor(muted); paint.setTextSize(9 * fontScale);
            text(canvas, paint, "+" + grid.hiddenAllDay() + " all-day · " + open, (float) grid.gutter() + 3, grid.height() - 4, grid.width() - (float) grid.gutter() - 6);
        }
        canvas.restore();
    }
    private static void paintRanges(Canvas canvas, TextPaint paint, JsonObject snapshot, NativeWidgetChartLayout.Grid grid,
                                    NativeWidgetChartLayout.OverviewPlan plan, int height, boolean dark, float fontScale, int weekendMask) {
        int width = grid.width();
        canvas.save(); canvas.clipRect(0, 0, width, height);
        int ink = color(dark ? "#eff4fb" : "#243044"), muted = color(dark ? "#bacbdc" : "#526579");
        paint.setColor(NativeWidgetPresentation.panelColor(dark)); canvas.drawRoundRect(0, 0, width, height, 8, 8, paint);
        var days = grid.days(); float gutter = (float) grid.gutter();
        paint.setColor(NativeWeekend.OVERLAY);
        for (var day : days) if (NativeWeekend.contains(day.date(), weekendMask)) canvas.drawRect((float)day.rect().x(), 0, (float)(day.rect().x()+day.rect().width()), height, paint);
        paint.setColor(color(dark ? "#20ffffff" : "#20243044")); paint.setStrokeWidth(.6f);
        for (var day : days) canvas.drawLine((float)day.rect().x(), 0, (float)day.rect().x(), height, paint);
        var dependencies=NativeWidgetChartLayout.overviewDependencies(snapshot,plan,width,fontScale);
        int header=plan.header(),total=plan.hidden()+(int)plan.lines().stream().filter(line->!line.heading()).count();
        drawPlotLinks(canvas,paint,dependencies,gutter,header,width-gutter,height-header,header,dark);
        float headerBaseline=12*fontScale;
        float titleLeft=gutter+17, bodyWidth=width-titleLeft-4;
        float statusLeft=titleLeft+bodyWidth*.57f, datesLeft=titleLeft+bodyWidth*.78f;
        float titleWidth=plan.columns()?statusLeft-titleLeft-8:bodyWidth;
        if(header>0){
            paint.setColor(muted);paint.setTextSize(10*fontScale);paint.setTypeface(MEDIUM);
            text(canvas,paint,"Dated work · "+total,gutter+3,headerBaseline,plan.columns()?statusLeft-gutter-8:width-gutter-6);
            if(plan.columns()){
                text(canvas,paint,"Status",statusLeft,headerBaseline,datesLeft-statusLeft-7);
                text(canvas,paint,"Dates",datesLeft,headerBaseline,width-datesLeft-4);
            }
        }
        for(int index=0;index<plan.lines().size();index++){
            var line=plan.lines().get(index);
            JsonObject row=line.row();float top=line.y();int rowHeight=line.height();
            if(line.heading()){
                paint.setColor(color(dark?"#334d718a":"#1871889a"));canvas.drawRect(gutter,top,width,top+rowHeight,paint);
                paint.setColor(muted);paint.setTypeface(MEDIUM);paint.setTextSize(10*fontScale);
                textBlock(canvas,paint,NativeWidgetPolicy.text(row,"title",""),gutter+4,top+1,width-gutter-8,rowHeight-2,1);continue;
            }
            var range=NativeWidgetPresentation.range(NativeWidgetPolicy.object(row,"timeline"));int accent=color(NativeWidgetPolicy.text(row,"color","#70bfce"));
            paint.setColor(accent);
            var bounds=NativeWidgetPlotLinks.bounds(range,width-(int)gutter);
            if(bounds.visible()&&rowHeight>=9){
                float center=NativeWidgetChartLayout.overviewRangeCenter(line,false);
                canvas.drawRoundRect(gutter+bounds.left(),center-2.5f,gutter+bounds.right(),center+2.5f,2,2,paint);
            }
            paint.setStyle(Paint.Style.STROKE);paint.setStrokeWidth(1.2f);
            String kind=NativeWidgetPolicy.text(row,"kind","task");
            if("task".equals(kind))canvas.drawCircle(gutter+8,top+9,4,paint);else canvas.drawRoundRect(gutter+4,top+5,gutter+12,top+13,1,1,paint);
            String fallback=dependencies.fallback(index);
            float fallbackWidth=0;
            if(!plan.details()&&!fallback.isEmpty()){
                paint.setStyle(Paint.Style.FILL);paint.setColor(muted);paint.setTypeface(Typeface.DEFAULT);paint.setTextSize(8.5f*fontScale);
                fallbackWidth=Math.min(paint.measureText(fallback)+6,titleWidth*.62f);
                text(canvas,paint,fallback,titleLeft+titleWidth-fallbackWidth+4,top+Math.min(rowHeight-2,13*fontScale),fallbackWidth-4);
            }
            paint.setStyle(Paint.Style.FILL);paint.setTextSize(11*fontScale);paint.setColor(ink);paint.setTypeface("card".equals(kind)?MEDIUM:Typeface.DEFAULT);paint.setStrikeThruText(NativeWidgetPolicy.flag(row,"completed",false));
            float titleHeight=Math.min(plan.details()?16*fontScale:rowHeight-9,height-top-2);
            textBlock(canvas,paint,NativeWidgetPolicy.text(row,"title",""),titleLeft,top+1,titleWidth-fallbackWidth,titleHeight,1);paint.setStrikeThruText(false);
            if(plan.details()){
                var detail=NativeWidgetChartLayout.overviewDetail(row);
                paint.setTypeface(Typeface.DEFAULT);paint.setTextSize(9.5f*fontScale);paint.setColor(muted);
                String secondary=plan.columns()?detail.source():detail.inline();
                if(!fallback.isEmpty())secondary=secondary.isEmpty()?fallback:fallback+" · "+secondary;
                text(canvas,paint,secondary,titleLeft,top+23*fontScale,titleWidth);
                if(plan.columns()){
                    text(canvas,paint,detail.status(),statusLeft,top+14*fontScale,datesLeft-statusLeft-7);
                    text(canvas,paint,detail.dates(),datesLeft,top+14*fontScale,width-datesLeft-4);
                }
            }
            paint.setColor(color(dark ? "#20ffffff" : "#20243044"));paint.setStrokeWidth(.6f);
            canvas.drawLine(gutter,top+rowHeight-.5f,width,top+rowHeight-.5f,paint);
        }
        int lastBottom=plan.lines().isEmpty()?header:plan.lines().get(plan.lines().size()-1).y()+plan.lines().get(plan.lines().size()-1).height();
        if(total==0){paint.setColor(muted);paint.setTextSize(11*fontScale);textBlock(canvas,paint,"No dated work",gutter+3,header+2,width-gutter-6,height-header-4,1);}
        else if(plan.hidden()>0&&lastBottom+13*fontScale<=height){paint.setColor(muted);paint.setTextSize(9*fontScale);text(canvas,paint,"+"+plan.hidden()+" more · open Overview",gutter+4,height-3,width-gutter-8);}
        paint.setColor(color(dark ? "#38ffffff" : "#30243044")); canvas.drawLine(0, height - 1, width, height - 1, paint); canvas.restore();
    }
    private static int labelTint(boolean dark) { return dark ? 0x28101923 : 0x66ffffff; }
    private static int headerTint(boolean dark) { return dark ? 0x0fffffff : 0x10243044; }
    private static void clipRoundedPanel(Canvas canvas, int width, int height) {
        Path panel = new Path();
        panel.addRoundRect(0, 0, width, height, 8, 8, Path.Direction.CW);
        canvas.clipPath(panel);
    }

    private static void paintSplitRanges(Canvas canvas, TextPaint paint, JsonObject snapshot, NativeWidgetChartLayout.Grid grid,
                                         NativeWidgetChartLayout.OverviewPlan plan, int height, boolean dark, float fontScale, int weekendMask) {
        int width = grid.width();
        var columns = plan.workColumns();
        var dependencies = NativeWidgetChartLayout.overviewDependencies(snapshot, plan, width, fontScale);
        int ink = color(dark ? "#eff4fb" : "#243044"), muted = color(dark ? "#bacbdc" : "#526579");
        int blue = color(dark ? "#41b5f4" : "#0076b5"), lineColor = color(dark ? "#28ffffff" : "#20243044");
        canvas.save();
        canvas.clipRect(0, 0, width, height);
        paint.setColor(NativeWidgetPresentation.panelColor(dark));
        canvas.drawRoundRect(0, 0, width, height, 8, 8, paint);
        clipRoundedPanel(canvas, width, height);
        paint.setColor(labelTint(dark));
        canvas.drawRect(0, 0, columns.labelWidth(), height, paint);
        if (plan.header() > 0) {
            paint.setColor(headerTint(dark));
            canvas.drawRect(0, 0, width, plan.header(), paint);
        }
        for (var day : grid.days()) {
            var cell = day.rect();
            float left = (float) cell.x(), right = (float) (cell.x() + cell.width());
            if (NativeWeekend.contains(day.date(), weekendMask)) {
                paint.setColor(NativeWeekend.OVERLAY);
                canvas.drawRect(left, 0, right, height, paint);
            }
            if (day.today()) {
                paint.setColor((blue & 0xffffff) | 0x12000000);
                canvas.drawRect(left, 0, right, height, paint);
                paint.setColor((blue & 0xffffff) | 0x58000000);
                paint.setStrokeWidth(1);
                canvas.drawLine((left + right) / 2, plan.header(), (left + right) / 2, height, paint);
            }
            paint.setColor(lineColor); paint.setStrokeWidth(.65f);
            canvas.drawLine(left, 0, left, height, paint);
            if (plan.header() > 0) {
                paint.setColor(day.today() ? blue : muted); paint.setTypeface(MEDIUM); paint.setTextSize(10 * fontScale);
                centered(canvas, paint, workDayLabel(day, fontScale), left + 2, 0, cell.width() - 4, plan.header());
            }
        }
        if (plan.header() > 0) {
            paint.setColor(ink); paint.setTypeface(MEDIUM); paint.setTextSize(10 * fontScale);
            float y = 12 * fontScale;
            text(canvas, paint, "Tasks & cards", 7, y, columns.titleWidth() - 13);
            if (columns.metadataColumns()) {
                text(canvas, paint, "Status", columns.titleWidth() + 5, y, columns.statusWidth() - 9);
                text(canvas, paint, "Due", columns.titleWidth() + columns.statusWidth() + 5, y, columns.dueWidth() - 9);
            }
            paint.setColor(lineColor); paint.setStrokeWidth(.65f);
            canvas.drawLine(0, plan.header() - .5f, width, plan.header() - .5f, paint);
        }
        drawPlotLinks(canvas, paint, dependencies, columns.labelWidth(), plan.header(),
            width - columns.labelWidth(), height - plan.header(), plan.header(), dark);
        for (int index = 0; index < plan.lines().size(); index++) {
            var row = plan.lines().get(index);
            canvas.save(); canvas.clipRect(0, row.y(), width, row.y() + row.height());
            if (row.heading()) paintWorkHeading(canvas, paint, row, columns.labelWidth(), width, muted, fontScale, dark);
            else {
                paintWorkLabel(canvas, paint, row, plan, dependencies.fallback(index), ink, muted, dark, fontScale);
                int accent = color(NativeWidgetPolicy.text(row.row(), "color", "#70bfce"));
                var range = NativeWidgetPresentation.range(NativeWidgetPolicy.object(row.row(), "timeline"));
                paintWorkRange(canvas, paint, range, accent, columns.labelWidth(), width, row.y(), row.height());
            }
            canvas.restore();
            paint.setColor(lineColor); paint.setStrokeWidth(.65f);
            canvas.drawLine(0, row.y() + row.height() - .5f, width, row.y() + row.height() - .5f, paint);
        }
        int lastBottom = plan.lines().isEmpty() ? plan.header() : plan.lines().get(plan.lines().size() - 1).y() + plan.lines().get(plan.lines().size() - 1).height();
        paint.setColor(muted); paint.setTypeface(Typeface.DEFAULT); paint.setTextSize(9 * fontScale);
        if (plan.lines().isEmpty())
            textBlock(canvas, paint, "No dated work", 8, plan.header() + 3, columns.labelWidth() - 16, height - plan.header() - 5, 1);
        else if (plan.hidden() > 0 && lastBottom + 13 * fontScale <= height)
            text(canvas, paint, "+" + plan.hidden() + " more · open Overview", 7, height - 3, columns.labelWidth() - 12);
        paint.setColor(lineColor); paint.setStrokeWidth(.7f);
        canvas.drawLine(0, height - 1, width, height - 1, paint);
        canvas.restore();
    }

    private static String workDayLabel(NativeWidgetChartLayout.Day day, float fontScale) {
        if (day.rect().width() >= 75 * fontScale) return day.label();
        try {
            var date = java.time.LocalDate.parse(day.date());
            if (day.rect().width() >= 45 * fontScale)
                return date.getDayOfWeek().getDisplayName(java.time.format.TextStyle.SHORT, Locale.getDefault()) + " " + date.getDayOfMonth();
            return String.valueOf(date.getDayOfMonth());
        } catch (Exception ignored) { return day.label(); }
    }

    private static void paintWorkHeading(Canvas canvas, TextPaint paint, NativeWidgetChartLayout.OverviewLine row,
                                         int labelWidth, int width, int muted, float fontScale, boolean dark) {
        paint.setColor(dark ? 0x314d718a : 0x1771889a);
        canvas.drawRect(0, row.y(), width, row.y() + row.height(), paint);
        float left = 6 + Math.min(3, Math.max(0, NativeWidgetPolicy.number(row.row(), "depth", 0))) * 7;
        float center = row.y() + row.height() / 2f;
        paint.setColor(color(NativeWidgetPolicy.text(row.row(), "color", dark ? "#67bbe7" : "#075e8a")));
        canvas.drawCircle(left + 3, center, 2.5f, paint);
        paint.setColor(muted); paint.setTypeface(MEDIUM); paint.setTextSize(9.5f * fontScale);
        String count = row.row().has("sectionCount") ? String.valueOf(NativeWidgetPolicy.number(row.row(), "sectionCount", 0)) : "";
        float countWidth = count.isEmpty() ? 0 : paint.measureText(count) + 7;
        text(canvas, paint, NativeWidgetPolicy.text(row.row(), "title", ""), left + 9, center + 3.5f * fontScale, labelWidth - left - 15 - countWidth);
        if (countWidth > 0) text(canvas, paint, count, labelWidth - countWidth, center + 3.5f * fontScale, countWidth - 3);
    }

    private static void paintWorkLabel(Canvas canvas, TextPaint paint, NativeWidgetChartLayout.OverviewLine row,
                                       NativeWidgetChartLayout.OverviewPlan plan, String fallback,
                                       int ink, int muted, boolean dark, float fontScale) {
        JsonObject item = row.row();
        var columns = plan.workColumns();
        var detail = NativeWidgetChartLayout.overviewDetail(item);
        boolean details = row.height() >= 24 * fontScale + 2;
        float center = row.y() + row.height() / 2f;
        float iconY = details ? center - 5 * fontScale : center;
        float left = 6 + Math.min(2, Math.max(0, NativeWidgetPolicy.number(item, "depth", 0))) * 4;
        float labelLeft = left + 13, labelWidth = columns.titleWidth() - labelLeft - 5;
        int accent = color(NativeWidgetPolicy.text(item, "color", "#70bfce"));
        paint.setColor(accent); paint.setStyle(Paint.Style.STROKE); paint.setStrokeWidth(1.4f);
        if ("task".equals(NativeWidgetPolicy.text(item, "kind", ""))) canvas.drawCircle(left + 4, iconY, 4, paint);
        else canvas.drawRoundRect(left, iconY - 4, left + 8, iconY + 4, 1.5f, 1.5f, paint);
        paint.setStyle(Paint.Style.FILL);
        paint.setTypeface(MEDIUM); paint.setTextSize(11 * fontScale); paint.setColor(ink);
        paint.setStrikeThruText(NativeWidgetPolicy.flag(item, "completed", false));
        text(canvas, paint, NativeWidgetPolicy.text(item, "title", ""), labelLeft, iconY + 4 * fontScale, labelWidth);
        paint.setStrikeThruText(false);
        String due = NativeWidgetPolicy.text(item, "trailingLabel", "");
        if (details) {
            paint.setColor(muted); paint.setTypeface(Typeface.DEFAULT); paint.setTextSize(9 * fontScale);
            List<String> meta = new ArrayList<>();
            if (!fallback.isEmpty()) meta.add(fallback);
            if (!columns.metadataColumns() && !detail.status().isEmpty()) meta.add(detail.status());
            if (!columns.metadataColumns() && !due.isEmpty()) meta.add(due);
            if (!detail.source().isEmpty()) meta.add(detail.source());
            text(canvas, paint, String.join(" · ", meta), labelLeft, center + 9 * fontScale, labelWidth);
        }
        if (!columns.metadataColumns()) return;
        int statusLeft = columns.titleWidth(), dueLeft = statusLeft + columns.statusWidth();
        paint.setColor(headerTint(dark)); paint.setStrokeWidth(.7f);
        canvas.drawLine(statusLeft, row.y(), statusLeft, row.y() + row.height(), paint);
        canvas.drawLine(dueLeft, row.y(), dueLeft, row.y() + row.height(), paint);
        paint.setTypeface(Typeface.DEFAULT); paint.setTextSize(9.5f * fontScale);
        if (!detail.status().isEmpty()) {
            float badge = Math.min(columns.statusWidth() - 8, paint.measureText(detail.status()) + 8);
            canvas.drawRoundRect(statusLeft + 4, center - 7 * fontScale, statusLeft + 4 + badge, center + 7 * fontScale, 3, 3, paint);
        }
        paint.setColor(muted);
        text(canvas, paint, detail.status(), statusLeft + 7, center + 3.3f * fontScale, columns.statusWidth() - 13);
        if (due.startsWith("Overdue · ")) {
            paint.setColor(color(dark ? "#f8a29c" : "#a93535"));
            due = due.substring("Overdue · ".length());
        }
        text(canvas, paint, due.isEmpty() ? "—" : due, dueLeft + 5, center + 3.3f * fontScale, columns.dueWidth() - 9);
    }

    private static void paintWorkRange(Canvas canvas, TextPaint paint, NativeWidgetPresentation.Range range, int accent,
                                       int plotLeft, int width, float top, float height) {
        var bounds = NativeWidgetPlotLinks.bounds(range, width - plotLeft);
        if (!bounds.visible() || height < 9) return;
        float left = plotLeft + bounds.left(), right = plotLeft + bounds.right();
        float center = top + height / 2;
        float half = Math.min(6, (height - 2) / 2);
        paint.setColor((accent & 0xffffff) | 0x50000000);
        canvas.drawRoundRect(left, center - half, right, center + half, 4, 4, paint);
        paint.setColor((accent & 0xffffff) | 0xac000000); paint.setStyle(Paint.Style.STROKE); paint.setStrokeWidth(.8f);
        canvas.drawRoundRect(left, center - half, right, center + half, 4, 4, paint);
        paint.setStyle(Paint.Style.FILL); paint.setColor(accent);
        canvas.drawRoundRect(left, center - half + 1, Math.min(right, left + 2.8f), center + half - 1, 1.2f, 1.2f, paint);
    }
    /** Draw one clip of a shared logical plot, including matching segments of a scrolling timeline. */
    static void drawPlotLinks(Canvas canvas, Paint paint, NativeWidgetPlotLinks.Plan dependencies,
                              float x, float y, float width, float height, float top, boolean dark) {
        if (dependencies.routes().isEmpty() || height <= 0) return;
        canvas.save();
        canvas.clipRect(x, y, x + width, y + height);
        canvas.translate(x, y - top);
        paint.setColor(NativeWidgetDependencies.connectorColor(dark));
        float oldWidth = paint.getStrokeWidth();
        Paint.Cap oldCap = paint.getStrokeCap();
        Paint.Join oldJoin = paint.getStrokeJoin();
        Paint.Style oldStyle = paint.getStyle();
        paint.setStrokeWidth(1.35f);
        paint.setStrokeCap(Paint.Cap.ROUND);
        paint.setStrokeJoin(Paint.Join.ROUND);
        Path path = new Path();
        for (var route : dependencies.routes()) {
            if (!route.crosses(top, height)) continue;
            var start = route.start();
            var end = route.end();
            path.rewind();
            path.moveTo(start.x(), start.y());
            for (var point : route.points().subList(1, route.points().size())) path.lineTo(point.x(), point.y());
            path.moveTo(end.x() - 4.3f, end.y() - 2.8f);
            path.lineTo(end.x(), end.y());
            path.lineTo(end.x() - 4.3f, end.y() + 2.8f);
            paint.setStyle(Paint.Style.STROKE);
            canvas.drawPath(path, paint);
            paint.setStyle(Paint.Style.FILL);
            canvas.drawCircle(start.x(), start.y(), 1.65f, paint);
        }
        paint.setStrokeWidth(oldWidth);
        paint.setStrokeCap(oldCap);
        paint.setStrokeJoin(oldJoin);
        paint.setStyle(oldStyle);
        canvas.restore();
    }
    private static Bitmap image(NativeWidgetChartLayout.Raster size) { Bitmap image = Bitmap.createBitmap(size.width(), size.height(), Bitmap.Config.ARGB_8888); image.setDensity(Bitmap.DENSITY_NONE); return image; }
    private static Canvas canvas(Bitmap image, int width, int height) {
        Canvas canvas = new Canvas(image); var fit = NativeWidgetChartLayout.fit(width, height, image.getWidth(), image.getHeight());
        canvas.translate((float) fit.x(), (float) fit.y()); canvas.scale((float) fit.scale(), (float) fit.scale()); return canvas;
    }
    private static TextPaint paint() { TextPaint paint = new TextPaint(Paint.ANTI_ALIAS_FLAG | Paint.SUBPIXEL_TEXT_FLAG); paint.setTypeface(Typeface.DEFAULT); return paint; }
    private static void text(Canvas canvas, TextPaint paint, String value, float left, float baseline, float width) {
        if (width <= 0) return; CharSequence label = TextUtils.ellipsize(value.replace('\n', ' '), paint, width, TextUtils.TruncateAt.END); canvas.drawText(label, 0, label.length(), left, baseline, paint);
    }
    private static void centered(Canvas canvas, TextPaint paint, String value, double left, double top, double width, double height) {
        if (width <= 0 || height <= 0) return;
        CharSequence label = TextUtils.ellipsize(value.replace('\n', ' '), paint, (float) width, TextUtils.TruncateAt.END); Paint.FontMetrics metrics = paint.getFontMetrics();
        if (metrics.descent - metrics.ascent > height) return;
        canvas.drawText(label, 0, label.length(), (float) (left + (width - paint.measureText(label, 0, label.length())) / 2), (float) (top + (height - metrics.descent - metrics.ascent) / 2), paint);
    }
    private static void textBlock(Canvas canvas, TextPaint paint, String value, float left, float top, float width, float height, int maxLines) {
        int lines = Math.min(maxLines, (int) Math.floor(height / Math.max(1, paint.getFontMetrics().descent - paint.getFontMetrics().ascent)));
        if (width < 1 || lines < 1) return;
        StaticLayout label = StaticLayout.Builder.obtain(value, 0, value.length(), paint, Math.max(1, (int) width)).setIncludePad(false).setMaxLines(lines).setEllipsize(TextUtils.TruncateAt.END).build();
        canvas.save(); canvas.clipRect(left, top, left + width, top + height); canvas.translate(left, top); label.draw(canvas); canvas.restore();
    }
    private static int color(String value) { try { return Color.parseColor(value); } catch (Exception ignored) { return Color.rgb(112, 191, 206); } }
    private static String key(String mode, JsonObject data, int width, int height, NativeWidgetChartLayout.Raster size, boolean dark, float fontScale) {
        try { return mode + ':' + width + ':' + height + ':' + size + ':' + dark + ':' + fontScale + ':' + NativeLoginFlow.digest(data.toString()); }
        catch (Exception failure) { throw new IllegalStateException(failure); }
    }
}
