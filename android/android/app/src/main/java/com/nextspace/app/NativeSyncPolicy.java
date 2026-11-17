package com.nextspace.app;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.List;

/** Pure validation shared by the scheduled reader and foreground resource-cache port. */
final class NativeSyncPolicy {
    static final long CACHE_BYTES = 256L * 1024 * 1024;
    static final int DAV_BYTES = 2 * 1024 * 1024, RESPONSE_BYTES = 24 * 1024 * 1024;
    static final long REQUEST_MILLIS = 45_000, JOB_MILLIS = 90_000;
    record Settings(int caldavMinutes, int deckMinutes, boolean wifiOnly) {
        static Settings defaults() { return new Settings(15, 15, false); }
    }
    record Locator(String kind, String collection, String href) {}
    record Entry(int version, String kind, String collection, String href, String etag, String body, long bytes) {
        Locator locator() { return new Locator(kind, collection, href); }
    }
    static String deniedCollection(String base,String kind,String target)throws Exception{
        NativeRequestPolicy.checkedTarget(base,target);
        String suffix="dav".equals(kind)?"/remote\\.php/dav/calendars/[^/]+/[^/]+/":"/index\\.php/apps/deck/api/v1\\.0/boards/[1-9]\\d*(?=/|$)";
        var matcher=java.util.regex.Pattern.compile("^"+java.util.regex.Pattern.quote(base.replaceAll("/+$",""))+suffix).matcher(target);
        return matcher.find()?matcher.group():null;
    }
    static Settings settings(JsonObject value, boolean strict) throws Exception {
        try {
            if (value == null || !value.keySet().equals(java.util.Set.of("caldavMinutes", "deckMinutes", "wifiOnly"))) throw new IllegalArgumentException();
            if (value == null || !value.has("caldavMinutes") || !value.has("deckMinutes") || !value.has("wifiOnly") ||
                    !value.get("caldavMinutes").isJsonPrimitive() || !value.getAsJsonPrimitive("caldavMinutes").isNumber() ||
                    !value.get("deckMinutes").isJsonPrimitive() || !value.getAsJsonPrimitive("deckMinutes").isNumber() ||
                    !value.get("wifiOnly").isJsonPrimitive() || !value.getAsJsonPrimitive("wifiOnly").isBoolean()) throw new IllegalArgumentException();
            double caldav = value.get("caldavMinutes").getAsDouble(), deck = value.get("deckMinutes").getAsDouble();
            if (!List.of(0d, 15d, 30d, 60d, 240d).contains(caldav) || !List.of(0d, 15d, 30d, 60d, 240d).contains(deck)) throw new IllegalArgumentException();
            return new Settings((int) caldav, (int) deck, value.get("wifiOnly").getAsBoolean());
        } catch (Exception error) {
            if (strict) throw failure("VALIDATION", "Choose Off, 15, 30, 60 or 240 minutes for each source.");
            return Settings.defaults();
        }
    }
    static void locator(String base, Locator value) throws Exception {
        if (value == null || value.kind() == null || !List.of("dav", "deck").contains(value.kind())) throw failure("VALIDATION", "Invalid source cache kind.");
        URI collection = NativeRequestPolicy.checkedTarget(base, value.collection());
        URI href = NativeRequestPolicy.checkedTarget(base, value.href());
        if (collection.getRawQuery() != null || href.getRawQuery() != null) throw failure("VALIDATION", "Source cache locators cannot contain a query.");
        String prefix = new URI(base).getRawPath().replaceAll("/+$", "");
        String path = collection.getRawPath();
        if ("dav".equals(value.kind())) {
            if (!path.matches(java.util.regex.Pattern.quote(prefix) + "/remote\\.php/dav/calendars/[^/]+/[^/]+/") ||
                    !href.getRawPath().startsWith(path) || href.getRawPath().substring(path.length()).isEmpty() ||
                    href.getRawPath().substring(path.length()).contains("/")) throw failure("VALIDATION", "A calendar cache resource must be a direct child of its collection.");
        } else if (!path.matches(java.util.regex.Pattern.quote(prefix) + "/index\\.php/apps/deck/api/v1\\.0/boards/[1-9]\\d*") ||
                !value.href().equals(value.collection() + "/stacks")) throw failure("VALIDATION", "Invalid Deck source cache endpoint.");
    }
    static void entry(String base, Entry value) throws Exception {
        if (value == null || value.version() != 1) throw failure("FORMAT", "Invalid source cache format.");
        locator(base, value.locator());
        if (value.body() == null || !cacheEtag(value.kind(), value.etag()) ||
                value.bytes() != value.body().getBytes(StandardCharsets.UTF_8).length || value.bytes() < 0 ||
                value.bytes() > ("dav".equals(value.kind()) ? DAV_BYTES : RESPONSE_BYTES)) throw failure("FORMAT", "Invalid source cache resource.");
        if ("deck".equals(value.kind()) && !completeDeckStacks(JsonParser.parseString(value.body()))) throw failure("FORMAT", "Deck cache must contain complete, uniquely identified stacks and cards.");
    }
    static Entry parseEntry(JsonObject object) throws Exception {
        try {
            for (String name : List.of("kind", "collection", "href", "etag", "body")) if (!object.has(name) || !object.get(name).isJsonPrimitive() || !object.getAsJsonPrimitive(name).isString()) throw new IllegalArgumentException();
            for (String name : List.of("version", "bytes")) if (!object.has(name) || !object.get(name).isJsonPrimitive() || !object.getAsJsonPrimitive(name).isNumber()) throw new IllegalArgumentException();
            double version = object.get("version").getAsDouble(), bytes = object.get("bytes").getAsDouble();
            if (version != 1 || !Double.isFinite(bytes) || bytes < 0 || bytes != Math.floor(bytes) || bytes > RESPONSE_BYTES) throw new IllegalArgumentException();
            return new Entry(1, object.get("kind").getAsString(), object.get("collection").getAsString(), object.get("href").getAsString(), object.get("etag").getAsString(), object.get("body").getAsString(), (long) bytes);
        } catch (Exception invalid) { throw failure("FORMAT", "Invalid source cache fields."); }
    }
    static boolean strongEtag(String value) { return value != null && value.length() <= 1000 && value.matches("\"[\\x21\\x23-\\x7e\\x80-\\xff]*\""); }
    static boolean cacheEtag(String kind, String value) { return strongEtag(value) || "deck".equals(kind) && value != null && value.length() <= 1000 && value.startsWith("W/") && strongEtag(value.substring(2)); }
    static boolean completeDeckStacks(com.google.gson.JsonElement value) {
        if (value == null || !value.isJsonArray()) return false;
        java.util.Set<String> stacks = new java.util.HashSet<>(), cards = new java.util.HashSet<>();
        for (var element : value.getAsJsonArray()) {
            if (!element.isJsonObject()) return false; JsonObject stack = element.getAsJsonObject();
            String stackId = nativeId(stack.get("id"));
            if (stackId == null || !stacks.add(stackId) || !stringField(stack, "title") || !stack.has("cards") || !stack.get("cards").isJsonArray()) return false;
            for (var item : stack.getAsJsonArray("cards")) {
                if (!item.isJsonObject()) return false; JsonObject card = item.getAsJsonObject(); String cardId = nativeId(card.get("id"));
                if (cardId == null || !cards.add(cardId) || !stringField(card, "title")) return false;
            }
        }
        return true;
    }
    private static boolean stringField(JsonObject value, String key) { return value.has(key) && value.get(key).isJsonPrimitive() && value.getAsJsonPrimitive(key).isString(); }
    static String nativeId(com.google.gson.JsonElement value) {
        if (value == null || !value.isJsonPrimitive()) return null;
        String id;
        if (value.getAsJsonPrimitive().isString()) id = value.getAsString();
        else if (value.getAsJsonPrimitive().isNumber()) try { id = value.getAsBigDecimal().stripTrailingZeros().toPlainString(); } catch (Exception invalid) { return null; }
        else return null;
        return id.matches("[1-9]\\d*") ? id : null;
    }
    static NativeLoginFlow.Failure failure(String code, String message) { return new NativeLoginFlow.Failure(code, message); }
}
