package com.nextspace.app;

import android.app.PendingIntent;
import android.appwidget.*;
import android.content.*;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Paint;
import android.net.Uri;
import android.os.*;
import android.view.View;
import android.widget.RemoteViews;
import com.google.gson.*;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;

/** Launcher rendering only: reads compact snapshots, never source archives or the network. */
public class NativeWidgetProvider extends AppWidgetProvider {
    static final String ACTION="com.nextspace.app.WIDGET_ACTION";
    private static final String SELECT_MONTH_DAY="com.nextspace.app.WIDGET_SELECT_MONTH_DAY";
    static boolean owns(Context c,int id){AppWidgetProviderInfo info=AppWidgetManager.getInstance(c).getAppWidgetInfo(id);return info!=null&&new ComponentName(c,NativeWidgetProvider.class).equals(info.provider);}
    static int[] ids(Context c){return AppWidgetManager.getInstance(c).getAppWidgetIds(new ComponentName(c,NativeWidgetProvider.class));}
    private static void refreshInstances(Context c){for(int id:ids(c))updateOne(c,id);}
    static void refreshAll(Context c){refreshInstances(c);NativeWidgetRollover.reconcile(c);}
    @Override public void onUpdate(Context c,AppWidgetManager manager,int[] ids){for(int id:ids)updateOne(c,id);NativeWidgetRollover.reconcile(c);}
    @Override public void onAppWidgetOptionsChanged(Context c,AppWidgetManager manager,int id,Bundle options){update(c,id);}
    @Override public void onEnabled(Context c){NativeWidgetRollover.reconcile(c);}
    @Override public void onDisabled(Context c){NativeWidgetRollover.reconcile(c);}
    @Override public void onDeleted(Context c,int[] ids){try{new NativeWidgetStore(c).delete(ids);}catch(Exception ignored){}NativeWidgetRollover.reconcile(c);}
    @Override public void onRestored(Context c,int[] oldIds,int[] newIds){try{new NativeWidgetStore(c).restore(oldIds,newIds);}catch(Exception ignored){}for(int id:newIds)updateOne(c,id);NativeWidgetProjector.schedule(c);NativeWidgetRollover.reconcile(c);}
    @Override public void onReceive(Context c,Intent intent){
        if(SELECT_MONTH_DAY.equals(intent.getAction())){
            int id=intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,0);
            try{
                if(id>0&&owns(c,id)&&new NativeWidgetStore(c).selectMonthDate(id,intent.getIntExtra("generation",0),
                    Objects.toString(intent.getStringExtra("accountKey"),""),Objects.toString(intent.getStringExtra("month"),""),Objects.toString(intent.getStringExtra("date"),"")))updateOne(c,id);
            }catch(Exception ignored){/* An unavailable projection cannot change a widget's selection. */}
            return;
        }
        super.onReceive(c,intent);
        String action=intent.getAction();
        if(action!=null&&Set.of(Intent.ACTION_DATE_CHANGED,Intent.ACTION_TIME_CHANGED,Intent.ACTION_TIMEZONE_CHANGED,Intent.ACTION_LOCALE_CHANGED).contains(action)){
            NativeWidgetProjector.schedule(c);
            refreshInstances(c);
            if(Intent.ACTION_TIME_CHANGED.equals(action)||Intent.ACTION_TIMEZONE_CHANGED.equals(action))NativeWidgetRollover.reconcileClockChange(c);
            else NativeWidgetRollover.reconcile(c);
        }
    }
    static boolean dark(Context c,JsonObject config){String theme=NativeWidgetPolicy.text(config,"theme","system");return "dark".equals(theme)||("system".equals(theme)&&(c.getResources().getConfiguration().uiMode&Configuration.UI_MODE_NIGHT_MASK)==Configuration.UI_MODE_NIGHT_YES);}
    static Intent action(Context context,JsonObject config,String action){
        int id=NativeWidgetPolicy.number(config,"widgetId",0),generation=NativeWidgetPolicy.number(config,"generation",0);
        return new Intent(context,MainActivity.class).setAction(ACTION).setData(Uri.parse("nextglance-widget://instance/"+id+"/"+generation+"/"+action)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TOP)
            .putExtra("widgetId",id).putExtra("generation",generation).putExtra("accountKey",NativeWidgetPolicy.text(config,"accountKey","")).putExtra("widgetAction",action);
    }
    static PendingIntent pending(Context c,JsonObject config,String action){return PendingIntent.getActivity(c,0,action(c,config,action),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);}
    static PendingIntent setup(Context c,int id){Intent intent=new Intent(c,NativeWidgetConfigurationActivity.class).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,id).setData(Uri.parse("nextglance-widget://configure/"+id));return PendingIntent.getActivity(c,id,intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);}
    static String timestamp(String iso){try{return DateTimeFormatter.ofLocalizedDateTime(java.time.format.FormatStyle.SHORT).withLocale(Locale.getDefault()).withZone(ZoneId.systemDefault()).format(Instant.parse(iso));}catch(Exception ignored){return "Not yet checked";}}
    static int dp(Context c,int value){return Math.round(c.getResources().getDisplayMetrics().density*value);}
    static NativeWidgetChartLayout.Size legacySize(Context c,int id){return legacySize(c,id,c.getResources().getConfiguration().orientation==Configuration.ORIENTATION_LANDSCAPE);}
    static NativeWidgetChartLayout.Size legacySize(Context c,int id,boolean landscape){Bundle o=AppWidgetManager.getInstance(c).getAppWidgetOptions(id);return NativeWidgetChartLayout.legacySize(landscape,o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH,180),o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT,210),o.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH,180),o.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT,210));}
    static int width(Context c,int id){return legacySize(c,id).width();}
    static int contentWidth(Context c,int id){var size=legacySize(c,id);return NativeWidgetPresentation.layout("",size.width(),size.height()).width();}
    static void icon(Context c,RemoteViews views,int view,int resource,int color){views.setImageViewIcon(view,android.graphics.drawable.Icon.createWithResource(c,resource).setTint(color));}
    static String fullFreshness(JsonObject snapshot){return "Source checked: "+timestamp(NativeWidgetPolicy.text(snapshot,"sourceVerifiedAt",""))+". Planner data checked: "+timestamp(NativeWidgetPolicy.text(snapshot,"metadataVerifiedAt",""));}
    static void update(Context c,int id){
        updateOne(c,id);
        NativeWidgetRollover.reconcile(c);
    }
    private static void updateOne(Context c,int id){
        try{
            if(!owns(c,id))return;
            NativeWidgetStore.RenderState state=new NativeWidgetStore(c).renderState(id);
            List<NativeWidgetChartLayout.Size> supplied=new ArrayList<>();
            if(Build.VERSION.SDK_INT>=31){ArrayList<android.util.SizeF> options=AppWidgetManager.getInstance(c).getAppWidgetOptions(id).getParcelableArrayList(AppWidgetManager.OPTION_APPWIDGET_SIZES);if(options!=null)for(android.util.SizeF option:options)if(Float.isFinite(option.getWidth())&&Float.isFinite(option.getHeight())&&option.getWidth()>=80&&option.getHeight()>=80&&option.getWidth()<=4096&&option.getHeight()<=4096)supplied.add(new NativeWidgetChartLayout.Size((int)Math.floor(option.getWidth()),(int)Math.floor(option.getHeight())));}
            boolean exact=!supplied.isEmpty();var portrait=legacySize(c,id,false);var landscape=legacySize(c,id,true);
            List<NativeWidgetChartLayout.Size> sizes=NativeWidgetChartLayout.sizes(exact?supplied:List.of(portrait,landscape),portrait);
            var metrics=c.getResources().getDisplayMetrics();long budget=NativeWidgetChartLayout.bitmapBudget(metrics.widthPixels,metrics.heightPixels)/sizes.size();
            RemoteViews views;
            if(Build.VERSION.SDK_INT>=31&&exact){Map<android.util.SizeF,RemoteViews> variants=new LinkedHashMap<>();for(var size:sizes)variants.put(new android.util.SizeF(size.width(),size.height()),render(c,id,state,size,budget,true));views=new RemoteViews(variants);}
            else if(!portrait.equals(landscape))views=new RemoteViews(render(c,id,state,landscape,budget,false),render(c,id,state,portrait,budget,false));
            else views=render(c,id,state,portrait,budget,false);
            AppWidgetManager manager=AppWidgetManager.getInstance(c);manager.updateAppWidget(id,views);if(Build.VERSION.SDK_INT<31)manager.notifyAppWidgetViewDataChanged(id,R.id.widget_list);
        }catch(Exception ignored){
            RemoteViews safe=new RemoteViews(c.getPackageName(),R.layout.nextglance_widget);safe.setTextViewText(R.id.widget_title,"NextGlance");safe.setTextViewText(R.id.widget_context,"");safe.setTextViewText(R.id.widget_freshness,"");safe.setViewVisibility(R.id.widget_content,View.VISIBLE);safe.setViewVisibility(R.id.widget_footer,View.VISIBLE);safe.setViewVisibility(R.id.widget_settings,View.VISIBLE);safe.setViewVisibility(R.id.widget_settings_compact,View.GONE);safe.setContentDescription(R.id.widget_title,"NextGlance");safe.setContentDescription(R.id.widget_freshness,"");safe.setOnClickPendingIntent(R.id.widget_title,setup(c,id));
            for(int view:new int[]{R.id.widget_list,R.id.widget_month,R.id.widget_month_agenda,R.id.widget_overview,R.id.widget_timeline_axis,R.id.widget_timeline_split_header,R.id.widget_create,R.id.widget_freshness_compact,R.id.widget_grid_plan})safe.setViewVisibility(view,View.GONE);
            for(int image:new int[]{R.id.widget_calendar_image,R.id.widget_timeline_axis,R.id.widget_timeline_split_axis})safe.setImageViewBitmap(image,null);safe.removeAllViews(R.id.widget_calendar_actions);
            safe.removeAllViews(R.id.widget_month);safe.setViewVisibility(R.id.widget_empty,View.VISIBLE);safe.setTextViewText(R.id.widget_empty,"Open widget settings to prepare this saved view.");safe.setOnClickPendingIntent(R.id.widget_settings,setup(c,id));safe.setOnClickPendingIntent(R.id.widget_open,setup(c,id));AppWidgetManager.getInstance(c).updateAppWidget(id,safe);
        }
    }
    private static RemoteViews render(Context c,int id,NativeWidgetStore.RenderState state,NativeWidgetChartLayout.Size size,long budget,boolean positioned){
            JsonObject config=state.config();
            boolean valid=NativeWidgetPolicy.validConfig(config)&&NativeWidgetStore.accountKey(c).equals(NativeWidgetPolicy.text(config,"accountKey",""));
            JsonObject snapshot=valid?state.snapshot():new JsonObject();
            boolean ready=!snapshot.isEmpty(),dark=dark(c,config);
            String page=valid?NativeWidgetPolicy.text(config,"page","calendar"):"calendar";
            int width=size.width(),height=size.height();
            NativeWidgetPresentation.Layout layout=NativeWidgetPresentation.layout(page,width,height);
            RemoteViews views=new RemoteViews(c.getPackageName(),R.layout.nextglance_widget);
            int side=layout.compact()&&layout.narrow()?2:8;views.setViewPadding(R.id.widget_body,dp(c,side),dp(c,6),dp(c,side),dp(c,6));
            int ink=Color.parseColor(dark?"#eff4fb":"#243044"),muted=Color.parseColor(dark?"#c3cfde":"#435666"),blue=Color.parseColor(dark?"#41b5f4":"#0076b5");
            views.setViewVisibility(R.id.widget_content,View.VISIBLE);views.setViewVisibility(R.id.widget_month,View.GONE);views.setViewVisibility(R.id.widget_month_agenda,View.GONE);views.removeAllViews(R.id.widget_month);views.setViewVisibility(R.id.widget_list,View.VISIBLE);views.setViewVisibility(R.id.widget_grid_plan,View.GONE);views.setViewVisibility(R.id.widget_open,View.VISIBLE);
            for(int image:new int[]{R.id.widget_calendar_image,R.id.widget_timeline_axis,R.id.widget_timeline_split_axis})views.setImageViewBitmap(image,null);
            views.removeAllViews(R.id.widget_calendar_actions);
            views.setImageViewResource(R.id.widget_background,dark?R.drawable.widget_shell_dark:R.drawable.widget_shell_light);
            boolean highContrast=false;try{highContrast=android.provider.Settings.Secure.getInt(c.getContentResolver(),"high_text_contrast_enabled",0)==1;}catch(Exception ignored){}
            views.setInt(R.id.widget_background,"setImageAlpha",highContrast?255:(int)Math.round(255*(1-Math.max(0,Math.min(50,NativeWidgetPolicy.number(config,"transparency",32)))/100.0)));
            views.setTextColor(R.id.widget_title,ink);
            for(int view:new int[]{R.id.widget_context,R.id.widget_empty,R.id.widget_freshness,R.id.widget_freshness_compact})views.setTextColor(view,muted);
            views.setTextColor(R.id.widget_open,blue);
            icon(c,views,R.id.widget_create,R.drawable.widget_icon_plus,blue);
            icon(c,views,R.id.widget_settings,R.drawable.widget_icon_settings,blue);
            icon(c,views,R.id.widget_settings_compact,R.drawable.widget_icon_settings,blue);
            String title=valid?NativeWidgetPolicy.text(config,"title","NextGlance"):"NextGlance";
            views.setTextViewText(R.id.widget_title,title);
            views.setOnClickPendingIntent(R.id.widget_settings,setup(c,id));
            views.setOnClickPendingIntent(R.id.widget_settings_compact,setup(c,id));
            // At narrow sizes move settings to the footer; compact heights keep both header controls.
            boolean footerSettings=layout.narrow()&&!layout.compact();
            views.setViewVisibility(R.id.widget_settings,footerSettings?View.GONE:View.VISIBLE);
            views.setViewVisibility(R.id.widget_settings_compact,footerSettings?View.VISIBLE:View.GONE);
            views.setViewVisibility(R.id.widget_footer,layout.compact()?View.GONE:View.VISIBLE);
            views.setViewVisibility(R.id.widget_freshness_compact,layout.compact()&&NativeWidgetPresentation.compactFooter(page,height)?View.VISIBLE:View.GONE);
            views.setViewVisibility(R.id.widget_freshness,footerSettings?View.GONE:View.VISIBLE);
            String context=ready?NativeWidgetPolicy.text(snapshot,"contextLabel","Saved view"):"Saved view";
            JsonObject overview=NativeWidgetPolicy.object(snapshot,"overview");
            String bookings=NativeWidgetPolicy.number(overview,"bookings",0)+" bookings",work=NativeWidgetPolicy.number(overview,"work",0)+" work items";
            if("overview".equals(page)&&!layout.overview()&&!overview.isEmpty())context=bookings+" \u00b7 "+work;
            views.setTextViewText(R.id.widget_context,context);
            views.setViewVisibility(R.id.widget_context,layout.context()?View.VISIBLE:View.GONE);
            views.setContentDescription(R.id.widget_title,title+". Open "+page+". "+NativeWidgetPolicy.text(snapshot,"contextLabel",context)+". "+fullFreshness(snapshot));
            views.setViewVisibility(R.id.widget_overview,layout.overview()&&!overview.isEmpty()?View.VISIBLE:View.GONE);
            views.setTextViewText(R.id.widget_overview_bookings,bookings);views.setTextViewText(R.id.widget_overview_work,work);
            for(int view:new int[]{R.id.widget_overview_bookings,R.id.widget_overview_work}){views.setTextColor(view,ink);views.setInt(view,"setBackgroundResource",dark?R.drawable.widget_card_dark:R.drawable.widget_card_light);}
            JsonObject axis=NativeWidgetPolicy.object(snapshot,"timelineAxis");
            var timeline=layout.timeline()?NativeWidgetPresentation.timeline(snapshot,layout.width(),c.getResources().getConfiguration().fontScale,budget,Build.VERSION.SDK_INT>=31):null;
            boolean splitTimeline=timeline!=null&&timeline.split();
            views.setViewVisibility(R.id.widget_timeline_axis,timeline!=null&&!axis.isEmpty()&&!splitTimeline?View.VISIBLE:View.GONE);
            views.setViewVisibility(R.id.widget_timeline_split_header,splitTimeline?View.VISIBLE:View.GONE);
            if(Build.VERSION.SDK_INT>=31&&splitTimeline){
                bindSplitTimelineHeader(c,views,axis,timeline,dark,ink,muted);
            }else if(timeline!=null&&!axis.isEmpty()){
                views.setImageViewBitmap(R.id.widget_timeline_axis,timelineChart(c,axis,new JsonObject(),timeline.chartWidth(),
                    NativeWidgetPresentation.COMPACT_TIMELINE_AXIS_HEIGHT,dark,muted,NativeWidgetTimelineCharts.Part.HEADING,timeline.chartBudget()));
                views.setContentDescription(R.id.widget_timeline_axis,NativeWidgetPolicy.text(axis,"label","Timeline dates"));
            }
            String message=valid?"Open NextGlance to prepare this widget.":"Set up this widget to choose a page and sources.";
            if(!config.isEmpty()&&!NativeWidgetStore.accountKey(c).equals(NativeWidgetPolicy.text(config,"accountKey","")))message="This widget belongs to another account. Open settings to reconnect it.";
            if(ready)message=NativeWidgetPolicy.text(snapshot,"message","No matching items.");
            views.setTextViewText(R.id.widget_empty,message);views.setEmptyView(R.id.widget_list,R.id.widget_empty);
            boolean available=ready&&!"unavailable".equals(NativeWidgetPolicy.text(snapshot,"state",""));
            views.setViewVisibility(R.id.widget_create,available?View.VISIBLE:View.GONE);
            if(available){views.setOnClickPendingIntent(R.id.widget_create,pending(c,config,"create"));views.setOnClickPendingIntent(R.id.widget_title,pending(c,config,"open"));views.setOnClickPendingIntent(R.id.widget_open,pending(c,config,"open"));}
            else {PendingIntent open=PendingIntent.getActivity(c,id,new Intent(c,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);views.setOnClickPendingIntent(R.id.widget_open,valid?open:setup(c,id));views.setOnClickPendingIntent(R.id.widget_title,valid?open:setup(c,id));}
            JsonArray rows=NativeWidgetPolicy.array(snapshot,"rows");
            views.setTextViewText(R.id.widget_open,NativeWidgetPolicy.flag(snapshot,"truncated",false)?"All ("+NativeWidgetPolicy.number(snapshot,"totalCount",rows.size())+")":"Open");
            views.setContentDescription(R.id.widget_open,"Open "+(valid?page:"NextGlance")+". "+fullFreshness(snapshot));
            String freshness=ready?NativeWidgetPresentation.compactFreshness(snapshot,Locale.getDefault(),ZoneId.systemDefault()):"Saved data is not ready";
            for(int view:new int[]{R.id.widget_freshness,R.id.widget_freshness_compact}){views.setTextViewText(view,freshness);views.setContentDescription(view,fullFreshness(snapshot));}
            if(available&&NativeWidgetChartLayout.gridPage(page,config,snapshot)){
                renderGrid(c,views,config,snapshot,size,budget,dark,positioned);
                return views;
            }
            JsonObject month=NativeWidgetPolicy.object(snapshot,"month");
            JsonArray cells=NativeWidgetPolicy.array(month,"cells");
            if(available&&!state.monthDate().isEmpty()&&cells.size()>0){
                boolean grid=NativeWidgetPolicy.showMonthGrid(width,height);
                boolean agenda=!grid||NativeWidgetPresentation.monthAgenda(height,(cells.size()+6)/7,c.getResources().getConfiguration().fontScale);
                String monthLabel=NativeWidgetPolicy.text(month,"label","Calendar");
                views.setTextViewText(R.id.widget_context,monthLabel+" \u00b7 "+(grid?context:c.getString(R.string.widget_enlarge_month)));
                views.setViewVisibility(R.id.widget_context,View.VISIBLE);
                if(grid)renderMonth(c,views,config,month,state.monthDate(),agenda,ink,muted,blue);
                if(agenda){
                    rows=NativeWidgetMonth.itinerary(snapshot,state.monthDate());
                    renderMonthAgenda(c,views,config,NativeWidgetMonth.cell(month,state.monthDate()),state.monthDate(),rows.size(),height,ink,muted,blue);
                    bindRows(c,id,views,config,snapshot,rows,layout.width(),budget,true,null);
                }else views.setViewVisibility(R.id.widget_content,View.GONE);
            }else bindRows(c,id,views,config,snapshot,rows,layout.width(),budget,false,timeline);
            return views;
    }
    private static void bindRows(Context c,int id,RemoteViews views,JsonObject config,JsonObject snapshot,JsonArray rows,int width,long budget,
                                 boolean monthAgenda, NativeWidgetPresentation.Timeline timeline){
        int flags=PendingIntent.FLAG_UPDATE_CURRENT|(Build.VERSION.SDK_INT>=31?PendingIntent.FLAG_MUTABLE:0);
        views.setPendingIntentTemplate(R.id.widget_list,PendingIntent.getActivity(c,id,action(c,config,"item"),flags));
        if(Build.VERSION.SDK_INT>=31){
            RemoteViews.RemoteCollectionItems.Builder items=new RemoteViews.RemoteCollectionItems.Builder().setHasStableIds(false).setViewTypeCount(NativeWidgetPresentation.ROW_LAYOUT_COUNT);
            for(int position=0;position<rows.size();position++)if(rows.get(position).isJsonObject())
                items.addItem(position,row(c,rows.get(position).getAsJsonObject(),config,snapshot,width,budget/26,timeline,position));
            views.setRemoteAdapter(R.id.widget_list,items.build());
        }else{
            Intent service=new Intent(c,NativeWidgetCollectionService.class).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,id).putExtra("contentWidth",width)
                .putExtra("monthAgenda",monthAgenda).putExtra("bitmapBudget",budget)
                .setData(Uri.parse("nextglance-widget://rows/"+id+"/"+width+(monthAgenda?"/month":timeline==null?"":"/timeline/"+budget)));
            views.setRemoteAdapter(R.id.widget_list,service);
        }
    }
    private static void renderGrid(Context c,RemoteViews views,JsonObject config,JsonObject snapshot,NativeWidgetChartLayout.Size size,long budget,boolean dark,boolean positioned){
        // Leave one dp at the fixed viewport edges for launcher/fractional-dp rounding.
        int width=Math.max(1,NativeWidgetChartLayout.contentWidth(size.width())-1);if(size.width()<240)views.setViewPadding(R.id.widget_body,dp(c,2),dp(c,6),dp(c,2),dp(c,6));
        var metrics=c.getResources().getDisplayMetrics();float density=metrics.density,fontScale=c.getResources().getConfiguration().fontScale;
        String page=NativeWidgetPolicy.text(config,"page","calendar");boolean overview="overview".equals(page);var chrome=NativeWidgetChartLayout.chrome(page,size.height(),fontScale);
        for(int view:new int[]{R.id.widget_list,R.id.widget_empty,R.id.widget_month,R.id.widget_overview,R.id.widget_timeline_axis,R.id.widget_timeline_split_header,R.id.widget_footer})views.setViewVisibility(view,View.GONE);
        views.setViewVisibility(R.id.widget_grid_plan,View.VISIBLE);views.setViewVisibility(R.id.widget_content,View.VISIBLE);
        views.setViewVisibility(R.id.widget_context,chrome.context()?View.VISIBLE:View.GONE);
        views.setViewVisibility(R.id.widget_freshness_compact,chrome.footer()?View.VISIBLE:View.GONE);
        // The footer collapses here, so settings always remains in the 44dp header.
        views.setViewVisibility(R.id.widget_settings,View.VISIBLE);views.setViewVisibility(R.id.widget_settings_compact,View.GONE);
        int workHeight=overview?chrome.work():0,calendarHeight=Math.max(1,chrome.calendar()-1),chartHeight=workHeight+calendarHeight;
        JsonObject source=NativeWidgetPolicy.object(snapshot,"calendarGrid");var grid=NativeWidgetChartLayout.grid(source,width,calendarHeight,overview,fontScale);
        if(NativeWidgetPolicy.flag(snapshot,"truncated",false))views.setTextViewText(R.id.widget_title,NativeWidgetPolicy.text(config,"title","NextGlance")+" · More");
        int weekendMask=NativeAppearancePreferences.weekendMask(c);
        var raster=NativeWidgetChartLayout.raster(width,chartHeight,density,budget);
        views.setImageViewBitmap(R.id.widget_calendar_image,NativeWidgetCharts.calendar(snapshot,grid,workHeight,raster,dark,fontScale,weekendMask));
        if(Build.VERSION.SDK_INT>=31){
            for(int id:new int[]{R.id.widget_calendar_chart,R.id.widget_calendar_image,R.id.widget_calendar_actions}){
                views.setViewLayoutWidth(id,width,android.util.TypedValue.COMPLEX_UNIT_DIP);views.setViewLayoutHeight(id,chartHeight,android.util.TypedValue.COMPLEX_UNIT_DIP);
            }
            views.setViewLayoutHeight(R.id.widget_context,20,android.util.TypedValue.COMPLEX_UNIT_DIP);
        }
        views.removeAllViews(R.id.widget_calendar_actions);
        views.setOnClickPendingIntent(R.id.widget_calendar_image,!overview&&grid.days().size()==1?chartAction(c,config,"date",grid.days().get(0).date()):pending(c,config,"open"));
        if(Build.VERSION.SDK_INT>=31&&positioned){
            var fit=NativeWidgetChartLayout.displayFit(width,chartHeight,raster,width,chartHeight);
            for(var day:grid.days()){
                var original=day.rect();var target=NativeWidgetChartLayout.target(new NativeWidgetChartLayout.Rect(original.x(),original.y()+workHeight,original.width(),original.height()),fit,density);
                if(target.actionable())addHit(c,views,config,target,"date",day.date(),day.label()+". Open calendar day");
            }
            Map<String,String> labels=new HashMap<>();for(JsonElement element:NativeWidgetPolicy.array(snapshot,"rows"))if(element.isJsonObject()){
                JsonObject row=element.getAsJsonObject();labels.put(NativeWidgetPolicy.text(row,"recordId",""),NativeWidgetPresentation.row(row,overview?"timeline":"calendar").accessible());
            }
            if(overview){
                var layout=NativeWidgetChartLayout.overviewPlan(snapshot,grid.width(),workHeight,fontScale);
                var dependencies=NativeWidgetChartLayout.overviewDependencies(snapshot,layout,grid.width(),fontScale);
                for(int index=0;index<layout.lines().size();index++){
                    String recordId=NativeWidgetPolicy.text(layout.lines().get(index).row(),"recordId",""), description=dependencies.description(index);
                    if(!recordId.isEmpty()&&!description.isEmpty())labels.computeIfPresent(recordId,(key,label)->label+". "+description);
                }
            }
            for(var mark:NativeWidgetChartLayout.actionable(grid,fit,density,workHeight))addHit(c,views,config,mark.rect(),"item",mark.recordId(),labels.getOrDefault(mark.recordId(),mark.title()));
            for(var mark:NativeWidgetChartLayout.overviewActionable(snapshot,grid,workHeight,fontScale,fit,density))addHit(c,views,config,mark.rect(),"item",mark.recordId(),labels.getOrDefault(mark.recordId(),mark.title()));
        }
    }
    private static PendingIntent chartAction(Context c,JsonObject config,String type,String value){
        Intent intent=action(c,config,type);intent.setData(Uri.parse(intent.getDataString()+"/"+Uri.encode(value))).putExtra("date".equals(type)?"date":"recordId",value);
        return PendingIntent.getActivity(c,0,intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
    }
    @android.annotation.TargetApi(31)
    private static void addHit(Context c,RemoteViews views,JsonObject config,NativeWidgetChartLayout.Rect rect,String type,String value,String label){
        RemoteViews hit=new RemoteViews(c.getPackageName(),R.layout.nextglance_widget_hit);
        hit.setViewLayoutWidth(R.id.widget_chart_hit,(float)rect.width(),android.util.TypedValue.COMPLEX_UNIT_DIP);hit.setViewLayoutHeight(R.id.widget_chart_hit,(float)rect.height(),android.util.TypedValue.COMPLEX_UNIT_DIP);
        hit.setViewLayoutMargin(R.id.widget_chart_hit,RemoteViews.MARGIN_LEFT,(float)rect.x(),android.util.TypedValue.COMPLEX_UNIT_DIP);hit.setViewLayoutMargin(R.id.widget_chart_hit,RemoteViews.MARGIN_TOP,(float)rect.y(),android.util.TypedValue.COMPLEX_UNIT_DIP);
        hit.setContentDescription(R.id.widget_chart_hit,label);hit.setOnClickPendingIntent(R.id.widget_chart_hit,chartAction(c,config,type,value));views.addView(R.id.widget_calendar_actions,hit);
    }
    private static PendingIntent monthSelection(Context c,JsonObject config,String month,String date){
        int id=NativeWidgetPolicy.number(config,"widgetId",0),generation=NativeWidgetPolicy.number(config,"generation",0);
        String account=NativeWidgetPolicy.text(config,"accountKey","");
        Intent intent=new Intent(c,NativeWidgetProvider.class).setAction(SELECT_MONTH_DAY).addFlags(Intent.FLAG_RECEIVER_FOREGROUND)
            .setData(Uri.parse("nextglance-widget://month/"+id+"/"+generation+"/"+account+"/"+month+"/"+date))
            .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,id).putExtra("generation",generation).putExtra("accountKey",account)
            .putExtra("month",month).putExtra("date",date);
        return PendingIntent.getBroadcast(c,id,intent,PendingIntent.FLAG_IMMUTABLE);
    }
    private static String calendarDayLabel(String date){
        try{return DateTimeFormatter.ofLocalizedDate(java.time.format.FormatStyle.MEDIUM).withLocale(Locale.getDefault()).format(LocalDate.parse(date));}
        catch(DateTimeException invalid){return date;}
    }
    private static String monthItemCount(Context c,int count){return c.getResources().getQuantityString(R.plurals.widget_month_items,count,count);}
    private static void renderMonthAgenda(Context c,RemoteViews views,JsonObject config,JsonObject cell,String date,int visible,int height,int ink,int muted,int blue){
        int count=Math.max(visible,NativeWidgetPolicy.number(cell,"count",0)),hidden=count-visible;
        String summary=count==0?"":monthItemCount(c,count);
        if(hidden>0)summary+=" \u00b7 "+c.getString(R.string.widget_month_more,hidden);
        views.setViewVisibility(R.id.widget_month_agenda,View.VISIBLE);
        views.setTextViewText(R.id.widget_month_agenda_date,calendarDayLabel(date));views.setTextColor(R.id.widget_month_agenda_date,ink);
        views.setTextViewText(R.id.widget_month_agenda_count,summary);views.setTextColor(R.id.widget_month_agenda_count,muted);
        views.setViewVisibility(R.id.widget_month_agenda_count,count==0?View.GONE:View.VISIBLE);
        views.setTextColor(R.id.widget_month_open_day,blue);
        views.setContentDescription(R.id.widget_month_open_day,c.getString(R.string.widget_open_day_named,calendarDayLabel(date)));
        views.setOnClickPendingIntent(R.id.widget_month_open_day,chartAction(c,config,"date",date));
        views.setTextViewText(R.id.widget_empty,count==0?c.getString(R.string.widget_month_no_items):c.getString(R.string.widget_month_items_in_calendar));
        views.setViewVisibility(R.id.widget_footer,View.GONE);
        views.setViewVisibility(R.id.widget_freshness_compact,height>=240?View.VISIBLE:View.GONE);
        views.setViewVisibility(R.id.widget_settings,View.VISIBLE);
        views.setViewVisibility(R.id.widget_settings_compact,View.GONE);
    }
    private static void renderMonth(Context c,RemoteViews views,JsonObject config,JsonObject month,String selectedDate,boolean agenda,int ink,int muted,int blue){
        views.setViewVisibility(R.id.widget_month,View.VISIBLE);views.removeAllViews(R.id.widget_month);
        views.setInt(R.id.widget_month,"setBackgroundResource",dark(c,config)?R.drawable.widget_card_dark:R.drawable.widget_card_light);
        int weekendMask=NativeAppearancePreferences.weekendMask(c),weekdayIndex=0;JsonArray cells=NativeWidgetPolicy.array(month,"cells");
        RemoteViews weekdays=new RemoteViews(c.getPackageName(),R.layout.nextglance_widget_week);
        for(JsonElement label:NativeWidgetPolicy.array(month,"weekdays")){
            RemoteViews day=new RemoteViews(c.getPackageName(),R.layout.nextglance_widget_day);day.setTextViewText(R.id.widget_day,label.getAsString());day.setTextColor(R.id.widget_day,muted);
            String date=weekdayIndex<cells.size()?NativeWidgetPolicy.text(cells.get(weekdayIndex).getAsJsonObject(),"date",""):"";
            day.setInt(R.id.widget_day,"setBackgroundColor",NativeWeekend.contains(date,weekendMask)?NativeWeekend.OVERLAY:Color.TRANSPARENT);weekdayIndex++;weekdays.addView(R.id.widget_week,day);
        }
        views.addView(R.id.widget_month,weekdays);
        RemoteViews week=null;int index=0;String monthKey=NativeWidgetMonth.monthKey(month);
        for(JsonElement value:NativeWidgetPolicy.array(month,"cells")){
            if(index%7==0){if(week!=null)views.addView(R.id.widget_month,week);week=new RemoteViews(c.getPackageName(),R.layout.nextglance_widget_week);}
            JsonObject cell=value.getAsJsonObject();RemoteViews day=new RemoteViews(c.getPackageName(),R.layout.nextglance_widget_day);String date=NativeWidgetPolicy.text(cell,"date","");
            boolean selected=date.equals(selectedDate),today=NativeWidgetPolicy.flag(cell,"today",false);int count=NativeWidgetPolicy.number(cell,"count",0);
            day.setTextViewText(R.id.widget_day,NativeWidgetPolicy.number(cell,"day",0)+(count>0?" \u2022":""));
            day.setTextColor(R.id.widget_day,selected||today?blue:NativeWidgetPolicy.flag(cell,"inMonth",true)?ink:muted);
            int background=selected?((blue&0x00ffffff)|0x24000000):NativeWeekend.contains(date,weekendMask)?NativeWeekend.OVERLAY:Color.TRANSPARENT;
            day.setInt(R.id.widget_day,"setBackgroundColor",background);
            day.setContentDescription(R.id.widget_day,calendarDayLabel(date)+". "+monthItemCount(c,count)+(selected?". "+c.getString(R.string.widget_month_selected):""));
            day.setOnClickPendingIntent(R.id.widget_day,agenda&&!monthKey.isEmpty()?monthSelection(c,config,monthKey,date):chartAction(c,config,"date",date));
            week.addView(R.id.widget_week,day);index++;
        }
        if(week!=null)views.addView(R.id.widget_month,week);
    }
    static RemoteViews row(Context c,JsonObject value,JsonObject config,JsonObject snapshot,int contentWidth,long bitmapBudget,
                           NativeWidgetPresentation.Timeline timeline,int position){
        String page=NativeWidgetPolicy.text(config,"page","calendar");
        if(Build.VERSION.SDK_INT>=31&&timeline!=null&&timeline.split())return splitTimelineRow(c,value,config,snapshot,timeline,position);
        NativeWidgetPresentation.Row row=NativeWidgetPresentation.row(value,page,contentWidth);
        NativeWidgetPresentation.Cluster cluster=NativeWidgetPresentation.cluster(value,snapshot,page);
        boolean dark=dark(c,config);int ink=Color.parseColor(dark?"#eff4fb":"#243044"),muted=Color.parseColor(dark?"#c3cfde":"#435666"),color=ink;
        boolean weekend=NativeWeekend.contains(NativeWeekend.rowDate(value),NativeAppearancePreferences.weekendMask(c));
        try{color=Color.parseColor(row.color());}catch(Exception ignored){}
        int resource=switch(row.style()){
            case SECTION->timeline!=null?R.layout.nextglance_widget_timeline_section:R.layout.nextglance_widget_section;
            case BOOKING->R.layout.nextglance_widget_booking;
            case CARD->R.layout.nextglance_widget_card;
            case TASK->R.layout.nextglance_widget_row;
            case TIMELINE->R.layout.nextglance_widget_timeline;
        };
        RemoteViews views=new RemoteViews(c.getPackageName(),resource);
        if(row.style()!=NativeWidgetPresentation.Style.CARD)views.setInt(R.id.widget_row,"setBackgroundResource",dark?R.drawable.widget_row_dark:R.drawable.widget_row_light);
        views.setTextViewText(R.id.widget_row_title,row.title());views.setTextColor(R.id.widget_row_title,row.style()==NativeWidgetPresentation.Style.SECTION?muted:ink);
        String dependencies=timeline==null?"":timeline.dependencies().description(position);
        int itemView=row.style()==NativeWidgetPresentation.Style.TIMELINE?R.id.widget_timeline_content:R.id.widget_row;
        views.setContentDescription(itemView,dependencies.isBlank()?row.accessible():row.accessible()+". "+dependencies);
        views.setInt(R.id.widget_row_title,"setPaintFlags",Paint.ANTI_ALIAS_FLAG|(row.completed()?Paint.STRIKE_THRU_TEXT_FLAG:0));
        if(row.style()==NativeWidgetPresentation.Style.SECTION){
            views.setInt(R.id.widget_row,"setBackgroundResource",dark?R.drawable.widget_section_dark:R.drawable.widget_section_light);
            views.setViewPadding(timeline==null?R.id.widget_row:R.id.widget_timeline_section_content,
                dp(c,3+Math.min(5,Math.max(0,NativeWidgetPolicy.number(value,"depth",0)))*8),0,dp(c,3),0);
            views.setTextViewText(R.id.widget_row_date,row.trailing());views.setTextColor(R.id.widget_row_date,muted);return views;
        }
        boolean comfortable="comfortable".equals(NativeWidgetPolicy.text(config,"density",""));
        views.setTextViewTextSize(R.id.widget_row_title,android.util.TypedValue.COMPLEX_UNIT_SP,
            row.style()==NativeWidgetPresentation.Style.TIMELINE?(comfortable?14:13):(comfortable?16:15));
        if(row.style()==NativeWidgetPresentation.Style.TIMELINE){
            String kind=NativeWidgetPolicy.text(value,"kind","task");
            icon(c,views,R.id.widget_row_icon,"event".equals(kind)?R.drawable.widget_icon_event:"card".equals(kind)?R.drawable.widget_icon_card:row.completed()?R.drawable.widget_icon_done:R.drawable.widget_icon_task,color);
            views.setTextViewText(R.id.widget_row_date,row.trailing());views.setTextColor(R.id.widget_row_date,muted);views.setViewVisibility(R.id.widget_row_date,row.trailing().isEmpty()?View.GONE:View.VISIBLE);
            views.setInt(R.id.widget_row_date,"setBackgroundColor",weekend?NativeWeekend.OVERLAY:Color.TRANSPARENT);
            String fallback=timeline==null?"":timeline.dependencies().fallback(position);
            String secondary=NativeWidgetPresentation.timelineContext(row.secondary(),fallback);
            views.setTextViewText(R.id.widget_row_subtitle,secondary);views.setTextColor(R.id.widget_row_subtitle,muted);
            views.setViewVisibility(R.id.widget_row_subtitle,secondary.isBlank()?View.GONE:View.VISIBLE);
            views.setImageViewBitmap(R.id.widget_timeline_bar,timelineChart(c,NativeWidgetPolicy.object(snapshot,"timelineAxis"),
                NativeWidgetPolicy.object(value,"timeline"),contentWidth,NativeWidgetPresentation.COMPACT_TIMELINE_BAR_HEIGHT,
                dark,color,NativeWidgetTimelineCharts.Part.ITEM,timeline==null?bitmapBudget:timeline.chartBudget()));
        }else{
            String secondary=row.secondary();
            if(row.style()==NativeWidgetPresentation.Style.BOOKING){
                String day=NativeWidgetPolicy.text(value,"displayDay","");if(!day.isEmpty())secondary=day+(secondary.isEmpty()?"":" \u00b7 "+secondary);
                views.setTextViewText(R.id.widget_row_time,row.leading());views.setTextColor(R.id.widget_row_time,Color.parseColor(dark?"#66c8fa":"#006b9f"));
                views.setInt(R.id.widget_row_time,"setBackgroundColor",weekend?NativeWeekend.OVERLAY:Color.TRANSPARENT);
                views.setInt(R.id.widget_row_edge,"setBackgroundColor",color);
            }else{
                views.setTextViewText(R.id.widget_row_date,row.trailing());views.setTextColor(R.id.widget_row_date,muted);
                views.setInt(R.id.widget_row_date,"setBackgroundColor",weekend?NativeWeekend.OVERLAY:Color.TRANSPARENT);
                views.setViewVisibility(R.id.widget_row_date,row.trailing().isEmpty()?View.GONE:View.VISIBLE);
                icon(c,views,R.id.widget_row_icon,row.style()==NativeWidgetPresentation.Style.CARD?R.drawable.widget_icon_card:row.completed()?R.drawable.widget_icon_done:R.drawable.widget_icon_task,color);
                if(row.style()==NativeWidgetPresentation.Style.CARD){
                    views.setInt(R.id.widget_card_surface,"setBackgroundResource",cluster.parent()?(dark?R.drawable.widget_cluster_top_dark:R.drawable.widget_cluster_top_light):(dark?R.drawable.widget_card_dark:R.drawable.widget_card_light));views.setInt(R.id.widget_row_edge,"setBackgroundColor",color);
                    views.setViewPadding(R.id.widget_row,0,dp(c,4),0,cluster.parent()?0:dp(c,5));
                    if(cluster.parent())secondary+=(secondary.isBlank()?"":" \u00b7 ")+cluster.count()+" linked task"+(cluster.count()==1?"":"s");
                }else{
                    views.setViewPadding(R.id.widget_row,dp(c,3),dp(c,6),dp(c,3),dp(c,6));
                    views.setViewPadding(R.id.widget_task_content,dp(c,6),0,dp(c,6),0);
                    int connector=color;try{if(cluster.child())connector=Color.parseColor(cluster.color());}catch(Exception ignored){}
                    views.setViewVisibility(R.id.widget_link_indent,row.linked()?View.VISIBLE:View.GONE);
                    for(int id:new int[]{R.id.widget_link_line,R.id.widget_link_tail,R.id.widget_link_branch})views.setInt(id,"setBackgroundColor",connector);
                    views.setViewVisibility(R.id.widget_link_tail,cluster.child()&&cluster.last()?View.INVISIBLE:View.VISIBLE);
                    views.setViewVisibility(R.id.widget_row_parent,cluster.child()?View.VISIBLE:View.GONE);
                    views.setTextViewText(R.id.widget_row_parent,cluster.child()?cluster.relationship()+" "+cluster.title():"");views.setTextColor(R.id.widget_row_parent,muted);
                    if(cluster.child()){
                        views.setInt(R.id.widget_row,"setBackgroundResource",cluster.last()?(dark?R.drawable.widget_cluster_bottom_dark:R.drawable.widget_cluster_bottom_light):(dark?R.drawable.widget_cluster_middle_dark:R.drawable.widget_cluster_middle_light));
                        views.setViewPadding(R.id.widget_row,dp(c,5),0,dp(c,7),0);
                        views.setViewPadding(R.id.widget_task_content,dp(c,6),dp(c,6),dp(c,6),dp(c,6));
                        views.setTextViewTextSize(R.id.widget_row_title,android.util.TypedValue.COMPLEX_UNIT_SP,comfortable?15:14);
                        views.setContentDescription(R.id.widget_row,row.accessible()+". "+cluster.relationship()+" "+cluster.title());
                    }
                }
            }
            String datePrefix=row.style()==NativeWidgetPresentation.Style.BOOKING?NativeWidgetPolicy.text(value,"displayDay",""):row.trailing().isEmpty()?NativeWidgetPolicy.text(value,"trailingLabel",NativeWidgetPolicy.text(value,"dateLabel","")):"";
            views.setTextViewText(R.id.widget_row_subtitle,dateTint(secondary,datePrefix,weekend));views.setTextColor(R.id.widget_row_subtitle,muted);views.setViewVisibility(R.id.widget_row_subtitle,secondary.isEmpty()?View.GONE:View.VISIBLE);
        }
        views.setOnClickFillInIntent(itemView,new Intent().putExtra("recordId",NativeWidgetPolicy.text(value,"recordId","")));
        return views;
    }
    private static android.graphics.Bitmap timelineChart(Context c, JsonObject axis, JsonObject range, int width, int height,
                                                         boolean dark, int accent, NativeWidgetTimelineCharts.Part part, long budget) {
        var raster=NativeWidgetChartLayout.raster(width,height,c.getResources().getDisplayMetrics().density,budget);
        return NativeWidgetTimelineCharts.render(axis,NativeWidgetPresentation.range(range),width,height,raster,dark,accent,part,
            c.getResources().getConfiguration().fontScale,NativeAppearancePreferences.weekendMask(c),Locale.getDefault(),null,0);
    }

    @android.annotation.TargetApi(31)
    private static void bindSplitTimelineHeader(Context c, RemoteViews views, JsonObject axis,
                                                NativeWidgetPresentation.Timeline timeline, boolean dark, int ink, int muted) {
        views.setViewLayoutHeight(R.id.widget_timeline_split_header,timeline.headerHeight(),android.util.TypedValue.COMPLEX_UNIT_DIP);
        views.setViewLayoutWidth(R.id.widget_timeline_split_work_heading,timeline.titleWidth(),android.util.TypedValue.COMPLEX_UNIT_DIP);
        views.setInt(R.id.widget_timeline_split_header,"setBackgroundResource",dark?R.drawable.widget_section_dark:R.drawable.widget_section_light);
        views.setTextColor(R.id.widget_timeline_split_work_heading,ink);
        bindTimelineCell(views,R.id.widget_timeline_split_status_heading,timeline.columns().statusWidth(),muted);
        bindTimelineCell(views,R.id.widget_timeline_split_due_heading,timeline.columns().dueWidth(),muted);
        views.setImageViewBitmap(R.id.widget_timeline_split_axis,splitTimelineChart(c,axis,new JsonObject(),timeline,
            timeline.headerHeight(),dark,muted,NativeWidgetTimelineCharts.Part.HEADING,-1));
        views.setContentDescription(R.id.widget_timeline_split_axis,NativeWidgetPolicy.text(axis,"label","Timeline dates"));
    }

    @android.annotation.TargetApi(31)
    private static void bindTimelineCell(RemoteViews views, int id, int width, int color) {
        views.setViewVisibility(id,width > 0 ? View.VISIBLE : View.GONE);
        if(width <= 0)return;
        views.setViewLayoutWidth(id,width,android.util.TypedValue.COMPLEX_UNIT_DIP);
        views.setTextColor(id,color);
    }

    @android.annotation.TargetApi(31)
    private static RemoteViews splitTimelineRow(Context c, JsonObject value, JsonObject config, JsonObject snapshot,
                                               NativeWidgetPresentation.Timeline timeline, int position) {
        var row=NativeWidgetPresentation.row(value,"timeline");
        boolean section=row.style()==NativeWidgetPresentation.Style.SECTION,dark=dark(c,config);
        int ink=dark?0xffeff4fb:0xff243044,muted=dark?0xffc3cfde:0xff435666;
        int accent;
        try{accent=Color.parseColor(row.color());}catch(IllegalArgumentException invalid){accent=muted;}
        int indent=5+Math.min(5,Math.max(0,NativeWidgetPolicy.number(value,"depth",0)))*5;
        int rowHeight=section?timeline.groupHeight():timeline.rowHeight();
        RemoteViews views=new RemoteViews(c.getPackageName(),section?R.layout.nextglance_widget_timeline_split_section:R.layout.nextglance_widget_timeline_split_row);
        views.setViewLayoutHeight(R.id.widget_row,rowHeight,android.util.TypedValue.COMPLEX_UNIT_DIP);
        int background=section?(dark?R.drawable.widget_section_dark:R.drawable.widget_section_light):(dark?R.drawable.widget_row_dark:R.drawable.widget_row_light);
        views.setInt(R.id.widget_row,"setBackgroundResource",background);
        views.setTextViewText(R.id.widget_row_title,row.title());
        views.setTextColor(R.id.widget_row_title,row.completed()?muted:ink);
        JsonObject axis=NativeWidgetPolicy.object(snapshot,"timelineAxis");
        views.setImageViewBitmap(R.id.widget_timeline_bar,splitTimelineChart(c,axis,NativeWidgetPolicy.object(value,"timeline"),timeline,
            rowHeight,dark,accent,section?NativeWidgetTimelineCharts.Part.SECTION:NativeWidgetTimelineCharts.Part.ITEM,position));
        if(section){
            int width=timeline.titleWidth()+timeline.columns().statusWidth()+timeline.columns().dueWidth();
            int widthPixels=dp(c,timeline.titleWidth())+dp(c,timeline.columns().statusWidth())+dp(c,timeline.columns().dueWidth());
            views.setViewLayoutWidth(R.id.widget_timeline_section_content,widthPixels,android.util.TypedValue.COMPLEX_UNIT_PX);
            views.setViewPadding(R.id.widget_timeline_section_content,dp(c,Math.min(indent,width/4)),0,dp(c,5),0);
            icon(c,views,R.id.widget_row_icon,R.drawable.widget_icon_task,accent);
            views.setTextViewText(R.id.widget_row_date,row.trailing());
            views.setTextColor(R.id.widget_row_date,muted);
            views.setContentDescription(R.id.widget_row,row.accessible());
            return views;
        }

        int titleWidth=timeline.titleWidth();
        views.setViewLayoutWidth(R.id.widget_timeline_split_label,titleWidth,android.util.TypedValue.COMPLEX_UNIT_DIP);
        views.setViewPadding(R.id.widget_timeline_split_label,dp(c,Math.min(indent,titleWidth/5)),0,dp(c,4),0);
        views.setInt(R.id.widget_row_title,"setPaintFlags",Paint.ANTI_ALIAS_FLAG|(row.completed()?Paint.STRIKE_THRU_TEXT_FLAG:0));
        String kind=NativeWidgetPolicy.text(value,"kind","task");
        icon(c,views,R.id.widget_row_icon,"event".equals(kind)?R.drawable.widget_icon_event:"card".equals(kind)?R.drawable.widget_icon_card:row.completed()?R.drawable.widget_icon_done:R.drawable.widget_icon_task,accent);
        var label=NativeWidgetPresentation.timelineLabel(value,timeline.columns().metadataColumns());
        String secondary=NativeWidgetPresentation.timelineContext(label.secondary(),timeline.dependencies().fallback(position));
        views.setTextViewText(R.id.widget_row_subtitle,secondary);
        views.setTextColor(R.id.widget_row_subtitle,muted);
        views.setViewVisibility(R.id.widget_row_subtitle,secondary.isBlank()?View.GONE:View.VISIBLE);
        bindTimelineCell(views,R.id.widget_timeline_split_status,timeline.columns().statusWidth(),muted);
        bindTimelineCell(views,R.id.widget_row_date,timeline.columns().dueWidth(),label.overdue()?(dark?0xfff5a49d:0xff952f29):muted);
        views.setTextViewText(R.id.widget_timeline_split_status,label.status().isBlank()?"—":label.status());
        views.setTextViewText(R.id.widget_row_date,label.due().isBlank()?"—":label.due());
        String dependencies=timeline.dependencies().description(position);
        String description=row.accessible()+(dependencies.isBlank()?"":". "+dependencies);
        if(!label.due().isBlank()&&!label.due().equals(row.trailing()))description+=". "+(label.overdue()?"Overdue ":"Due ")+label.due();
        views.setContentDescription(R.id.widget_timeline_content,description);
        views.setOnClickFillInIntent(R.id.widget_timeline_content,new Intent().putExtra("recordId",NativeWidgetPolicy.text(value,"recordId","")));
        return views;
    }

    private static android.graphics.Bitmap splitTimelineChart(Context c, JsonObject axis, JsonObject range,
                                                              NativeWidgetPresentation.Timeline timeline, int height, boolean dark,
                                                              int accent, NativeWidgetTimelineCharts.Part part, int position) {
        int width=timeline.chartWidth();
        var raster=NativeWidgetPresentation.timelineRaster(timeline,height,c.getResources().getDisplayMetrics().density);
        return NativeWidgetTimelineCharts.render(axis,NativeWidgetPresentation.range(range),width,height,raster,dark,accent,part,
            c.getResources().getConfiguration().fontScale,NativeAppearancePreferences.weekendMask(c),Locale.getDefault(),
            position<0?null:timeline.dependencies(),position<0?0:timeline.rowTop(position));
    }

    private static CharSequence dateTint(String text,String prefix,boolean weekend){
        if(!weekend||prefix.isEmpty()||!text.startsWith(prefix))return text;
        android.text.SpannableString marked=new android.text.SpannableString(text);
        marked.setSpan(new android.text.style.BackgroundColorSpan(NativeWeekend.OVERLAY),0,prefix.length(),android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);return marked;
    }
}
