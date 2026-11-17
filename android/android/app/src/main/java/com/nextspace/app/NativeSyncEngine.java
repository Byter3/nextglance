package com.nextspace.app;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.StringReader;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.LongSupplier;
import javax.xml.parsers.DocumentBuilderFactory;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.xml.sax.InputSource;
import org.xml.sax.helpers.DefaultHandler;

/** Read-only native cache warmer. Shared JS remains the only normalized-record projector. */
final class NativeSyncEngine {
    record Reply(int status, Map<String, String> headers, String body) {}
    interface Network { Reply request(String url, String method, Map<String, List<String>> headers, String body, int maxBytes, long remainingMillis) throws Exception; }
    interface Progress { void update(String stage, int completed, int total) throws Exception; }
    private final String base;
    private final Network network;
    private final NativeResourceCache cache;
    private final NativeResourceCache.Guard guard;
    private final LongSupplier clock;
    private final Progress progress;
    private final long deadline;
    private int completed;
    NativeSyncEngine(String base, Network network, NativeResourceCache cache, NativeResourceCache.Guard guard, LongSupplier clock, Progress progress) {
        this.base = base.replaceAll("/+$", ""); this.network = network; this.cache = cache; this.guard = guard; this.clock = clock; this.progress = progress;
        deadline = clock.getAsLong() + NativeSyncPolicy.JOB_MILLIS;
    }
    void run(String kind) throws Exception { check(); if ("dav".equals(kind)) dav(); else if ("deck".equals(kind)) deck(); else throw NativeSyncPolicy.failure("VALIDATION", "Unknown background source."); }
    private void check() throws Exception {
        guard.check(); if (clock.getAsLong() >= deadline) throw NativeSyncPolicy.failure("TIMEOUT", "Background source check reached its 90-second budget. Saved downloads will be reused on the next check.");
    }
    private Reply request(String url, String method, Map<String, List<String>> headers, String body, int max) throws Exception {
        check(); NativeRequestPolicy.checkedTarget(base, url);
        Reply result = network.request(url, method, headers, body, max, Math.min(NativeSyncPolicy.REQUEST_MILLIS, deadline - clock.getAsLong()));
        check(); if (result.status() == 401) throw NativeSyncPolicy.failure("AUTH", "Nextcloud authorization expired. Reconnect to continue background checks.");
        return result;
    }
    private String url(String value) throws Exception {
        URI origin = new URI(base + "/"); URI resolved = origin.resolve(value); NativeRequestPolicy.checkedTarget(base, resolved.toString()); return resolved.toString();
    }
    private static void success(Reply reply) throws Exception {
        if (reply.status() == 403) throw NativeSyncPolicy.failure("PERMISSION", "Nextcloud denied access to this source. Review its permissions.");
        if (reply.status() < 200 || reply.status() >= 300) throw NativeSyncPolicy.failure("NEXTCLOUD", "Nextcloud could not complete the source check (HTTP " + reply.status() + "). Retry later.");
    }
    private List<DavRow> propfind(String url, String properties, int depth) throws Exception {
        Reply reply = request(url, "PROPFIND", Map.of("Depth", List.of(String.valueOf(depth)), "Content-Type", List.of("application/xml; charset=utf-8")),
                "<?xml version=\"1.0\"?><d:propfind xmlns:d=\"DAV:\" xmlns:c=\"urn:ietf:params:xml:ns:caldav\" xmlns:a=\"http://apple.com/ns/ical/\" xmlns:cs=\"http://calendarserver.org/ns/\"><d:prop>" + properties + "</d:prop></d:propfind>", NativeSyncPolicy.RESPONSE_BYTES);
        success(reply); List<DavRow> rows = parseDav(reply.body());
        if (rows.isEmpty()) throw NativeSyncPolicy.failure("FORMAT", "Nextcloud returned an empty calendar listing without its collection resource.");
        return rows;
    }
    private void dav() throws Exception {
        progress.update("discovery", 0, 0);
        List<DavRow> principals = propfind(base + "/remote.php/dav/", "<d:current-user-principal/>", 0);
        String principal = propertyHref(principals, "current-user-principal");
        if (principal == null) throw NativeSyncPolicy.failure("FORMAT", "Nextcloud returned no calendar principal.");
        List<DavRow> homes = propfind(url(principal), "<c:calendar-home-set/><c:calendar-user-address-set/><c:schedule-outbox-URL/><d:displayname/>", 0);
        String home = propertyHref(homes, "calendar-home-set");
        if (home == null) throw NativeSyncPolicy.failure("FORMAT", "Nextcloud returned no calendar home.");
        String outbox = propertyHref(homes,"schedule-outbox-URL");
        if(outbox!=null && homes.stream().anyMatch(row->row.props.containsKey("calendar-user-address-set"))) {
            try {propfind(url(outbox),"<d:current-user-privilege-set/>",0);}
            catch(NativeLoginFlow.Failure unavailable) {if(!Set.of("PERMISSION","NEXTCLOUD").contains(unavailable.code))throw unavailable;}
        }
        List<DavRow> rows = propfind(url(home), "<d:displayname/><d:resourcetype/><d:owner/><c:supported-calendar-component-set/><d:current-user-privilege-set/><a:calendar-color/><d:sync-token/><cs:getctag/>", 1);
        requireCompleteInventory(rows, url(home));
        Set<String> collections = new HashSet<>();
        for (DavRow row : rows) {
            if (row.status >= 400) throw NativeSyncPolicy.failure("PERMISSION", "Calendar discovery was incomplete. Existing cached sources were retained.");
            Element type = row.props.get("resourcetype");
            if (type == null || type.getElementsByTagNameNS("urn:ietf:params:xml:ns:caldav", "calendar").getLength() == 0) continue;
            String collection = url(row.href); if (!collection.endsWith("/")) collection += "/";
            NativeSyncPolicy.locator(base, new NativeSyncPolicy.Locator("dav", collection, collection + "validation.ics")); collections.add(collection);
        }
        check(); cache.retain("dav", collections);
        for (String collection : collections.stream().sorted().toList()) {
            check(); List<DavRow> resources;
            try { resources = propfind(collection, "<d:getetag/><d:resourcetype/>", 1); }
            catch (NativeLoginFlow.Failure error) {
                if ("PERMISSION".equals(error.code)) cache.prune("dav", collection, Set.of());
                throw error;
            }
            requireCompleteInventory(resources, collection);
            List<DavResource> inventory = new ArrayList<>(); Set<String> hrefs = new HashSet<>();
            for (DavRow row : resources) {
                if (row.status >= 400) throw NativeSyncPolicy.failure("FORMAT", "A calendar listing was incomplete. Existing entries were retained.");
                String href = url(row.href);
                if (href.equals(collection) || (href + "/").equals(collection)) continue;
                if (row.props.get("resourcetype").getElementsByTagNameNS("DAV:", "collection").getLength() > 0) throw NativeSyncPolicy.failure("FORMAT", "A calendar resource listing unexpectedly contained a nested collection.");
                NativeSyncPolicy.Locator locator = new NativeSyncPolicy.Locator("dav", collection, href); NativeSyncPolicy.locator(base, locator);
                if (!hrefs.add(href)) throw NativeSyncPolicy.failure("FORMAT", "Nextcloud returned duplicate calendar resources.");
                Element etag = row.props.get("getetag"); inventory.add(new DavResource(locator, etag == null ? "" : etag.getTextContent()));
            }
            // Only this complete, structurally checked inventory can remove missing resources.
            check(); cache.prune("dav", collection, hrefs);
            int total = completed + inventory.size();
            Map<String, String> savedEtags = new HashMap<>();
            for (var saved : cache.list("dav", collection)) savedEtags.put(saved.href(), saved.etag());
            for (DavResource resource : inventory) {
                check(); progress.update("source-read", completed, total);
                String savedEtag = savedEtags.get(resource.locator.href());
                if (NativeSyncPolicy.strongEtag(resource.etag) && resource.etag.equals(savedEtag)) { completed++; continue; }
                Map<String, List<String>> headers = NativeSyncPolicy.strongEtag(resource.etag) ? Map.of("If-Match", List.of(resource.etag)) : Map.of();
                Reply reply = request(resource.locator.href(), "GET", headers, null, NativeSyncPolicy.DAV_BYTES);
                if (reply.status() == 403) cache.remove(resource.locator);
                success(reply);
                String etag = reply.headers().getOrDefault("etag", "");
                if (NativeSyncPolicy.strongEtag(resource.etag) && !etag.isEmpty() && !etag.equals(resource.etag)) throw NativeSyncPolicy.failure("CONFLICT", "A calendar resource changed during the check. Retry to read its current version.");
                if (reply.body().isEmpty()) throw NativeSyncPolicy.failure("FORMAT", "Nextcloud returned an empty calendar resource.");
                check(); String cacheEtag = etag.isEmpty() ? resource.etag : etag;
                if (NativeSyncPolicy.cacheEtag("dav", cacheEtag)) cache.put(new NativeSyncPolicy.Entry(1, "dav", collection, resource.locator.href(), cacheEtag, reply.body(), reply.body().getBytes(StandardCharsets.UTF_8).length));
                else cache.remove(resource.locator);
                completed++;
            }
        }
    }
    private void deck() throws Exception {
        progress.update("discovery", 0, 0);
        Reply boardsReply = request(base + "/index.php/apps/deck/api/v1.0/boards?details=true", "GET", Map.of(), null, NativeSyncPolicy.RESPONSE_BYTES); success(boardsReply);
        JsonElement parsed;
        try { parsed = JsonParser.parseString(boardsReply.body()); } catch (Exception malformed) { throw NativeSyncPolicy.failure("FORMAT", "Nextcloud returned an invalid Deck inventory."); }
        if (!parsed.isJsonArray()) throw NativeSyncPolicy.failure("FORMAT", "Nextcloud returned an incomplete Deck inventory.");
        Set<String> collections = new HashSet<>();
        for (JsonElement element : parsed.getAsJsonArray()) {
            if (!element.isJsonObject() || !element.getAsJsonObject().has("id")) throw NativeSyncPolicy.failure("FORMAT", "Nextcloud returned an invalid Deck board.");
            JsonObject board = element.getAsJsonObject(); String id = NativeSyncPolicy.nativeId(board.get("id"));
            if (id == null) throw NativeSyncPolicy.failure("FORMAT", "Nextcloud returned an invalid Deck board identity.");
            String collection = base + "/index.php/apps/deck/api/v1.0/boards/" + id;
            if (!collections.add(collection)) throw NativeSyncPolicy.failure("FORMAT", "Nextcloud returned duplicate Deck boards.");
        }
        check(); cache.retain("deck", collections);
        for (String collection : collections.stream().sorted().toList()) {
            check(); progress.update("source-read", completed, collections.size());
            NativeSyncPolicy.Locator key = new NativeSyncPolicy.Locator("deck", collection, collection + "/stacks");
            NativeSyncPolicy.Entry existing = cache.get(key);
            Map<String, List<String>> headers = existing != null && !existing.etag().isEmpty() ? Map.of("If-None-Match", List.of(existing.etag())) : Map.of();
            Reply reply = request(key.href(), "GET", headers, null, NativeSyncPolicy.RESPONSE_BYTES);
            if (reply.status() == 304 && existing != null && !existing.etag().isEmpty()) { completed++; continue; }
            if (reply.status() == 403) cache.remove(key);
            success(reply);
            NativeSyncPolicy.Entry entry = new NativeSyncPolicy.Entry(1, "deck", collection, key.href(), reply.headers().getOrDefault("etag", ""), reply.body(), reply.body().getBytes(StandardCharsets.UTF_8).length);
            check();
            if (NativeSyncPolicy.cacheEtag("deck", entry.etag())) cache.put(entry);
            else { if (!NativeSyncPolicy.completeDeckStacks(JsonParser.parseString(reply.body()))) throw NativeSyncPolicy.failure("FORMAT", "Nextcloud returned invalid Deck stacks."); cache.remove(key); }
            completed++;
        }
    }
    record DavResource(NativeSyncPolicy.Locator locator, String etag) {}
    record DavRow(String href, int status, Map<String, Element> props) {}
    private void requireCompleteInventory(List<DavRow> rows, String collection) throws Exception {
        boolean self = false; Set<String> hrefs = new HashSet<>();
        for (DavRow row : rows) {
            String href = url(row.href); Element type = row.props.get("resourcetype");
            if (row.status >= 400 || type == null || !hrefs.add(href)) throw NativeSyncPolicy.failure("FORMAT", "Calendar inventory was incomplete. Existing cached resources were retained.");
            if (href.replaceAll("/+$", "").equals(collection.replaceAll("/+$", ""))) {
                if (self || type.getElementsByTagNameNS("DAV:", "collection").getLength() == 0) throw NativeSyncPolicy.failure("FORMAT", "Nextcloud returned an invalid calendar collection resource.");
                self = true;
            }
        }
        if (!self) throw NativeSyncPolicy.failure("FORMAT", "Calendar inventory omitted its collection resource. Existing cached resources were retained.");
    }
    static List<DavRow> parseDav(String xml) throws Exception {
        try {
            if (xml == null || xml.contains("<!DOCTYPE") || xml.contains("<!ENTITY")) throw new IllegalArgumentException();
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance(); factory.setNamespaceAware(true);
            factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
            factory.setFeature("http://xml.org/sax/features/external-general-entities", false); factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
            var builder = factory.newDocumentBuilder(); builder.setErrorHandler(new DefaultHandler());
            Element root = builder.parse(new InputSource(new StringReader(xml))).getDocumentElement();
            if (!"multistatus".equals(root.getLocalName()) || !"DAV:".equals(root.getNamespaceURI())) throw new IllegalArgumentException();
            List<DavRow> result = new ArrayList<>();
            for (Element response : children(root, "response")) {
                List<Element> hrefs = children(response, "href"); if (hrefs.size() != 1 || hrefs.get(0).getTextContent().isEmpty()) throw new IllegalArgumentException();
                Map<String, Element> props = new HashMap<>(); int status = 200;
                for (Element direct : children(response, "status")) status = status(direct.getTextContent());
                for (Element propstat : children(response, "propstat")) {
                    List<Element> statuses = children(propstat, "status"); if (statuses.size() != 1) throw new IllegalArgumentException();
                    int code = status(statuses.get(0).getTextContent());
                    if (code == 200) {
                        for (Element prop : children(propstat, "prop")) for (Node node = prop.getFirstChild(); node != null; node = node.getNextSibling()) if (node instanceof Element && List.of("DAV:", "urn:ietf:params:xml:ns:caldav").contains(node.getNamespaceURI())) props.put(node.getLocalName(), (Element) node);
                    } else if (code != 404) status = code;
                }
                result.add(new DavRow(hrefs.get(0).getTextContent(), status, props));
            }
            return result;
        } catch (Exception error) { throw NativeSyncPolicy.failure("FORMAT", "Nextcloud returned a malformed or incomplete calendar listing."); }
    }
    private static int status(String value) { var match = java.util.regex.Pattern.compile("^HTTP/[^ ]+ ([1-5][0-9]{2})(?: .*|)$").matcher(value.trim()); if (!match.matches()) throw new IllegalArgumentException(); return Integer.parseInt(match.group(1)); }
    private static List<Element> children(Element parent, String name) { List<Element> result = new ArrayList<>(); for (Node node = parent.getFirstChild(); node != null; node = node.getNextSibling()) if (node instanceof Element && name.equals(node.getLocalName()) && "DAV:".equals(node.getNamespaceURI())) result.add((Element) node); return result; }
    private static String propertyHref(List<DavRow> rows, String name) { for (DavRow row : rows) { Element prop = row.props.get(name); if (prop != null) { var hrefs = prop.getElementsByTagNameNS("DAV:", "href"); if (hrefs.getLength() > 0) return hrefs.item(0).getTextContent(); } } return null; }
}
