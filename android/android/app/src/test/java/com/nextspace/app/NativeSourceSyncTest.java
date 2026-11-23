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
    NativeResourceCache cache() throws Exception { return new NativeResourceCache(temporary.getRoot(), "account", base, () -> {},(from,to)->{Files.move(from.toPath(),to.toPath(),java.nio.file.StandardCopyOption.ATOMIC_MOVE,java.nio.file.StandardCopyOption.REPLACE_EXISTING);return true;}); }
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

    NativeSyncEngine.Reply tokenDiscovery(String url,String token,String property){
        if(url.equals(base+"/remote.php/dav/calendars/user/"))return reply(xml(row(url,"<d:resourcetype><d:collection/></d:resourcetype>")+row(calendar,"<d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:sync-token>"+token+"</d:sync-token>"+property)));
        return discovery(url);
    }
    void forgetResourceIndexes()throws Exception{
        for(String name:List.of("INVENTORIES","VALIDATORS","SIZES","MUTATIONS")){var field=NativeResourceCache.class.getDeclaredField(name);field.setAccessible(true);((Map<?,?>)field.get(null)).clear();}
    }
    @Test public void completedPublishedInventorySkipsUnchangedListingAfterProcessRestart()throws Exception{
        NativeResourceCache cache=cache();cache.put(entry("dav",calendar,calendar+"a.ics","\"a\"","BEGIN:VCALENDAR\nEND:VCALENDAR"));
        List<String> requests=new ArrayList<>();NativeSyncEngine.Network network=(url,m,h,b,max,r)->{requests.add(url);var discovery=tokenDiscovery(url,"one","");return discovery!=null?discovery:reply(xml(row(calendar,"")+row(calendar+"a.ics","<d:getetag>&quot;a&quot;</d:getetag>")));};
        var initial=engine(cache,network);initial.run("dav");assertEquals(4,requests.size());
        // An un-published pass must never certify its token.
        requests.clear();var unpublished=engine(cache,network);unpublished.run("dav");assertEquals(4,requests.size());unpublished.projected();
        forgetResourceIndexes();requests.clear();List<String> replayed=new ArrayList<>();NativeResourceCache cold=cache();
        new NativeSyncEngine(base,network,cold,()->{},()->0,(s,c,t)->{},(url,reply)->{assertEquals(calendar,url);assertEquals(2,NativeSyncEngine.parseDav(reply.body()).size());replayed.add(url);}).run("dav");
        assertEquals(new NativeResourceCache.IoCounts(0,0),cold.ioCounts());
        assertEquals(3,requests.size());assertEquals(List.of(calendar),replayed);assertEquals(1,cache().list("dav",calendar).size());assertEquals(1,cache().snapshot("dav",Set.of()).size());
    }
    @Test public void emptyCompletedCollectionCanReuseButChangedPropertiesCannot()throws Exception{
        AtomicBoolean changed=new AtomicBoolean();List<String> requests=new ArrayList<>();
        NativeSyncEngine.Network network=(url,m,h,b,max,r)->{requests.add(url);var discovery=tokenDiscovery(url,"one",changed.get()?"<d:displayname>Renamed</d:displayname>":"");return discovery!=null?discovery:reply(xml(row(calendar,"")));};
        var initial=engine(cache(),network);initial.run("dav");initial.projected();requests.clear();engine(cache(),network).run("dav");assertEquals(3,requests.size());
        changed.set(true);requests.clear();engine(cache(),network).run("dav");assertEquals(4,requests.size());
    }
    @Test public void ctagIsRecognizedAndComponentAttributesInvalidateProof()throws Exception{
        AtomicBoolean changed=new AtomicBoolean();List<String> requests=new ArrayList<>();
        NativeSyncEngine.Network network=(url,m,h,b,max,r)->{requests.add(url);if(url.equals(base+"/remote.php/dav/calendars/user/"))return reply(xml(row(url,"<d:resourcetype><d:collection/></d:resourcetype>")+row(calendar,"<d:resourcetype><d:collection/><c:calendar/></d:resourcetype><cs:getctag xmlns:cs='http://calendarserver.org/ns/'>ctag-1</cs:getctag><c:supported-calendar-component-set><c:comp name='"+(changed.get()?"VEVENT":"VTODO")+"'/></c:supported-calendar-component-set>")));var discovery=discovery(url);return discovery!=null?discovery:reply(xml(row(calendar,"")));};
        var initial=engine(cache(),network);initial.run("dav");initial.projected();requests.clear();engine(cache(),network).run("dav");assertEquals(3,requests.size());changed.set(true);requests.clear();engine(cache(),network).run("dav");assertEquals(4,requests.size());
    }
    @Test public void localWritesMissingBodiesAndMalformedProofCannotReuseToken()throws Exception{
        NativeResourceCache cache=cache();var item=entry("dav",calendar,calendar+"a.ics","\"a\"","BEGIN:VCALENDAR\nEND:VCALENDAR");cache.put(item);
        List<String> requests=new ArrayList<>();NativeSyncEngine.Network network=(url,m,h,b,max,r)->{requests.add(m+" "+url);var discovery=tokenDiscovery(url,"one","");if(discovery!=null)return discovery;if(m.equals("GET"))return new NativeSyncEngine.Reply(200,Map.of("etag","\"a\""),item.body());return reply(xml(row(calendar,"")+row(item.href(),"<d:getetag>&quot;a&quot;</d:getetag>")));};
        var initial=engine(cache,network);initial.run("dav");initial.projected();cache.put(item);requests.clear();var afterWrite=engine(cache,network);afterWrite.run("dav");assertEquals(4,requests.size());afterWrite.projected();
        var directory=new java.io.File(temporary.getRoot(),NativeLoginFlow.digest("account"));var resource=new java.io.File(directory,NativeLoginFlow.digest("dav\0"+calendar+"\0"+item.href())+".json");assertTrue(resource.delete());requests.clear();var missing=engine(cache,network);missing.run("dav");assertEquals(5,requests.size());missing.projected();
        var marker=new java.io.File(directory,NativeLoginFlow.digest(calendar)+".inventory.json");Files.write(marker.toPath(),"{}".getBytes(StandardCharsets.UTF_8));requests.clear();engine(cache,network).run("dav");assertEquals(4,requests.size());
    }
    @Test public void failedChangedPassDoesNotRetainPreviousTokenAndDenialNeverReplays()throws Exception{
        AtomicBoolean changed=new AtomicBoolean(),denied=new AtomicBoolean();NativeResourceCache cache=cache();List<String> requests=new ArrayList<>();
        NativeSyncEngine.Network network=(url,m,h,b,max,r)->{requests.add(url);if(denied.get()&&url.equals(base+"/remote.php/dav/calendars/user/"))return new NativeSyncEngine.Reply(403,Map.of(),"");var discovery=tokenDiscovery(url,changed.get()?"two":"one","");if(discovery!=null)return discovery;if(changed.get())throw NativeSyncPolicy.failure("TIMEOUT","fixture");return reply(xml(row(calendar,"")));};
        var initial=engine(cache,network);initial.run("dav");initial.projected();changed.set(true);assertThrows(Exception.class,()->engine(cache,network).run("dav"));changed.set(false);requests.clear();engine(cache,network).run("dav");assertEquals(4,requests.size());denied.set(true);requests.clear();assertEquals("PERMISSION",assertThrows(NativeLoginFlow.Failure.class,()->engine(cache,network).run("dav")).code);assertEquals(3,requests.size());
    }
    @Test public void pendingProofCannotPublishAfterSameSizeSameTimestampWriteOrLateCancellation()throws Exception{
        NativeResourceCache cache=cache();var item=entry("dav",calendar,calendar+"a.ics","\"a\"","one");cache.put(item);
        var proof=cache.prepareInventory(calendar,"a".repeat(64),"sync-token","one",List.of(new NativeResourceCache.Metadata(item.href(),item.etag())));assertNotNull(proof);
        var directory=new java.io.File(temporary.getRoot(),NativeLoginFlow.digest("account"));var resource=new java.io.File(directory,NativeLoginFlow.digest("dav\0"+calendar+"\0"+item.href())+".json");long timestamp=resource.lastModified();
        cache.put(entry("dav",calendar,item.href(),item.etag(),"two"));assertTrue(resource.setLastModified(timestamp));cache.commitInventory(proof);assertNull(cache.reuseInventory(calendar,"a".repeat(64),"sync-token","one"));
        AtomicBoolean permitted=new AtomicBoolean(true);var guarded=new NativeResourceCache(temporary.getRoot(),"guarded",base,()->{if(!permitted.get())throw NativeSyncPolicy.failure("CANCELLED","fixture");});
        var empty=guarded.prepareInventory(calendar,"a".repeat(64),"sync-token","one",List.of());permitted.set(false);assertEquals("CANCELLED",assertThrows(NativeLoginFlow.Failure.class,()->guarded.commitInventory(empty)).code);permitted.set(true);assertNull(guarded.reuseInventory(calendar,"a".repeat(64),"sync-token","one"));
    }
    @Test public void coldWarmStageOpensNoRawFilesFor512PublishedUnchangedResources()throws Exception{
        NativeResourceCache cache=cache();StringBuilder listing=new StringBuilder(row(calendar,""));
        for(int index=0;index<512;index++){String href=calendar+index+".ics",etag="\""+index+"\"";cache.put(entry("dav",calendar,href,etag,"BEGIN:VCALENDAR\nEND:VCALENDAR"));listing.append(row(href,"<d:getetag>&quot;"+index+"&quot;</d:getetag>"));}
        List<String> requests=new ArrayList<>();NativeSyncEngine.Network network=(url,m,h,b,max,r)->{requests.add(url);var discovery=tokenDiscovery(url,"one","");return discovery!=null?discovery:reply(xml(listing.toString()));};
        var initial=engine(cache,network);initial.run("dav");initial.projected();assertEquals(512,cache.ioCounts().metadataReads());
        forgetResourceIndexes();requests.clear();NativeResourceCache cold=cache();engine(cold,network).run("dav");assertEquals(3,requests.size());assertEquals(new NativeResourceCache.IoCounts(0,0),cold.ioCounts());
    }
    @Test public void denialCorruptResourceAndAccountReplacementInvalidateInventoryReuse()throws Exception{
        NativeResourceCache cache=cache();var item=entry("dav",calendar,calendar+"a.ics","\"a\"","body");cache.put(item);String properties="a".repeat(64);
        var proof=cache.prepareInventory(calendar,properties,"sync-token","one",List.of(new NativeResourceCache.Metadata(item.href(),item.etag())));cache.commitInventory(proof);assertNotNull(cache.reuseInventory(calendar,properties,"sync-token","one"));
        var other=new NativeResourceCache(temporary.getRoot(),"another-account",base,()->{});assertNull(other.reuseInventory(calendar,properties,"sync-token","one"));
        cache.invalidateInventories("dav",calendar);assertNull(cache.reuseInventory(calendar,properties,"sync-token","one"));
        proof=cache.prepareInventory(calendar,properties,"sync-token","one",List.of(new NativeResourceCache.Metadata(item.href(),item.etag())));cache.commitInventory(proof);
        var directory=new java.io.File(temporary.getRoot(),NativeLoginFlow.digest("account"));var resource=new java.io.File(directory,NativeLoginFlow.digest("dav\0"+calendar+"\0"+item.href())+".json");Files.write(resource.toPath(),"broken".getBytes(StandardCharsets.UTF_8));assertNull(cache.reuseInventory(calendar,properties,"sync-token","one"));assertNull(cache.get(item.locator()));
        var pending=cache.prepareInventory(calendar,properties,"sync-token","one",List.of());cache.clear();cache.commitInventory(pending);assertNull(cache.reuseInventory(calendar,properties,"sync-token","one"));
    }

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
