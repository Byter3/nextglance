package com.nextspace.app;

import org.junit.Test;

import static org.junit.Assert.*;

public class NativeWidgetWorkLayoutTest {
    @Test public void splitKeepsWeekDatesAndGroupsReadableAcrossAvailableWidths() {
        assertFalse(NativeWidgetWorkLayout.columns(132, 7, 1).split());
        assertFalse(NativeWidgetWorkLayout.columns(300, 7, 1).split());
        var medium = NativeWidgetWorkLayout.columns(359, 7, 1);
        assertTrue(medium.split());
        assertFalse(medium.metadataColumns());
        assertTrue(medium.labelWidth() >= 84);
        assertTrue(359 - medium.labelWidth() >= 7 * 32);

        var wide = NativeWidgetWorkLayout.columns(579, 7, 1);
        assertTrue(wide.metadataColumns());
        assertEquals(wide.labelWidth(), wide.titleWidth() + wide.statusWidth() + wide.dueWidth());
        assertTrue(wide.titleWidth() >= 100);
        assertTrue(579 - wide.labelWidth() >= 7 * 32);
    }

    @Test public void largeTextDropsMetadataColumnsBeforeDiscardingAUsefulSplit() {
        var wide = NativeWidgetWorkLayout.columns(579, 7, 2);
        assertTrue(wide.split());
        assertFalse(wide.metadataColumns());
        assertTrue(579 - wide.labelWidth() >= 7 * 52);
        assertFalse(NativeWidgetWorkLayout.columns(359, 7, 2).split());
    }

    @Test public void singleDayCanUseASplitAtWidthsThatKeepAWeekCompact() {
        assertTrue(NativeWidgetWorkLayout.columns(279, 1, 1).split());
        assertFalse(NativeWidgetWorkLayout.columns(279, 7, 1).split());
        assertEquals(NativeWidgetWorkLayout.COMPACT, NativeWidgetWorkLayout.columns(579, 0, 1));
    }

    @Test public void workAndHeadingHeightsAreCompactAndRetainLargeText() {
        assertEquals(34, NativeWidgetWorkLayout.workRowHeight(1));
        assertEquals(60, NativeWidgetWorkLayout.workRowHeight(2));
        assertEquals(14, NativeWidgetWorkLayout.sectionHeight(1));
        assertEquals(28, NativeWidgetWorkLayout.sectionHeight(2));
        assertEquals(17, NativeWidgetWorkLayout.dateHeadingHeight(1));
        assertEquals(34, NativeWidgetWorkLayout.dateHeadingHeight(2));
    }
}
