package com.nextspace.app;

import com.google.gson.*;
import java.util.*;

/** Pure local instance lifecycle. Storage, account lookup and launcher effects are injected by the host. */
final class NativeWidgetState {
    static JsonObject empty(){JsonObject s=new JsonObject();s.addProperty("version",1);s.addProperty("revision",0);s.add("configs",new JsonObject());return s;}
    static JsonObject config(JsonObject state,int id){return NativeWidgetPolicy.object(NativeWidgetPolicy.object(state,"configs"),String.valueOf(id)).deepCopy();}
    static JsonObject monthSelection(JsonObject state,int id){return NativeWidgetPolicy.object(NativeWidgetPolicy.object(state,"monthSelections"),String.valueOf(id)).deepCopy();}
    static JsonObject withMonthSelection(JsonObject state,int id,JsonObject selection){
        JsonObject next=state.deepCopy(),selections=NativeWidgetPolicy.object(next,"monthSelections");
        if(selection.isEmpty())selections.remove(String.valueOf(id));else selections.add(String.valueOf(id),selection.deepCopy());
        if(selections.isEmpty())next.remove("monthSelections");else next.add("monthSelections",selections);
        return next;
    }
    static JsonObject save(JsonObject state,int id,JsonObject value,String account){
        if(id<=0||!account.equals(NativeWidgetPolicy.text(value,"accountKey","")))throw new IllegalArgumentException("The selected widget account changed.");
        JsonObject s=withMonthSelection(state,id,new JsonObject()),config=value.deepCopy();config.addProperty("widgetId",id);config.addProperty("generation",Math.addExact(NativeWidgetPolicy.number(config(s,id),"generation",0),1));if(!NativeWidgetPolicy.validConfig(config))throw new IllegalArgumentException("Check the widget settings.");NativeWidgetPolicy.object(s,"configs").add(String.valueOf(id),config);s.addProperty("revision",Math.addExact(NativeWidgetPolicy.number(s,"revision",0),1));return s;
    }
    static JsonObject delete(JsonObject state,int[] ids){JsonObject s=state.deepCopy();for(int id:ids){NativeWidgetPolicy.object(s,"configs").remove(String.valueOf(id));NativeWidgetPolicy.object(s,"monthSelections").remove(String.valueOf(id));}s.addProperty("revision",Math.addExact(NativeWidgetPolicy.number(s,"revision",0),1));return s;}
    static JsonObject restore(JsonObject state,int[] oldIds,int[] newIds,String account){
        JsonObject s=delete(state,oldIds);for(int i=0;i<Math.min(oldIds.length,newIds.length);i++){JsonObject c=config(state,oldIds[i]);if(newIds[i]>0&&NativeWidgetPolicy.validConfig(c)&&account.equals(NativeWidgetPolicy.text(c,"accountKey",""))){NativeWidgetPolicy.object(s,"monthSelections").remove(String.valueOf(newIds[i]));c.addProperty("widgetId",newIds[i]);c.addProperty("generation",Math.addExact(NativeWidgetPolicy.number(c,"generation",0),1));NativeWidgetPolicy.object(s,"configs").add(String.valueOf(newIds[i]),c);}}return s;
    }
    static void requirePublication(JsonObject state,String account,int revision,JsonObject catalog,JsonArray snapshots){
        if(revision!=NativeWidgetPolicy.number(state,"revision",-1))throw new IllegalArgumentException("Widget settings changed during preparation.");
        if(!account.equals(NativeWidgetPolicy.text(catalog,"accountKey","")))throw new IllegalArgumentException("Invalid widget catalog account.");
        Set<Integer> seen=new HashSet<>();for(JsonElement e:snapshots){if(!e.isJsonObject())throw new IllegalArgumentException("Invalid widget snapshot.");JsonObject snapshot=e.getAsJsonObject();int id=NativeWidgetPolicy.number(snapshot,"widgetId",0);if(!seen.add(id)||!NativeWidgetPolicy.snapshotMatches(snapshot,config(state,id),account))throw new IllegalArgumentException("Widget snapshot is obsolete.");}
    }
}
