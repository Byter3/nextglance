package com.nextspace.app;

import static org.junit.Assert.*;
import com.google.gson.JsonParser;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class NativeSourceSyncTest {
    @Test public void boundedBatchCacheKeepsOrderMissingEntriesAndAccountIsolation()throws Exception{
        NativeResourceCache cache=cache();var a=entry("dav",calendar,calendar+"a.ics","\"a\"","a");var b=entry("dav",calendar,calendar+"b.ics","\"b\"","b");cache.put(a);cache.put(b);
        var missing=new NativeSyncPolicy.Locator("dav",calendar,calendar+"missing.ics");
        assertEquals(java.util.Arrays.asList(b,null,a),cache.getMany(List.of(b.locator(),missing,a.locator())));
        assertThrows(Exception.class,()->cache.getMany(java.util.Collections.nCopies(33,a.locator())));
        assertThrows(Exception.class,()->cache.getMany(List.of(new NativeSyncPolicy.Locator("dav",calendar,"https://other.example/a.ics"))));
        var other=new NativeResourceCache(temporary.getRoot(),"other",base,()->{});assertEquals(java.util.Arrays.asList((NativeSyncPolicy.Entry)null),other.getMany(List.of(a.locator())));
    }
    @Test public void batchCacheCapsTotalBodyAndRetainsTruncatedItemsOnDisk()throws Exception{
        NativeResourceCache cache=cache();List<NativeSyncPolicy.Locator> keys=new ArrayList<>();String body="x".repeat(1024*1024);
        for(int i=0;i<6;i++){var item=entry("dav",calendar,calendar+i+".ics","\"a\"",body);cache.put(item);keys.add(item.locator());}
        var result=cache.getMany(keys);assertEquals(4,result.size());assertEquals(4,result.stream().filter(java.util.Objects::nonNull).count());assertNotNull(cache.get(keys.get(5)));
    }
    @Rule public TemporaryFolder temporary = new TemporaryFolder();
    final String base = "https://cloud.example/nextcloud", calendar = base + "/remote.php/dav/calendars/user/personal/";
    final String board = base + "/index.php/apps/deck/api/v1.0/boards/12";
    NativeResourceCache cache() throws Exception { return new NativeResourceCache(temporary.getRoot(), "account", base, () -> {}); }
    NativeSyncPolicy.Entry entry(String kind, String collection, String href, String etag, String body) { return new NativeSyncPolicy.Entry(1, kind, collection, href, etag, body, body.getBytes(StandardCharsets.UTF_8).length); }
    String row(String href, String properties) {
        if (href.startsWith(calendar) && !properties.contains("resourcetype")) properties += href.equals(calendar) ? "<d:resourcetype><d:collection/></d:resourcetype>" : "<d:resourcetype/>";
        return "<d:response><d:href>" + href + "</d:href><d:propstat><d:prop>" + properties + "</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>";
    }
    String xml(String rows) { return "<d:multistatus xmlns:d='DAV:' xmlns:c='urn:ietf:params:xml:ns:caldav'>" + rows + "</d:multistatus>"; }
    NativeSyncEngine.Reply reply(String body) { return new NativeSyncEngine.Reply(200, Map.of(), body); }
    NativeSyncEngine.Reply discovery(String url) {
        if (url.equals(base + "/remote.php/dav/")) return reply(xml(row(url, "<d:current-user-principal><d:href>/nextcloud/remote.php/dav/principals/users/user/</d:href></d:current-user-principal>")));
        if (url.endsWith("/principals/users/user/")) return reply(xml(row(url, "<c:calendar-home-set><d:href>/nextcloud/remote.php/dav/calendars/user/</d:href></c:calendar-home-set>")));
        if (url.equals(base + "/remote.php/dav/calendars/user/")) return reply(xml(row(url, "<d:resourcetype><d:collection/></d:resourcetype>") + row(calendar, "<d:resourcetype><d:collection/><c:calendar/></d:resourcetype>")));
        return null;
    }
    NativeSyncEngine engine(NativeResourceCache cache, NativeSyncEngine.Network network) { return new NativeSyncEngine(base, network, cache, () -> {}, () -> 0, (s,c,t) -> {}); }

    @Test public void settingsAreStrictAndRestorationHasDocumentedDefaults() throws Exception {
        assertEquals(new NativeSyncPolicy.Settings(0, 240, true), NativeSyncPolicy.settings(JsonParser.parseString("{\"caldavMinutes\":0,\"deckMinutes\":240,\"wifiOnly\":true}").getAsJsonObject(), true));
        assertEquals(NativeSyncPolicy.Settings.defaults(), NativeSyncPolicy.settings(JsonParser.parseString("{\"caldavMinutes\":1}").getAsJsonObject(), false));
        assertThrows(NativeLoginFlow.Failure.class, () -> NativeSyncPolicy.settings(JsonParser.parseString("{\"caldavMinutes\":15.5,\"deckMinutes\":15,\"wifiOnly\":false}").getAsJsonObject(), true));
        assertThrows(NativeLoginFlow.Failure.class, () -> NativeSyncPolicy.settings(JsonParser.parseString("{\"caldavMinutes\":15,\"deckMinutes\":15,\"wifiOnly\":false,\"extra\":true}").getAsJsonObject(), true));
    }
    @Test public void locatorsRejectAnotherServerTraversalAndWrongSource() throws Exception {
        NativeSyncPolicy.locator(base, new NativeSyncPolicy.Locator("dav", calendar, calendar + "a.ics"));
        assertThrows(Exception.class, () -> NativeSyncPolicy.locator(base, new NativeSyncPolicy.Locator("dav", calendar, "https://evil.example/a.ics")));
        assertThrows(Exception.class, () -> NativeSyncPolicy.locator(base, new NativeSyncPolicy.Locator("dav", calendar, calendar + "nested/a.ics")));
        assertThrows(Exception.class, () -> NativeSyncPolicy.locator(base, new NativeSyncPolicy.Locator("dav", calendar, calendar + "%2e%2e/a.ics")));
        assertThrows(Exception.class, () -> NativeSyncPolicy.locator(base, new NativeSyncPolicy.Locator("deck", board, board + "/cards")));
    }
    @Test public void cacheRoundTripIsAccountBoundAndUtf8Validated() throws Exception {
        NativeResourceCache first = cache(); NativeSyncPolicy.Entry value = entry("dav", calendar, calendar + "a.ics", "\"a\"", "ő😀");
        first.put(value); assertEquals(value, first.get(value.locator()));
        NativeResourceCache other = new NativeResourceCache(temporary.getRoot(), "other-account", base, () -> {}); assertNull(other.get(value.locator()));
        assertThrows(Exception.class, () -> first.put(new NativeSyncPolicy.Entry(1, "dav", calendar, calendar + "b.ics", "\"a\"", "ő", 1)));
    }
    @Test public void cacheValidatorsRejectWeakDavBareDeckAndFractionalFields() throws Exception {
        assertThrows(Exception.class, () -> cache().put(entry("dav", calendar, calendar + "a.ics", "W/\"a\"", "body")));
        assertThrows(Exception.class, () -> cache().put(entry("deck", board, board + "/stacks", "bare", "[]")));
        assertFalse(NativeSyncPolicy.cacheEtag("deck", "\"" + "a".repeat(1000) + "\""));
        assertThrows(Exception.class, () -> NativeSyncPolicy.parseEntry(JsonParser.parseString("{\"version\":1.5,\"kind\":\"deck\",\"collection\":\"x\",\"href\":\"x\",\"etag\":\"x\",\"body\":\"[]\",\"bytes\":2}").getAsJsonObject()));
        assertThrows(Exception.class, () -> NativeSyncPolicy.parseEntry(JsonParser.parseString("{\"version\":1,\"kind\":\"deck\",\"collection\":\"x\",\"href\":\"x\",\"etag\":\"x\",\"body\":\"[]\",\"bytes\":2.5}").getAsJsonObject()));
    }
    @Test public void unchangedDavBodyIsReusedOnlyAfterFreshInventory() throws Exception {
        NativeResourceCache cache = cache(); cache.put(entry("dav", calendar, calendar + "a.ics", "\"same\"", "BEGIN:VCALENDAR\nEND:VCALENDAR"));
        List<String> requests = new ArrayList<>();
        engine(cache, (url, method, headers, body, max, remaining) -> {
            requests.add(method + " " + url); NativeSyncEngine.Reply discovery = discovery(url); if (discovery != null) return discovery;
            if (url.equals(calendar)) return reply(xml(row(calendar, "<d:resourcetype><d:collection/></d:resourcetype>") + row(calendar + "a.ics", "<d:getetag>&quot;same&quot;</d:getetag>")));
            fail("Unchanged resource should not download"); return null;
        }).run("dav");
        assertEquals(4, requests.size()); assertTrue(requests.stream().allMatch(request -> request.startsWith("PROPFIND ")));
    }
    @Test public void partialDownloadPersistsCompletedPrefixAndResumeSkipsIt() throws Exception {
        NativeResourceCache cache = cache(); AtomicBoolean failSecond = new AtomicBoolean(true); List<String> gets = new ArrayList<>();
        NativeSyncEngine.Network network = (url, method, headers, body, max, remaining) -> {
            NativeSyncEngine.Reply discovery = discovery(url); if (discovery != null) return discovery;
            if (url.equals(calendar)) return reply(xml(row(calendar, "") + row(calendar + "a.ics", "<d:getetag>&quot;a&quot;</d:getetag>") + row(calendar + "b.ics", "<d:getetag>&quot;b&quot;</d:getetag>")));
            gets.add(url); assertEquals(List.of(url.endsWith("a.ics") ? "\"a\"" : "\"b\""), headers.get("If-Match"));
            if (url.endsWith("b.ics") && failSecond.get()) throw NativeSyncPolicy.failure("TIMEOUT", "fixture");
            return new NativeSyncEngine.Reply(200, Map.of("etag", url.endsWith("a.ics") ? "\"a\"" : "\"b\""), "BEGIN:VCALENDAR\nEND:VCALENDAR");
        };
        assertThrows(Exception.class, () -> engine(cache, network).run("dav")); assertNotNull(cache.get(new NativeSyncPolicy.Locator("dav", calendar, calendar + "a.ics")));
        failSecond.set(false); engine(cache, network).run("dav");
        assertEquals(1, gets.stream().filter(url -> url.endsWith("a.ics")).count()); assertEquals(2, gets.stream().filter(url -> url.endsWith("b.ics")).count());
    }
    @Test public void malformedInventoryNeverPrunesExistingResources() throws Exception {
        NativeResourceCache cache = cache(); NativeSyncPolicy.Entry old = entry("dav", calendar, calendar + "old.ics", "\"old\"", "old"); cache.put(old);
        assertThrows(Exception.class, () -> engine(cache, (url,m,h,b,max,r) -> { var discovery = discovery(url); return discovery != null ? discovery : reply("<d:multistatus"); }).run("dav"));
        assertEquals(old, cache.get(old.locator()));
    }
    @Test public void missingResourceTypeOrCollectionSelfCannotPrune() throws Exception {
        NativeResourceCache cache = cache(); NativeSyncPolicy.Entry old = entry("dav", calendar, calendar + "old.ics", "\"old\"", "old"); cache.put(old);
        String incomplete = xml("<d:response><d:href>" + calendar + "</d:href><d:propstat><d:prop><d:resourcetype/></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat></d:response>");
        assertThrows(Exception.class, () -> engine(cache, (url,m,h,b,max,r) -> url.equals(base + "/remote.php/dav/calendars/user/") ? reply(incomplete) : discovery(url)).run("dav"));
        assertEquals(old, cache.get(old.locator()));
        assertThrows(Exception.class, () -> engine(cache, (url,m,h,b,max,r) -> { var discovery = discovery(url); return discovery != null ? discovery : reply(xml(row(calendar + "a.ics", "<d:getetag>&quot;a&quot;</d:getetag>"))); }).run("dav"));
        assertEquals(old, cache.get(old.locator()));
    }
    @Test public void deckCacheNeedsCompleteUniqueStacksAndCards() throws Exception {
        assertTrue(NativeSyncPolicy.completeDeckStacks(JsonParser.parseString("[{\"id\":1,\"title\":\"Todo\",\"cards\":[{\"id\":2,\"title\":\"Work\"}]}]")));
        for (String body : List.of("[{\"id\":1}]", "[{\"id\":1,\"title\":\"Todo\",\"cards\":[{\"id\":2}]}]", "[{\"id\":1,\"title\":\"Todo\",\"cards\":[{\"id\":2,\"title\":\"A\"},{\"id\":2,\"title\":\"B\"}]}]")) assertThrows(Exception.class, () -> cache().put(entry("deck", board, board + "/stacks", "\"a\"", body)));
    }
    @Test public void missingValidatorDoesNotFailSuccessfulReadOrCertifyCache() throws Exception {
        NativeResourceCache cache = cache();
        engine(cache, (url,m,h,b,max,r) -> reply(url.endsWith("/boards?details=true") ? "[{\"id\":12}]" : "[]")).run("deck");
        assertNull(cache.get(new NativeSyncPolicy.Locator("deck", board, board + "/stacks")));
    }
    @Test public void completeInventoryRemovesOnlyMissingResources() throws Exception {
        NativeResourceCache cache = cache(); NativeSyncPolicy.Entry old = entry("dav", calendar, calendar + "old.ics", "\"old\"", "old"); cache.put(old);
        engine(cache, (url,m,h,b,max,r) -> { var discovery = discovery(url); return discovery != null ? discovery : reply(xml(row(calendar, "<d:resourcetype><d:collection/></d:resourcetype>"))); }).run("dav");
        assertNull(cache.get(old.locator()));
    }
    @Test public void deckUsesConditionalGetAndValidatedBodyOn304() throws Exception {
        NativeResourceCache cache = cache(); NativeSyncPolicy.Entry old = entry("deck", board, board + "/stacks", "W/\"abc\"", "[]"); cache.put(old);
        List<String> requests = new ArrayList<>();
        engine(cache, (url,m,h,b,max,r) -> { requests.add(url); if (url.endsWith("/boards?details=true")) return reply("[{\"id\":12}]"); assertEquals(List.of("W/\"abc\""), h.get("If-None-Match")); return new NativeSyncEngine.Reply(304, Map.of(), ""); }).run("deck");
        assertEquals(2, requests.size()); assertEquals(old, cache.get(old.locator()));
    }
    @Test public void corruptCacheForcesReadAnd304CannotInventAResult() throws Exception {
        NativeResourceCache cache = cache();
        assertThrows(Exception.class, () -> engine(cache, (url,m,h,b,max,r) -> { if (url.endsWith("/boards?details=true")) return reply("[{\"id\":12}]"); assertFalse(h.containsKey("If-None-Match")); return new NativeSyncEngine.Reply(304, Map.of(), ""); }).run("deck"));
        assertNull(cache.get(new NativeSyncPolicy.Locator("deck", board, board + "/stacks")));
    }
    @Test public void budgetAndAccountCancellationStopLateWrites() throws Exception {
        AtomicLong now = new AtomicLong(); NativeResourceCache cache = cache();
        NativeSyncEngine engine = new NativeSyncEngine(base, (url,m,h,b,max,r) -> { now.set(90_001); return reply("[]"); }, cache, () -> {}, now::get, (s,c,t) -> {});
        NativeLoginFlow.Failure error = assertThrows(NativeLoginFlow.Failure.class, () -> engine.run("deck")); assertEquals("TIMEOUT", error.code);
        AtomicBoolean valid = new AtomicBoolean(true); NativeResourceCache protectedCache = new NativeResourceCache(temporary.getRoot(), "protected", base, () -> { if (!valid.get()) throw NativeSyncPolicy.failure("CANCELLED", "replaced"); });
        valid.set(false); assertEquals("CANCELLED", assertThrows(NativeLoginFlow.Failure.class, () -> protectedCache.put(entry("deck", board, board + "/stacks", "a", "[]"))).code);
    }
    @Test public void boundedCallerReturnsWhenExternalWorkHangs() throws Exception {
        AtomicBoolean cancelled = new AtomicBoolean(); long began = System.nanoTime();
        NativeLoginFlow.Failure error = assertThrows(NativeLoginFlow.Failure.class, () -> NativeDeadline.run(NativeDeadline.Lane.FOREGROUND, () -> { Thread.sleep(30_000); return 1; }, () -> cancelled.set(true), 25));
        assertEquals("TIMEOUT", error.code); assertTrue(cancelled.get()); assertTrue((System.nanoTime() - began) / 1_000_000 < 2000);
    }
    @Test public void externalEntitiesAndErrorInventoriesAreRejected() throws Exception {
        assertThrows(Exception.class, () -> NativeSyncEngine.parseDav("<!DOCTYPE x [<!ENTITY e SYSTEM 'file:///test'>]><d:multistatus xmlns:d='DAV:'>&e;</d:multistatus>"));
        assertThrows(Exception.class, () -> NativeSyncEngine.parseDav("<html>error</html>"));
        assertEquals(403, NativeSyncEngine.parseDav(xml("<d:response><d:href>" + calendar + "</d:href><d:status>HTTP/1.1 403 Forbidden</d:status></d:response>")).get(0).status());
    }
}
