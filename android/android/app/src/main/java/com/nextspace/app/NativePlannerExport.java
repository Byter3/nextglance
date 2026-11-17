package com.nextspace.app;

import com.google.gson.*;
import com.google.gson.stream.JsonReader;
import com.google.gson.stream.JsonToken;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.Set;

/** Bounded metadata-only file boundary; the portable core owns schema validation. */
final class NativePlannerExport {
    private static final Set<String> ALLOWED = Set.of("schemaVersion", "id", "name", "spaces", "categories", "projects", "relations", "plans", "identities", "properties", "updatedAt", "appearance", "planner");
    static String checked(String document) throws Exception {
        try {
            if (document == null || document.length() > 8 * 1024 * 1024 || document.getBytes(StandardCharsets.UTF_8).length > 8 * 1024 * 1024) throw new IllegalArgumentException();
            JsonReader reader = new JsonReader(new StringReader(document)); reader.setStrictness(Strictness.STRICT);
            JsonElement parsed = JsonParser.parseReader(reader);
            if (reader.peek() != JsonToken.END_DOCUMENT || !parsed.isJsonObject()) throw new IllegalArgumentException();
            JsonObject value = parsed.getAsJsonObject();
            if (!ALLOWED.containsAll(value.keySet()) || !value.keySet().containsAll(Set.of("schemaVersion", "id", "name", "spaces", "projects", "relations", "plans", "identities", "properties", "updatedAt"))) throw new IllegalArgumentException();
            JsonElement version = value.get("schemaVersion");
            if (!version.isJsonPrimitive() || !version.getAsJsonPrimitive().isNumber() || version.getAsDouble() != 2d) throw new IllegalArgumentException();
            for (String key : Set.of("id", "name", "updatedAt")) if (!value.get(key).isJsonPrimitive() || !value.getAsJsonPrimitive(key).isString()) throw new IllegalArgumentException();
            for (String key : Set.of("spaces", "projects", "relations", "plans", "identities")) if (!value.get(key).isJsonArray()) throw new IllegalArgumentException();
            if (!value.get("properties").isJsonObject() || value.has("categories") && !value.get("categories").isJsonArray()) throw new IllegalArgumentException();
            for (String key : Set.of("appearance", "planner")) if (value.has(key) && !value.get(key).isJsonObject()) throw new IllegalArgumentException();
            return document;
        } catch (Exception invalid) { throw NativeSyncPolicy.failure("VALIDATION", "Only a valid bounded planner metadata document can be exported."); }
    }
    static void write(OutputStream output, String document) throws Exception {
        if (output == null) throw new IOException("The export destination could not be opened.");
        output.write(checked(document).getBytes(StandardCharsets.UTF_8));
        output.flush();
    }
}
