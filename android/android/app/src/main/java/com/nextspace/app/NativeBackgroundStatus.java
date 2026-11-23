package com.nextspace.app;

import com.google.gson.JsonObject;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Pure scheduler evidence and presentation; a completed download is not a published read generation. */
final class NativeBackgroundStatus {
    record Job(long intervalMillis, boolean wifiOnly, String selection, String kind, boolean persisted) {}

    static boolean matches(Job job, int minutes, boolean wifiOnly, String selection, String kind) {
        return minutes > 0 && job != null && job.persisted() && job.intervalMillis() == minutes * 60_000L
            && job.wifiOnly() == wifiOnly && selection.equals(job.selection()) && kind.equals(job.kind());
    }

    static boolean interruptionMatches(String attempt, String currentAttempt, String projection) {
        return attempt != null && !attempt.isEmpty() && attempt.equals(currentAttempt) && !"ready".equals(projection);
    }

    static JsonObject family(boolean enabled, boolean scheduled, Map<String,String> saved) {
        JsonObject out = new JsonObject();
        out.addProperty("enabled", enabled);out.addProperty("scheduled", enabled && scheduled);
        for (String field : List.of("lastAttemptAt", "downloadedAt", "readGenerationAt")) {
            String stamp = saved.get(field);if (instant(stamp)) out.addProperty(field, stamp);
        }
        String projection = saved.getOrDefault("projection", "pending");
        if (!Set.of("pending", "ready", "unavailable", "incomplete").contains(projection)) projection = "incomplete";
        out.addProperty("projection", projection);
        if ("unavailable".equals(projection)) out.addProperty("message", "This Android provider cannot update the readable planner in the background. Open NextGlance to apply available downloads.");
        else if ("incomplete".equals(projection)) out.addProperty("message", "Downloads may be saved, but the readable planner was not updated. Previous usable data is preserved.");
        if ("true".equals(saved.get("interrupted"))) out.addProperty("message", "The background check paused when NextGlance became active or Android stopped the job. Saved data is preserved.");
        if (!saved.getOrDefault("error", "").isBlank()) out.addProperty("error", saved.get("error"));
        return out;
    }

    static JsonObject aggregate(JsonObject caldav, JsonObject deck) {
        JsonObject out = new JsonObject(), sources = new JsonObject();
        sources.add("caldav", caldav);sources.add("deck", deck);out.add("sources", sources);
        out.addProperty("supported", true);
        List<JsonObject> enabled = List.of(caldav, deck).stream().filter(value -> value.get("enabled").getAsBoolean()).toList();
        out.addProperty("scheduled", !enabled.isEmpty() && enabled.stream().allMatch(value -> value.get("scheduled").getAsBoolean()));
        latest(out, "lastAttemptAt", "lastAttemptAt", List.of(caldav, deck));
        latest(out, "lastSuccessAt", "downloadedAt", List.of(caldav, deck));
        // Aggregate usable freshness cannot hide a family which has never published.
        if (!enabled.isEmpty() && enabled.stream().allMatch(value -> value.has("readGenerationAt"))) {
            out.addProperty("readGenerationAt", enabled.stream().map(value -> value.get("readGenerationAt").getAsString()).min(java.util.Comparator.comparing(Instant::parse)).orElseThrow());
        }
        String projection = "pending";
        if (!enabled.isEmpty()) {
            projection = "ready";
            for (String candidate : List.of("pending", "unavailable", "incomplete"))
                if (enabled.stream().anyMatch(value -> candidate.equals(value.get("projection").getAsString()))) projection = candidate;
        }
        out.addProperty("projection", projection);
        return out;
    }

    private static boolean instant(String value) {
        try { Instant.parse(value);return true; } catch (Exception invalid) { return false; }
    }
    private static void latest(JsonObject out, String output, String field, List<JsonObject> families) {
        families.stream().filter(value -> value.has(field)).map(value -> value.get(field).getAsString()).max(java.util.Comparator.comparing(Instant::parse)).ifPresent(value -> out.addProperty(output, value));
    }
}
