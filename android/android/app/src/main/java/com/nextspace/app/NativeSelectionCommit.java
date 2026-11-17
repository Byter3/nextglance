package com.nextspace.app;

import java.util.Map;
import java.util.LinkedHashMap;

/** A failed durable preference write can still mutate memory; restore the previous selection. */
final class NativeSelectionCommit {
    interface Preferences {
        String read(String key);
        boolean write(Map<String, String> values);
    }
    static void replace(Preferences preferences, Map<String, String> next) throws NativeLoginFlow.Failure {
        Map<String, String> previous = new LinkedHashMap<>();
        for (String field : next.keySet()) previous.put(field, preferences.read(field));
        if (preferences.write(next)) return;
        preferences.write(previous);
        throw new NativeLoginFlow.Failure("STORAGE", "Nextcloud authorization could not be stored securely. Your previous account is preserved.");
    }
}
