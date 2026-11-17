package com.nextspace.app;

import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.PersistableBundle;
import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.File;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/** Selected-account scheduling and private-cache coordination, independent of Activity lifetime. */
final class NativeSyncRuntime {
    static final int DAV_JOB = 671201, DECK_JOB = 671202;
    private static final NativeCacheEpoch EPOCH = new NativeCacheEpoch();
    private static final Map<Integer, Runnable> RUNNING = new ConcurrentHashMap<>();
    private static volatile boolean foreground;
    private static final Gson GSON = new Gson();
    record Session(Context context, NativeLoginFlow.Account account, String selection, long epoch) {
        void checkEpoch() throws Exception {EPOCH.check(epoch);}
        void check() throws Exception {
            EPOCH.check(epoch);
            if (!selection.equals(fingerprint(context))) throw NativeSyncPolicy.failure("CANCELLED", "The selected account changed.");
        }
        NativeResourceCache cache() throws Exception {
            return cache(() -> {});
        }
        NativeResourceCache cache(NativeResourceCache.Guard operation) throws Exception {
            check(); operation.check(); return new NativeResourceCache(new File(context.getFilesDir(), "nextspace-source-resources-v1"), account.name() + "\0" + account.serverUrl() + "\0" + account.username(), account.serverUrl(), () -> { check(); operation.check(); });
        }
        NativeResourceCache cacheBatch(NativeResourceCache.Guard operation) throws Exception {
            // Full selected-account verification brackets the bridge operation. Inner file
            // steps still check the session epoch/deadline without rereading preferences.
            NativeResourceCache.Guard guard = batchGuard(this::check, () -> { EPOCH.check(epoch); operation.check(); });
            return new NativeResourceCache(new File(context.getFilesDir(), "nextspace-source-resources-v1"), account.name() + "\0" + account.serverUrl() + "\0" + account.username(), account.serverUrl(), guard);
        }
    }
    static NativeResourceCache.Guard batchGuard(NativeResourceCache.Guard full, NativeResourceCache.Guard quick) throws Exception {
        full.check(); quick.check(); return quick;
    }
    private static SharedPreferences selection(Context context) { return context.getSharedPreferences("nextspace-account-selection", Context.MODE_PRIVATE); }
    private static SharedPreferences preferences(Context context) { return context.getSharedPreferences("nextspace-background-sync-v1", Context.MODE_PRIVATE); }
    static NativeLoginFlow.Account savedAccount(Context context) throws Exception { return new NativeCredentialStore(selection(context)).current(); }
    static Session session(Context context, String name) throws Exception {
        Context app = context.getApplicationContext(); NativeLoginFlow.Account account = savedAccount(app);
        if (account == null || name == null || !name.equals(account.name())) throw NativeSyncPolicy.failure("CANCELLED", "The selected Nextcloud account changed.");
        return new Session(app, account, fingerprint(app), EPOCH.capture());
    }
    private static String fingerprint(Context context) throws Exception {
        SharedPreferences prefs = selection(context); NativeLoginFlow.Account account = savedAccount(context);
        if (account == null) return "";
        // Ciphertext is included only in an in-memory digest; secrets never enter cache/scheduler extras.
        return NativeLoginFlow.digest(account.name() + "\0" + account.serverUrl() + "\0" + account.username() + "\0" + prefs.getString("transport", "sso") + "\0" + prefs.getString("providerName", "") + "\0" + prefs.getString("direct:" + NativeLoginFlow.digest(account.name()), ""));
    }
    static void invalidate() { EPOCH.invalidate(); for (Runnable cancel : RUNNING.values()) cancel.run(); }
    static boolean beforeCacheMaintenance(String operation) {
        boolean invalidated = EPOCH.beforeMaintenance(operation);
        if (invalidated) for (Runnable cancel : RUNNING.values()) cancel.run();
        return invalidated;
    }
    static boolean isForeground() { return foreground; }
    static synchronized void foreground(boolean value) {
        foreground = value;
        // Keep periodic jobs scheduled for later; only yield the current read-only pass.
        if (value) for (Runnable cancel : RUNNING.values()) cancel.run();
    }
    interface Commit {void run() throws Exception;}
    static synchronized void commitBackground(Session session, Commit commit) throws Exception {
        session.check();if(foreground)throw NativeSyncPolicy.failure("CANCELLED","Foreground editing resumed.");commit.run();
    }
    static void projection(Session session,String status,Long timestamp) throws Exception {
        session.check();var edit=preferences(session.context).edit().putString(key(session)+":projection",status);
        if(timestamp!=null)edit.putString(key(session)+":readGeneration",Instant.ofEpochMilli(timestamp).toString());
        if(!edit.commit())throw NativeSyncPolicy.failure("CACHE_WRITE","Background read status could not be saved.");
    }
    static com.google.gson.JsonArray readDenials(Context context,NativeLoginFlow.Account account)throws Exception {
        String key=NativeLoginFlow.digest(account.name()+"\0"+account.serverUrl()+"\0"+account.username());
        return JsonParser.parseString(preferences(context).getString(key+":readDenials","[]")).getAsJsonArray();
    }
    static synchronized void denyRead(Session session,String kind,String code,String collection)throws Exception {
        session.check();var values=readDenials(session.context,session.account);
        List<String> sources="AUTH".equals(code)?List.of("tasks","calendar","deck","notes","collectives"):"dav".equals(kind)?List.of("tasks","calendar"):List.of("deck");
        for(String source:sources){JsonObject value=new JsonObject();value.addProperty("source",source);value.addProperty("code",code);if(collection==null)value.add("collection",com.google.gson.JsonNull.INSTANCE);else value.addProperty("collection",collection);boolean found=false;for(var old:values)if(old.equals(value))found=true;if(!found)values.add(value);}
        if(!preferences(session.context).edit().putString(key(session)+":readDenials",values.toString()).commit())throw NativeSyncPolicy.failure("CACHE_WRITE","Source access restrictions could not be saved.");
    }
    static synchronized void verifiedReads(Session session,Set<String> sources)throws Exception {
        session.check();if(!Set.of("tasks","calendar","deck","notes","collectives").containsAll(sources))throw NativeSyncPolicy.failure("VALIDATION","Invalid verified source set.");
        var retained=new com.google.gson.JsonArray();for(var value:readDenials(session.context,session.account))if(!sources.contains(value.getAsJsonObject().get("source").getAsString()))retained.add(value);
        if(!preferences(session.context).edit().putString(key(session)+":readDenials",retained.toString()).commit())throw NativeSyncPolicy.failure("CACHE_WRITE","Source access verification could not be saved.");
    }
    static void cancelAll(Context context) { invalidate(); JobScheduler jobs = context.getSystemService(JobScheduler.class); if (jobs != null) { jobs.cancel(DAV_JOB); jobs.cancel(DECK_JOB); } }
    static String key(Session session) throws Exception { return NativeLoginFlow.digest(session.account.name() + "\0" + session.account.serverUrl() + "\0" + session.account.username()); }
    static JsonObject configure(Context context, String name, JsonObject input) throws Exception {
        return configure(context, name, input, () -> {});
    }
    static JsonObject configure(Context context, String name, JsonObject input, NativeResourceCache.Guard operation) throws Exception {
        Session session = session(context, name); NativeSyncPolicy.Settings settings = NativeSyncPolicy.settings(input, true); String key = key(session);
        operation.check(); session.check(); if (!preferences(context).edit().putString(key + ":settings", GSON.toJson(settings)).commit()) throw NativeSyncPolicy.failure("CACHE_WRITE", "Sync preferences could not be saved on this device.");
        JobScheduler jobs = context.getSystemService(JobScheduler.class);
        if (jobs == null) throw NativeSyncPolicy.failure("UNAVAILABLE", "Android background scheduling is unavailable.");
        try {
            operation.check(); schedule(context, jobs, session, DAV_JOB, "dav", settings.caldavMinutes(), settings.wifiOnly());
            operation.check(); schedule(context, jobs, session, DECK_JOB, "deck", settings.deckMinutes(), settings.wifiOnly());
        } catch (Exception failure) {
            session.check();
            jobs.cancel(DAV_JOB); jobs.cancel(DECK_JOB);
            preferences(context).edit().putString(key + ":schedulerError", "Android could not schedule background checks. Open settings and retry.").commit(); throw failure;
        }
        operation.check(); session.check(); preferences(context).edit().remove(key + ":schedulerError").commit(); return state(context, name);
    }
    private static void schedule(Context context, JobScheduler jobs, Session session, int id, String kind, int minutes, boolean wifiOnly) throws Exception {
        session.check();
        if (minutes == 0) { jobs.cancel(id); Runnable cancel = RUNNING.get(id); if (cancel != null) cancel.run(); return; }
        JobInfo current = jobs.getPendingJob(id);
        if (current != null && current.getIntervalMillis() == minutes * 60_000L && current.getExtras().getBoolean("wifiOnly", false) == wifiOnly && session.selection.equals(current.getExtras().getString("selection"))) return;
        PersistableBundle extras = new PersistableBundle(); extras.putString("accountName", session.account.name()); extras.putString("selection", session.selection); extras.putString("kind", kind); extras.putBoolean("wifiOnly", wifiOnly);
        JobInfo.Builder builder = new JobInfo.Builder(id, new ComponentName(context, NativeSourceSyncService.class)).setExtras(extras).setPersisted(true)
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPeriodic(minutes * 60_000L).setBackoffCriteria(60_000L, JobInfo.BACKOFF_POLICY_EXPONENTIAL);
        if (wifiOnly && android.os.Build.VERSION.SDK_INT >= 28) builder.setRequiredNetwork(new android.net.NetworkRequest.Builder().addTransportType(android.net.NetworkCapabilities.TRANSPORT_WIFI).addCapability(android.net.NetworkCapabilities.NET_CAPABILITY_INTERNET).build());
        JobInfo info = builder.build();
        if (jobs.schedule(info) != JobScheduler.RESULT_SUCCESS) throw NativeSyncPolicy.failure("UNAVAILABLE", "Android could not schedule background source checks.");
    }
    static JsonObject state(Context context, String name) throws Exception {
        Session session = session(context, name); String key = key(session); SharedPreferences prefs = preferences(context); JobScheduler jobs = context.getSystemService(JobScheduler.class);
        JsonObject state = new JsonObject(); state.addProperty("supported", true);
        state.addProperty("scheduled", jobs != null && (matches(jobs.getPendingJob(DAV_JOB), session) || matches(jobs.getPendingJob(DECK_JOB), session)));
        String latestAttempt = "", latestSuccess = ""; List<String> errors = new ArrayList<>();
        for (String kind : List.of("dav", "deck")) {
            String prefix = key + ":" + kind + ":"; String attempt = prefs.getString(prefix + "attempt", ""), success = prefs.getString(prefix + "success", ""), error = prefs.getString(prefix + "error", "");
            if (attempt.compareTo(latestAttempt) > 0) latestAttempt = attempt; if (success.compareTo(latestSuccess) > 0) latestSuccess = success;
            if (!error.isEmpty()) errors.add(("dav".equals(kind) ? "Tasks/Calendar: " : "Deck: ") + error);
        }
        String schedulerError = prefs.getString(key + ":schedulerError", ""); if (!schedulerError.isEmpty()) errors.add(schedulerError);
        if (!latestAttempt.isEmpty()) state.addProperty("lastAttemptAt", latestAttempt); if (!latestSuccess.isEmpty()) state.addProperty("lastSuccessAt", latestSuccess);
        if (!errors.isEmpty()) state.addProperty("error", String.join(" ", errors));
        String projection=prefs.getString(key+":projection","pending");state.addProperty("projection",projection);
        String readGeneration=prefs.getString(key+":readGeneration","");if(!readGeneration.isEmpty())state.addProperty("readGenerationAt",readGeneration);
        if("unavailable".equals(projection))state.addProperty("message","Background downloads are available; this Android system does not support headless read-store projection. Open NextGlance to apply downloaded changes.");
        else if("incomplete".equals(projection))state.addProperty("message","Background resources are saved, but the readable view could not be updated. The previous view is preserved.");
        return state;
    }
    private static boolean matches(JobInfo job, Session session) { return job != null && session.selection.equals(job.getExtras().getString("selection")); }
    static void register(int job, Runnable cancel) { RUNNING.put(job, cancel); }
    static void unregister(int job, Runnable cancel) { RUNNING.remove(job, cancel); }
    static void progress(Session session, String kind, String stage, int completed, int total) throws Exception {
        session.check(); String prefix = key(session) + ":" + kind + ":";
        // Progress checkpoints contain no refreshing flag, so process death cannot leave a permanent spinner.
        if (!preferences(session.context).edit().putString(prefix + "stage", stage).putInt(prefix + "completed", completed).putInt(prefix + "total", Math.max(completed, total)).commit()) throw NativeSyncPolicy.failure("CACHE_WRITE", "Background progress could not be saved.");
    }
    static void started(Session session, String kind) throws Exception { session.check(); if (!preferences(session.context).edit().putString(key(session) + ":" + kind + ":attempt", Instant.now().toString()).commit()) throw NativeSyncPolicy.failure("CACHE_WRITE", "Background status could not be saved."); }
    static void finished(Session session, String kind, Exception failure) throws Exception {
        session.check(); String prefix = key(session) + ":" + kind + ":"; SharedPreferences.Editor edit = preferences(session.context).edit();
        boolean revoked = false, denied = false;
        if (failure == null) edit.putString(prefix + "success", Instant.now().toString()).remove(prefix + "error");
        else {
            String code = failure instanceof NativeLoginFlow.Failure known ? known.code : "NETWORK";
            if ("CANCELLED".equals(code)) return;
            String message = failure instanceof NativeLoginFlow.Failure ? failure.getMessage() : "Nextcloud could not complete the background check. Retry after checking its connection.";
            String stage = preferences(session.context).getString(prefix + "stage", "discovery");
            edit.putString(prefix + "error", ("discovery".equals(stage) ? "Discovery: " : "Downloading sources: ") + message);
            revoked = "AUTH".equals(code); denied = "PERMISSION".equals(code);
            if (revoked) session.cache().clear();
        }
        if (!edit.commit()) throw NativeSyncPolicy.failure("CACHE_WRITE", "Background check status could not be saved.");
        if (revoked) cancelAll(session.context);
        else if (denied) { JobScheduler jobs = session.context.getSystemService(JobScheduler.class); if (jobs != null) jobs.cancel("dav".equals(kind) ? DAV_JOB : DECK_JOB); }
    }
    static void mutated(Context context, String name, String url) throws Exception {
        Session session = session(context, name); String base = session.account.serverUrl().replaceAll("/+$", "");
        if (url.startsWith(base + "/remote.php/dav/calendars/") && !url.endsWith("/")) {
            session.cache().remove(new NativeSyncPolicy.Locator("dav", url.substring(0, url.lastIndexOf('/') + 1), url)); invalidate();
        } else {
            var match = java.util.regex.Pattern.compile(java.util.regex.Pattern.quote(base) + "/index\\.php/apps/deck/api/v1\\.0/boards/([1-9]\\d*)/.*").matcher(url);
            if (match.matches()) { String collection = base + "/index.php/apps/deck/api/v1.0/boards/" + match.group(1); session.cache().remove(new NativeSyncPolicy.Locator("deck", collection, collection + "/stacks")); invalidate(); }
        }
    }
}
