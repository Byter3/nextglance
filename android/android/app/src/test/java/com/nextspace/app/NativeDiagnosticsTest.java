package com.nextspace.app;
import static org.junit.Assert.*;
import com.google.gson.*;
import org.junit.Test;
public class NativeDiagnosticsTest {
    String report(){return "{\"format\":\"nextglance-diagnostics\",\"version\":1,\"platform\":\"android\",\"appVersion\":\"0.6.4\",\"summary\":{\"recording\":false,\"elapsedMs\":12,\"eventCount\":1,\"dropped\":0,\"canSaveFile\":true,\"stopReason\":\"manual\"},\"events\":[{\"atMs\":10,\"kind\":\"request\",\"method\":\"GET\",\"status\":200,\"durationMs\":8,\"success\":true}]}";}
    @Test public void onlyStrictBoundedEvidenceCanCrossExportBoundary()throws Exception{assertEquals(JsonParser.parseString(report()),JsonParser.parseString(NativeDiagnostics.checked(report())));}
    @Test public void acceptsPlannerFailureCodes() throws Exception {
        for (String code : new String[]{"PLANNER_READ_CHANGED", "PLANNER_WRITE_CHANGED", "PLANNER_OVERLAP"}) {
            JsonObject value = JsonParser.parseString(report()).getAsJsonObject();
            JsonObject event = value.getAsJsonArray("events").get(0).getAsJsonObject();
            event.addProperty("kind", "planner");
            event.addProperty("stage", "error");
            event.addProperty("code", code);
            assertEquals(value, JsonParser.parseString(NativeDiagnostics.checked(value.toString())));
        }
    }
    @Test public void privateTextAndUnknownKeysAreRejected(){for(String key:new String[]{"url","headers","body","title","account","stack","message","tag"}){JsonObject value=JsonParser.parseString(report()).getAsJsonObject();value.getAsJsonArray("events").get(0).getAsJsonObject().addProperty(key,"private");assertThrows(Exception.class,()->NativeDiagnostics.checked(value.toString()));}}
    @Test public void untrustedEnumsAndNumbersAreRejected(){for(String field:new String[]{"source","kind","method","stage","page","code"}){JsonObject value=JsonParser.parseString(report()).getAsJsonObject();value.getAsJsonArray("events").get(0).getAsJsonObject().addProperty(field,"private");assertThrows(Exception.class,()->NativeDiagnostics.checked(value.toString()));}assertThrows(Exception.class,()->NativeDiagnostics.checked(report().replace("\"durationMs\":8","\"durationMs\":-1")));}
    @Test public void countsTimesMetadataAndBodyAreBounded(){assertThrows(Exception.class,()->NativeDiagnostics.checked(report().replace("\"eventCount\":1","\"eventCount\":2")));assertThrows(Exception.class,()->NativeDiagnostics.checked(report().replace("\"atMs\":10","\"atMs\":20")));assertThrows(Exception.class,()->NativeDiagnostics.checked(report().replace("0.6.4","account@example.invalid")));assertThrows(Exception.class,()->NativeDiagnostics.checked("x".repeat(NativeDiagnostics.MAX_BYTES+1)));}
}
