package com.nextspace.app;

import com.google.gson.*;
import java.util.Set;

/** Native envelope/intent fences only. Planner selection and business rules stay in shared core. */
final class NativeWidgetPolicy {
    static final Set<String> PAGES=Set.of("overview","calendar","timeline","board","list");
    static String text(JsonObject value,String key,String fallback){try{return value.has(key)&&value.get(key).isJsonPrimitive()?value.get(key).getAsString():fallback;}catch(Exception error){return fallback;}}
    static int number(JsonObject value,String key,int fallback){try{return value.get(key).getAsBigDecimal().intValueExact();}catch(Exception error){return fallback;}}
    static boolean flag(JsonObject value,String key,boolean fallback){try{return value.get(key).getAsBoolean();}catch(Exception error){return fallback;}}
    static JsonArray array(JsonObject value,String key){return value.has(key)&&value.get(key).isJsonArray()?value.getAsJsonArray(key):new JsonArray();}
    static JsonObject object(JsonObject value,String key){return value.has(key)&&value.get(key).isJsonObject()?value.getAsJsonObject(key):new JsonObject();}
    static boolean showMonthGrid(int widthDp,int heightDp){return widthDp>=340&&heightDp>=450;}
    static void requireUnchangedAccess(String preparedDenials,JsonArray currentDenials){if(!currentDenials.toString().equals(preparedDenials))throw new IllegalStateException("Source access changed while preparing the widget.");}
    static JsonObject sealProjection(JsonObject data,String accessProof){if(!accessProof.matches("[a-f0-9]{64}"))throw new IllegalArgumentException("Invalid widget access proof.");JsonObject value=new JsonObject();value.addProperty("version",1);value.addProperty("accessProof",accessProof);value.add("data",data.deepCopy());return value;}
    static JsonObject openProjection(JsonObject value,String currentAccessProof){return number(value,"version",0)==1&&currentAccessProof.matches("[a-f0-9]{64}")&&currentAccessProof.equals(text(value,"accessProof",""))?object(value,"data").deepCopy():new JsonObject();}
    static boolean validConfig(JsonObject c){
        return number(c,"version",0)==1&&number(c,"widgetId",0)>0&&number(c,"generation",0)>0
            &&text(c,"accountKey","").matches("[a-f0-9]{64}")&&PAGES.contains(text(c,"page",""))
            &&!text(c,"title","").isBlank()&&text(c,"title","").length()<=80&&text(c,"scopeId","").length()>0;
    }
    static boolean snapshotMatches(JsonObject snapshot,JsonObject config,String account){
        return validConfig(config)&&text(config,"accountKey","").equals(account)
            &&number(snapshot,"version",0)==1&&number(snapshot,"widgetId",0)==number(config,"widgetId",-1)
            &&number(snapshot,"generation",0)==number(config,"generation",-1)
            &&text(snapshot,"accountKey","").equals(account)&&text(snapshot,"page","").equals(text(config,"page",""))&&text(snapshot,"scopeId","").equals(text(config,"scopeId",""))
            &&Set.of("ready","empty","unavailable").contains(text(snapshot,"state",""))
            &&array(snapshot,"rows").size()<=512&&snapshot.toString().length()<=1_000_000;
    }
    static boolean actionMatches(JsonObject action,JsonObject config,JsonObject snapshot,String account){
        if(!snapshotMatches(snapshot,config,account)||"unavailable".equals(text(snapshot,"state","")))return false;
        if(number(action,"widgetId",0)!=number(config,"widgetId",-1)||number(action,"generation",0)!=number(config,"generation",-1)||!text(action,"accountKey","").equals(account))return false;
        String kind=text(action,"action","");
        if("open".equals(kind)||"create".equals(kind))return true;
        if("item".equals(kind)){
            String id=text(action,"recordId","");
            for(JsonElement row:array(snapshot,"rows"))if(row.isJsonObject()&&"item".equals(text(row.getAsJsonObject(),"type",""))&&id.equals(text(row.getAsJsonObject(),"recordId","")))return !id.isBlank();
            return "month".equals(text(config,"calendarLayout",""))&&NativeWidgetMonth.containsProjectedItem(snapshot,id);
        }
        if("date".equals(kind)){String date=text(action,"date","");for(JsonArray dates:new JsonArray[]{array(object(snapshot,"month"),"cells"),array(object(snapshot,"calendarGrid"),"days")})for(JsonElement cell:dates)if(cell.isJsonObject()&&date.equals(text(cell.getAsJsonObject(),"date","")))return date.matches("\\d{4}-\\d{2}-\\d{2}");}
        return false;
    }
}
