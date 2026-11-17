package com.nextspace.app;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.HashMap;
import java.util.Locale;
import java.io.StringReader;
import javax.xml.parsers.DocumentBuilderFactory;
import org.xml.sax.InputSource;
import org.xml.sax.SAXParseException;
import org.xml.sax.helpers.DefaultHandler;
import com.google.gson.JsonObject;
import com.google.gson.JsonElement;
import com.google.gson.JsonParser;
import com.google.gson.Strictness;
import com.google.gson.stream.JsonReader;
import com.google.gson.stream.JsonToken;
/** Framework-free account, origin and scoped native/metadata-write boundary. */
final class NativeRequestPolicy {
    private static final int MAX_QUERY = 1024 * 1024;
    private static final int MAX_METADATA = 8 * 1024 * 1024;
    static String davReadMode(String transport) {
        return "direct".equals(transport) ? "report" : "propfind-get";
    }
    static String nativeEdits(String transport) {
        return "direct".equals(transport) || "sso".equals(transport) ? "notes-dates-scheduling" : null;
    }

    static void checkedRequest(String transport, String base, String username, String target, String method,
                               Map<String, List<String>> headers, String body) throws Exception {
        if ("REPORT".equals(method) && !"report".equals(davReadMode(transport)))
            throw new NativeLoginFlow.Failure("UNAVAILABLE", "The Nextcloud Files SSO service does not support CalDAV REPORT. Use the DAV listing reader.");
        if (!List.of("GET", "HEAD", "PROPFIND", "REPORT", "SEARCH", "PUT", "MKCOL", "POST", "DELETE").contains(method))
            throw new NativeLoginFlow.Failure("UNAVAILABLE", "This native operation is not available on this client yet.");
        checkedTarget(base, target);
        if ("SEARCH".equals(method)) {
            if(!"direct".equals(transport)||!new URI(target).getPath().equals(trimTrailingSlashes(new URI(base).getPath())+"/remote.php/dav/")||new URI(target).getRawQuery()!=null||body==null||body.getBytes(StandardCharsets.UTF_8).length>MAX_QUERY||body.toUpperCase(Locale.ROOT).contains("<!DOCTYPE")||body.toUpperCase(Locale.ROOT).contains("<!ENTITY")||!body.contains("<oc:fileid/>")||!body.contains("<d:nresults>2</d:nresults>"))throw new NativeLoginFlow.Failure("VALIDATION","Only bounded immutable file lookup is supported.");
            return;
        }
        if (List.of("PUT", "MKCOL", "POST", "DELETE").contains(method)) {
            if ("MKCOL".equals(method) || new URI(target).getPath().contains("/remote.php/dav/files/"))
                checkedMetadataWrite(base, username, target, method, headers, body);
            else {
                if (nativeEdits(transport) == null) throw new NativeLoginFlow.Failure("UNAVAILABLE", "Native editing is not available through this connection.");
                checkedNativeWrite(base, username, target, method, headers, body);
            }
            return;
        }
        if ("REPORT".equals(method) && body != null && body.getBytes(StandardCharsets.UTF_8).length > MAX_QUERY)
            throw new NativeLoginFlow.Failure("LIMIT", "The CalDAV query exceeds the size limit.");
        if (body != null && (body.getBytes(StandardCharsets.UTF_8).length > MAX_QUERY || !List.of("PROPFIND", "REPORT").contains(method)))
            throw new NativeLoginFlow.Failure("VALIDATION", "Only bounded DAV query bodies are supported.");
        if ("REPORT".equals(method)) checkedCalendarQuery(base, target, headers, body);
    }

    private static Map<String, String> singleHeaders(Map<String, List<String>> headers) throws Exception {
        Map<String, String> normalized = new HashMap<>();
        for (Map.Entry<String, List<String>> entry : headers.entrySet()) {
            String name = entry.getKey().toLowerCase(Locale.ROOT);
            if (normalized.containsKey(name) || entry.getValue() == null || entry.getValue().size() != 1 || entry.getValue().get(0) == null)
                throw new NativeLoginFlow.Failure("VALIDATION", "Ambiguous native write headers.");
            normalized.put(name, entry.getValue().get(0));
        }
        return normalized;
    }

    private static void conditional(Map<String, String> headers, boolean create) throws Exception {
        String match = headers.get("if-match"), none = headers.get("if-none-match");
        if (create && match == null && "*".equals(none)) return;
        if (none == null && match != null && match.length() <= 1000 && match.matches("\"[\\x21\\x23-\\x7e\\x80-\\xff]+\"")) return;
        throw new NativeLoginFlow.Failure("VALIDATION", "A native write requires its exact version or a create-only condition.");
    }

    private static JsonObject jsonBody(Map<String, String> headers, String body) throws Exception {
        if (!headers.getOrDefault("content-type", "").toLowerCase(Locale.ROOT).matches("application/json(?:\\s*;.*)?") || body == null)
            throw new NativeLoginFlow.Failure("VALIDATION", "A native JSON object is required.");
        try {
            JsonReader reader = new JsonReader(new StringReader(body));
            reader.setStrictness(Strictness.STRICT);
            JsonElement value = JsonParser.parseReader(reader);
            if (!value.isJsonObject() || reader.peek() != JsonToken.END_DOCUMENT) throw new IllegalArgumentException();
            return value.getAsJsonObject();
        } catch (Exception malformed) { throw new NativeLoginFlow.Failure("VALIDATION", "A valid native JSON object is required."); }
    }

    private static void fields(JsonObject value, List<String> allowed, List<String> required) throws Exception {
        if (value.size() == 0 || !allowed.containsAll(value.keySet()) || !value.keySet().containsAll(required))
            throw new NativeLoginFlow.Failure("VALIDATION", "This native write contains unsupported fields.");
    }

    private static boolean string(JsonObject value, String name) {
        return value.has(name) && value.get(name).isJsonPrimitive() && value.getAsJsonPrimitive(name).isString();
    }

    private static void noteFields(JsonObject value, boolean create) throws Exception {
        List<String> allowed = List.of("title", "content", "category");
        fields(value, allowed, create ? allowed : List.of());
        for (String name : allowed) {
            if (!value.has(name)) continue;
            int limit = "title".equals(name) ? 500 : "content".equals(name) ? 500000 : 200;
            if (!string(value, name)) throw new NativeLoginFlow.Failure("VALIDATION", "The note fields are invalid.");
            String text = value.get(name).getAsString();
            if (text.length() > limit || text.indexOf(0) >= 0 || "title".equals(name) && text.trim().isEmpty() ||
                    "category".equals(name) && text.chars().anyMatch(character -> character <= 31))
                throw new NativeLoginFlow.Failure("VALIDATION", "The note fields are invalid.");
        }
    }

    static void checkedNativeWrite(String base, String username, String target, String method, Map<String, List<String>> rawHeaders, String body) throws Exception {
        URI uri = checkedTarget(base, target);
        int offset = trimTrailingSlashes(new URI(base).getPath()).length() + 1;
        if (uri.getPath().length() <= offset) throw new NativeLoginFlow.Failure("VALIDATION", "A native source resource path is required.");
        String path = uri.getPath().substring(offset);
        Map<String, String> headers = singleHeaders(rawHeaders);
        if (body != null && body.getBytes(StandardCharsets.UTF_8).length > MAX_METADATA)
            throw new NativeLoginFlow.Failure("LIMIT", "The native write exceeds its body limit.");

        boolean share="POST".equals(method)&&"ocs/v2.php/apps/files_sharing/api/v1/shares".equals(path)&&"format=json".equals(uri.getRawQuery());
        boolean detach="DELETE".equals(method)&&path.matches("index\\.php/apps/deck/api/v1\\.1/boards/[1-9]\\d*/stacks/[1-9]\\d*/cards/[1-9]\\d*/attachments/[1-9]\\d*")&&"type=file".equals(uri.getRawQuery());
        if(uri.getRawQuery()!=null&&!share&&!detach)throw new NativeLoginFlow.Failure("VALIDATION","Unsupported native query parameters.");
        if(share){
            JsonObject value=jsonBody(headers,body);List<String> allowed=List.of("path","shareType","shareWith","permissions");fields(value,allowed,allowed);
            if(!string(value,"path")||!value.get("path").getAsString().startsWith("/")||value.get("path").getAsString().length()>4096||value.get("path").getAsString().chars().anyMatch(c->c<32||c==92)||List.of(value.get("path").getAsString().split("/")).stream().anyMatch(p->p.equals(".")||p.equals(".."))||!value.get("shareType").isJsonPrimitive()||!value.getAsJsonPrimitive("shareType").isNumber()||value.get("shareType").getAsDouble()!=12||!value.get("permissions").isJsonPrimitive()||!value.getAsJsonPrimitive("permissions").isNumber()||value.get("permissions").getAsDouble()!=1||!value.get("shareWith").isJsonPrimitive()||!value.get("shareWith").getAsString().matches("[1-9]\\d{0,15}")||Double.parseDouble(value.get("shareWith").getAsString())>9007199254740991d)throw new NativeLoginFlow.Failure("VALIDATION","Only a read-only file share to a Deck card is allowed.");
            return;
        }
        if(detach){if(body!=null&&!body.isEmpty())throw new NativeLoginFlow.Failure("VALIDATION","Attachment deletion requires an empty body.");return;}
        String deckCard = "index\\.php/apps/deck/api/v1\\.0/boards/[1-9]\\d*/stacks/[1-9]\\d*/cards/[1-9]\\d*/";
        if (List.of("POST", "DELETE").contains(method) && path.matches(deckCard + "dependentCards/[1-9]\\d*")) {
            deckVersion(headers);
            if (body != null && !body.isEmpty()) throw new NativeLoginFlow.Failure("VALIDATION", "A Deck dependency change requires an empty body.");
            return;
        }
        if ("PUT".equals(method) && path.matches(deckCard + "(reorder|assignLabel|removeLabel)")) {
            deckVersion(headers);
            JsonObject value = jsonBody(headers, body);
            boolean reorder = path.endsWith("/reorder");
            List<String> allowed = reorder ? List.of("stackId", "order") : List.of("labelId");
            fields(value, allowed, allowed);
            JsonElement id = value.get(reorder ? "stackId" : "labelId");
            boolean valid = id.isJsonPrimitive() && id.getAsJsonPrimitive().isNumber() && Double.isFinite(id.getAsDouble()) && id.getAsDouble() > 0 && id.getAsDouble() <= 9007199254740991d && Math.floor(id.getAsDouble()) == id.getAsDouble();
            if (reorder) valid &= value.get("order").isJsonPrimitive() && value.getAsJsonPrimitive("order").isNumber() && value.get("order").getAsDouble() == 99999d;
            if (reorder && valid) valid = path.contains("/stacks/" + id.getAsLong() + "/cards/");
            if (!valid) throw new NativeLoginFlow.Failure("VALIDATION", "Invalid Deck stack or label change.");
            return;
        }
        if ("POST".equals(method) && path.matches("index\\.php/apps/deck/api/v1\\.0/boards/[1-9]\\d*/labels")) {
            JsonObject value = jsonBody(headers, body);
            fields(value, List.of("title", "color"), List.of("title", "color"));
            if (headers.containsKey("if-match") || headers.containsKey("if-none-match") || !string(value, "title") || value.get("title").getAsString().trim().isEmpty() || value.get("title").getAsString().length() > 100 || value.get("title").getAsString().chars().anyMatch(character -> character <= 31) || !string(value, "color") || !value.get("color").getAsString().matches("[0-9a-fA-F]{6}")) throw new NativeLoginFlow.Failure("VALIDATION", "Invalid native Deck label.");
            return;
        }
        if("DELETE".equals(method)&&path.matches("remote\\.php/dav/calendars/[^/]+/[^/]+/[^/]+")){conditional(headers,false);if(body!=null&&!body.isEmpty())throw new NativeLoginFlow.Failure("VALIDATION","Event deletion requires an empty body.");return;}
        if ("POST".equals(method) && "index.php/apps/notes/api/v1/notes".equals(path)) {
            if (headers.containsKey("if-match") || headers.containsKey("if-none-match"))
                throw new NativeLoginFlow.Failure("VALIDATION", "Note creation does not accept a version condition.");
            noteFields(jsonBody(headers, body), true); return;
        }
        if ("PUT".equals(method) && path.matches("index\\.php/apps/notes/api/v1/notes/[1-9]\\d*")) {
            conditional(headers, false); noteFields(jsonBody(headers, body), false); return;
        }
        if ("POST".equals(method) && "remote.php/dav/systemtags/".equals(path)) {
            JsonObject value = jsonBody(headers, body);
            List<String> allowed = List.of("name", "userVisible", "userAssignable");
            fields(value, allowed, allowed);
            if (!string(value, "name") || value.get("name").getAsString().trim().isEmpty() || value.get("name").getAsString().trim().getBytes(StandardCharsets.UTF_8).length > 64 ||
                    value.get("name").getAsString().chars().anyMatch(character -> character <= 31) ||
                    !value.get("userVisible").isJsonPrimitive() || !value.getAsJsonPrimitive("userVisible").isBoolean() || !value.get("userVisible").getAsBoolean() ||
                    !value.get("userAssignable").isJsonPrimitive() || !value.getAsJsonPrimitive("userAssignable").isBoolean() || !value.get("userAssignable").getAsBoolean())
                throw new NativeLoginFlow.Failure("VALIDATION", "Only visible, assignable native tags may be created.");
            return;
        }
        if (List.of("PUT", "DELETE").contains(method) && path.matches("remote\\.php/dav/systemtags-relations/files/[1-9]\\d*/[1-9]\\d*")) {
            if (body != null && !body.isEmpty()) throw new NativeLoginFlow.Failure("VALIDATION", "Native tag assignment changes must have an empty body.");
            return;
        }
        if ("PUT".equals(method) && path.matches("remote\\.php/dav/calendars/[^/]+/[^/]+/[^/]+")) {
            conditional(headers, true);
            if (!headers.getOrDefault("content-type", "").toLowerCase(Locale.ROOT).matches("text/calendar(?:\\s*;.*)?") || body == null ||
                    !java.util.regex.Pattern.compile("^BEGIN:VCALENDAR\\r?\\n").matcher(body).find() || !java.util.regex.Pattern.compile("(?:^|\\n)END:VCALENDAR$").matcher(body.trim()).find() || !java.util.regex.Pattern.compile("(?m)^BEGIN:V(?:EVENT|TODO)\\r?$").matcher(body).find() || body.indexOf(0) >= 0)
                throw new NativeLoginFlow.Failure("VALIDATION", "A bounded native calendar resource is required.");
            return;
        }
        if ("POST".equals(method) && path.matches("index\\.php/apps/deck/api/v1\\.0/boards/[1-9]\\d*/stacks/[1-9]\\d*/cards")) {
            JsonObject value = jsonBody(headers, body);
            List<String> allowed = List.of("title", "type", "order", "description", "startdate", "duedate", "users");
            fields(value, allowed, allowed);
            boolean valid = !headers.containsKey("if-match") && !headers.containsKey("if-none-match");
            for (String name : List.of("title", "description")) {
                valid &= string(value, name) && value.get(name).getAsString().length() <= (name.equals("title") ? 255 : 500000) && value.get(name).getAsString().indexOf(0) < 0;
            }
            valid &= string(value, "title") && !value.get("title").getAsString().trim().isEmpty() && string(value, "type") && "plain".equals(value.get("type").getAsString());
            valid &= value.get("order").isJsonPrimitive() && value.getAsJsonPrimitive("order").isNumber() && value.get("order").getAsDouble() == 99999d;
            for (String name : List.of("startdate", "duedate")) valid &= value.get(name).isJsonNull() || string(value, name) && value.get(name).getAsString().matches("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z");
            valid &= value.get("users").isJsonArray() && value.getAsJsonArray("users").size() <= 1;
            if (valid) for (JsonElement assignment : value.getAsJsonArray("users")) {
                if (!assignment.isJsonObject()) { valid = false; break; }
                JsonObject user = assignment.getAsJsonObject();
                fields(user, List.of("id", "type"), List.of("id", "type"));
                valid &= string(user, "id") && username.equals(user.get("id").getAsString()) && user.get("type").isJsonPrimitive() && user.getAsJsonPrimitive("type").isNumber() && user.get("type").getAsDouble() == 0d;
            }
            if (!valid) throw new NativeLoginFlow.Failure("VALIDATION", "The Deck card creation fields are invalid.");
            return;
        }
        if ("PUT".equals(method) && path.matches("index\\.php/apps/deck/api/v1\\.0/boards/[1-9]\\d*/stacks/[1-9]\\d*/cards/[1-9]\\d*")) {
            JsonObject value = jsonBody(headers, body);
            List<String> allowed = List.of("title", "type", "owner", "description", "order", "startdate", "duedate", "archived", "done", "color");
            fields(value, allowed, allowed);
            deckVersion(headers);
            boolean valid = List.of("title", "type", "owner", "description").stream().allMatch(name -> string(value, name)) && !value.get("owner").getAsString().isEmpty();
            JsonElement order = value.get("order");
            valid &= order.isJsonPrimitive() && order.getAsJsonPrimitive().isNumber() && Double.isFinite(order.getAsDouble()) && Math.floor(order.getAsDouble()) == order.getAsDouble();
            valid &= value.get("archived").isJsonPrimitive() && value.getAsJsonPrimitive("archived").isBoolean();
            for (String name : List.of("startdate", "duedate", "color")) valid &= value.get(name).isJsonNull() || string(value, name);
            valid &= value.get("done").isJsonNull() || value.get("done").isJsonPrimitive();
            if (!valid) throw new NativeLoginFlow.Failure("VALIDATION", "The Deck date update is not a complete current card.");
            return;
        }
        throw new NativeLoginFlow.Failure("VALIDATION", "This native operation is not available on this client yet.");
    }

    private static void deckVersion(Map<String, String> headers) throws Exception {
        String version = headers.get("if-match");
        if (headers.containsKey("if-none-match") || version != null && (version.isEmpty() || "*".equals(version) || version.length() > 1000 || version.chars().anyMatch(character -> character <= 31 || character == 127))) throw new NativeLoginFlow.Failure("VALIDATION", "Invalid Deck version condition.");
    }

    private static void checkedCalendarQuery(String base, String target, Map<String, List<String>> headers, String body) throws Exception {
        String contentType = null;
        for (Map.Entry<String, List<String>> header : headers.entrySet()) {
            if (!"content-type".equalsIgnoreCase(header.getKey())) continue;
            if (contentType != null || header.getValue() == null || header.getValue().size() != 1)
                throw new NativeLoginFlow.Failure("VALIDATION", "A single XML query content type is required.");
            contentType = header.getValue().get(0);
        }
        if (body == null || body.trim().isEmpty() || contentType == null ||
                !contentType.toLowerCase(Locale.ROOT).matches("(?:application|text)/xml(?:\\s*;.*)?"))
            throw new NativeLoginFlow.Failure("VALIDATION", "A bounded read-only CalDAV XML query is required.");
        String declarations = body.toUpperCase(Locale.ROOT);
        if (declarations.contains("<!DOCTYPE") || declarations.contains("<!ENTITY"))
            throw new NativeLoginFlow.Failure("SECURITY", "External XML declarations are unavailable in CalDAV queries.");
        try {
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            factory.setNamespaceAware(true);
            factory.setExpandEntityReferences(false);
            var builder = factory.newDocumentBuilder();
            // DTDs are rejected above; fail closed if any parser attempts external resolution.
            builder.setEntityResolver((publicId, systemId) -> { throw new org.xml.sax.SAXException("External XML entities are unavailable."); });
            builder.setErrorHandler(new DefaultHandler() {
                @Override public void error(SAXParseException error) throws SAXParseException { throw error; }
                @Override public void fatalError(SAXParseException error) throws SAXParseException { throw error; }
            });
            var root = builder.parse(new InputSource(new StringReader(body))).getDocumentElement();
            String report=root.getLocalName();
            if("calendar-query".equals(report)&&"urn:ietf:params:xml:ns:caldav".equals(root.getNamespaceURI()))return;
            boolean sync="sync-collection".equals(report)&&"DAV:".equals(root.getNamespaceURI());
            boolean multiget="calendar-multiget".equals(report)&&"urn:ietf:params:xml:ns:caldav".equals(root.getNamespaceURI());
            if(!sync&&!multiget)throw new NativeLoginFlow.Failure("VALIDATION","Unsupported calendar REPORT.");
            Map<String,List<org.w3c.dom.Element>> fields=new HashMap<>();
            for(var node=root.getFirstChild();node!=null;node=node.getNextSibling())if(node instanceof org.w3c.dom.Element element){
                if(!"DAV:".equals(element.getNamespaceURI()))throw new NativeLoginFlow.Failure("VALIDATION","Invalid calendar REPORT member.");
                fields.computeIfAbsent(element.getLocalName(),ignored->new java.util.ArrayList<>()).add(element);
            }
            if(!fields.containsKey("prop")||fields.get("prop").size()!=1)throw new NativeLoginFlow.Failure("VALIDATION","Calendar REPORT requires properties.");
            if(sync){
                if(!fields.keySet().equals(java.util.Set.of("prop","sync-token","sync-level"))||fields.get("sync-token").size()!=1||fields.get("sync-level").size()!=1)throw new NativeLoginFlow.Failure("VALIDATION","Invalid collection sync REPORT.");
                String token=fields.get("sync-token").get(0).getTextContent(),level=fields.get("sync-level").get(0).getTextContent();
                if(fields.get("sync-token").get(0).getElementsByTagName("*").getLength()!=0||fields.get("sync-level").get(0).getElementsByTagName("*").getLength()!=0)throw new NativeLoginFlow.Failure("VALIDATION","Invalid nested sync value.");
                if(token.trim().isEmpty()||token.length()>4096||token.chars().anyMatch(value->value<32)||!"1".equals(level))throw new NativeLoginFlow.Failure("VALIDATION","Invalid collection sync token or level.");
            }else{
                if(!fields.keySet().equals(java.util.Set.of("prop","href"))||fields.get("href").isEmpty()||fields.get("href").size()>4)throw new NativeLoginFlow.Failure("VALIDATION","Calendar multiget is limited to four resources.");
                java.util.Set<String> hrefs=new java.util.HashSet<>();
                for(var element:fields.get("href")){String href=element.getTextContent();if(element.getElementsByTagName("*").getLength()!=0||href.isEmpty()||href.length()>16384||href.chars().anyMatch(value->value<32||value==92)||!hrefs.add(href))throw new NativeLoginFlow.Failure("VALIDATION","Invalid calendar resource locator.");NativeSyncPolicy.locator(base,new NativeSyncPolicy.Locator("dav",target,new URI(target).resolve(href).toString()));}
            }
        } catch (NativeLoginFlow.Failure error) { throw error; }
        catch (Exception invalidXml) { throw new NativeLoginFlow.Failure("VALIDATION", "A valid read-only CalDAV XML query is required."); }
    }

    static void checkedAccountIdentity(String name, String serverUrl, String username) throws Exception {
        if (name == null || name.trim().isEmpty() || name.length() > 4096 ||
                username == null || username.trim().isEmpty() || username.length() > 512 ||
                name.chars().anyMatch(value -> value <= 31 || value == 127) ||
                username.chars().anyMatch(value -> value <= 31 || value == 127))
            throw new NativeLoginFlow.Failure("AUTH", "Nextcloud did not provide a valid account identity.");
        checkedTarget(serverUrl, serverUrl);
    }

    static URI checkedTarget(String baseValue, String targetValue) throws Exception {
        if (baseValue == null || baseValue.length() > 4096 || targetValue == null || targetValue.length() > 16384)
            throw new NativeLoginFlow.Failure("VALIDATION", "A valid Nextcloud request URL is required.");
        URI base = new URI(baseValue), target = new URI(targetValue);
        if (!List.of("https", "http").contains(base.getScheme()) || base.getHost() == null ||
                "http".equals(base.getScheme()) && !List.of("localhost", "127.0.0.1", "[::1]", "::1").contains(base.getHost().toLowerCase(Locale.ROOT)) ||
                base.getUserInfo() != null || base.getQuery() != null || base.getFragment() != null ||
                !base.getScheme().equals(target.getScheme()) || !base.getHost().equalsIgnoreCase(target.getHost() == null ? "" : target.getHost()) ||
                effectivePort(base) != effectivePort(target) || target.getUserInfo() != null || target.getFragment() != null)
            throw new NativeLoginFlow.Failure("VALIDATION", "Requests must stay inside the selected Nextcloud server.");
        String basePath = trimTrailingSlashes(base.getRawPath());
        String path = target.getRawPath();
        if (path == null) path = "";
        if (!(path.equals(basePath) || path.startsWith(basePath + "/")) || path.contains("\\") || path.contains("//"))
            throw new NativeLoginFlow.Failure("VALIDATION", "Requests must stay inside the selected Nextcloud installation.");
        for (String segment : path.split("/")) {
            String decoded = URLDecoder.decode(segment.replace("+", "%2B"), "UTF-8");
            if (decoded.equals(".") || decoded.equals("..") || decoded.indexOf('/') >= 0 || decoded.indexOf('\\') >= 0 ||
                    decoded.chars().anyMatch(character -> character <= 31 || character == 127) || decoded.matches("(?i).*%[\\da-f]{2}.*"))
                throw new NativeLoginFlow.Failure("VALIDATION", "Unsafe Nextcloud request path.");
        }
        return target;
    }

    // Enforce independently of the WebView: no native item or legacy planner file writes.
    static void checkedMetadataWrite(String baseValue, String username, String targetValue,
                                     String method, Map<String, List<String>> headers, String body) throws Exception {
        URI target = checkedTarget(baseValue, targetValue);
        String prefix = trimTrailingSlashes(new URI(baseValue).getPath()) + "/remote.php/dav/files/" + username + "/";
        String path = target.getPath();
        if (target.getRawQuery() != null || !path.startsWith(prefix))
            throw new NativeLoginFlow.Failure("VALIDATION", "Planner writes must stay in the selected account's Files.");
        String relative = path.substring(prefix.length());
        String generation = "data-[a-f0-9-]{36}";
        if ("MKCOL".equals(method)) {
            if (!relative.matches("Workspace(?:/Nextspace(?:/" + generation + "(?:/(?:links|plans|properties|workflow|arrangements))?)?)?") || body != null && !body.isEmpty())
                throw new NativeLoginFlow.Failure("VALIDATION", "Only NextGlance planner folders may be created.");
            return;
        }
        String file = "Workspace/Nextspace/(?:manifest\\.json|view-preferences\\.json|" + generation + "/(?:(?:core|organization|settings|dependencies|identities|legacy-import|legacy-original)\\.json|(?:links|plans|properties|workflow|arrangements)/[a-f0-9]{64}\\.json))";
        if (!"PUT".equals(method) || !relative.matches(file))
            throw new NativeLoginFlow.Failure("VALIDATION", "Only NextGlance planner protocol documents may be written.");
        Map<String, String> normalized = new HashMap<>();
        for (Map.Entry<String, List<String>> entry : headers.entrySet()) {
            String key = entry.getKey().toLowerCase(Locale.ROOT);
            if (normalized.containsKey(key) || entry.getValue().size() != 1)
                throw new NativeLoginFlow.Failure("VALIDATION", "Ambiguous planner write headers.");
            normalized.put(key, entry.getValue().get(0));
        }
        String match = normalized.get("if-match"), none = normalized.get("if-none-match");
        if (!(match == null && "*".equals(none) || none == null && match != null && match.length() <= 1000 && match.matches("\"[\\x21\\x23-\\x7e\\x80-\\xff]*\"")))
            throw new NativeLoginFlow.Failure("VALIDATION", "Planner writes need an exact version or create-only condition.");
        String contentType = normalized.getOrDefault("content-type", "").toLowerCase(Locale.ROOT);
        if (!contentType.matches("application/json(?:\\s*;.*)?") || body == null || body.isEmpty() || body.getBytes(StandardCharsets.UTF_8).length > MAX_METADATA)
            throw new NativeLoginFlow.Failure("VALIDATION", "A bounded JSON planner document is required.");
    }

    private static int effectivePort(URI uri) { return uri.getPort() == -1 ? ("https".equals(uri.getScheme()) ? 443 : 80) : uri.getPort(); }
    private static String trimTrailingSlashes(String value) { return value == null ? "" : value.replaceAll("/+$", ""); }

}
