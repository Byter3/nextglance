package com.nextspace.app;

import com.google.gson.JsonObject;
import java.util.Map;
import org.junit.Test;
import static org.junit.Assert.*;

public class NativeBackgroundStatusTest {
    private JsonObject family(boolean enabled,boolean scheduled,String projection,String downloaded,String published){
        return NativeBackgroundStatus.family(enabled,scheduled,Map.of("projection",projection,"downloadedAt",downloaded,"readGenerationAt",published));
    }
    @Test public void unchangedPersistedScheduleMatchesButChangedPreferencesOrAccountDoNot(){
        var job=new NativeBackgroundStatus.Job(3_600_000,false,"account-one","dav",true);
        assertTrue(NativeBackgroundStatus.matches(job,60,false,"account-one","dav"));
        assertFalse(NativeBackgroundStatus.matches(job,0,false,"account-one","dav"));
        assertFalse(NativeBackgroundStatus.matches(job,15,false,"account-one","dav"));
        assertFalse(NativeBackgroundStatus.matches(job,60,true,"account-one","dav"));
        assertFalse(NativeBackgroundStatus.matches(job,60,false,"account-two","dav"));
        assertFalse(NativeBackgroundStatus.matches(job,60,false,"account-one","deck"));
        assertFalse(NativeBackgroundStatus.matches(new NativeBackgroundStatus.Job(3_600_000,false,"account-one","dav",false),60,false,"account-one","dav"));
    }
    @Test public void everyEnabledFamilyMustHaveItsJobAndAllOffIsNotScheduled(){
        JsonObject on=family(true,true,"pending","",""),missing=family(true,false,"pending","",""),off=family(false,true,"pending","","");
        assertTrue(NativeBackgroundStatus.aggregate(on,on).get("scheduled").getAsBoolean());
        assertFalse(NativeBackgroundStatus.aggregate(on,missing).get("scheduled").getAsBoolean());
        assertTrue(NativeBackgroundStatus.aggregate(on,off).get("scheduled").getAsBoolean());
        assertFalse(NativeBackgroundStatus.aggregate(off,off).get("scheduled").getAsBoolean());assertFalse(off.get("scheduled").getAsBoolean());
    }
    @Test public void downloadedButUnsupportedFamilyNeverAcquiresUsableTimestamp(){
        var caldav=family(true,true,"unavailable","2026-11-22T08:00:00Z","");
        var deck=family(true,true,"ready","2026-11-22T09:00:00Z","2026-11-22T09:00:01Z");
        var state=NativeBackgroundStatus.aggregate(caldav,deck);
        assertEquals("2026-11-22T09:00:00Z",state.get("lastSuccessAt").getAsString());
        assertFalse(caldav.has("readGenerationAt"));assertFalse(state.has("readGenerationAt"));
        assertEquals("unavailable",state.get("projection").getAsString());
        assertEquals("unavailable",state.getAsJsonObject("sources").getAsJsonObject("caldav").get("projection").getAsString());
        assertEquals("ready",state.getAsJsonObject("sources").getAsJsonObject("deck").get("projection").getAsString());
    }
    @Test public void latestDownloadDoesNotHideOlderFamilyReadGenerationOrFailure(){
        var caldav=family(true,true,"incomplete","2026-11-22T09:00:00Z","2026-11-22T07:00:00Z");
        var deck=family(true,true,"ready","2026-11-22T10:00:00Z","2026-11-22T10:00:01Z");
        var state=NativeBackgroundStatus.aggregate(caldav,deck);
        assertEquals("incomplete",state.get("projection").getAsString());
        assertEquals("2026-11-22T07:00:00Z",state.get("readGenerationAt").getAsString());
        assertEquals("2026-11-22T09:00:00Z",state.getAsJsonObject("sources").getAsJsonObject("caldav").get("downloadedAt").getAsString());
    }
    @Test public void absentOrMalformedEvidenceIsNotManufacturedAsSuccessful(){
        var source=NativeBackgroundStatus.family(true,false,Map.of("lastAttemptAt","bad","downloadedAt","bad","projection","denied","error","Access denied"));
        assertFalse(source.has("lastAttemptAt"));assertFalse(source.has("downloadedAt"));assertFalse(source.has("readGenerationAt"));
        assertEquals("incomplete",source.get("projection").getAsString());assertEquals("Access denied",source.get("error").getAsString());
        var pending=NativeBackgroundStatus.family(true,false,Map.of());assertEquals("pending",pending.get("projection").getAsString());
    }
    @Test public void timestampComparisonUsesInstantsAcrossFractionsAndOffsets(){
        var earlier=family(true,true,"ready","2026-11-22T09:00:00Z","2026-11-22T10:00:00+01:00");
        var later=family(true,true,"ready","2026-11-22T09:00:00.500Z","2026-11-22T09:00:00.500Z");
        var state=NativeBackgroundStatus.aggregate(earlier,later);
        assertEquals("2026-11-22T09:00:00.500Z",state.get("lastSuccessAt").getAsString());
        assertEquals("2026-11-22T10:00:00+01:00",state.get("readGenerationAt").getAsString());
    }
    @Test public void interruptionCannotOverwriteNewAttemptOrCompletedPublication(){
        assertTrue(NativeBackgroundStatus.interruptionMatches("attempt-one","attempt-one","pending"));
        assertFalse(NativeBackgroundStatus.interruptionMatches("attempt-one","attempt-two","pending"));
        assertFalse(NativeBackgroundStatus.interruptionMatches("attempt-one","attempt-one","ready"));
        assertFalse(NativeBackgroundStatus.interruptionMatches(null,"attempt-one","pending"));
        var source=NativeBackgroundStatus.family(true,true,Map.of("projection","incomplete","interrupted","true","readGenerationAt","2026-11-22T08:00:00Z"));
        assertTrue(source.get("message").getAsString().contains("paused"));assertFalse(source.has("error"));assertEquals("2026-11-22T08:00:00Z",source.get("readGenerationAt").getAsString());
    }
    @Test public void hourlyFallbackDoesNotMigrateExplicitShortOrManualIntervals()throws Exception{
        assertEquals(new NativeSyncPolicy.Settings(60,60,false),NativeSyncPolicy.Settings.defaults());
        var valid=com.google.gson.JsonParser.parseString("{\"caldavMinutes\":0,\"deckMinutes\":15,\"wifiOnly\":true}").getAsJsonObject();
        assertEquals(new NativeSyncPolicy.Settings(0,15,true),NativeSyncPolicy.settings(valid,false));
        assertEquals(new NativeSyncPolicy.Settings(60,60,false),NativeSyncPolicy.settings(new JsonObject(),false));
        assertEquals(90_000,NativeSyncPolicy.JOB_MILLIS);
    }
}
