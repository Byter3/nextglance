package com.nextspace.app;

import com.google.gson.*;
import java.time.*;
import java.util.*;

/** Pure selection and itinerary rules over a bounded, already-authorized snapshot. */
final class NativeWidgetMonth {
    private static final int DAY_LIMIT=6;

    static String monthKey(JsonObject month){
        int year=NativeWidgetPolicy.number(month,"year",0);
        if(year<1||year>9999)return "";
        try{return YearMonth.of(year,NativeWidgetPolicy.number(month,"month",0)).toString();}
        catch(DateTimeException invalid){return "";}
    }

    static JsonObject cell(JsonObject month,String date){
        if(!isDate(date))return new JsonObject();
        for(JsonElement entry:NativeWidgetPolicy.array(month,"cells"))if(entry.isJsonObject()){
            JsonObject cell=entry.getAsJsonObject();
            if(date.equals(NativeWidgetPolicy.text(cell,"date","")))return cell;
        }
        return new JsonObject();
    }

    static String selectedDate(JsonObject month,JsonObject selection,JsonObject config){
        String date=NativeWidgetPolicy.text(selection,"date","");
        if(matches(selection,config,month)&&!cell(month,date).isEmpty())return date;
        for(JsonElement entry:NativeWidgetPolicy.array(month,"cells"))if(entry.isJsonObject()){
            JsonObject cell=entry.getAsJsonObject();String day=NativeWidgetPolicy.text(cell,"date","");
            if(NativeWidgetPolicy.flag(cell,"today",false)&&isDate(day))return day;
        }
        return "";
    }

    static boolean matches(JsonObject selection,JsonObject config,JsonObject month){
        String key=monthKey(month);
        return !key.isEmpty()&&key.equals(NativeWidgetPolicy.text(selection,"month",""))
            &&NativeWidgetPolicy.number(selection,"generation",0)==NativeWidgetPolicy.number(config,"generation",-1)
            &&NativeWidgetPolicy.text(config,"accountKey","").equals(NativeWidgetPolicy.text(selection,"accountKey",""));
    }

    static JsonObject select(JsonObject config,JsonObject snapshot,String account,String monthKey,String date,int generation){
        JsonObject month=NativeWidgetPolicy.object(snapshot,"month");
        if(!NativeWidgetPolicy.snapshotMatches(snapshot,config,account)||"unavailable".equals(NativeWidgetPolicy.text(snapshot,"state",""))
            ||!"calendar".equals(NativeWidgetPolicy.text(config,"page",""))||!"month".equals(NativeWidgetPolicy.text(config,"calendarLayout",""))
            ||generation!=NativeWidgetPolicy.number(config,"generation",-1)||monthKey.isEmpty()||!monthKey(month).equals(monthKey)||cell(month,date).isEmpty())return new JsonObject();
        JsonObject selection=new JsonObject();selection.addProperty("month",monthKey);selection.addProperty("date",date);selection.addProperty("generation",generation);selection.addProperty("accountKey",account);
        return selection;
    }

    static JsonArray itinerary(JsonObject snapshot,String date){
        JsonObject month=NativeWidgetPolicy.object(snapshot,"month"),cell=cell(month,date);
        if(cell.isEmpty())return new JsonArray();
        if(month.has("itineraryRows"))return indexedRows(month,cell);
        List<JsonObject> rows=new ArrayList<>();
        for(JsonElement entry:NativeWidgetPolicy.array(snapshot,"rows"))if(entry.isJsonObject()){
            JsonObject row=entry.getAsJsonObject();
            String start=NativeWidgetPolicy.text(row,"rangeStartDay",NativeWidgetPolicy.text(row,"dateKey",""));
            String end=NativeWidgetPolicy.text(row,"rangeEndDay",start);
            if(isItem(row)&&isDate(start)&&isDate(end)&&start.compareTo(date)<=0&&date.compareTo(end)<=0)rows.add(row);
        }
        rows.sort(Comparator.comparing((JsonObject row)->!NativeWidgetPolicy.flag(row,"allDay",false))
            .thenComparing(NativeWidgetMonth::start).thenComparing(row->NativeWidgetPolicy.text(row,"recordId","")));
        JsonArray result=new JsonArray();rows.stream().limit(DAY_LIMIT).forEach(result::add);return result;
    }

    static boolean containsProjectedItem(JsonObject snapshot,String recordId){
        if(recordId.isBlank()||!"calendar".equals(NativeWidgetPolicy.text(snapshot,"page","")))return false;
        JsonObject month=NativeWidgetPolicy.object(snapshot,"month");
        for(JsonElement cell:NativeWidgetPolicy.array(month,"cells"))if(cell.isJsonObject()&&isDate(NativeWidgetPolicy.text(cell.getAsJsonObject(),"date","")))
            for(JsonElement row:indexedRows(month,cell.getAsJsonObject()))
                if(recordId.equals(NativeWidgetPolicy.text(row.getAsJsonObject(),"recordId","")))return true;
        return false;
    }

    private static JsonArray indexedRows(JsonObject month,JsonObject cell){
        JsonArray result=new JsonArray(),rows=NativeWidgetPolicy.array(month,"itineraryRows");
        Set<String> ids=new HashSet<>();
        for(JsonElement ref:NativeWidgetPolicy.array(cell,"itinerary")){
            if(result.size()==DAY_LIMIT)break;
            if(!ref.isJsonPrimitive()||!ref.getAsJsonPrimitive().isNumber())continue;
            int index;
            try{index=ref.getAsBigDecimal().intValueExact();}catch(ArithmeticException|NumberFormatException invalid){continue;}
            if(index<0||index>=rows.size()||!rows.get(index).isJsonObject())continue;
            JsonObject row=rows.get(index).getAsJsonObject();
            if(isItem(row)&&ids.add(NativeWidgetPolicy.text(row,"recordId","")))result.add(row);
        }
        return result;
    }

    private static boolean isItem(JsonObject row){return "item".equals(NativeWidgetPolicy.text(row,"type",""))&&!NativeWidgetPolicy.text(row,"recordId","").isBlank();}
    private static boolean isDate(String day){
        if(!day.matches("\\d{4}-\\d{2}-\\d{2}"))return false;
        try{LocalDate.parse(day);return true;}catch(DateTimeException invalid){return false;}
    }
    private static Instant start(JsonObject row){
        try{return Instant.parse(NativeWidgetPolicy.text(row,"start",""));}catch(DateTimeException invalid){return Instant.MAX;}
    }
}
