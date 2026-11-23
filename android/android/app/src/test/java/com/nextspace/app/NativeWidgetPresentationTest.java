package com.nextspace.app;

import com.google.gson.*;
import org.junit.Test;
import org.w3c.dom.*;
import javax.xml.parsers.DocumentBuilderFactory;
import java.nio.file.*;
import java.time.ZoneId;
import java.util.*;
import static org.junit.Assert.*;

/** Pure presentation and resource geometry checks, not an Android launcher rendering test. */
public class NativeWidgetPresentationTest {
    private JsonObject object(String json){return JsonParser.parseString(json).getAsJsonObject();}
    private Element xml(String name)throws Exception{
        return xmlIn("layout",name);
    }
    private Element xmlIn(String folder,String name)throws Exception{
        DocumentBuilderFactory factory=DocumentBuilderFactory.newInstance();factory.setNamespaceAware(true);
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl",true);
        return factory.newDocumentBuilder().parse(Path.of("src/main/res/"+folder+"/"+name+".xml").toFile()).getDocumentElement();
    }
    private String attr(Element e,String key){return e.getAttributeNS("http://schemas.android.com/apk/res/android",key);}
    private boolean hasId(Element element, String id) {
        return ("@+id/"+id).equals(attr(element,"id")) || ("@id/"+id).equals(attr(element,"id"));
    }
    private Element find(Element root,String id){
        if(hasId(root,id))return root;
        NodeList list=root.getElementsByTagName("*");for(int i=0;i<list.getLength();i++){Element e=(Element)list.item(i);if(hasId(e,id))return e;}
        throw new AssertionError("Missing widget view: "+id);
    }
    private int dp(Element e,String key){return Integer.parseInt(attr(e,key).replace("dp",""));}
    @Test public void pageAndKindChooseDistinctPresentationWithoutChangingRows(){
        JsonObject event=object("{\"type\":\"item\",\"kind\":\"event\",\"title\":\"Review\"}");
        assertEquals(NativeWidgetPresentation.Style.BOOKING,NativeWidgetPresentation.row(event,"calendar").style());
        assertEquals(NativeWidgetPresentation.Style.BOOKING,NativeWidgetPresentation.row(event,"overview").style());
        assertEquals(NativeWidgetPresentation.Style.TIMELINE,NativeWidgetPresentation.row(event,"timeline").style());
        assertEquals(NativeWidgetPresentation.Style.CARD,NativeWidgetPresentation.row(object("{\"kind\":\"card\"}"),"board").style());
        assertEquals(NativeWidgetPresentation.Style.TASK,NativeWidgetPresentation.row(object("{\"kind\":\"task\"}"),"list").style());
        assertEquals(NativeWidgetPresentation.Style.SECTION,NativeWidgetPresentation.row(object("{\"type\":\"heading\"}"),"timeline").style());
        assertEquals(8,NativeWidgetPresentation.ROW_LAYOUT_COUNT);
        assertEquals(3,event.size());
    }
    @Test public void compactLegacyAndLowBudgetTimelinesPreserveDependencyCounts(){
        JsonObject snapshot=object("""
            {"timelineAxis":{"ticks":[{"offset":0,"label":"Nov 23"},{"offset":50,"label":"Nov 24"},{"offset":100}]},
             "rows":[{"type":"item","kind":"task","recordId":"draft","timeline":{"offset":0,"length":20}},
                 {"type":"heading","title":"Review"},{"type":"item","kind":"card","recordId":"review","timeline":{"offset":50,"length":35}}],
             "dependencies":{"edges":[{"prerequisiteId":"draft","dependentId":"review"}],
                "counts":[{"recordId":"draft","prerequisites":0,"dependents":1},
                {"recordId":"review","prerequisites":1,"dependents":0}]}}
            """);
        var legacy=NativeWidgetPresentation.timeline(snapshot,680,1,64_000);
        var compact=NativeWidgetPresentation.timeline(snapshot,180,1,64_000,true);
        var tinyBudget=NativeWidgetPresentation.timeline(snapshot,680,1,4_000,true);
        assertFalse(legacy.split());
        assertFalse(compact.split());
        assertTrue(tinyBudget.split());
        assertEquals(680,legacy.chartWidth());
        assertEquals(180,compact.chartWidth());
        for (var fallback : List.of(legacy,compact,tinyBudget)) {
            assertFalse(fallback.alignedRaster());
            assertTrue(fallback.dependencies().routes().isEmpty());
            assertEquals("1 prerequisite",fallback.dependencies().fallback(2));
            assertEquals("1 item waiting for this item",fallback.dependencies().description(0));
        }
    }
    @Test public void headingCountStaysInlineAndLegacySnapshotsRemainReadable(){
        assertEquals("7",NativeWidgetPresentation.row(object("{\"type\":\"heading\",\"title\":\"Doing\",\"sectionCount\":7}"),"board").trailing());
        assertEquals("2",NativeWidgetPresentation.row(object("{\"type\":\"heading\",\"subtitle\":\"2\"}"),"calendar").trailing());
        var old=NativeWidgetPresentation.row(object("{\"kind\":\"card\",\"subtitle\":\"Project board\",\"dateLabel\":\"Nov 25\"}"),"board");
        assertEquals("Project board",old.secondary());assertEquals("Nov 25",old.trailing());
    }
    @Test public void completedLinkedTasksKeepCompletionAndRelationshipPresentation(){
        var row=NativeWidgetPresentation.row(object("{\"kind\":\"task\",\"title\":\"Prepare draft\",\"depth\":1,\"parentId\":\"card-one\",\"completed\":true,\"secondaryLabel\":\"Prerequisite · Work\",\"trailingLabel\":\"Nov 25\"}"),"board",132);
        assertTrue(row.completed());assertTrue(row.linked());assertEquals("",row.trailing());assertTrue(row.secondary().startsWith("Nov 25"));assertTrue(row.secondary().contains("Prerequisite"));assertTrue(row.accessible().contains("Completed"));assertTrue(row.accessible().contains("Linked task"));
    }
    @Test public void linkedBoardRowsJoinOnlyTheirActualContiguousParentAndKeepOwnStatus(){
        JsonObject snapshot=object("{\"rows\":[{\"type\":\"heading\",\"title\":\"Doing\"},{\"type\":\"item\",\"kind\":\"card\",\"recordId\":\"card\",\"title\":\"Release guide\",\"color\":\"#118899\"},{\"type\":\"item\",\"kind\":\"task\",\"recordId\":\"input\",\"parentId\":\"card\",\"direction\":\"incoming\",\"completed\":true,\"statusLabel\":\"Done\",\"color\":\"#8855aa\"},{\"type\":\"item\",\"kind\":\"task\",\"recordId\":\"output\",\"parentId\":\"card\",\"direction\":\"outgoing\"},{\"type\":\"heading\",\"title\":\"Other\"},{\"type\":\"item\",\"kind\":\"task\",\"recordId\":\"separate\",\"parentId\":\"card\"}]}");
        String before=snapshot.toString();JsonArray rows=snapshot.getAsJsonArray("rows");
        var parent=NativeWidgetPresentation.cluster(rows.get(1).getAsJsonObject(),snapshot,"board");assertTrue(parent.parent());assertEquals(2,parent.count());
        var input=NativeWidgetPresentation.cluster(rows.get(2).getAsJsonObject(),snapshot,"board");assertTrue(input.child());assertFalse(input.last());assertEquals("Release guide",input.title());assertEquals("#118899",input.color());assertEquals("Prerequisite for",input.relationship());
        var child=NativeWidgetPresentation.row(rows.get(2).getAsJsonObject(),"board");assertTrue(child.completed());assertEquals("#8855aa",child.color());assertTrue(child.secondary().startsWith("Done"));
        var output=NativeWidgetPresentation.cluster(rows.get(3).getAsJsonObject(),snapshot,"board");assertTrue(output.last());assertEquals("Follow-up to",output.relationship());
        assertFalse(NativeWidgetPresentation.cluster(rows.get(5).getAsJsonObject(),snapshot,"board").child());
        assertFalse(NativeWidgetPresentation.cluster(rows.get(1).getAsJsonObject(),snapshot,"list").parent());assertEquals(before,snapshot.toString());
    }
    @Test public void chartPanelsMaintainTextContrastAgainstBlackAndWhiteWallpaper(){
        for(boolean dark:List.of(true,false))for(int wallpaper:List.of(0,255)){
            int panel=NativeWidgetPresentation.panelColor(dark),ink=dark?0xeff4fb:0x243044;double alpha=(panel>>>24)/255.0;
            double background=0,foreground=0;double[] weights={.2126,.7152,.0722};
            for(int channel=0;channel<3;channel++){
                int shift=(2-channel)*8;double p=((((panel>>shift)&255)*alpha+wallpaper*(1-alpha))/255),f=((ink>>shift)&255)/255.0;
                background+=weights[channel]*(p<=.04045?p/12.92:Math.pow((p+.055)/1.055,2.4));foreground+=weights[channel]*(f<=.04045?f/12.92:Math.pow((f+.055)/1.055,2.4));
            }
            assertTrue((Math.max(background,foreground)+.05)/(Math.min(background,foreground)+.05)>=7);
        }
        assertEquals(0x06ffffff,NativeWeekend.OVERLAY);
    }
    @Test public void overviewGroupsAreSeparateRowsRatherThanRepeatedTitlePrefixes(){
        JsonObject snapshot=object("{\"overviewRangeIds\":[\"one\",\"two\",\"three\"],\"rows\":[{\"type\":\"heading\",\"title\":\"Studio\"},{\"type\":\"item\",\"recordId\":\"one\",\"title\":\"Draft\"},{\"type\":\"item\",\"recordId\":\"two\",\"title\":\"Review\"},{\"type\":\"heading\",\"title\":\"Workshop\"},{\"type\":\"item\",\"recordId\":\"three\",\"title\":\"Prepare\"}]}");
        var entries=NativeWidgetChartLayout.overviewEntries(snapshot);assertEquals(List.of("Studio","Draft","Review","Workshop","Prepare"),entries.stream().map(row->NativeWidgetPolicy.text(row,"title","")).toList());
        assertEquals("presentationHeading",NativeWidgetPolicy.text(entries.get(0),"type",""));assertEquals("item",NativeWidgetPolicy.text(entries.get(1),"type",""));assertEquals(3,NativeWidgetChartLayout.overviewRows(snapshot).size());
        for(int height:List.of(24,30,68,110,140,200))for(float scale:List.of(1f,1.5f,2f)){
            var plan=NativeWidgetChartLayout.overviewPlan(snapshot,579,height,scale);assertFalse(plan.lines().isEmpty());assertFalse(plan.lines().get(plan.lines().size()-1).heading());
            int last=plan.header(),shown=0;for(var line:plan.lines()){assertTrue(line.y()>=last);assertTrue(line.y()+line.height()<=height);last=line.y()+line.height();if(!line.heading())shown++;}
            assertTrue(shown>0);assertEquals(3-shown,plan.hidden());
        }
        var compact=NativeWidgetChartLayout.overviewPlan(snapshot,279,24,1);assertEquals(1,compact.lines().size());assertFalse(compact.lines().get(0).heading());assertEquals("Draft",NativeWidgetPolicy.text(compact.lines().get(0).row(),"title",""));
    }
    @Test public void narrowCardsKeepTitleWidthByMovingDueIntoSecondary(){
        JsonObject card=object("{\"kind\":\"card\",\"secondaryLabel\":\"Very long project source\",\"trailingLabel\":\"Tomorrow\"}");
        assertEquals("Tomorrow",NativeWidgetPresentation.row(card,"board",260).trailing());
        var narrow=NativeWidgetPresentation.row(card,"board",132);assertEquals("",narrow.trailing());assertTrue(narrow.secondary().startsWith("Tomorrow"));
    }
    @Test public void bookingAccessibilityRetainsStartDayTimeAndEnd(){
        var row=NativeWidgetPresentation.row(object("{\"kind\":\"event\",\"title\":\"Review\",\"displayDay\":\"Nov 25\",\"leadingLabel\":\"09:30\",\"secondaryLabel\":\"Work · Until 10:30\"}"),"overview");
        for(String text:List.of("Review","Nov 25","09:30","Until 10:30"))assertTrue(row.accessible().contains(text));
        assertFalse(row.accessible().contains(". ."));
    }
    @Test public void minimumAndPhoneLayoutsKeepEssentialStructure(){
        var minimum=NativeWidgetPresentation.layout("timeline",140,180);assertTrue(minimum.narrow());assertTrue(minimum.compact());assertFalse(minimum.context());assertTrue(minimum.timeline());assertEquals(132,minimum.width());
        var overview=NativeWidgetPresentation.layout("overview",140,180);assertTrue(overview.context());assertFalse(overview.overview());
        var phone=NativeWidgetPresentation.layout("overview",280,300);assertFalse(phone.narrow());assertFalse(phone.compact());assertTrue(phone.overview());assertEquals(260,phone.width());
        for(int height:List.of(219,220,239)){assertTrue(NativeWidgetPresentation.layout("timeline",140,height).compact());assertFalse(NativeWidgetPresentation.layout("timeline",140,height).context());}
        assertFalse(NativeWidgetPresentation.layout("timeline",280,240).compact());assertTrue(NativeWidgetPresentation.layout("timeline",280,240).context());
        assertFalse(NativeWidgetPresentation.monthAgenda(450,6));assertTrue(NativeWidgetPresentation.monthAgenda(600,6));
    }
    @Test public void timelineDayGuidesAndBarsShareClippedCoordinates(){
        JsonObject axis=object("{\"ticks\":[{\"offset\":0,\"label\":\"Mon\"},{\"offset\":25,\"label\":\"Tue\"},{\"offset\":50,\"label\":\"Wed\"},{\"offset\":75,\"label\":\"Thu\"},{\"offset\":100,\"label\":\"Fri\"},{\"offset\":101,\"label\":\"bad\"}]}");
        var ticks=NativeWidgetPresentation.ticks(axis);assertEquals(5,ticks.size());assertEquals(2,NativeWidgetPresentation.labeledTicks(ticks,132).size());assertEquals(List.of(ticks.get(0),ticks.get(2),ticks.get(3)),NativeWidgetPresentation.labeledTicks(ticks,260));
        assertEquals(100,ticks.get(4).offset(),0.001);
        assertFalse(NativeWidgetPresentation.labeledTicks(ticks,580,1).contains(ticks.get(4)));
        var bar=NativeWidgetPresentation.range(object("{\"offset\":25,\"length\":25}"));
        for(int width:List.of(132,260,780)){assertEquals(NativeWidgetPresentation.position(ticks.get(1).offset(),width),NativeWidgetPresentation.position(bar.offset(),width),0.001);assertEquals(NativeWidgetPresentation.position(ticks.get(2).offset(),width),NativeWidgetPresentation.position(bar.offset()+bar.length(),width),0.001);}
        var clipped=NativeWidgetPresentation.range(object("{\"offset\":90,\"length\":30}"));assertEquals(10,clipped.length(),0.001);assertEquals(0,NativeWidgetPresentation.range(new JsonObject()).length(),0.001);
    }
    @Test public void timelineShowsStatusAndRealRangeAtAllWidths(){
        JsonObject card=object("{\"kind\":\"card\",\"title\":\"Release guide\",\"secondaryLabel\":\"Delivery board\",\"statusLabel\":\"Doing\",\"displayDay\":\"Nov 23 – Nov 27\",\"trailingLabel\":\"Nov 27\"}");
        var wide=NativeWidgetPresentation.row(card,"timeline",580);
        assertEquals("Doing · Delivery board",wide.secondary());assertEquals("Nov 23 – Nov 27",wide.trailing());
        var narrow=NativeWidgetPresentation.row(card,"timeline",170);
        assertEquals("Nov 23 – Nov 27 · Doing · Delivery board",narrow.secondary());assertEquals("",narrow.trailing());
        assertTrue(narrow.accessible().contains("Nov 23 – Nov 27"));assertTrue(narrow.accessible().contains("Doing"));
    }

    @Test public void splitTimelineAlignsEveryRowAndCountsEveryBitmap(){
        JsonObject snapshot=object("""
            {"timelineAxis":{"start":"2026-11-23","ticks":[{"offset":0,"label":"Nov 23"},{"offset":50,"label":"Nov 24"},{"offset":100,"label":""}]},
             "rows":[{"type":"item","kind":"task","recordId":"draft","timeline":{"offset":0,"length":20}},
                 {"type":"heading","title":"Review"},{"type":"item","kind":"card","recordId":"review","timeline":{"offset":50,"length":35}}],
             "dependencies":{"edges":[{"prerequisiteId":"draft","dependentId":"review"}],"counts":[{"recordId":"review","prerequisites":2,"dependents":0}]}}
            """);
        var wide=NativeWidgetPresentation.timeline(snapshot,680,1,64_000,true);
        assertTrue(wide.split()); assertTrue(wide.columns().metadataColumns());
        assertEquals(680,wide.titleWidth()+wide.columns().statusWidth()+wide.columns().dueWidth()+wide.chartWidth());
        assertEquals(20,wide.headerHeight()); assertEquals(16,wide.groupHeight()); assertEquals(36,wide.rowHeight());
        assertTrue(wide.alignedRaster());
        assertEquals(List.of(0,36,52),wide.rowTops());
        var route=wide.dependencies().routes().getFirst();
        assertEquals(18,route.start().y(),0);
        assertEquals(70,route.end().y(),0);
        assertTrue(route.crosses(wide.rowTop(1),wide.groupHeight()));
        int width=wide.chartWidth();
        long bytes=0;
        for (int height : List.of(wide.headerHeight(),wide.rowHeight(),wide.groupHeight(),wide.rowHeight())) {
            var tile=NativeWidgetPresentation.timelineRaster(wide,height,2.75f);
            assertEquals((long)width*tile.height(),(long)height*tile.width());
            bytes+=tile.bytes();
        }
        assertTrue(bytes<=64_000);
        assertEquals("2 prerequisites",wide.dependencies().description(2));
        assertEquals("1 prerequisite",wide.dependencies().fallback(2));
        var narrow=NativeWidgetPresentation.timeline(snapshot,240,1,64_000,true);
        assertTrue(narrow.split()); assertFalse(narrow.columns().metadataColumns());
        var large=NativeWidgetPresentation.timeline(snapshot,680,2,64_000,true);
        assertTrue(large.rowHeight()>=56 && large.groupHeight()>=28 && large.headerHeight()>=34);
    }

    @Test public void splitTimelineMetadataKeepsDueIndependentOfPlottedDates(){
        var work=object("""
            {"kind":"task","statusLabel":"Reviewing","secondaryLabel":"Delivery board","displayDay":"Nov 23 – Nov 27","trailingLabel":"Overdue · Nov 21"}
            """);
        var wide=NativeWidgetPresentation.timelineLabel(work,true);
        assertEquals("Reviewing",wide.status()); assertEquals("Delivery board",wide.secondary()); assertEquals("Nov 21",wide.due()); assertTrue(wide.overdue());
        assertEquals("Reviewing · Overdue · Nov 21 · Delivery board",NativeWidgetPresentation.timelineLabel(work,false).secondary());
        var event=NativeWidgetPresentation.timelineLabel(object("{\"kind\":\"event\",\"displayDay\":\"Nov 27\",\"trailingLabel\":\"Nov 27\"}"),true);
        assertEquals("",event.due()); assertFalse(event.overdue());
        var saved=NativeWidgetPresentation.timelineLabel(object("{\"kind\":\"task\",\"due\":\"2026-11-25\",\"dateLabel\":\"Nov 25\"}"),true);
        assertEquals("Nov 25",saved.due());
    }

    @Test public void splitTimelineResourcesUseNativeRowsWithOneWeightedPlot()throws Exception{
        Element header=xml("nextglance_widget_timeline_split_header"), row=xml("nextglance_widget_timeline_split_row"), section=xml("nextglance_widget_timeline_split_section");
        assertEquals("gone",attr(header,"visibility"));
        assertEquals(List.of(20,36,16),List.of(dp(header,"layout_height"),dp(row,"layout_height"),dp(section,"layout_height")));
        for(var plot:List.of(find(header,"widget_timeline_split_axis"),find(row,"widget_timeline_bar"),find(section,"widget_timeline_bar"))){
            assertEquals("0dp",attr(plot,"layout_width")); assertEquals("1",attr(plot,"layout_weight"));
            assertEquals("match_parent",attr(plot,"layout_height")); assertEquals("fitCenter",attr(plot,"scaleType"));
        }
        assertSame(find(row,"widget_timeline_content"),find(row,"widget_timeline_bar").getParentNode());
        assertEquals("1",attr(find(row,"widget_row_subtitle"),"maxLines"));
        assertEquals(0,row.getElementsByTagName("include").getLength());
        assertEquals("1 prerequisite · Reviewing · Delivery board",
            NativeWidgetPresentation.timelineContext("Reviewing · Delivery board","1 prerequisite"));
    }
    @Test public void invalidChartNumbersNeverCreateUnboundedBitmaps(){
        assertEquals(0,NativeWidgetPresentation.range(object("{\"offset\":\"NaN\",\"length\":4}")).length(),0.001);
        assertEquals(0,NativeWidgetPresentation.range(object("{\"offset\":4,\"length\":-1}")).length(),0.001);
        assertEquals(1,NativeWidgetPresentation.position(-10,260),0.001);assertEquals(259,NativeWidgetPresentation.position(110,260),0.001);
    }
    @Test public void freshnessUsesOneLineAndClockIsInjected(){
        String text=NativeWidgetPresentation.compactFreshness(object("{\"sourceVerifiedAt\":\"2026-11-23T09:30:00Z\",\"metadataVerifiedAt\":\"2026-11-23T09:31:00Z\"}"),Locale.US,ZoneId.of("UTC"));
        assertEquals("Data Nov 23 09:30 \u00b7 Space Nov 23 09:31",text);assertFalse(text.contains("\n"));assertTrue(NativeWidgetPresentation.compactFreshness(new JsonObject(),Locale.US,ZoneId.of("UTC")).contains("unchecked"));
    }
    @Test public void actualShellKeepsContentClippedAboveFooterAndActionsLarge()throws Exception{
        Element root=xml("nextglance_widget"),content=find(root,"widget_content"),footer=find(root,"widget_footer");
        assertEquals("0dp",attr(content,"layout_height"));assertEquals("1",attr(content,"layout_weight"));assertEquals("true",attr(content,"clipChildren"));assertSame(content.getParentNode(),footer.getParentNode());
        assertEquals("match_parent",attr(find(root,"widget_title"),"layout_height"));assertEquals("44dp",attr((Element)find(root,"widget_title").getParentNode(),"layout_height"));
        for(String id:List.of("widget_create","widget_settings","widget_settings_compact")){Element button=find(root,id);assertEquals("ImageView",button.getTagName());assertEquals(44,dp(button,"layout_width"));assertEquals(44,dp(button,"layout_height"));assertTrue(attr(button,"src").startsWith("@drawable/widget_icon_"));}
        assertEquals("1",attr(find(root,"widget_freshness"),"maxLines"));assertEquals(18,dp(find(root,"widget_freshness_compact"),"layout_height"));
        NodeList elements=root.getElementsByTagName("*");for(int i=0;i<elements.getLength();i++){Element e=(Element)elements.item(i);assertFalse(e.hasAttributeNS("http://schemas.android.com/apk/res/android","paddingHorizontal"));assertFalse(e.hasAttributeNS("http://schemas.android.com/apk/res/android","paddingVertical"));}
    }
    @Test public void minimumGeometryFitsAHeadingAndActionableRow()throws Exception{
        Element root=xml("nextglance_widget"),body=find(root,"widget_body");int padding=dp(root,"padding")*2+dp(body,"paddingTop")+dp(body,"paddingBottom");
        int header=dp((Element)find(root,"widget_title").getParentNode(),"layout_height"),compactFooter=dp(find(root,"widget_freshness_compact"),"layout_height"),axis=dp(find(root,"widget_timeline_axis"),"layout_height"),section=dp(xml("nextglance_widget_timeline_section"),"minHeight");
        int remaining=180-padding-header-(NativeWidgetPresentation.compactFooter("timeline",180)?compactFooter:0)-axis;
        assertTrue(remaining>=section+dp(xml("nextglance_widget_timeline"),"minHeight"));
        assertTrue(NativeWidgetPresentation.layout("timeline",140,180).width()>=44*3);
    }
    @Test public void resourceHierarchyMatchesDistinctPagesAndNeverFakesTaskActions()throws Exception{
        assertEquals(48,dp(find(xml("nextglance_widget_booking"),"widget_row_time"),"layout_width"));
        assertTrue(attr(find(xml("nextglance_widget_card"),"widget_card_surface"),"background").startsWith("@drawable/widget_card_"));
        Element task=xml("nextglance_widget_row");assertEquals(18,dp(find(task,"widget_link_indent"),"layout_width"));assertEquals(0,task.getElementsByTagName("CheckBox").getLength());assertEquals("ImageView",find(task,"widget_row_icon").getTagName());
        assertEquals(2,xml("nextglance_widget_section").getElementsByTagName("TextView").getLength());
        assertEquals("match_parent",attr(find(xml("nextglance_widget_timeline"),"widget_timeline_bar"),"layout_width"));assertEquals("match_parent",attr(find(xml("nextglance_widget"),"widget_timeline_axis"),"layout_width"));
        assertEquals(30,dp(find(xml("nextglance_widget"),"widget_overview"),"layout_height"));
    }
    @Test public void linkedTaskPlateHasGrowingParentContextAndContinuousConnector()throws Exception{
        Element task=xml("nextglance_widget_row");assertEquals("match_parent",attr(find(task,"widget_link_indent"),"layout_height"));
        assertEquals("2",attr(find(task,"widget_row_parent"),"maxLines"));assertEquals("wrap_content",attr(find(task,"widget_row_parent"),"layout_height"));
        assertEquals("1",attr(find(task,"widget_link_tail"),"layout_weight"));
        for(String theme:List.of("dark","light"))for(String part:List.of("top","middle","bottom"))assertEquals("shape",xmlIn("drawable","widget_cluster_"+part+"_"+theme).getTagName());
    }
    @Test public void chartImagesPreserveProportionAndModernHitViewportCannotReweight()throws Exception{
        for(String folder:List.of("layout","layout-v31")){
            Element shell=xmlIn(folder,"nextglance_widget");
            for(String id:List.of("widget_calendar_image","widget_timeline_axis"))assertEquals("fitCenter",attr(find(shell,id),"scaleType"));
            Element viewport=find(shell,"widget_calendar_chart"),image=find(shell,"widget_calendar_image"),hits=find(shell,"widget_calendar_actions");
            assertSame(viewport,image.getParentNode());assertSame(viewport,hits.getParentNode());
            assertEquals("match_parent",attr(image,"layout_width"));assertEquals("match_parent",attr(hits,"layout_width"));
            assertEquals("ltr",attr(hits,"layoutDirection"));
            assertEquals("",attr(viewport,"layout_weight"));
            assertEquals("match_parent",attr(viewport,"layout_height"));
            Element chart=find(shell,"widget_grid_plan");
            assertEquals(0,chart.getElementsByTagName("ListView").getLength());
            assertEquals(0,chart.getElementsByTagName("TextView").getLength());
            Element agenda=find(shell,"widget_month_agenda"),open=find(shell,"widget_month_open_day");
            assertEquals("gone",attr(agenda,"visibility"));assertEquals("44dp",attr(open,"layout_height"));
        }
        Element axis=find(xml("nextglance_widget"),"widget_timeline_axis"),bar=find(xml("nextglance_widget_timeline"),"widget_timeline_bar");
        assertEquals("fitCenter",attr(bar,"scaleType"));
        assertEquals(NativeWidgetPresentation.COMPACT_TIMELINE_AXIS_HEIGHT,dp(axis,"layout_height"));
        assertEquals(NativeWidgetPresentation.COMPACT_TIMELINE_BAR_HEIGHT,dp(bar,"layout_height"));
        assertEquals("left|top",attr(xml("nextglance_widget_hit"),"layout_gravity"));
    }
    @Test public void nativeRowsAndHeadingsGrowForSystemTextInsteadOfScalingGlyphs()throws Exception{
        for(String layout:List.of("nextglance_widget_row","nextglance_widget_card","nextglance_widget_booking","nextglance_widget_timeline","nextglance_widget_section")){
            Element root=xml(layout),title=find(root,"widget_row_title");
            assertEquals("wrap_content",attr(root,"layout_height"));assertEquals("wrap_content",attr(title,"layout_height"));
            assertEquals("false",attr(title,"includeFontPadding"));assertTrue(attr(title,"textSize").endsWith("sp"));
        }
        assertEquals(26,dp(xml("nextglance_widget_section"),"minHeight"));
    }
    @Test public void pickerPreviewIsASeparateNativeFictionalLayout()throws Exception{
        Element provider=xmlIn("xml","nextglance_widget"),preview=xml("nextglance_widget_preview");
        assertEquals("@layout/nextglance_widget_preview",attr(provider,"previewLayout"));
        assertEquals("@layout/nextglance_widget",attr(provider,"initialLayout"));
        NodeList nodes=preview.getElementsByTagName("*");boolean sampleContext=false;
        for(int i=0;i<nodes.getLength();i++){
            Element node=(Element)nodes.item(i);assertTrue(Set.of("FrameLayout","LinearLayout","TextView","ImageView").contains(node.getTagName()));
            if("@string/widget_preview_context".equals(attr(node,"text")))sampleContext=true;
        }
        assertTrue(sampleContext);
    }
}
