package com.nextspace.app;

import com.google.gson.*;
import java.util.*;

/** Export boundary: accepts only DIAG-01 scalar evidence, never arbitrary logs. */
final class NativeDiagnostics {
    static final int MAX_BYTES=4*1024*1024;
    static final Map<String,Set<String>> ENUMS=Map.of(
        "kind",Set.of("authorization","source","request","cache","projection","planner","restore","ui"),
        "source",Set.of("tasks","calendar","deck","notes","collectives","caldav","planner"),
        "stage",Set.of("start","finish","error","discovery","cache-read","cache-write","download","projection","local-cache","authorization","planner-read","planner-write","page","panel","frame","scroll","worker-ready","first-checkpoint","full-restore","publication"),
        "page",Set.of("overview","calendar","timeline","board","list","settings"),
        "method",Set.of("GET","HEAD","PROPFIND","REPORT","PUT","POST","DELETE","MKCOL"),
        "code",Set.of("AUTH","PERMISSION","CANCELLED","TIMEOUT","NETWORK","FILES_TRANSPORT","OFFLINE","LIMIT","FORMAT","VALIDATION","SECURITY","CONFLICT","PLANNER_OVERLAP","PLANNER_READ_CHANGED","PLANNER_WRITE_CHANGED","UNAVAILABLE","NEXTCLOUD","REDIRECT","CACHE_FORMAT","CACHE_READ_FAILED","CACHE_WRITE_FAILED","CACHE_WRITE","CACHE_UNREADABLE","METADATA_NOT_READY","PREVIEW_HOST","PREVIEW_SESSION_EXPIRED","RECONNECT_REQUIRED","UNKNOWN"));
    static final Set<String> NUMBERS=Set.of("durationMs","count","bytes","completed","total","cacheHits","cacheMisses","downloads","frames","maxDelayMs","status");
    static String checked(String text) throws Exception {
        try {
            if(text==null||text.length()>MAX_BYTES||text.getBytes(java.nio.charset.StandardCharsets.UTF_8).length>MAX_BYTES) throw new IllegalArgumentException();
            JsonObject report=JsonParser.parseString(text).getAsJsonObject();
            if(!report.keySet().equals(Set.of("format","version","platform","appVersion","summary","events"))||!"nextglance-diagnostics".equals(string(report.get("format")))||number(report.get("version"))!=1) throw new IllegalArgumentException();
            if(!Set.of("android","preview","windows","unknown").contains(string(report.get("platform")))||!string(report.get("appVersion")).matches("(?:\\d+\\.\\d+\\.\\d+|Development)"))throw new IllegalArgumentException();
            JsonObject summary=report.getAsJsonObject("summary"); Set<String> fields=new HashSet<>(Set.of("recording","elapsedMs","eventCount","dropped","canSaveFile"));
            if(summary.has("stopReason")){fields.add("stopReason");if(!Set.of("manual","duration","background","account-change").contains(string(summary.get("stopReason"))))throw new IllegalArgumentException();}
            if(!summary.keySet().equals(fields))throw new IllegalArgumentException();
            bool(summary.get("recording"));bool(summary.get("canSaveFile"));double elapsed=number(summary.get("elapsedMs"));if(elapsed>600000)throw new IllegalArgumentException();
            int count=integer(summary.get("eventCount"));integer(summary.get("dropped"));JsonArray events=report.getAsJsonArray("events");
            if(events.size()>5000||events.size()!=count)throw new IllegalArgumentException();
            double previous=0;
            for(JsonElement value:events){JsonObject event=value.getAsJsonObject();if(!event.has("atMs")||!event.has("kind"))throw new IllegalArgumentException();
                for(String key:event.keySet()){
                    if("atMs".equals(key)){double at=number(event.get(key));if(at<previous||at>elapsed)throw new IllegalArgumentException();previous=at;}
                    else if(ENUMS.containsKey(key)){if(!ENUMS.get(key).contains(string(event.get(key))))throw new IllegalArgumentException();}
                    else if(NUMBERS.contains(key))number(event.get(key));
                    else if("success".equals(key))bool(event.get(key));else throw new IllegalArgumentException();
                }
            }
            return new GsonBuilder().setPrettyPrinting().create().toJson(report);
        }catch(Exception invalid){throw NativeSyncPolicy.failure("VALIDATION","The diagnostics report is not a valid bounded performance recording.");}
    }
    private static String string(JsonElement value){if(value==null||!value.isJsonPrimitive()||!value.getAsJsonPrimitive().isString())throw new IllegalArgumentException();return value.getAsString();}
    private static double number(JsonElement value){if(value==null||!value.isJsonPrimitive()||!value.getAsJsonPrimitive().isNumber())throw new IllegalArgumentException();double n=value.getAsDouble();if(!Double.isFinite(n)||n<0||n>1e12)throw new IllegalArgumentException();return n;}
    private static int integer(JsonElement value){double n=number(value);if(n!=Math.floor(n)||n>Integer.MAX_VALUE)throw new IllegalArgumentException();return (int)n;}
    private static boolean bool(JsonElement value){if(value==null||!value.isJsonPrimitive()||!value.getAsJsonPrimitive().isBoolean())throw new IllegalArgumentException();return value.getAsBoolean();}
}
