package com.nextspace.app;

import android.appwidget.AppWidgetManager;
import android.content.Intent;
import android.widget.*;
import com.google.gson.*;

/** Compatibility collection adapter. Reads only the bounded widget snapshot. */
public class NativeWidgetCollectionService extends RemoteViewsService {
    @Override public RemoteViewsFactory onGetViewFactory(Intent intent){return new RemoteViewsFactory(){
        final int id=intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,-1),contentWidth=intent.getIntExtra("contentWidth",0);
        final boolean monthAgenda=intent.getBooleanExtra("monthAgenda",false);
        final long bitmapBudget=Math.max(1,Math.min(NativeWidgetChartLayout.MAX_BITMAP_BYTES,intent.getLongExtra("bitmapBudget",NativeWidgetChartLayout.MAX_BITMAP_BYTES/2)));
        JsonArray rows=new JsonArray();JsonObject config=new JsonObject(),snapshot=new JsonObject();
        NativeWidgetPresentation.Timeline timeline;
        private int width(){return contentWidth>=80&&contentWidth<=4096?contentWidth:NativeWidgetProvider.contentWidth(getApplicationContext(),id);}
        @Override public void onCreate(){onDataSetChanged();}
        @Override public void onDataSetChanged(){
            try{
                var state=new NativeWidgetStore(getApplicationContext()).renderState(id);
                config=state.config();snapshot=state.snapshot();
                if(!NativeWidgetStore.accountKey(getApplicationContext()).equals(NativeWidgetPolicy.text(config,"accountKey","")))snapshot=new JsonObject();
                rows=monthAgenda?NativeWidgetMonth.itinerary(snapshot,state.monthDate()):NativeWidgetPolicy.array(snapshot,"rows");
                timeline="timeline".equals(NativeWidgetPolicy.text(config,"page",""))
                    ?NativeWidgetPresentation.timeline(snapshot,width(),getResources().getConfiguration().fontScale,bitmapBudget):null;
            }catch(Exception unavailable){rows=new JsonArray();timeline=null;}
        }
        @Override public void onDestroy(){rows=new JsonArray();timeline=null;}
        @Override public int getCount(){return rows.size();}
        @Override public RemoteViews getViewAt(int position){return position>=0&&position<rows.size()&&rows.get(position).isJsonObject()
            ?NativeWidgetProvider.row(getApplicationContext(),rows.get(position).getAsJsonObject(),config,snapshot,width(),bitmapBudget/26,timeline,position):null;}
        @Override public RemoteViews getLoadingView(){return null;}
        @Override public int getViewTypeCount(){return NativeWidgetPresentation.ROW_LAYOUT_COUNT;}
        @Override public long getItemId(int position){return position;}
        @Override public boolean hasStableIds(){return false;}
    };}
}
