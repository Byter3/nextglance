package com.nextspace.app;

import android.content.Intent;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.gson.*;

/** Bounded local widget bridge; this plugin exposes no network or mutation capability. */
@CapacitorPlugin(name="NextGlanceWidgets")
public class NativeWidgetPlugin extends Plugin {
    private final java.util.concurrent.ExecutorService work=java.util.concurrent.Executors.newSingleThreadExecutor();
    private record Publication(String account,java.util.Map<String,String> revisions,String denials){}
    private final java.util.Map<String,Publication> publications=new java.util.LinkedHashMap<>();
    private android.content.SharedPreferences.OnSharedPreferenceChangeListener selectionListener;
    @PluginMethod public void getWeekendMask(PluginCall call){work.execute(()->{try{JSObject out=new JSObject();out.put("mask",NativeAppearancePreferences.weekendMask(getContext()));call.resolve(out);}catch(Exception error){call.reject("Weekend appearance could not be read.","APPEARANCE");}});}
    @PluginMethod public void setWeekendMask(PluginCall call){work.execute(()->{try{NativeAppearancePreferences.weekendMask(getContext(),call.getData().opt("mask"));NativeWidgetProvider.refreshAll(getContext());call.resolve();}catch(Exception error){call.reject("Weekend appearance could not be saved. Retry the setting.","APPEARANCE");}});}
    private JsonArray denials()throws Exception{var account=NativeSyncRuntime.savedAccount(getContext());return account==null?new JsonArray():NativeSyncRuntime.readDenials(getContext(),account);}
    @Override public void load(){selectionListener=(prefs,key)->NativeWidgetProvider.refreshAll(getContext());getContext().getSharedPreferences("nextspace-account-selection",android.content.Context.MODE_PRIVATE).registerOnSharedPreferenceChangeListener(selectionListener);}
    private void requireAccount(String key)throws Exception{if(key==null||key.isEmpty()||!key.equals(NativeWidgetStore.accountKey(getContext())))throw new Exception("The selected widget account changed.");}
    @PluginMethod public void state(PluginCall call){work.execute(()->{try{String key=call.getString("accountKey");requireAccount(key);JsonObject state=new NativeWidgetStore(getContext()).state(key);JsonArray denied=denials();String token=java.util.UUID.randomUUID().toString();if(publications.size()>=16)publications.remove(publications.keySet().iterator().next());publications.put(token,new Publication(key,NativeWidgetProjector.revisions(getContext(),key),denied.toString()));state.addProperty("publicationToken",token);state.add("readDenials",denied);call.resolve(JSObject.fromJSONObject(new org.json.JSONObject(state.toString())));}catch(Exception e){call.reject(e.getMessage(),"WIDGET_STATE");}});}
    @PluginMethod public void publish(PluginCall call){work.execute(()->{try{String key=call.getString("accountKey");requireAccount(key);Publication publication=publications.remove(call.getString("publicationToken"));if(publication==null||!key.equals(publication.account()))throw new Exception("Widget publication expired. Prepare a new snapshot.");JsonObject args=JsonParser.parseString(call.getData().toString()).getAsJsonObject();NativeCacheFile cache=new NativeCacheFile(getContext().getFilesDir());NativeReadGeneration.publish(publication.revisions(),cache::revision,()->{requireAccount(key);NativeWidgetPolicy.requireUnchangedAccess(publication.denials(),denials());},()->new NativeWidgetStore(getContext()).publish(key,NativeWidgetPolicy.number(args,"revision",-1),NativeWidgetPolicy.object(args,"catalog"),NativeWidgetPolicy.array(args,"snapshots"),publication.denials()));NativeWidgetProvider.refreshAll(getContext());call.resolve();}catch(Exception e){call.reject(e.getMessage(),"WIDGET_STATE");}});}
    @PluginMethod public void consumeAction(PluginCall call){getActivity().runOnUiThread(()->{JSObject out=new JSObject();out.put("action",org.json.JSONObject.NULL);try{
        String key=call.getString("accountKey");requireAccount(key);Intent intent=getActivity().getIntent();if(intent==null||!NativeWidgetProvider.ACTION.equals(intent.getAction())){call.resolve(out);return;}
        getActivity().setIntent(new Intent(getActivity(),MainActivity.class));int id=intent.getIntExtra("widgetId",0);JsonObject action=new JsonObject();action.addProperty("widgetId",id);action.addProperty("generation",intent.getIntExtra("generation",0));action.addProperty("accountKey",intent.getStringExtra("accountKey"));action.addProperty("action",intent.getStringExtra("widgetAction"));for(String field:new String[]{"recordId","date","kind"})if(intent.hasExtra(field))action.addProperty(field,intent.getStringExtra(field));
        NativeWidgetStore store=new NativeWidgetStore(getContext());JsonObject config=store.config(id),snapshot=store.snapshot(id);if(!NativeWidgetProvider.owns(getContext(),id)||!NativeWidgetPolicy.actionMatches(action,config,snapshot,key)){out.put("error","This widget changed or its saved item is unavailable. Open widget settings and retry.");call.resolve(out);return;}
        out.put("action",new org.json.JSONObject(action.toString()));out.put("config",new org.json.JSONObject(config.toString()));out.put("readDenials",new org.json.JSONArray(denials().toString()));call.resolve(out);
    }catch(Exception e){out.put("error",e.getMessage());call.resolve(out);}});}
    @Override protected void handleOnNewIntent(Intent intent){super.handleOnNewIntent(intent);if(NativeWidgetProvider.ACTION.equals(intent.getAction())){getActivity().setIntent(intent);notifyListeners("widgetAction",new JSObject(),true);}}
    @Override protected void handleOnDestroy(){if(selectionListener!=null)getContext().getSharedPreferences("nextspace-account-selection",android.content.Context.MODE_PRIVATE).unregisterOnSharedPreferenceChangeListener(selectionListener);work.shutdown();super.handleOnDestroy();}
}
