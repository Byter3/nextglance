package com.nextspace.app;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.text.TextPaint;
import android.text.TextUtils;
import android.util.LruCache;
import com.google.gson.JsonObject;
import java.time.DateTimeException;
import java.time.LocalDate;
import java.time.format.TextStyle;
import java.util.List;
import java.util.Locale;

/** Draws the standalone Timeline plot in the same coordinate system as its fixed date heading. */
final class NativeWidgetTimelineCharts {
    enum Part { HEADING, SECTION, ITEM }
    private record Key(String axis, NativeWidgetPresentation.Range range, int width, int height,
                       NativeWidgetChartLayout.Raster raster, boolean dark, int accent, Part part,
                       float fontScale, int weekendMask, Locale locale,
                       List<NativeWidgetPlotLinks.Route> links, int rowTop) {}
    private static final LruCache<Key, Bitmap> CACHE = new LruCache<>(1024 * 1024) {
        @Override protected int sizeOf(Key key, Bitmap value) { return value.getAllocationByteCount(); }
    };

    static synchronized Bitmap render(JsonObject axis, NativeWidgetPresentation.Range range, int width, int height,
                                      NativeWidgetChartLayout.Raster raster, boolean dark, int accent, Part part,
                                      float fontScale, int weekendMask, Locale locale,
                                      NativeWidgetPlotLinks.Plan links, int rowTop) {
        List<NativeWidgetPlotLinks.Route> routes = links == null ? List.of() : links.routes().stream()
            .filter(route -> route.crosses(rowTop, height)).toList();
        Key key = new Key(axis.toString(), range, width, height, raster, dark, accent, part,
            fontScale, weekendMask, locale, routes, routes.isEmpty() ? 0 : rowTop);
        Bitmap cached = CACHE.get(key);
        if (cached != null) return cached;
        Bitmap bitmap = Bitmap.createBitmap(raster.width(), raster.height(), Bitmap.Config.ARGB_8888);
        bitmap.setDensity(Bitmap.DENSITY_NONE);
        Canvas canvas = new Canvas(bitmap);
        var fit = NativeWidgetChartLayout.fit(width, height, raster.width(), raster.height());
        canvas.translate((float) fit.x(), (float) fit.y());
        canvas.scale((float) fit.scale(), (float) fit.scale());

        TextPaint paint = new TextPaint(Paint.ANTI_ALIAS_FLAG | Paint.SUBPIXEL_TEXT_FLAG);
        paint.setColor(NativeWidgetPresentation.panelColor(dark));
        canvas.drawRect(0, 0, width, height, paint);
        if (part != Part.ITEM) {
            paint.setColor(dark ? 0x1b8ca4bb : 0x1024354b);
            canvas.drawRect(0, 0, width, height, paint);
        }
        paint.setColor(NativeWeekend.OVERLAY);
        for (var band : NativeWeekend.timelineBands(axis, weekendMask)) {
            canvas.drawRect(position(band.start(), width), 0, position(band.end(), width), height, paint);
        }

        List<NativeWidgetPresentation.Tick> ticks = NativeWidgetPresentation.ticks(axis);
        int todayInk = dark ? 0xff41b5f4 : 0xff0076b5;
        float todayEnd = ticks.size() > 1 ? position(ticks.get(1).offset(), width) : 0;
        paint.setColor(withAlpha(todayInk, part == Part.HEADING ? 26 : 12));
        canvas.drawRect(0, 0, todayEnd, height, paint);
        paint.setColor(dark ? 0x405c758c : 0x3024354b);
        paint.setStrokeWidth(.7f);
        for (var tick : ticks) {
            float x = position(tick.offset(), width);
            canvas.drawLine(x, 0, x, height, paint);
        }
        canvas.drawLine(0, height - .5f, width, height - .5f, paint);
        if (todayEnd > 0) {
            paint.setColor(part == Part.HEADING ? todayInk : withAlpha(todayInk, 96));
            if (part == Part.HEADING) canvas.drawRect(0, height - 2, todayEnd, height, paint);
            else canvas.drawLine(todayEnd / 2, 0, todayEnd / 2, height, paint);
        }

        if (part == Part.HEADING) {
            paintLabels(canvas, paint, axis, ticks, width, height, fontScale, locale, todayInk, dark);
        } else {
            if (!routes.isEmpty()) NativeWidgetCharts.drawPlotLinks(canvas, paint, links, 0, 0, width, height, rowTop, dark);
            if (part == Part.ITEM && range.length() > 0) paintRange(canvas, paint, range, width, height, accent);
        }
        CACHE.put(key, bitmap);
        return bitmap;
    }

    private static void paintLabels(Canvas canvas, TextPaint paint, JsonObject axis, List<NativeWidgetPresentation.Tick> ticks,
                                    int width, int height, float fontScale, Locale locale, int todayInk, boolean dark) {
        int days = Math.max(1, ticks.size() - 1);
        float dayWidth = width / (float) days;
        boolean showEveryDay = days <= 7 && dayWidth >= 31 * fontScale;
        LocalDate date = firstDay(axis);
        List<NativeWidgetPresentation.Tick> labels = showEveryDay ? ticks : NativeWidgetPresentation.labeledTicks(ticks, width, fontScale);
        paint.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        for (var tick : labels) {
            if (tick.offset() >= 100 || tick.label().isBlank()) continue;
            float center = position(tick.offset(), width) + dayWidth / 2;
            int day = Math.min(days - 1, (int) Math.round(tick.offset() * days / 100));
            paint.setColor(day == 0 ? todayInk : dark ? 0xffc3cfde : 0xff435666);
            paint.setTextSize(10 * fontScale);
            if (showEveryDay && date != null && dayWidth < 62 * fontScale) {
                LocalDate current = date.plusDays(day);
                TextStyle style = dayWidth < 43 * fontScale ? TextStyle.NARROW : TextStyle.SHORT;
                String label = current.getDayOfWeek().getDisplayName(style, locale) + " " + current.getDayOfMonth();
                drawCentered(canvas, paint, label, center, (height - 1) / 2f, dayWidth - 3, width);
            } else {
                drawCentered(canvas, paint, tick.label(), center, (height - 1) / 2f,
                    showEveryDay ? dayWidth - 3 : Math.min(width, 76 * fontScale), width);
            }
        }
    }

    private static LocalDate firstDay(JsonObject axis) {
        try { return LocalDate.parse(NativeWidgetPolicy.text(axis, "start", "")); }
        catch (DateTimeException invalid) { return null; }
    }

    private static void drawCentered(Canvas canvas, TextPaint paint, String text, float center, float y, float maxWidth, int width) {
        CharSequence label = TextUtils.ellipsize(text, paint, maxWidth, TextUtils.TruncateAt.END);
        float labelWidth = paint.measureText(label, 0, label.length());
        float x = Math.max(1, Math.min(width - labelWidth - 1, center - labelWidth / 2));
        Paint.FontMetrics metrics = paint.getFontMetrics();
        canvas.drawText(label, 0, label.length(), x, y - (metrics.ascent + metrics.descent) / 2, paint);
    }

    private static void paintRange(Canvas canvas, Paint paint, NativeWidgetPresentation.Range range, int width, int height, int accent) {
        var bounds = NativeWidgetPlotLinks.bounds(range, width);
        float left = bounds.left(), right = bounds.right();
        float halfBar = Math.min(5.5f, height * .29f);
        float top = height / 2f - halfBar, bottom = height / 2f + halfBar;
        paint.setColor(withAlpha(accent, 106));
        canvas.drawRoundRect(left, top, right, bottom, 3, 3, paint);
        paint.setColor(accent);
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(.9f);
        canvas.drawRoundRect(left, top, right, bottom, 3, 3, paint);
        paint.setStyle(Paint.Style.FILL);
        canvas.drawRoundRect(left, top, Math.min(right, left + 2), bottom, 1, 1, paint);
    }

    private static int withAlpha(int color, int alpha) { return (color & 0x00ffffff) | (alpha << 24); }
    private static float position(double offset, int width) { return (float) (offset * width / 100); }
}
