package com.nextspace.app;

import com.google.gson.*;
import java.util.*;
import org.junit.Test;
import static org.junit.Assert.*;

/** Tests actual pure presentation geometry, never a substitute for launcher rendering acceptance. */
public class NativeWidgetChartLayoutTest {
    private JsonObject json(String text){return JsonParser.parseString(text).getAsJsonObject();}
    private JsonObject grid(){return json("{\"mode\":\"week\",\"label\":\"Nov23–24\",\"hourStart\":8,\"hourEnd\":18,\"days\":[{\"date\":\"2026-11-23\",\"label\":\"Mon23\",\"today\":true},{\"date\":\"2026-11-24\",\"label\":\"Tue24\"}],\"ticks\":[{\"minute\":480,\"label\":\"08:00\"},{\"minute\":1080,\"label\":\"18:00\"}],\"timed\":[{\"recordId\":\"event-a\",\"title\":\"Design review\",\"dayIndex\":0,\"startMinute\":540,\"endMinute\":660,\"lane\":0,\"laneCount\":1}],\"allDay\":[],\"allDayLanes\":0}");}
    @Test public void variantsUseAtMostFourDistinctValidLauncherSizes(){var sizes=NativeWidgetChartLayout.sizes(List.of(new NativeWidgetChartLayout.Size(280,300),new NativeWidgetChartLayout.Size(280,300),new NativeWidgetChartLayout.Size(140,180),new NativeWidgetChartLayout.Size(700,400),new NativeWidgetChartLayout.Size(600,600),new NativeWidgetChartLayout.Size(900,700),new NativeWidgetChartLayout.Size(-1,20)),new NativeWidgetChartLayout.Size(180,210));assertEquals(4,sizes.size());assertEquals(new NativeWidgetChartLayout.Size(140,180),sizes.get(0));}
    @Test public void legacyUsesPortraitAndLandscapeBoundsCorrectly(){assertEquals(new NativeWidgetChartLayout.Size(280,600),NativeWidgetChartLayout.legacySize(false,280,180,700,600));assertEquals(new NativeWidgetChartLayout.Size(700,180),NativeWidgetChartLayout.legacySize(true,280,180,700,600));}
    @Test public void narrowGridHeaderRetainsThreeFullSizedControls(){assertEquals(132,NativeWidgetChartLayout.contentWidth(140));assertTrue(NativeWidgetChartLayout.contentWidth(140)>=3*44);assertEquals(260,NativeWidgetChartLayout.contentWidth(280));}
    @Test public void chartUsesAllContentAtEverySupportedSizeAndKeepsBothOverviewPanes(){
        for(int height:List.of(180,219,220,239,240,299,300,399,400,700)){
            var overview=NativeWidgetChartLayout.chrome("overview",height);
            var calendar=NativeWidgetChartLayout.chrome("calendar",height);
            assertTrue(overview.work()>=24);assertTrue(overview.calendar()>=44);
            assertEquals(overview.content(),overview.work()+overview.calendar());
            assertEquals(calendar.content(),calendar.calendar());assertEquals(0,calendar.work());
            assertEquals(height,overview.content()+60+(overview.context()?20:0)+(overview.footer()?18:0));
        }
        assertEquals(392,NativeWidgetChartLayout.chrome("calendar",490).calendar());
        assertEquals(212,NativeWidgetChartLayout.chrome("overview",570).work());
        assertEquals(260,NativeWidgetChartLayout.chrome("overview",570).calendar());
    }
    @Test public void undersizedHostCannotProduceNegativeOrOverflowingGeometry(){
        for(int height:List.of(80,100,120,140,160)){
            var layout=NativeWidgetChartLayout.chrome("overview",height);
            assertTrue(layout.work()>=0);assertTrue(layout.calendar()>0);
            assertEquals(layout.content(),layout.work()+layout.calendar());assertEquals(height,60+layout.content());
        }
    }
    @Test public void combinedOverviewBitmapStaysWithinTheBudgetAcrossSizeVariants(){long budget=NativeWidgetChartLayout.bitmapBudget(1080,2400);long total=0;for(var size:List.of(new NativeWidgetChartLayout.Size(140,180),new NativeWidgetChartLayout.Size(280,300),new NativeWidgetChartLayout.Size(700,400),new NativeWidgetChartLayout.Size(900,700))){var layout=NativeWidgetChartLayout.chrome("overview",size.height());total+=NativeWidgetChartLayout.raster(size.width(),layout.content(),4,budget/4).bytes();}assertTrue(total<=budget);assertTrue(total<=2*1024*1024);assertTrue(NativeWidgetChartLayout.bitmapBudget(100,100)<budget);}
    @Test public void commonDayColumnsAndTimeRulesPositionActualTimedBlocks(){var grid=NativeWidgetChartLayout.grid(grid(),360,400,false);var item=grid.marks().get(0);assertEquals(grid.days().get(0).rect().x()+1,item.rect().x(),.001);assertEquals(46+(400-46-2)*.1,item.rect().y(),.001);assertEquals((400-46-2)*.2,item.rect().height(),.001);assertEquals(1,NativeWidgetChartLayout.actionable(grid).size());}
    @Test public void denseAndShortEventsNeverReceiveAmbiguousEnlargedTargets(){JsonObject source=grid();JsonObject shortEvent=source.getAsJsonArray("timed").get(0).getAsJsonObject();shortEvent.addProperty("endMinute",550);var shortGrid=NativeWidgetChartLayout.grid(source,140,100,false);assertTrue(shortGrid.marks().get(0).rect().height()<44);assertTrue(NativeWidgetChartLayout.actionable(shortGrid).isEmpty());JsonObject second=shortEvent.deepCopy();second.addProperty("recordId","event-b");source.getAsJsonArray("timed").add(second);shortEvent.addProperty("endMinute",800);second.addProperty("endMinute",800);assertTrue(NativeWidgetChartLayout.actionable(NativeWidgetChartLayout.grid(source,360,500,false)).isEmpty());}
    @Test public void suppliedOverlapLanesAreRespectedWithoutNativeRepacking(){JsonObject source=grid();JsonObject first=source.getAsJsonArray("timed").get(0).getAsJsonObject();first.addProperty("laneCount",2);JsonObject second=first.deepCopy();second.addProperty("recordId","event-b");second.addProperty("lane",1);source.getAsJsonArray("timed").add(second);var marks=NativeWidgetChartLayout.grid(source,700,500,false).marks();assertEquals(2,marks.size());assertFalse(marks.get(0).rect().intersects(marks.get(1).rect()));assertEquals(marks.get(0).rect().width(),marks.get(1).rect().width(),.001);}
    @Test public void denseProjectedLanesAreNeverClampedOrRepacked(){JsonObject source=grid();JsonObject item=source.getAsJsonArray("timed").get(0).getAsJsonObject();item.addProperty("laneCount",220);item.addProperty("lane",219);var chart=NativeWidgetChartLayout.grid(source,360,400,false);assertEquals(1,chart.marks().size());var rect=chart.marks().get(0).rect();assertTrue(rect.width()<1);assertTrue(rect.x()>chart.days().get(0).rect().x()+chart.days().get(0).rect().width()*.99);assertTrue(rect.x()+rect.width()<=chart.days().get(1).rect().x());assertTrue(NativeWidgetChartLayout.actionable(chart).isEmpty());}
    @Test public void allDayUsesExclusiveEndAndOverflowRemainsExplicit(){JsonObject source=grid();source.addProperty("allDayLanes",3);source.add("allDay",JsonParser.parseString("[{\"recordId\":\"all-day\",\"startDay\":0,\"endDay\":1,\"lane\":0},{\"recordId\":\"overflow\",\"startDay\":0,\"endDay\":2,\"lane\":2}]"));var chart=NativeWidgetChartLayout.grid(source,360,400,false);assertEquals(1,chart.hiddenAllDay());assertEquals(chart.days().get(0).rect().width()-2,chart.marks().get(0).rect().width(),.001);assertEquals(2,NativeWidgetChartLayout.grid(source,360,400,true).hiddenAllDay());}
    @Test public void compactCalendarRetainsTheFirstAllDayLaneWithoutCrowdingTimedEvents(){
        JsonObject source=grid();source.addProperty("allDayLanes",2);
        source.add("allDay",JsonParser.parseString("[{\"recordId\":\"day-one\",\"startDay\":0,\"endDay\":1,\"lane\":0},{\"recordId\":\"day-two\",\"startDay\":0,\"endDay\":1,\"lane\":1}]"));
        var layout=NativeWidgetChartLayout.grid(source,260,105,false);
        assertEquals(List.of("day-one","event-a"),layout.marks().stream().map(NativeWidgetChartLayout.Mark::recordId).toList());
        assertEquals(1,layout.hiddenAllDay());assertTrue(layout.marks().get(1).rect().y()>=layout.timedTop());
    }
    @Test public void overviewCarriesProjectedHeadingAncestryWithoutChangingMembership(){JsonObject snapshot=json("{\"overviewRangeIds\":[\"one\"],\"rows\":[{\"type\":\"heading\",\"title\":\"Studio\",\"depth\":0},{\"type\":\"heading\",\"title\":\"Launch\",\"depth\":1},{\"type\":\"item\",\"recordId\":\"one\"},{\"type\":\"item\",\"recordId\":\"two\"}]}");var rows=NativeWidgetChartLayout.overviewRows(snapshot);assertEquals(1,rows.size());assertEquals("Studio / Launch",rows.get(0).get("presentationGroup").getAsString());assertFalse(snapshot.toString().contains("presentationGroup"));}
    @Test public void settingsKeepExplicitLegacyChoicesAndOfferTheRequestedModes(){var calendar=NativeWidgetPresentation.calendarChoices("calendar","agenda");assertEquals(List.of("agenda","day","week","month"),calendar.ids());assertEquals(List.of("Agenda","Today","Week","Month"),calendar.labels());assertEquals(List.of("day","agenda"),NativeWidgetPresentation.calendarChoices("overview","agenda").ids());assertEquals(List.of("day","month"),NativeWidgetPresentation.calendarChoices("overview","month").ids());assertEquals(List.of("day","week"),NativeWidgetPresentation.calendarChoices("overview","week").ids());}
    @Test public void responsiveVariantsKeepSmallLargeAndOrientationExtremes(){
        var small=new NativeWidgetChartLayout.Size(140,180);var large=new NativeWidgetChartLayout.Size(900,900);var tall=new NativeWidgetChartLayout.Size(140,700);var wide=new NativeWidgetChartLayout.Size(900,180);
        var variants=NativeWidgetChartLayout.sizes(List.of(small,new NativeWidgetChartLayout.Size(280,300),new NativeWidgetChartLayout.Size(400,400),large,tall,wide),small);
        assertEquals(Set.of(small,large,tall,wide),new HashSet<>(variants));
    }
    @Test public void proportionalFitPreservesCirclesAndCentersLetterboxing(){
        var fit=NativeWidgetChartLayout.fit(200,100,300,300);var circle=fit.map(new NativeWidgetChartLayout.Rect(10,10,40,40));
        assertEquals(1.5,fit.scale(),0);assertEquals(0,fit.x(),0);assertEquals(75,fit.y(),0);assertEquals(circle.width(),circle.height(),0);assertEquals(90,circle.y(),0);
    }
    @Test public void actualRasterAndDisplayTransformsAgreeAtOddSizesAndDensities(){
        for(int width:List.of(131,257,699))for(int height:List.of(137,431,608))for(double density:List.of(.75,1.25,1.5,2.625,4.0)){
            var raster=NativeWidgetChartLayout.raster(width,height,density,131071);var draw=NativeWidgetChartLayout.fit(width,height,raster.width(),raster.height());var display=NativeWidgetChartLayout.fit(raster.width(),raster.height(),width,height);var composed=NativeWidgetChartLayout.displayFit(width,height,raster,width,height);
            var logical=new NativeWidgetChartLayout.Rect(17,19,44,44);var sequential=display.map(draw.map(logical));var actual=composed.map(logical);
            assertEquals(sequential.x(),actual.x(),1e-8);assertEquals(sequential.y(),actual.y(),1e-8);assertEquals(sequential.width(),actual.width(),1e-8);assertEquals(actual.width(),actual.height(),1e-8);assertTrue(raster.bytes()<=131071);
        }
    }
    @Test public void extremeAspectRatioBitmapsStayWithinTheirSharedBudget(){
        for(int width:List.of(1,4096))for(int height:List.of(1,4096))for(long budget:List.of(4L,100L,524288L)){
            var raster=NativeWidgetChartLayout.raster(width,height,8,budget);assertTrue(raster.width()>=1);assertTrue(raster.height()>=1);assertTrue(raster.bytes()<=budget);
        }
    }
    @Test public void inwardRoundedTargetsStayInsideTheVisibleGlyphSurface(){
        var rect=new NativeWidgetChartLayout.Rect(37.2,46.1,86.7,92.8);
        for(double density:List.of(.75,1.25,1.5,2.625,4.0)){
            var raster=NativeWidgetChartLayout.raster(357,431,density,262144);var fit=NativeWidgetChartLayout.displayFit(357,431,raster,357,431);var visible=fit.map(rect);var hit=NativeWidgetChartLayout.target(rect,fit,density);
            assertTrue(hit.x()+1e-7>=visible.x());assertTrue(hit.y()+1e-7>=visible.y());assertTrue(hit.x()+hit.width()<=visible.x()+visible.width()+1e-7);assertTrue(hit.y()+hit.height()<=visible.y()+visible.height()+1e-7);assertTrue(hit.actionable());assertEquals(Math.rint(hit.x()*density),hit.x()*density,1e-7);
        }
    }
    @Test public void overviewUsesOneTransformAndOffsetsOnlyItsCalendarRegion(){
        var grid=NativeWidgetChartLayout.grid(grid(),699,401,false);int workHeight=127;var raster=NativeWidgetChartLayout.raster(699,528,2.625,524288);var fit=NativeWidgetChartLayout.displayFit(699,528,raster,699,528);
        var day=grid.days().get(0).rect();var top=fit.map(new NativeWidgetChartLayout.Rect(day.x(),0,day.width(),workHeight));var bottom=fit.map(new NativeWidgetChartLayout.Rect(day.x(),workHeight,day.width(),day.height()));
        assertEquals(top.x(),bottom.x(),0);assertEquals(top.width(),bottom.width(),0);assertEquals(top.y()+top.height(),bottom.y(),1e-7);
        var marks=NativeWidgetChartLayout.actionable(grid,fit,2.625,workHeight);assertEquals(1,marks.size());assertTrue(marks.get(0).rect().y()>workHeight);
    }
    @Test public void overviewActionsStayInsideVisibleWorkRowsAndSeparateFromCalendarActions(){
        JsonObject snapshot=json("{\"overviewRangeIds\":[\"card\",\"task\"],\"rows\":[{\"type\":\"heading\",\"title\":\"Launch\"},{\"type\":\"item\",\"title\":\"Release notes\",\"recordId\":\"card\",\"kind\":\"card\"},{\"type\":\"item\",\"title\":\"Confirm links\",\"recordId\":\"task\",\"kind\":\"task\"}]}");
        int width=579,work=212,calendar=399;double density=2.625;
        var grid=NativeWidgetChartLayout.grid(grid(),width,calendar,true);
        var raster=NativeWidgetChartLayout.raster(width,work+calendar,density,524288);
        var fit=NativeWidgetChartLayout.displayFit(width,work+calendar,raster,width,work+calendar);
        var hits=NativeWidgetChartLayout.overviewActionable(snapshot,grid,work,1,fit,density);
        assertEquals(List.of("card","task"),hits.stream().map(NativeWidgetChartLayout.Mark::recordId).toList());
        assertFalse(hits.get(0).rect().intersects(hits.get(1).rect()));
        assertTrue(hits.get(0).rect().y()>=31);
        assertTrue(hits.get(0).rect().height()>=32);
        assertTrue(hits.get(0).rect().height()<=34);
        assertTrue(hits.get(1).rect().y()+hits.get(1).rect().height()<=work);
        assertTrue(NativeWidgetChartLayout.actionable(grid,fit,density,work).get(0).rect().y()>work);
        assertTrue(NativeWidgetChartLayout.overviewActionable(snapshot,grid,24,1,fit,density).isEmpty());
    }
    @Test public void splitOverviewAlignsWorkAndCalendarWithoutChangingStandaloneCalendar() {
        JsonObject source = week();
        var overview = NativeWidgetChartLayout.grid(source,579,259,true,1);
        var standalone = NativeWidgetChartLayout.grid(source,579,259,false,1);
        var columns = NativeWidgetWorkLayout.columns(579,7,1);
        assertEquals(columns.labelWidth(), overview.gutter(), 0);
        assertEquals(overview.gutter(), overview.days().get(0).rect().x(), 0);
        assertEquals(overview.gutter()+1, overview.marks().get(0).rect().x(), 0);
        assertEquals(36, standalone.gutter(), 0);
        assertEquals(37, standalone.marks().get(0).rect().x(), 0);
        assertEquals(36,NativeWidgetChartLayout.grid(source,279,259,true,1).gutter(),0);
        assertEquals(36,NativeWidgetChartLayout.grid(source,359,259,true,2).gutter(),0);
    }
    @Test public void splitOverviewPreservesGroupAncestryAndExactItemTargets() {
        JsonObject snapshot = json("""
            {"overviewRangeIds":["card","task"],"rows":[
              {"type":"heading","title":"Studio","sectionCount":2,"depth":0},
              {"type":"heading","title":"Launch","sectionCount":2,"depth":1},
              {"type":"item","title":"Release notes","recordId":"card","kind":"card","depth":2,"timeline":{"offset":35,"length":35}},
              {"type":"item","title":"Confirm links","recordId":"task","kind":"task","depth":2,"timeline":{"offset":20,"length":10}},
              {"type":"heading","title":"Calendar","sectionCount":1,"depth":0},
              {"type":"item","title":"Review","recordId":"event","kind":"event","depth":1}
            ],"dependencies":{"edges":[{"prerequisiteId":"task","dependentId":"card"}]}}
            """);
        JsonObject source = week();
        snapshot.add("calendarGrid", source);
        var grid = NativeWidgetChartLayout.grid(source,579,259,true,1);
        var plan = NativeWidgetChartLayout.overviewPlan(snapshot,579,212,1);
        assertEquals(grid.gutter(),plan.workColumns().labelWidth(),0);
        var groups = plan.lines().stream().filter(NativeWidgetChartLayout.OverviewLine::heading).toList();
        assertEquals(List.of("Studio","Launch"),groups.stream().map(line->line.row().get("title").getAsString()).toList());
        assertEquals(1,groups.get(1).row().get("depth").getAsInt());
        assertEquals(2,groups.get(1).row().get("sectionCount").getAsInt());
        var routes = NativeWidgetChartLayout.overviewDependencies(snapshot,plan,579,1).routes();
        assertEquals(1,routes.size());
        assertEquals(NativeWidgetChartLayout.overviewRangeCenter(plan.lines().get(3),true),routes.get(0).start().y(),0);
        assertEquals(NativeWidgetChartLayout.overviewRangeCenter(plan.lines().get(2),true),routes.get(0).end().y(),0);

        var hits = NativeWidgetChartLayout.overviewActionable(snapshot,grid,212,1,new NativeWidgetChartLayout.Fit(1,0,0),1);
        assertEquals(List.of("card","task"),hits.stream().map(NativeWidgetChartLayout.Mark::recordId).toList());
        for (var hit : hits) {
            assertEquals(0,hit.rect().x(),0);
            assertTrue(hit.rect().x() < grid.gutter());
            assertTrue(hit.rect().y()+hit.rect().height() <= 212);
        }
        var shortPlan = NativeWidgetChartLayout.overviewPlan(snapshot,579,54,1);
        assertTrue(shortPlan.lines().stream().anyMatch(line -> !line.heading()));
    }
    private JsonObject week() {
        JsonObject source = grid();
        JsonArray days = source.getAsJsonArray("days");
        for (int day = 25; day <= 29; day++) {
            JsonObject item = new JsonObject();
            item.addProperty("date", "2026-11-"+day);
            days.add(item);
        }
        return source;
    }
    @Test public void overviewReclaimsRoomForWorkMetadataAndReportsOverflow(){
        JsonObject snapshot=json("""
            {"overviewRangeIds":["one","two","three","four","five","six"],"rows":[
              {"type":"heading","title":"Work"},
              {"type":"item","recordId":"one","title":"Release notes","secondaryLabel":"Delivery board","statusLabel":"In progress","displayDay":"23 Nov – 27 Nov"},
              {"type":"item","recordId":"two"},{"type":"item","recordId":"three"},
              {"type":"item","recordId":"four"},{"type":"item","recordId":"five"},{"type":"item","recordId":"six"}
            ]}
            """);
        var wide=NativeWidgetChartLayout.overviewPlan(snapshot,579,212,1);
        assertTrue(wide.details());assertTrue(wide.columns());assertEquals(2,wide.hidden());
        assertEquals(34,wide.lines().get(1).height());
        assertEquals("In progress · 23 Nov – 27 Nov · Delivery board",NativeWidgetChartLayout.overviewDetail(wide.lines().get(1).row()).inline());
        var narrow=NativeWidgetChartLayout.overviewPlan(snapshot,279,212,1);
        assertTrue(narrow.details());assertFalse(narrow.columns());
        var compact=NativeWidgetChartLayout.overviewPlan(snapshot,132,30,1);
        assertFalse(compact.details());assertEquals(5,compact.hidden());assertFalse(compact.lines().get(0).heading());
    }
    @Test public void largeDateHeadersRetain44dpTargetsAfterFractionalRasterRounding(){
        var grid=NativeWidgetChartLayout.grid(grid(),699,401,false);
        for(double density:List.of(1.25,1.5,2.625,4.0)){
            var raster=NativeWidgetChartLayout.raster(699,401,density,524288);var fit=NativeWidgetChartLayout.displayFit(699,401,raster,699,401);
            assertTrue(NativeWidgetChartLayout.target(grid.days().get(0).rect(),fit,density).actionable());
        }
    }
    @Test public void largeFontChromeSacrificesSecondaryLabelsBeforeActionableContent(){
        for(int height:List.of(180,240,300,400,700)){
            var chrome=NativeWidgetChartLayout.chrome("overview",height,2);assertFalse(chrome.context());assertFalse(chrome.footer());assertTrue(chrome.calendar()>=44);assertTrue(chrome.work()>=24);assertEquals(chrome.content(),chrome.work()+chrome.calendar());assertEquals(height,chrome.content()+60);
        }
    }
}
