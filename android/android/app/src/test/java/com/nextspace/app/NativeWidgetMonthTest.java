package com.nextspace.app;

import com.google.gson.*;
import org.junit.Test;
import static org.junit.Assert.*;

public class NativeWidgetMonthTest {
    private static final String ACCOUNT="a".repeat(64);
    private static JsonObject object(String value){return JsonParser.parseString(value).getAsJsonObject();}
    private static JsonObject config(){
        JsonObject config=object("""
            {"version":1,"widgetId":10,"generation":1,"page":"calendar","calendarLayout":"month",
             "title":"Studio calendar","scopeId":"studio"}
            """);
        config.addProperty("accountKey",ACCOUNT);return config;
    }
    private static JsonObject snapshot(JsonObject config){
        JsonObject snapshot=config.deepCopy();snapshot.addProperty("state","ready");
        snapshot.add("month",object("""
            {"year":2026,"month":11,"cells":[
              {"date":"2026-11-23","today":true,"count":2,"itinerary":[0,1]},
              {"date":"2026-11-24","count":1,"itinerary":[0]},
              {"date":"2026-11-25","count":0,"itinerary":[]}
            ],"itineraryRows":[
              {"type":"item","recordId":"launch","title":"Launch window"},
              {"type":"item","recordId":"review","title":"Design review"},
              {"type":"item","recordId":"unreferenced","title":"Unreferenced"}
            ]}
            """));
        return snapshot;
    }
    private static String item(JsonArray rows,int index){return rows.get(index).getAsJsonObject().get("recordId").getAsString();}

    @Test public void selectionDefaultsToTodayAndRestoresOnlyForTheSameMonth(){
        JsonObject config=config(),snapshot=snapshot(config),month=snapshot.getAsJsonObject("month");
        assertEquals("2026-11-23",NativeWidgetMonth.selectedDate(month,new JsonObject(),config));
        JsonObject selection=NativeWidgetMonth.select(config,snapshot,ACCOUNT,"2026-11","2026-11-24",1);
        assertEquals("2026-11-24",NativeWidgetMonth.selectedDate(month,selection,config));
        month.addProperty("month",12);month.getAsJsonArray("cells").get(0).getAsJsonObject().addProperty("date","2026-12-01");
        assertEquals("2026-12-01",NativeWidgetMonth.selectedDate(month,selection,config));
    }
    @Test public void selectionRequiresAvailableSnapshotCurrentIdentityMonthAndCell(){
        JsonObject config=config(),snapshot=snapshot(config);
        assertTrue(NativeWidgetMonth.select(config,snapshot,"b".repeat(64),"2026-11","2026-11-24",1).isEmpty());
        assertTrue(NativeWidgetMonth.select(config,snapshot,ACCOUNT,"2026-11","2026-11-24",2).isEmpty());
        assertTrue(NativeWidgetMonth.select(config,snapshot,ACCOUNT,"2026-12","2026-11-24",1).isEmpty());
        assertTrue(NativeWidgetMonth.select(config,snapshot,ACCOUNT,"2026-11","2026-11-31",1).isEmpty());
        assertTrue(NativeWidgetMonth.select(config,snapshot,ACCOUNT,"2026-11","2026-11-26",1).isEmpty());
        snapshot.addProperty("state","unavailable");
        assertTrue(NativeWidgetMonth.select(config,snapshot,ACCOUNT,"2026-11","2026-11-24",1).isEmpty());
    }
    @Test public void indexedItineraryShowsOnlySelectedDayAndKeepsExactRecordGuards(){
        JsonObject config=config(),snapshot=snapshot(config);
        assertEquals(2,NativeWidgetMonth.itinerary(snapshot,"2026-11-23").size());
        JsonArray next=NativeWidgetMonth.itinerary(snapshot,"2026-11-24");
        assertEquals(1,next.size());assertEquals("launch",item(next,0));
        assertTrue(NativeWidgetMonth.itinerary(snapshot,"2026-11-25").isEmpty());
        JsonObject action=config.deepCopy();action.addProperty("action","item");action.addProperty("recordId","launch");
        assertTrue(NativeWidgetPolicy.actionMatches(action,config,snapshot,ACCOUNT));
        action.addProperty("recordId","unreferenced");
        assertFalse(NativeWidgetPolicy.actionMatches(action,config,snapshot,ACCOUNT));
    }
    @Test public void oldSnapshotsOnlyOfferItemsThatOverlapTheDay(){
        JsonObject snapshot=snapshot(config()),month=snapshot.getAsJsonObject("month");month.remove("itineraryRows");
        snapshot.add("rows",JsonParser.parseString("""
            [
              {"type":"item","recordId":"review","rangeStartDay":"2026-11-24","start":"2026-11-24T09:00:00Z"},
              {"type":"item","recordId":"launch","rangeStartDay":"2026-11-22","rangeEndDay":"2026-11-24","allDay":true},
              {"type":"item","recordId":"elsewhere","rangeStartDay":"2026-11-25"},
              {"type":"heading","recordId":"heading","rangeStartDay":"2026-11-24"}
            ]
            """));
        JsonArray itinerary=NativeWidgetMonth.itinerary(snapshot,"2026-11-24");
        assertEquals(2,itinerary.size());assertEquals("launch",item(itinerary,0));assertEquals("review",item(itinerary,1));
    }
    @Test public void invalidReferencesCannotExposeExtraRowsOrDuplicateAnItem(){
        JsonObject snapshot=snapshot(config()),cell=NativeWidgetMonth.cell(snapshot.getAsJsonObject("month"),"2026-11-24");
        cell.add("itinerary",JsonParser.parseString("[-1,1.2,999,0,0,\"1\",{},null]"));
        JsonArray itinerary=NativeWidgetMonth.itinerary(snapshot,"2026-11-24");
        assertEquals(1,itinerary.size());assertEquals("launch",item(itinerary,0));
    }
    @Test public void selectionIsPerWidgetAndDoesNotInvalidatePendingProjection(){
        JsonObject state=NativeWidgetState.save(NativeWidgetState.empty(),10,config(),ACCOUNT);
        state=NativeWidgetState.save(state,11,config(),ACCOUNT);
        JsonObject configuration=NativeWidgetState.config(state,10);
        JsonObject selection=NativeWidgetMonth.select(configuration,snapshot(configuration),ACCOUNT,"2026-11","2026-11-24",1);
        JsonObject next=NativeWidgetState.withMonthSelection(state,10,selection);
        assertTrue(NativeWidgetState.monthSelection(state,10).isEmpty());assertTrue(NativeWidgetState.monthSelection(next,11).isEmpty());
        assertEquals(selection,NativeWidgetState.monthSelection(next,10));assertEquals(state.get("revision"),next.get("revision"));
        assertTrue(NativeWidgetState.monthSelection(NativeWidgetState.save(next,10,config(),ACCOUNT),10).isEmpty());
        assertTrue(NativeWidgetState.monthSelection(NativeWidgetState.delete(next,new int[]{10}),10).isEmpty());
        assertTrue(NativeWidgetState.monthSelection(NativeWidgetState.restore(next,new int[]{10},new int[]{12},ACCOUNT),12).isEmpty());
    }
}
