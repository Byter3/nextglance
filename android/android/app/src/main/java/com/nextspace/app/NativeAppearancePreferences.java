package com.nextspace.app;

import android.content.Context;

/** Installation appearance only; never part of an account, planner archive or widget snapshot. */
final class NativeAppearancePreferences {
    private static final String STORE = "nextglance-appearance";
    private static final String WEEKEND = "weekendMask";
    static int weekendMask(Context context) {
        return NativeWeekend.normalize(context.getSharedPreferences(STORE, Context.MODE_PRIVATE).getAll().get(WEEKEND));
    }
    static void weekendMask(Context context, Object value) {
        if (!context.getSharedPreferences(STORE, Context.MODE_PRIVATE).edit().putInt(WEEKEND, NativeWeekend.normalize(value)).commit())
            throw new IllegalStateException("Weekend appearance could not be saved. Retry the setting.");
    }
}
