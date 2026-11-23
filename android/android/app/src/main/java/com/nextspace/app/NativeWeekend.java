package com.nextspace.app;

import com.google.gson.*;
import java.time.LocalDate;
import java.util.*;

/** Pure appearance policy. Date keys are the civil dates already displayed by shared projection. */
final class NativeWeekend {
    static final int DEFAULT_MASK = 65;
    static final int OVERLAY = 0x06ffffff;
    record Band(double start, double end) {}
    static int normalize(Object value) {
        if (!(value instanceof Number number)) return DEFAULT_MASK;
        double mask = number.doubleValue();
        return Double.isFinite(mask) && mask == Math.rint(mask) && mask >= 0 && mask <= 127 ? (int) mask : DEFAULT_MASK;
    }
    static boolean contains(String date, int mask) {
        LocalDate day = day(date);
        return day != null && (normalize(mask) & 1 << (day.getDayOfWeek().getValue() % 7)) != 0;
    }
    static String rowDate(JsonObject row) {
        String key = NativeWidgetPolicy.text(row, "dateKey", "");
        if (row.has("dateKey")) return day(key) == null ? "" : key;
        String legacy = NativeWidgetPolicy.text(row, "event".equals(NativeWidgetPolicy.text(row, "kind", "")) ? "start" : "due", "");
        return day(legacy) == null ? "" : legacy;
    }
    static List<Band> timelineBands(JsonObject axis, int mask) {
        LocalDate start = day(NativeWidgetPolicy.text(axis, "start", ""));
        if (start == null) return List.of();
        JsonArray ticks = NativeWidgetPolicy.array(axis, "ticks");
        List<Band> result = new ArrayList<>();
        for (int i = 0; i + 1 < Math.min(367, ticks.size()); i++) {
            if (!contains(start.plusDays(i).toString(), mask)) continue;
            double left = offset(ticks.get(i)), right = offset(ticks.get(i + 1));
            if (left >= 0 && right <= 100 && right > left) result.add(new Band(left, right));
        }
        return List.copyOf(result);
    }
    private static double offset(JsonElement value) {
        try { double offset = value.getAsJsonObject().get("offset").getAsDouble(); return Double.isFinite(offset) ? offset : -1; }
        catch (Exception ignored) { return -1; }
    }
    private static LocalDate day(String value) {
        if (value == null || !value.matches("\\d{4}-\\d{2}-\\d{2}")) return null;
        try { return LocalDate.parse(value); } catch (Exception ignored) { return null; }
    }
}
