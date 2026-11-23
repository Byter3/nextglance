package com.nextspace.app;

/** Space allocation shared by the two work timeline presentations. */
final class NativeWidgetWorkLayout {
    static final Columns COMPACT = new Columns(0, 0, 0);

    record Columns(int labelWidth, int statusWidth, int dueWidth) {
        boolean split() { return labelWidth > 0; }
        boolean metadataColumns() { return statusWidth > 0; }
        int titleWidth() { return labelWidth - statusWidth - dueWidth; }
    }

    static int dateHeadingHeight(float fontScale) { return (int) Math.ceil(17 * fontScale); }
    static int sectionHeight(float fontScale) { return (int) Math.ceil(14 * fontScale); }
    static int workRowHeight(float fontScale) { return Math.max(34, (int) Math.ceil(28 * fontScale + 4)); }

    static Columns columns(int width, int days, float fontScale) {
        if (days < 1 || width < 220) return COMPACT;
        float scale = Float.isFinite(fontScale) ? Math.max(1f, fontScale) : 1f;
        int minimumLabels = Math.round(84 * scale);
        int minimumPlot = Math.min(7, days) * Math.max(32, Math.round(26 * scale));
        int preferredLabels = Math.min(Math.round(width * .44f), Math.round(300 * scale));
        int labels = Math.min(width - minimumPlot, preferredLabels);
        if (labels < minimumLabels) return COMPACT;

        int minimumThreeColumns = Math.round(232 * scale);
        if (labels < minimumThreeColumns) return new Columns(labels, 0, 0);
        return new Columns(labels, Math.round(66 * scale), Math.round(52 * scale));
    }
}
