package com.nextspace.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;
import org.junit.Test;
import java.util.List;
import java.util.Map;

/** No live account: verify the native boundary independently of the JavaScript transport. */
public class NextcloudSsoPolicyTest {
    @Test public void boundedDeltaReportsRemainDirectOnlyAndPreferencesWritesStayConditional() throws Exception {
        String target=base+"/remote.php/dav/calendars/user/personal/";
        var headers=Map.of("Content-Type",List.of("application/xml"));
        String delta="<d:sync-collection xmlns:d='DAV:'><d:sync-token>token</d:sync-token><d:sync-level>1</d:sync-level><d:prop><d:getetag/></d:prop></d:sync-collection>";
        String batch="<c:calendar-multiget xmlns:c='urn:ietf:params:xml:ns:caldav' xmlns:d='DAV:'><d:prop><d:getetag/><c:calendar-data/></d:prop><d:href>a.ics</d:href></c:calendar-multiget>";
        for(String body:List.of(delta,batch)){NativeRequestPolicy.checkedRequest("direct",base,"user",target,"REPORT",headers,body);assertThrows(Exception.class,()->NativeRequestPolicy.checkedRequest("sso",base,"user",target,"REPORT",headers,body));}
        assertThrows(Exception.class,()->NativeRequestPolicy.checkedRequest("direct",base,"user",target,"REPORT",headers,delta.replace("<d:sync-level>1","<d:sync-level>2")));
        assertThrows(Exception.class,()->NativeRequestPolicy.checkedRequest("direct",base,"user",target,"REPORT",headers,batch.replace("</c:calendar-multiget>","<d:href>a</d:href><d:href>b</d:href><d:href>c</d:href><d:href>d</d:href></c:calendar-multiget>")));
        NativeRequestPolicy.checkedRequest("sso",base,"user",planner+"view-preferences.json","PUT",json,"{}");
        assertThrows(Exception.class,()->NativeRequestPolicy.checkedRequest("sso",base,"user",planner+"view-preferences.json","PUT",Map.of("Content-Type",List.of("application/json")),"{}"));
    }
    @Test
    public void dependenciesStackMovesAndLabelsRemainScopedOnBothTransports() throws Exception {
        String server="https://cloud.example/nextcloud", card=server+"/index.php/apps/deck/api/v1.0/boards/1/stacks/2/cards/3", labels=server+"/index.php/apps/deck/api/v1.0/boards/1/labels";
        Map<String,List<String>> headers=Map.of("Content-Type",List.of("application/json"));
        for(String transport:new String[]{"direct","sso"}) {
            for(String method:new String[]{"POST","DELETE"}) NativeRequestPolicy.checkedRequest(transport,server,"user",card+"/dependentCards/4",method,headers,null);
            NativeRequestPolicy.checkedRequest(transport,server,"user",card.replace("/stacks/2/","/stacks/6/")+"/reorder","PUT",headers,"{\"stackId\":6,\"order\":99999}");
            assertThrows(Exception.class,()->NativeRequestPolicy.checkedRequest(transport,server,"user",card+"/reorder","PUT",headers,"{\"stackId\":6,\"order\":99999}"));
            for(String suffix:new String[]{"assignLabel","removeLabel"}) NativeRequestPolicy.checkedRequest(transport,server,"user",card+"/"+suffix,"PUT",headers,"{\"labelId\":20}");
            NativeRequestPolicy.checkedRequest(transport,server,"user",labels,"POST",headers,"{\"title\":\"Project\",\"color\":\"4488aa\"}");
            for(String suffix:new String[]{"/x/dependentCards/4","/dependentCards/0","/dependentCards/4?force=1"}) assertThrows(Exception.class,()->NativeRequestPolicy.checkedRequest(transport,server,"user",card+suffix,"POST",headers,null));
            for(String body:new String[]{"{\"stackId\":6,\"order\":1}","{\"stackId\":\"6\",\"order\":99999}","{\"stackId\":6.5,\"order\":99999}","{\"stackId\":6,\"order\":99999,\"title\":\"Wrong\"}"}) assertThrows(Exception.class,()->NativeRequestPolicy.checkedRequest(transport,server,"user",card+"/reorder","PUT",headers,body));
            assertThrows(Exception.class,()->NativeRequestPolicy.checkedRequest(transport,server,"user",card+"/dependentCards/4","POST",headers,"{}"));
            assertThrows(Exception.class,()->NativeRequestPolicy.checkedRequest(transport,server,"user",labels,"POST",headers,"{\"title\":\"Project\",\"color\":\"#4488aa\"}"));
        }
    }
    @Test
    public void deckCreationIsBoundedAndCanOnlyAssignTheCurrentUser() throws Exception {
        String server="https://cloud.example/nextcloud", target=server+"/index.php/apps/deck/api/v1.0/boards/1/stacks/2/cards";
        Map<String,List<String>> headers=Map.of("Content-Type",List.of("application/json"));
        String body="{\"title\":\"Card\",\"type\":\"plain\",\"order\":99999,\"description\":\"- [ ] Check\",\"startdate\":null,\"duedate\":\"2030-06-12T09:00:00.000Z\",\"users\":[{\"id\":\"user\",\"type\":0}]}";
        for(String transport:new String[]{"direct","sso"}) {
            NativeRequestPolicy.checkedRequest(transport,server,"user",target,"POST",headers,body);
            NativeRequestPolicy.checkedRequest(transport,server,"user",target,"POST",headers,body.replace("[{\"id\":\"user\",\"type\":0}]","[]"));
            for(String invalid:new String[]{body.replace("\"id\":\"user\"","\"id\":\"other\""),body.replace("\"type\":0","\"type\":1"),body.replace("99999","1"),body.replace("\"Card\"","\"\""),body.replace("\"plain\"","\"other\""),body.replace("null","false"),body.replace(".000Z","Z"),body.replace("\"Card\"","\""+"x".repeat(256)+"\""),body.replace("\"- [ ] Check\"","null"),body.replace("\"users\":[","\"owner\":\"other\",\"users\":[")})
                assertThrows(Exception.class,()->NativeRequestPolicy.checkedRequest(transport,server,"user",target,"POST",headers,invalid));
            assertThrows(Exception.class,()->NativeRequestPolicy.checkedRequest(transport,server,"user",target+"?force=1","POST",headers,body));
            assertThrows(Exception.class,()->NativeRequestPolicy.checkedRequest(transport,server,"user",target+"/3","POST",headers,body));
            assertThrows(Exception.class,()->NativeRequestPolicy.checkedRequest(transport,server,"user",target,"POST",Map.of("Content-Type",List.of("application/json"),"If-Match",List.of("\"old\"")),body));
        }
    }
    private final String base = "https://cloud.example/nextcloud";
    private final String planner = base + "/remote.php/dav/files/user/Workspace/Nextspace/";
    private final String generation = "data-01234567-89ab-cdef-0123-456789abcdef";
    private final Map<String, List<String>> json = Map.of("Content-Type", List.of("application/json"), "If-None-Match", List.of("*"));
    private final Map<String, List<String>> xml = Map.of("Content-Type", List.of("application/xml; charset=utf-8"), "Depth", List.of("1"));
    private final String calendar = base + "/remote.php/dav/calendars/user/personal/";
    private final String query = "<?xml version=\"1.0\"?><c:calendar-query xmlns:d=\"DAV:\" xmlns:c=\"urn:ietf:params:xml:ns:caldav\"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name=\"VCALENDAR\"><c:comp-filter name=\"VTODO\"></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>";

    @Test
    public void arrangementDocumentsKeepAccountPathAndConditionalWriteGuards() throws Exception {
        String directory = planner + generation + "/arrangements";
        String target = directory + "/" + "a".repeat(64) + ".json";
        for (String transport : new String[]{"direct", "sso"}) {
            NativeRequestPolicy.checkedRequest(transport, base, "user", directory, "MKCOL", Map.of(), null);
            NativeRequestPolicy.checkedRequest(transport, base, "user", target, "PUT", json, "{}");
            NativeRequestPolicy.checkedRequest(transport, base, "user", target, "PUT",
                    Map.of("Content-Type", List.of("application/json"), "If-Match", List.of("\"arrangement-version\"")), "{}");
            for (String invalid : new String[]{directory + "/all.json", directory + "/" + "a".repeat(63) + ".json", target + "?x=1"})
                assertThrows(NativeLoginFlow.Failure.class, () -> NativeRequestPolicy.checkedRequest(transport, base, "user", invalid, "PUT", json, "{}"));
            assertThrows(NativeLoginFlow.Failure.class, () -> NativeRequestPolicy.checkedRequest(transport, base, "other", target, "PUT", json, "{}"));
            assertThrows(NativeLoginFlow.Failure.class, () -> NativeRequestPolicy.checkedRequest(transport, base, "user", target, "PUT", Map.of("Content-Type", List.of("application/json")), "{}"));
            assertThrows(NativeLoginFlow.Failure.class, () -> NativeRequestPolicy.checkedRequest(transport, base, "user", target, "DELETE", json, null));
        }
    }

    @Test
    public void onlyDirectAuthorizationAdvertisesReport() {
        assertEquals("report", NativeRequestPolicy.davReadMode("direct"));
        for (String transport : new String[]{"sso", null, "", "unknown", "DIRECT", "report"})
            assertEquals("propfind-get", NativeRequestPolicy.davReadMode(transport));
    }

    @Test
    public void editCapabilityIsSeparateFromDavReadMode() {
        for (String transport : new String[]{"direct", "sso"})
            assertEquals("notes-dates-scheduling", NativeRequestPolicy.nativeEdits(transport));
        for (String transport : new String[]{null, "unknown", "report", "DIRECT"})
            assertEquals(null, NativeRequestPolicy.nativeEdits(transport));
    }

    @Test
    public void nativeNotesSupportCreatesAndConditionalPartialPatchesOnly() throws Exception {
        String notes = base + "/index.php/apps/notes/api/v1/notes";
        Map<String, List<String>> content = Map.of("Content-Type", List.of("application/json"));
        Map<String, List<String>> version = Map.of("Content-Type", List.of("application/json"), "If-Match", List.of("\"current\""));
        for (String transport : new String[]{"direct", "sso"}) {
            NativeRequestPolicy.checkedRequest(transport, base, "user", notes, "POST", content, "{\"title\":\"Note\",\"content\":\"Text\",\"category\":\"\"}");
            NativeRequestPolicy.checkedRequest(transport, base, "user", notes + "/3", "PUT", version, "{\"content\":\"Merged text\"}");
        }
        for (String invalid : new String[]{"{}", "[]", "{\"favorite\":true}", "{\"title\":42}", "{\"category\":\"line\\nbreak\"}", "{content:'not JSON'}"})
            assertThrows(Exception.class, () -> NativeRequestPolicy.checkedRequest("direct", base, "user", notes + "/3", "PUT", version, invalid));
        assertThrows(Exception.class, () -> NativeRequestPolicy.checkedRequest("direct", base, "user", notes + "/3", "PUT", content, "{\"content\":\"Text\"}"));
        assertThrows(Exception.class, () -> NativeRequestPolicy.checkedRequest("direct", base, "user", notes + "/3", "DELETE", Map.of(), null));
        assertThrows(Exception.class, () -> NativeRequestPolicy.checkedRequest("direct", base, "user", notes + "/3?force=1", "PUT", version, "{\"content\":\"Text\"}"));
        assertEquals("VALIDATION", assertThrows(NativeLoginFlow.Failure.class, () -> NativeRequestPolicy.checkedRequest("direct", base, "user", base, "PUT", version, "{\"content\":\"Text\"}")).code);
    }

    @Test
    public void nativeTagsAllowOnlyCreationAndAssignmentChanges() throws Exception {
        String tags = base + "/remote.php/dav/systemtags/", assignment = base + "/remote.php/dav/systemtags-relations/files/12/34";
        Map<String, List<String>> content = Map.of("Content-Type", List.of("application/json"));
        for (String transport : new String[]{"direct", "sso"}) {
            NativeRequestPolicy.checkedRequest(transport, base, "user", tags, "POST", content, "{\"name\":\"Freelance\",\"userVisible\":true,\"userAssignable\":true}");
            NativeRequestPolicy.checkedRequest(transport, base, "user", assignment, "PUT", Map.of(), "");
            NativeRequestPolicy.checkedRequest(transport, base, "user", assignment, "DELETE", Map.of(), null);
        }
        for (String invalid : new String[]{"{\"name\":\"Hidden\",\"userVisible\":false,\"userAssignable\":true}", "{\"name\":\"" + "é".repeat(33) + "\",\"userVisible\":true,\"userAssignable\":true}"})
            assertThrows(Exception.class, () -> NativeRequestPolicy.checkedRequest("direct", base, "user", tags, "POST", content, invalid));
        for (String target : new String[]{tags + "34", base + "/remote.php/dav/files/user/Notes/a.md", assignment + "/extra"})
            assertThrows(Exception.class, () -> NativeRequestPolicy.checkedRequest("direct", base, "user", target, "DELETE", Map.of(), null));
        assertThrows(Exception.class, () -> NativeRequestPolicy.checkedRequest("direct", base, "user", assignment, "PUT", content, "{}"));
    }

    @Test
    public void nativeDatesAdmitConditionalResourcesIncludingSharedPrincipals() throws Exception {
        String body = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:fixture\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        Map<String, List<String>> create = Map.of("Content-Type", List.of("text/calendar; charset=utf-8"), "If-None-Match", List.of("*"));
        Map<String, List<String>> update = Map.of("Content-Type", List.of("text/calendar"), "If-Match", List.of("\"current\""));
        for (String transport : new String[]{"direct", "sso"}) {
            NativeRequestPolicy.checkedRequest(transport, base, "user", calendar + "event.ics", "PUT", create, body);
            NativeRequestPolicy.checkedRequest(transport, base, "user", base + "/remote.php/dav/calendars/shared-owner/shared/task.ics", "PUT", update, body.replace("VEVENT", "VTODO"));
        }
        for (Map<String, List<String>> invalid : List.of(Map.<String, List<String>>of("Content-Type", List.of("text/calendar")),
                Map.of("Content-Type", List.of("text/calendar"), "If-Match", List.of("W/\"weak\"")),
                Map.of("Content-Type", List.of("text/calendar"), "If-Match", List.of("\"current\""), "If-None-Match", List.of("*"))))
            assertThrows(Exception.class, () -> NativeRequestPolicy.checkedRequest("direct", base, "user", calendar + "event.ics", "PUT", invalid, body));
        assertThrows(Exception.class, () -> NativeRequestPolicy.checkedRequest("direct", base, "user", calendar, "PUT", create, body));
        assertThrows(Exception.class, () -> NativeRequestPolicy.checkedRequest("direct", base, "user", calendar + "event.ics", "PUT", create, "{}"));
        assertThrows(Exception.class, () -> NativeRequestPolicy.checkedRequest("direct", base, "user", calendar + "event.ics", "PUT", create, body + " ".repeat(8 * 1024 * 1024)));
    }

    @Test
    public void schedulingDiscoveryAndConditionalInvitationWritesStayAccountBound() throws Exception {
        String principal = base + "/remote.php/dav/principals/users/user/";
        String outbox = base + "/remote.php/dav/calendars/user/outbox/";
        String properties = "<d:propfind xmlns:d=\"DAV:\" xmlns:c=\"urn:ietf:params:xml:ns:caldav\"><d:prop><c:calendar-user-address-set/><c:schedule-outbox-URL/><d:owner/><d:current-user-privilege-set/></d:prop></d:propfind>";
        String invitation = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:fixture\r\nORGANIZER:mailto:owner@example.test\r\nATTENDEE;PARTSTAT=ACCEPTED;RSVP=FALSE:mailto:guest@example.test\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        Map<String,List<String>> update = Map.of("Content-Type",List.of("text/calendar"),"If-Match",List.of("\"current\""));
        for(String transport : new String[]{"direct","sso"}) {
            for(String target : new String[]{principal,outbox,calendar}) NativeRequestPolicy.checkedRequest(transport,base,"user",target,"PROPFIND",xml,properties);
            NativeRequestPolicy.checkedRequest(transport,base,"user",calendar+"event.ics","PUT",update,invitation);
            assertThrows(Exception.class,()->NativeRequestPolicy.checkedRequest(transport,base,"user",outbox.replace("cloud.example","other.example"),"PROPFIND",xml,properties));
            assertThrows(Exception.class,()->NativeRequestPolicy.checkedRequest(transport,base,"user",outbox,"POST",update,invitation));
        }
    }

    @Test
    public void deckDateRepresentationDoesNotEnableOtherDeckRoutes() throws Exception {
        String target = base + "/index.php/apps/deck/api/v1.0/boards/1/stacks/2/cards/3";
        String body = "{\"title\":\"Card\",\"type\":\"plain\",\"owner\":\"user\",\"description\":\"text\",\"order\":0,\"startdate\":null,\"duedate\":\"2026-11-12T09:00:00Z\",\"archived\":false,\"done\":null,\"color\":null}";
        Map<String, List<String>> content = Map.of("Content-Type", List.of("application/json"));
        for (String transport : new String[]{"direct", "sso"}) NativeRequestPolicy.checkedRequest(transport, base, "user", target, "PUT", content, body);
        for (String suffix : new String[]{"/reorder", "/attachments", "/assignLabel", "/dependencies"})
            assertThrows(Exception.class, () -> NativeRequestPolicy.checkedRequest("direct", base, "user", target + suffix, "PUT", content, body));
        assertThrows(Exception.class, () -> NativeRequestPolicy.checkedRequest("direct", base, "user", target, "PUT", content, "{\"duedate\":null}"));
        assertThrows(Exception.class, () -> NativeRequestPolicy.checkedRequest("direct", base, "user", target, "DELETE", Map.of(), null));
    }

    @Test
    public void directAcceptsReferenceTaskAndTimeRangedEventQueries() throws Exception {
        NativeRequestPolicy.checkedRequest("direct", base, "user", calendar, "REPORT", xml, query);
        String events = query.replace("name=\"VTODO\">", "name=\"VEVENT\"><c:time-range start=\"20261101T000000Z\" end=\"20270201T000000Z\"/>");
        NativeRequestPolicy.checkedRequest("direct", base, "user", calendar, "REPORT", xml, events);
        String defaultNamespace = query.replace("xmlns:c=", "xmlns=").replace("c:", "");
        NativeRequestPolicy.checkedRequest("direct", base, "user", calendar, "REPORT", Map.of("content-type", List.of("text/xml")), defaultNamespace);
    }

    @Test
    public void filesSsoAndUnknownTransportsNeverAdmitReport() {
        for (String transport : new String[]{"sso", null, "unknown", "report"}) {
            NativeLoginFlow.Failure error = assertThrows(NativeLoginFlow.Failure.class,
                    () -> NativeRequestPolicy.checkedRequest(transport, base, "user", calendar, "REPORT", xml, query));
            assertEquals("UNAVAILABLE", error.code);
        }
    }

    @Test
    public void reportRequiresBoundedWellFormedReadOnlyCalendarXml() {
        for (String invalid : new String[]{null, "", " ", "{}", "<c:calendar-query", query + "<extra/>",
                query.replace("urn:ietf:params:xml:ns:caldav", "urn:other"), query.replace("calendar-query", "calendar-multiget")}) {
            NativeLoginFlow.Failure error = assertThrows(NativeLoginFlow.Failure.class,
                    () -> NativeRequestPolicy.checkedRequest("direct", base, "user", calendar, "REPORT", xml, invalid));
            assertEquals("VALIDATION", error.code);
        }
        for (String oversized : new String[]{query + " ".repeat(1024 * 1024), query.replace("<d:getetag/>", "<d:getetag>" + "é".repeat(512 * 1024) + "</d:getetag>")})
            assertEquals("LIMIT", assertThrows(NativeLoginFlow.Failure.class, () -> NativeRequestPolicy.checkedRequest("direct", base, "user", calendar, "REPORT", xml, oversized)).code);
        for (String forbidden : new String[]{"<!DOCTYPE query SYSTEM \"https://external.example/private\">" + query, "<!ENTITY secret SYSTEM \"file:///private\">" + query})
            assertEquals("SECURITY", assertThrows(NativeLoginFlow.Failure.class, () -> NativeRequestPolicy.checkedRequest("direct", base, "user", calendar, "REPORT", xml, forbidden)).code);
        for (Map<String, List<String>> headers : List.of(Map.<String, List<String>>of(), json,
                Map.of("Content-Type", List.of("application/xml", "application/json")),
                Map.of("Content-Type", List.of("application/xml"), "content-type", List.of("application/xml"))))
            assertThrows(NativeLoginFlow.Failure.class, () -> NativeRequestPolicy.checkedRequest("direct", base, "user", calendar, "REPORT", headers, query));
    }

    @Test
    public void reportKeepsOriginAndInstallationGuards() {
        for (String target : new String[]{"https://other.example/nextcloud/remote.php/dav/calendars/user/personal/",
                "https://cloud.example/remote.php/dav/calendars/user/personal/", calendar + "%2e%2e/other/"})
            assertThrows(NativeLoginFlow.Failure.class, () -> NativeRequestPolicy.checkedRequest("direct", base, "user", target, "REPORT", xml, query));
    }

    @Test
    public void reportCapabilityNeverEnablesNativeWritesOrChangesMetadataConditions() throws Exception {
        for (String transport : new String[]{"direct", "sso"}) {
            NativeRequestPolicy.checkedRequest(transport, base, "user", calendar, "PROPFIND", xml, "<d:propfind xmlns:d=\"DAV:\"/>");
            NativeRequestPolicy.checkedRequest(transport, base, "user", calendar + "task.ics", "GET", Map.of(), null);
            NativeRequestPolicy.checkedRequest(transport, base, "user", planner + "manifest.json", "PUT", json, "{}");
            for (String method : new String[]{"POST", "PATCH", "DELETE"})
                assertThrows(NativeLoginFlow.Failure.class, () -> NativeRequestPolicy.checkedRequest(transport, base, "user", calendar, method, xml, query));
            assertThrows(NativeLoginFlow.Failure.class, () -> NativeRequestPolicy.checkedRequest(transport, base, "user", calendar + "task.ics", "PUT", json, "{}"));
            assertThrows(NativeLoginFlow.Failure.class, () -> NativeRequestPolicy.checkedRequest(transport, base, "user", base + "/index.php/apps/notes/api/v1/notes/1", "PUT", json, "{}"));
            assertThrows(NativeLoginFlow.Failure.class, () -> NativeRequestPolicy.checkedRequest(transport, base, "user", planner + "manifest.json", "PUT", Map.of("Content-Type", List.of("application/json")), "{}"));
            assertThrows(NativeLoginFlow.Failure.class, () -> NativeRequestPolicy.checkedRequest(transport, base, "user", calendar, "GET", xml, query));
        }
    }

    @Test
    public void allowsOnlyConditionalPlannerProtocolWrites() throws Exception {
        for (String path : new String[]{"manifest.json", generation + "/organization.json", generation + "/legacy-import.json", generation + "/links/" + "a".repeat(64) + ".json"})
            NextcloudSsoPlugin.checkedMetadataWrite(base, "user", planner + path, "PUT", json, "{}");
        NextcloudSsoPlugin.checkedMetadataWrite(base, "user", planner + generation + "/organization.json", "PUT",
                Map.of("content-type", List.of("application/json; charset=utf-8"), "if-match", List.of("\"exact\"")), "{}");
        for (String path : new String[]{"Workspace", "Workspace/Nextspace", "Workspace/Nextspace/" + generation, "Workspace/Nextspace/" + generation + "/links"})
            NextcloudSsoPlugin.checkedMetadataWrite(base, "user", base + "/remote.php/dav/files/user/" + path, "MKCOL", Map.of(), null);
    }

    @Test
    public void rejectsNativeFilesCrossAccountAndUnversionedWrites() {
        for (String path : new String[]{"notes.json", generation + "/other.json", generation + "/organization.json?query=1", "../planner.json"})
            assertThrows(Exception.class, () -> NextcloudSsoPlugin.checkedMetadataWrite(base, "user", planner + path, "PUT", json, "{}"));
        assertThrows(Exception.class, () -> NextcloudSsoPlugin.checkedMetadataWrite(base, "other", planner + "manifest.json", "PUT", json, "{}"));
        assertThrows(Exception.class, () -> NextcloudSsoPlugin.checkedMetadataWrite(base, "user", planner + "manifest.json", "DELETE", json, null));
        for (String etag : new String[]{"*", "W/\"weak\"", "unquoted", "\"a\", \"b\"", "\"a\tb\"", "\"has space\"", "\"" + "a".repeat(999) + "\""})
            assertThrows(Exception.class, () -> NextcloudSsoPlugin.checkedMetadataWrite(base, "user", planner + "manifest.json", "PUT", Map.of("Content-Type", List.of("application/json"), "If-Match", List.of(etag)), "{}"));
        assertThrows(Exception.class, () -> NextcloudSsoPlugin.checkedMetadataWrite(base, "user", planner + "manifest.json", "PUT", Map.of("Content-Type", List.of("application/json")), "{}"));
        assertThrows(Exception.class, () -> NextcloudSsoPlugin.checkedMetadataWrite(base, "user", planner + "other", "MKCOL", Map.of(), null));
    }

    @Test
    public void allowsAccountSubpathAndEscapedFileNames() throws Exception {
        String url = "https://cloud.example/nextcloud/remote.php/dav/files/user/My%20Note%2Bone.md?format=json";
        assertEquals(url, NextcloudSsoPlugin.checkedTarget("https://cloud.example/nextcloud", url).toString());
        assertEquals("https://cloud.example:443/nextcloud/status.php",
                NextcloudSsoPlugin.checkedTarget("https://cloud.example/nextcloud/", "https://cloud.example:443/nextcloud/status.php").toString());
    }

    @Test
    public void rejectsOriginCredentialsAndInstallationEscapes() {
        String base = "https://cloud.example/nextcloud";
        for (String target : new String[]{
                "https://other.example/nextcloud/status.php",
                "http://cloud.example/nextcloud/status.php",
                "https://cloud.example:8443/nextcloud/status.php",
                "https://user@cloud.example/nextcloud/status.php",
                "https://cloud.example/nextcloud-evil/status.php",
                "https://cloud.example/status.php",
                "https://cloud.example/nextcloud/../status.php",
                "https://cloud.example/nextcloud/%2e%2e/status.php",
                "https://cloud.example/nextcloud/%252e%252e/status.php",
                "https://cloud.example/nextcloud/%25252e%25252e/status.php",
                "https://cloud.example/nextcloud/%0a%0a/status.php",
                "https://cloud.example/nextcloud/%2foutside",
                "https://cloud.example/nextcloud/%5coutside",
                "https://cloud.example/nextcloud//outside",
                "https://cloud.example/nextcloud/status.php#fragment"
        }) assertThrows(target, Exception.class, () -> NextcloudSsoPlugin.checkedTarget(base, target));
    }

    @Test
    public void onlyLoopbackMayUseCleartextHttp() throws Exception {
        for (String base : new String[]{"http://localhost", "http://127.0.0.1:8181", "http://[::1]:8181"})
            assertEquals(base + "/status.php", NextcloudSsoPlugin.checkedTarget(base, base + "/status.php").toString());
        for (String base : new String[]{"http://cloud.example", "http://192.168.1.5", "http://localhost.evil.example"})
            assertThrows(Exception.class, () -> NextcloudSsoPlugin.checkedTarget(base, base + "/status.php"));
        String tooLong = "https://cloud.example/" + "a".repeat(4096);
        assertThrows(Exception.class, () -> NextcloudSsoPlugin.checkedTarget(tooLong, tooLong));
    }

    @Test
    public void savedAccountIdentityRequiresCompleteBoundedNonsecretFields() throws Exception {
        NextcloudSsoPlugin.checkedAccountIdentity("User@cloud.example", base, "canonical-user");
        for (String name : new String[]{null, "", " ", "line\nbreak", "a".repeat(4097)})
            assertThrows(Exception.class, () -> NextcloudSsoPlugin.checkedAccountIdentity(name, base, "user"));
        for (String username : new String[]{null, "", " ", "user\u0000", "a".repeat(513)})
            assertThrows(Exception.class, () -> NextcloudSsoPlugin.checkedAccountIdentity("selected", base, username));
        for (String server : new String[]{null, "", "https://u:p@cloud.example", "https://cloud.example?token=x", "https://cloud.example#account", "http://cloud.example"})
            assertThrows(Exception.class, () -> NextcloudSsoPlugin.checkedAccountIdentity("selected", server, "user"));
    }
    @Test public void attachmentWritesAndEventDeleteHaveExactNativeScope()throws Exception{
        String share=base+"/ocs/v2.php/apps/files_sharing/api/v1/shares?format=json";
        Map<String,List<String>> headers=Map.of("Content-Type",List.of("application/json"));
        String body="{\"path\":\"/Notes/brief.md\",\"shareType\":12,\"shareWith\":\"5\",\"permissions\":1}";
        for(String transport:List.of("sso","direct")){
            NativeRequestPolicy.checkedRequest(transport,base,"user",share,"POST",headers,body);
            assertThrows(Exception.class,()->NativeRequestPolicy.checkedRequest(transport,base,"user",share,"POST",headers,body.replace("permissions\":1","permissions\":31")));
            String attachments=base+"/index.php/apps/deck/api/v1.1/boards/1/stacks/2/cards/5/attachments";
            String attachment=attachments+"/file/8";
            NativeRequestPolicy.checkedRequest(transport,base,"user",attachment,"DELETE",Map.of(),null);
            for(String target:List.of(attachments+"/deck_file/8",attachments+"/8?type=file",attachment+"?type=file",attachment+"/extra",base+"/remote.php/dav/files/user/Notes/brief.md"))
                assertThrows(Exception.class,()->NativeRequestPolicy.checkedRequest(transport,base,"user",target,"DELETE",Map.of(),null));
            assertThrows(Exception.class,()->NativeRequestPolicy.checkedRequest(transport,base,"user",attachment,"DELETE",headers,"{}"));
            NativeRequestPolicy.checkedRequest(transport,base,"user",calendar+"event.ics","DELETE",Map.of("If-Match",List.of("\"exact\"")),null);
            assertThrows(Exception.class,()->NativeRequestPolicy.checkedRequest(transport,base,"user",calendar+"event.ics","DELETE",Map.of(),null));
        }
        assertThrows(Exception.class,()->NativeRequestPolicy.checkedRequest("sso",base,"user",base+"/remote.php/dav/","SEARCH",xml,"<search/>"));
    }

}
