package com.nextspace.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.ActivityCallback;
import androidx.activity.result.ActivityResult;
import com.google.gson.Gson;
import com.nextcloud.android.sso.AccountImporter;
import com.nextcloud.android.sso.model.SingleSignOnAccount;
import java.net.URI;
import java.util.Collections;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;

/** Account-bound source reads and conditional planner writes. Credentials never enter JavaScript. */
@CapacitorPlugin(name = "NextcloudSso")
public class NextcloudSsoPlugin extends Plugin {
    private record Attachment(String token,String account,String name,long size,android.net.Uri uri,long epoch,long created){}
    private Attachment attachment;
    private String attachmentAccount;
    private long attachmentEpoch;
    @PluginMethod public synchronized void chooseAttachment(PluginCall call){
        if(attachmentAccount!=null){call.reject("A file picker is already open.","UNAVAILABLE");return;}
        try{
            String name=call.getString("accountName");ensureCurrent(name,generation);
            attachment=null;attachmentAccount=name;attachmentEpoch=accountGeneration;
            android.content.Intent intent=new android.content.Intent(android.content.Intent.ACTION_OPEN_DOCUMENT);
            intent.addCategory(android.content.Intent.CATEGORY_OPENABLE);intent.setType("*/*");
            startActivityForResult(call,intent,"attachmentChosen");
        }catch(Exception error){attachmentAccount=null;reject(call,error);}
    }
    @ActivityCallback private void attachmentChosen(PluginCall call,ActivityResult activity){
        final String name;final long epoch;synchronized(this){name=attachmentAccount;epoch=attachmentEpoch;attachmentAccount=null;}
        if(call==null)return;
        if(activity.getResultCode()!=android.app.Activity.RESULT_OK||activity.getData()==null||activity.getData().getData()==null){JSObject result=new JSObject();result.put("cancelled",true);call.resolve(result);return;}
        android.net.Uri uri=activity.getData().getData();
        localWork(call,cacheRequests,"Selected attachment",timed->{
            if(!"content".equals(uri.getScheme()))throw new BridgeFailure("VALIDATION","Choose a document from the system file picker.");
            String fileName=null;long size=-1;
            try(android.database.Cursor cursor=getContext().getContentResolver().query(uri,new String[]{android.provider.OpenableColumns.DISPLAY_NAME,android.provider.OpenableColumns.SIZE},null,null,null)){
                if(cursor!=null&&cursor.moveToFirst()){fileName=cursor.getString(0);if(!cursor.isNull(1))size=cursor.getLong(1);}
            }
            fileName=NativeMultipart.name(fileName);if(size<0||size>NativeMultipart.MAX)throw new BridgeFailure("LIMIT","Choose a file with a known size up to 20 MiB.");
            String token=java.util.UUID.randomUUID().toString();
            synchronized(this){if(epoch!=accountGeneration||!java.util.Objects.equals(name,preferences().getString("name",null)))throw new BridgeFailure("CANCELLED","The selected account changed.");attachment=new Attachment(token,name,fileName,size,uri,epoch,System.currentTimeMillis());}
            JSObject result=new JSObject();result.put("token",token);result.put("name",fileName);result.put("size",size);return result;
        });
    }
    @PluginMethod public void uploadAttachment(PluginCall call){
        final Attachment selected;final long expected;
        try{synchronized(this){selected=attachment;attachment=null;expected=generation;ensureCurrent(call.getString("accountName"),expected);if(selected==null||!selected.token.equals(call.getString("token"))||!selected.account.equals(call.getString("accountName"))||selected.epoch!=accountGeneration||System.currentTimeMillis()-selected.created>300000)throw new BridgeFailure("CANCELLED","Choose the attachment again; its selection expired.");}}
        catch(Exception error){reject(call,error);return;}
        TimedCall timed=new TimedCall(call,"Attachment upload");
        try{timed.pending(requests.submit(()->{
            try{
                ensureCurrent(selected.account,expected);NativeSourceTransport transport;
                synchronized(this){if(sourceTransport==null||sourceTransport.isClosed())sourceTransport=new NativeSourceTransport(getContext(),NativeSyncRuntime.savedAccount(getContext()),()->ensureCurrent(selected.account,expected));transport=sourceTransport;}
                try(java.io.InputStream file=getContext().getContentResolver().openInputStream(selected.uri)){
                    if(file==null)throw new BridgeFailure("UNAVAILABLE","The selected file is unavailable.");
                    transport.upload(String.valueOf(call.getData().get("boardId")),String.valueOf(call.getData().get("stackId")),String.valueOf(call.getData().get("cardId")),selected.name,file,selected.size,timed.remaining());
                }
                ensureCurrent(selected.account,expected);JSObject result=new JSObject();result.put("uploaded",true);timed.resolve(result);
            }catch(Exception error){timed.reject(error);}
        }),requests);}catch(RejectedExecutionException error){timed.reject(new BridgeFailure("NETWORK","Too many requests are pending. Choose the attachment again."));}
    }
    private NativeCacheFile privateCache;
    private synchronized NativeCacheFile privateCache(){if(privateCache==null)privateCache=new NativeCacheFile(getContext().getFilesDir());return privateCache;}
    @PluginMethod public void cacheFile(PluginCall call){
        final long epoch; synchronized(this){epoch=accountGeneration;}
        final NativeCacheArguments numeric;
        try{numeric=NativeCacheArguments.from(call);}catch(Exception error){reject(call,error);return;}
        final String currentOwner=call.getString("owner");final long ownerEpoch=numeric.ownerEpoch();
        try{privateCache().owner(currentOwner,ownerEpoch);}catch(Exception error){reject(call,error);return;}
        localWork(call,cacheRequests,"Private cache transfer",timed->NativeSyncRuntime.cacheOperation(()->{
            NativeCacheFile cache=privateCache();String path=call.getString("path"),token=call.getString("token"),owner=call.getString("owner");
            NativeCacheFile.Guard guard=()->{timed.check();cache.checkOwner(currentOwner,ownerEpoch);synchronized(this){if(epoch!=accountGeneration)throw new BridgeFailure("CANCELLED","The selected account changed.");}};
            guard.check();JSObject result=new JSObject();
            switch(call.getString("operation","")){
                case "size":{var stat=cache.stat(path,guard);result.put("size",stat.size()==null?JSONObject.NULL:stat.size());result.put("revision",stat.revision());result.put("prefix",stat.prefix());break;}
                case "read":result.put("chunk",Base64.encodeToString(cache.read(path,numeric.offset(),numeric.length(),numeric.size(),call.getString("revision"),guard),Base64.NO_WRAP));break;
                case "beginWrite":result.put("token",cache.begin(path,numeric.size(),epoch,owner,guard));break;
                case "append":{
                    String chunk=call.getString("chunk");if(chunk==null||chunk.length()>((NativeCacheFile.CHUNK+2)/3)*4||chunk.length()%4!=0||!chunk.matches("[A-Za-z0-9+/]*={0,2}"))throw new BridgeFailure("CACHE_FORMAT","Invalid cache chunk.");
                    cache.append(path,token,epoch,owner,numeric.offset(),Base64.decode(chunk,Base64.NO_WRAP),guard);break;
                }
                case "commit":cache.commit(path,token,epoch,owner,guard);break;
                case "abort":cache.abort(path,token,epoch,owner);break;
                case "remove":cache.remove(path,guard);break;
                default:throw new BridgeFailure("VALIDATION","Unknown private cache operation.");
            }
            return result;
        }));
    }
    private String diagnosticExport;
    private boolean diagnosticChooserOpen;
    private String plannerExport;
    private boolean plannerChooserOpen;
    @PluginMethod
    public void exportPlanner(PluginCall call) {
        if (plannerChooserOpen) { call.reject("A planner export dialog is already open.", "UNAVAILABLE"); return; }
        try {
            plannerExport = NativePlannerExport.checked(call.getString("document"));
            android.content.Intent intent = new android.content.Intent(android.content.Intent.ACTION_CREATE_DOCUMENT);
            intent.addCategory(android.content.Intent.CATEGORY_OPENABLE); intent.setType("application/json");
            intent.putExtra(android.content.Intent.EXTRA_TITLE, "NextGlance-planner.json");
            plannerChooserOpen = true; startActivityForResult(call, intent, "plannerCreated");
        } catch (Exception error) { plannerChooserOpen = false; plannerExport = null; reject(call, error); }
    }
    @ActivityCallback
    private void plannerCreated(PluginCall call, ActivityResult activity) {
        String document = plannerExport; plannerExport = null; plannerChooserOpen = false;
        if (call == null) return;
        if (activity.getResultCode() != android.app.Activity.RESULT_OK || activity.getData() == null || activity.getData().getData() == null) { JSObject result = new JSObject(); result.put("exported", false); call.resolve(result); return; }
        android.net.Uri uri = activity.getData().getData();
        localWork(call, controls, "Planner export", timed -> {
            String checked = NativePlannerExport.checked(document); timed.check();
            try (java.io.OutputStream output = getContext().getContentResolver().openOutputStream(uri, "wt")) { NativePlannerExport.write(output, checked); }
            JSObject result = new JSObject(); result.put("exported", true); return result;
        });
    }
    @PluginMethod
    public void copyDiagnostics(PluginCall call) {
        try {
            String report=NativeDiagnostics.checked(call.getString("report"));
            getActivity().runOnUiThread(()->{
                try {android.content.ClipboardManager clipboard=(android.content.ClipboardManager)getContext().getSystemService(Context.CLIPBOARD_SERVICE);
                    clipboard.setPrimaryClip(android.content.ClipData.newPlainText("NextGlance diagnostics",report));JSObject result=new JSObject();result.put("copied",true);call.resolve(result);
                }catch(Exception error){call.reject("Clipboard is unavailable. Use the selectable report or Save log.","UNAVAILABLE");}
            });
        }catch(Exception error){reject(call,error);}
    }
    @PluginMethod
    public void saveDiagnostics(PluginCall call) {
        if(diagnosticChooserOpen){call.reject("A diagnostics save dialog is already open.","UNAVAILABLE");return;}
        try {
            String report=NativeDiagnostics.checked(call.getString("report"));
            android.content.Intent intent=new android.content.Intent(android.content.Intent.ACTION_CREATE_DOCUMENT);
            intent.addCategory(android.content.Intent.CATEGORY_OPENABLE);intent.setType("application/json");
            intent.putExtra(android.content.Intent.EXTRA_TITLE,"NextGlance-diagnostics-"+java.time.Instant.now().toString().replace(':','-')+".json");
            diagnosticExport=report;diagnosticChooserOpen=true;startActivityForResult(call,intent,"diagnosticsCreated");
        }catch(Exception error){diagnosticChooserOpen=false;diagnosticExport=null;reject(call,error);}
    }
    @ActivityCallback
    private void diagnosticsCreated(PluginCall call, ActivityResult activity) {
        String report=diagnosticExport;diagnosticExport=null;diagnosticChooserOpen=false;
        if(call==null)return;
        if(activity.getResultCode()!=android.app.Activity.RESULT_OK||activity.getData()==null||activity.getData().getData()==null){JSObject result=new JSObject();result.put("saved",false);result.put("cancelled",true);call.resolve(result);return;}
        android.net.Uri uri=activity.getData().getData();
        localWork(call,controls,"Diagnostics export",timed->{
            String checked=NativeDiagnostics.checked(report);timed.check();
            try(java.io.OutputStream output=getContext().getContentResolver().openOutputStream(uri,"wt")){if(output==null)throw new java.io.IOException();output.write(checked.getBytes(java.nio.charset.StandardCharsets.UTF_8));}
            JSObject result=new JSObject();result.put("saved",true);return result;
        });
    }
    private static final int MAX_RESPONSE = 24 * 1024 * 1024;
    private static final String PREFS = "nextspace-account-selection";
    private final NativeRequestQueue requests = new NativeRequestQueue(2, 16);
    private final ThreadPoolExecutor accounts = new ThreadPoolExecutor(1, 1, 30, TimeUnit.SECONDS, new ArrayBlockingQueue<>(4));
    private final ThreadPoolExecutor browserAuthorization = NativeDeadline.executor("browser-authorization", 1, 4);
    private final ThreadPoolExecutor cacheRequests = new ThreadPoolExecutor(2, 2, 30, TimeUnit.SECONDS, new ArrayBlockingQueue<>(32));
    private final ThreadPoolExecutor controls = NativeDeadline.executor("sync-control", 1, 4);
    private final java.util.Set<TimedCall> pendingCalls = java.util.concurrent.ConcurrentHashMap.newKeySet();
    private NativeSourceTransport sourceTransport;
    private final java.util.concurrent.ScheduledExecutorService deadlines = java.util.concurrent.Executors.newSingleThreadScheduledExecutor();
    private long generation;
    private long accountGeneration;
    private boolean active = true;
    private final NativeHttp directHttp = new NativeHttp();
    private NativeCredentialStore credentialStore;
    private NativeLoginFlow login;

    @Override public void load() { NativeSyncRuntime.foreground(true); }

    private synchronized NativeCredentialStore credentials() {
        if (credentialStore == null) credentialStore = new NativeCredentialStore(preferences());
        return credentialStore;
    }

    private synchronized NativeLoginFlow login() {
        if (login == null) login = new NativeLoginFlow(directHttp, credentials(), System::currentTimeMillis, () -> java.util.UUID.randomUUID().toString());
        return login;
    }

    @PluginMethod
    public void beginLogin(PluginCall call) {
        synchronized (this) { accountGeneration++; }
        execute(call, timed -> {
            NativeLoginFlow.Started started = login().begin(call.getString("serverUrl"));
            JSObject result = new JSObject(); result.put("flowId", started.flowId()); result.put("loginUrl", started.loginUrl());
            return result;
        });
    }

    @PluginMethod
    public void pollLogin(PluginCall call) {
        execute(call, timed -> {
            NativeLoginFlow.Polled polled = login().poll(call.getString("flowId"));
            if (!polled.pending()) synchronized (this) { NativeSyncRuntime.cancelAll(getContext()); generation++; accountGeneration++; closeApi(); }
            JSObject result = polled.pending() ? new JSObject() : accountResult(polled.account(), "direct");
            result.put("pending", polled.pending());
            return result;
        });
    }

    @PluginMethod
    public void cancelLogin(PluginCall call) {
        NativeLoginFlow.Account committed = login().cancel(call.getString("flowId"));
        if (committed != null) { NativeSyncRuntime.cancelAll(getContext()); synchronized (this) { generation++; accountGeneration++; closeApi(); } }
        JSObject result = committed == null ? new JSObject() : accountResult(committed, "direct");
        result.put("pending", false);
        call.resolve(result);
    }

    private final class TimedCall {
        final PluginCall call;
        final String stage;
        final long deadline = android.os.SystemClock.elapsedRealtime() + NativeSyncPolicy.REQUEST_MILLIS;
        final java.util.concurrent.atomic.AtomicBoolean done = new java.util.concurrent.atomic.AtomicBoolean();
        final java.util.concurrent.ScheduledFuture<?> timeout;
        volatile java.util.concurrent.Future<?> pending;
        volatile ThreadPoolExecutor owner;
        TimedCall(PluginCall call) { this(call, "Nextcloud request"); }
        TimedCall(PluginCall call, String stage) {
            this.call = call; this.stage = stage; pendingCalls.add(this);
            timeout = deadlines.schedule(() -> {
                if (!done.compareAndSet(false, true)) return;
                java.util.concurrent.Future<?> task = pending; if (task != null) task.cancel(true);
                ThreadPoolExecutor queue = owner; if (queue != null) queue.purge(); pendingCalls.remove(this);
                call.reject(stage + " did not finish within 45 seconds. Saved data remains available; retry this operation.", "TIMEOUT");
            }, NativeSyncPolicy.REQUEST_MILLIS, TimeUnit.MILLISECONDS);
        }
        void pending(java.util.concurrent.Future<?> value, ThreadPoolExecutor queue) { pending = value; owner = queue; if (done.get()) { value.cancel(true); queue.purge(); } }
        void check() throws Exception {
            if (android.os.SystemClock.elapsedRealtime() >= deadline) throw NativeSyncPolicy.failure("TIMEOUT", stage + " did not finish within 45 seconds. Saved data is preserved; retry this operation.");
            if (done.get() || Thread.currentThread().isInterrupted()) throw NativeSyncPolicy.failure("CANCELLED", stage + " was stopped. Saved data is preserved.");
        }
        long remaining() { return Math.max(1, deadline - android.os.SystemClock.elapsedRealtime()); }
        void resolve(JSObject value) { if (done.compareAndSet(false, true)) { timeout.cancel(false); pendingCalls.remove(this); call.resolve(value); } }
        void reject(Exception error) { if (done.compareAndSet(false, true)) { timeout.cancel(false); pendingCalls.remove(this); NextcloudSsoPlugin.reject(call, error); } }
        void cancel() { java.util.concurrent.Future<?> task = pending; if (task != null) task.cancel(true); reject(new BridgeFailure("CANCELLED", stage + " was stopped. Saved data is preserved.")); }
    }
    private void execute(PluginCall call, LocalWork work) {
        TimedCall timed = new TimedCall(call, "Browser authorization");
        try { timed.pending(browserAuthorization.submit(() -> {
            try { timed.check(); JSObject result = work.run(timed); timed.check(); timed.resolve(result); }
            catch (Exception error) { timed.reject(error); }
        }), browserAuthorization); }
        catch (RejectedExecutionException error) { timed.reject(new BridgeFailure("NETWORK", "Browser authorization is already pending. Retry shortly.")); }
    }

    private static JSObject publicIdentity(NativeLoginFlow.Account account) {
        JSObject value = new JSObject(); value.put("name", account.name()); value.put("serverUrl", account.serverUrl()); value.put("username", account.username()); return value;
    }

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    @PluginMethod
    public void getSavedAccount(PluginCall call) {
        try { call.resolve(accountResult(NativeSyncRuntime.savedAccount(getContext()), preferences().getString("transport", "sso"))); }
        catch (Exception unavailable) { call.resolve(unavailableAccount()); }
    }

    @PluginMethod
    public void getAccount(PluginCall call) {
        final long expected;
        synchronized (this) { expected = accountGeneration; }
        TimedCall timed = new TimedCall(call, "Nextcloud authorization");
        try { timed.pending(accounts.submit(() -> {
            try {
                timed.check(); JSObject result = NativeDeadline.run(NativeDeadline.Lane.AUTHORIZATION, this::restoreAccount, () -> {}, timed.remaining());
                synchronized (this) {
                    if (expected != accountGeneration) throw new BridgeFailure("CANCELLED", "The selected account changed during authorization.");
                }
                timed.resolve(result);
            } catch (Exception error) { timed.reject(error); }
        }), accounts); } catch (RejectedExecutionException busy) { timed.reject(new BridgeFailure("NETWORK", "Nextcloud account verification is already pending. Retry shortly.")); }
    }

    private JSObject restoreAccount() {
        try {
            String name = preferences().getString("name", null);
            if (name == null) return accountResult(null, null);
            try {
                if ("direct".equals(preferences().getString("transport", "sso"))) {
                    return accountResult(credentials().read().account(), "direct");
                }
                SingleSignOnAccount account = checkedAccount(name);
                NativeLoginFlow.Account saved = credentials().current();
                if (saved == null || !NativeLoginFlow.normalizeServer(account.url).equals(NativeLoginFlow.normalizeServer(saved.serverUrl())) || !account.userId.equals(saved.username())) throw new BridgeFailure("AUTH", "Nextcloud Files returned another account.");
                return accountResult(saved, "sso");
            } catch (Exception unavailable) {
                JSObject result = accountResult(null, preferences().getString("transport", "sso"));
                try {
                    String serverUrl = preferences().getString("serverUrl", null);
                    String username = preferences().getString("username", null);
                    checkedAccountIdentity(name, serverUrl, username);
                    JSObject identity = new JSObject();
                    identity.put("name", name);
                    identity.put("serverUrl", serverUrl);
                    identity.put("username", username);
                    result.put("account", identity);
                    result.put("reconnectRequired", true);
                    result.put("restoreError", "Saved Nextcloud account access is unavailable. Sign in again; saved data remains on this device.");
                } catch (Exception invalidIdentity) {
                    result.put("account", JSONObject.NULL);
                    result.put("reconnectRequired", true);
                    result.put("recoveryOnly", true);
                    result.put("restoreError", "The saved account identity could not be verified. Reconnect through the Nextcloud Files app; existing account files are preserved.");
                }
                return result;
            }
        } catch (Exception error) {
            JSObject result = accountResult(null, null);
            result.put("reconnectRequired", true);
            result.put("recoveryOnly", true);
            result.put("restoreError", "The saved account selection could not be read. Reconnect through the Nextcloud Files app; existing account files are preserved.");
            return result;
        }
    }

    private JSObject unavailableAccount() {
        JSObject result = accountResult(null, null); result.put("reconnectRequired", true); result.put("recoveryOnly", true);
        result.put("restoreError", "The saved account selection could not be read. Reconnect through Nextcloud; existing files are preserved."); return result;
    }

    private void rememberAccount(SingleSignOnAccount account) throws Exception {
        checkedAccountIdentity(account.name, account.url, account.userId);
        String server = NativeLoginFlow.normalizeServer(account.url), locator = account.name;
        try {
            NativeLoginFlow.Account current = credentials().current();
            if (current != null && NativeLoginFlow.normalizeServer(current.serverUrl()).equals(server) && current.username().equals(account.userId)) locator = current.name();
        } catch (Exception ignored) { /* A valid new import can recover an unreadable selection. */ }
        credentials().replace(Map.of("name", locator, "serverUrl", server, "username", account.userId, "transport", "sso", "providerName", account.name));
    }

    @PluginMethod
    public void selectAccount(PluginCall call) {
        login().invalidate();
        final long selectionGeneration;
        synchronized (this) { selectionGeneration = ++accountGeneration; }
        getActivity().runOnUiThread(() -> ((MainActivity) getActivity()).chooseNextcloudAccount((account, error) -> {
            if (error != null) { reject(call, error); return; }
            try {
                if (account != null) {
                    publicAccount(account); // Validate before accepting the identity.
                    synchronized (this) {
                        if (selectionGeneration != accountGeneration)
                            throw new BridgeFailure("CANCELLED", "This account selection is no longer active.");
                        // The current session stays active if durable selection fails.
                        rememberAccount(account);
                        NativeSyncRuntime.cancelAll(getContext());
                        closeApi();
                        generation++;
                        accountGeneration++;
                    }
                }
                call.resolve(accountResult(account == null ? null : credentials().current(), "sso"));
            } catch (Exception failure) { reject(call, failure); }
        }));
    }

    @PluginMethod
    public synchronized void disconnect(PluginCall call) {
        login().invalidate();
        NativeSyncRuntime.cancelAll(getContext());
        try { credentials().clearSelection(); } catch (Exception failure) { reject(call, failure); return; }
        generation++;
        accountGeneration++;
        closeApi();
        // These are this application's imported tokens only. Never remove the Files app's account.
        AccountImporter.clearAllAuthTokens(getContext());
        call.resolve();
    }

    @PluginMethod
    public void request(PluginCall call) {
        TimedCall timed = new TimedCall(call);
        final long expected;
        synchronized (this) { expected = generation; }
        try {
            String priority = call.getString("priority", "high");
            if (!"high".equals(priority) && !"low".equals(priority)) { timed.reject(new BridgeFailure("VALIDATION", "Invalid request priority.")); return; }
            timed.pending(requests.submitRead(() -> performRequest(call, timed, expected), "low".equals(priority)), requests);
        } catch (RejectedExecutionException error) {
            timed.reject(new BridgeFailure("NETWORK", "Too many Nextcloud requests are pending. Try refreshing again."));
        }
    }

    private interface LocalWork { JSObject run(TimedCall timed) throws Exception; }
    private void localWork(PluginCall call, ThreadPoolExecutor executor, String stage, LocalWork work) {
        TimedCall timed = new TimedCall(call, stage);
        final long expected; synchronized (this) { expected = accountGeneration; }
        try { timed.pending(executor.submit(() -> {
            try {
                timed.check(); synchronized (this) { if (expected != accountGeneration) throw new BridgeFailure("CANCELLED", "The selected account changed."); }
                JSObject result = work.run(timed);
                timed.check(); synchronized (this) { if (expected != accountGeneration) throw new BridgeFailure("CANCELLED", "The selected account changed."); }
                timed.resolve(result);
            } catch (Exception error) { timed.reject(error); }
        }), executor); }
        catch (RejectedExecutionException busy) { timed.reject(new BridgeFailure("CACHE_WRITE", stage + " is busy. Retry shortly.")); }
    }

    @PluginMethod
    public void configureSync(PluginCall call) {
        localWork(call, controls, "Background sync settings", timed -> {
            var settings = com.google.gson.JsonParser.parseString(call.getObject("settings", new JSObject()).toString()).getAsJsonObject();
            var background = NativeSyncRuntime.configure(getContext(), call.getString("accountName"), settings, timed::check);
            JSObject result = new JSObject(); result.put("background", new JSObject(background.toString())); return result;
        });
    }

    @PluginMethod
    public void confirmSourceReads(PluginCall call) {
        localWork(call,controls,"Source access verification",timed->{var session=NativeSyncRuntime.session(getContext(),call.getString("accountName"));timed.check();NativeSyncRuntime.verifiedReads(session,stringSet(call,"sources"));return new JSObject();});
    }

    @PluginMethod
    public void getSyncState(PluginCall call) {
        localWork(call, controls, "Background sync status", timed -> {
            JSObject result = new JSObject(); result.put("background", new JSObject(NativeSyncRuntime.state(getContext(), call.getString("accountName")).toString())); return result;
        });
    }

    @PluginMethod
    public void resourceCache(PluginCall call) {
        final NativeSyncRuntime.Session captured;
        try { captured = NativeSyncRuntime.session(getContext(), call.getString("accountName")); }
        catch (Exception error) { reject(call, error); return; }
        localWork(call, cacheRequests, "Local source cache", timed -> {
            String operation = call.getString("operation", "");
            NativeSyncRuntime.Session session = captured;
            if ("clear".equals(operation)) captured.check();
            if (NativeSyncRuntime.beforeCacheMaintenance(operation)) session = NativeSyncRuntime.session(getContext(), call.getString("accountName"));
            NativeResourceCache cache = session.cacheBatch(timed::check); JSObject result = new JSObject();
            NativeSyncPolicy.Locator locator = new NativeSyncPolicy.Locator(call.getString("kind"), call.getString("collection"), call.getString("href"));
            switch (operation) {
                case "get": {
                    NativeSyncPolicy.Entry entry = cache.get(locator); result.put("entry", entry == null ? JSONObject.NULL : new JSObject(new Gson().toJson(entry))); break;
                }
                case "getMany": {
                    var keys=call.getArray("locators");if(keys==null||keys.length()>32)throw new BridgeFailure("VALIDATION","A cache lookup may contain at most 32 resources.");
                    List<NativeSyncPolicy.Locator> locators=new java.util.ArrayList<>();
                    for(int i=0;i<keys.length();i++){var key=keys.getJSONObject(i);locators.add(new NativeSyncPolicy.Locator(key.getString("kind"),key.getString("collection"),key.getString("href")));}
                    var batch=cache.getMany(locators);
                    // Raw bodies cross the JS bridge once as one bounded JSON string;
                    // the dedicated worker performs the only JavaScript parse.
                    if(Boolean.TRUE.equals(call.getBoolean("serialized", false))) result.put("entriesJson",new Gson().toJson(batch));
                    else { org.json.JSONArray entries=new org.json.JSONArray();for(var entry:batch)entries.put(entry==null?JSONObject.NULL:new JSObject(new Gson().toJson(entry)));result.put("entries",entries); }
                    break;
                }
                case "list": {
                    result.put("entries",new org.json.JSONArray(new Gson().toJson(cache.list(call.getString("kind"),call.getString("collection")))));break;
                }
                case "put": {
                    NativeSyncPolicy.Entry entry = NativeSyncPolicy.parseEntry(com.google.gson.JsonParser.parseString(call.getObject("entry", new JSObject()).toString()).getAsJsonObject()); cache.put(entry); break;
                }
                case "remove": cache.remove(locator); break;
                case "prune": {
                    String kind = call.getString("kind"), collection = call.getString("collection");
                    NativeSyncPolicy.locator(session.account().serverUrl(), new NativeSyncPolicy.Locator(kind, collection, "dav".equals(kind) ? collection + "validation.ics" : collection + "/stacks"));
                    java.util.Set<String> hrefs = stringSet(call, "hrefs");
                    for (String href : hrefs) NativeSyncPolicy.locator(session.account().serverUrl(), new NativeSyncPolicy.Locator(kind, collection, href));
                    cache.prune(kind, collection, hrefs); break;
                }
                case "retainCollections": {
                    String kind = call.getString("kind"); if (!List.of("dav", "deck").contains(kind)) throw new BridgeFailure("VALIDATION", "Invalid resource cache kind.");
                    java.util.Set<String> collections = stringSet(call, "collections");
                    for (String collection : collections) NativeSyncPolicy.locator(session.account().serverUrl(), new NativeSyncPolicy.Locator(kind, collection, "dav".equals(kind) ? collection + "validation.ics" : collection + "/stacks"));
                    cache.retain(kind, collections); break;
                }
                case "clear": cache.clear(); NativeSyncRuntime.cancelAll(getContext()); session = NativeSyncRuntime.session(getContext(), call.getString("accountName")); break;
                default: throw new BridgeFailure("VALIDATION", "Unknown resource cache operation.");
            }
            timed.check(); session.check(); return result;
        });
    }

    private static java.util.Set<String> stringSet(PluginCall call, String key) throws Exception {
        var array = call.getArray(key); if (array == null || array.length() > 100_000) throw new BridgeFailure("VALIDATION", "A bounded source inventory is required.");
        java.util.Set<String> values = new java.util.HashSet<>();
        for (int i = 0; i < array.length(); i++) { Object value = array.get(i); if (!(value instanceof String) || ((String) value).length() > 16384) throw new BridgeFailure("VALIDATION", "Invalid source inventory entry."); values.add((String) value); }
        return values;
    }

    private void performRequest(PluginCall call, TimedCall timed, long expected) {
        String target = call.getString("url"), name = call.getString("accountName");
        try {
            timed.check();
            String method = call.getString("method", "GET").toUpperCase(Locale.ROOT), body = call.getString("body");
            Map<String, List<String>> headers = requestHeaders(call.getObject("headers", new JSObject()));
            Integer limit = call.getInt("maxBytes", MAX_RESPONSE);
            if (limit == null) throw new BridgeFailure("VALIDATION", "Invalid response size limit.");
            NativeSourceTransport transport;
            synchronized (this) {
                ensureCurrent(name, expected);
                if (sourceTransport == null || sourceTransport.isClosed()) sourceTransport = new NativeSourceTransport(getContext(), NativeSyncRuntime.savedAccount(getContext()), () -> ensureCurrent(name, expected));
                transport = sourceTransport;
            }
            NativeSourceTransport.Reply response = transport.request(target, method, headers, body, limit, timed.remaining());
            ensureCurrent(name, expected);
            if (response.status() == 401) NativeSyncRuntime.cancelAll(getContext());
            if (List.of("PUT", "POST", "DELETE").contains(method) && response.status() >= 200 && response.status() < 300) {
                NativeSyncRuntime.mutated(getContext(), name, target);
            }
            JSObject resultHeaders = new JSObject(); response.headers().forEach(resultHeaders::put);
            timed.resolve(result(response.status(), response.statusSource(), resultHeaders, target, response.body()));
        } catch (Exception error) {
            try { ensureCurrent(name, expected); } catch (BridgeFailure stale) { timed.reject(stale); return; }
            timed.reject(error);
        }
    }

    private synchronized void ensureCurrent(String name, long expected) throws BridgeFailure {
        if (!active || generation != expected || name == null || !name.equals(preferences().getString("name", null)))
            throw new BridgeFailure("CANCELLED", "This request belongs to an inactive app session. Refresh after returning to NextGlance.");
    }

    private SingleSignOnAccount checkedAccount(String name) throws Exception {
        if (name == null || !name.equals(preferences().getString("name", null)))
            throw new BridgeFailure("CANCELLED", "The selected Nextcloud account changed. Refresh the current account.");
        String providerName = preferences().getString("providerName", name);
        if (AccountImporter.getAccountForName(getContext(), providerName) == null)
            throw new BridgeFailure("AUTH", "This account is no longer available in the Nextcloud Files app.");
        SingleSignOnAccount account = AccountImporter.getSingleSignOnAccount(getContext(), providerName);
        publicAccount(account);
        return account;
    }

    private synchronized void closeApi() {
        if (sourceTransport != null) sourceTransport.close();
        sourceTransport = null;
    }

    @Override
    protected synchronized void handleOnStart() { active = true; NativeSyncRuntime.foreground(true); }

    @Override
    protected void handleOnStop() {
        // Release only foreground transport. Scheduled jobs own their independent native session.
        // A late result from that activity generation cannot repopulate a new account/session.
        synchronized (this) { active = false; generation++; attachment=null; closeApi(); }
        NativeSyncRuntime.foreground(false);
    }

    @Override
    protected void handleOnDestroy() {
        login().invalidate();
        synchronized (this) { active = false; generation++; accountGeneration++; attachment=null; closeApi(); }
        NativeSyncRuntime.foreground(false);
        for (TimedCall pending : pendingCalls) pending.cancel();
        requests.shutdownNow();
        accounts.shutdownNow();
        browserAuthorization.shutdownNow();
        cacheRequests.shutdownNow();
        controls.shutdownNow();
        deadlines.shutdownNow();
    }

    private static JSObject publicAccount(SingleSignOnAccount account) throws Exception {
        checkedAccountIdentity(account.name, account.url, account.userId);
        JSObject result = new JSObject();
        result.put("name", account.name);
        result.put("serverUrl", account.url);
        result.put("username", account.userId);
        return result;
    }

    static void checkedAccountIdentity(String name, String server, String username) throws Exception { NativeRequestPolicy.checkedAccountIdentity(name, server, username); }

    private JSObject accountResult(NativeLoginFlow.Account account, String transport) {
        JSObject result = new JSObject();
        result.put("account", account == null ? JSONObject.NULL : publicIdentity(account));
        JSObject capabilities = new JSObject();
        capabilities.put("davReadMode", NativeRequestPolicy.davReadMode(transport));
        String nativeEdits = NativeRequestPolicy.nativeEdits(transport);
        if (nativeEdits != null) capabilities.put("nativeEdits", nativeEdits);
        result.put("capabilities", capabilities);
        if(account!=null)try{result.put("readDenials",new org.json.JSONArray(NativeSyncRuntime.readDenials(getContext(),account).toString()));}catch(Exception error){result.put("readDenials",JSONObject.NULL);}
        return result;
    }

    static URI checkedTarget(String base, String target) throws Exception { return NativeRequestPolicy.checkedTarget(base, target); }
    static void checkedMetadataWrite(String base, String username, String target, String method, Map<String, List<String>> headers, String body) throws Exception { NativeRequestPolicy.checkedMetadataWrite(base, username, target, method, headers, body); }
    private static String trimTrailingSlashes(String value) { return value == null ? "" : value.replaceAll("/+$", ""); }
    private static Map<String, List<String>> requestHeaders(JSObject input) throws Exception {
        Map<String, List<String>> result = new HashMap<>();
        int total = 0;
        for (Iterator<String> keys = input.keys(); keys.hasNext();) {
            String key = keys.next(), lower = key.toLowerCase(Locale.ROOT);
            if (List.of("authorization", "proxy-authorization", "cookie", "host", "connection", "transfer-encoding", "content-length").contains(lower))
                throw new BridgeFailure("VALIDATION", "Authentication and transport headers are owned by the Nextcloud Files app.");
            if ("ocs-apirequest".equals(lower)) continue; // Files adds it and rejects duplicates.
            Object raw = input.get(key);
            if (!(raw instanceof String) || !key.matches("[!#$%&'*+.^_`|~a-zA-Z0-9-]+") || ((String) raw).matches("(?s).*[\\r\\n\\x00].*"))
                throw new BridgeFailure("VALIDATION", "Invalid Nextcloud request header.");
            String value = (String) raw;
            total += key.length() + value.length();
            if (total > 16384 || result.size() >= 32) throw new BridgeFailure("LIMIT", "Too many Nextcloud request headers.");
            result.put(key, Collections.singletonList(value));
        }
        return result;
    }

    private static JSObject result(int status, String statusSource, JSObject headers, String target, byte[] body) {
        JSObject result = new JSObject();
        result.put("status", status);
        result.put("statusSource", statusSource);
        result.put("headers", headers);
        result.put("url", target);
        result.put("urlSource", "requested-no-redirects");
        result.put("bodyBase64", Base64.encodeToString(body, Base64.NO_WRAP));
        return result;
    }

    private static void reject(PluginCall call, Exception error) {
        if (error instanceof NativeLoginFlow.Failure) { call.reject(error.getMessage(), ((NativeLoginFlow.Failure) error).code); return; }
        if (error instanceof BridgeFailure) { call.reject(error.getMessage(), ((BridgeFailure) error).code); return; }
        String name = error.getClass().getSimpleName();
        if (name.contains("NotInstalled")) {
            call.reject("Install the Nextcloud Files app, sign in there, then choose its account here.", "FILES_APP_MISSING");
        } else if (name.contains("NotSupported")) {
            call.reject("Install or update the Nextcloud Files app, sign in there, then choose its account here.", "UNAVAILABLE");
        } else if (name.contains("Permission") || error instanceof SecurityException) {
            call.reject("Nextcloud account access was not granted. Choose the account again and allow access.", "PERMISSION");
        } else if (name.contains("TokenMismatch") || name.contains("AccountNotFound")) {
            call.reject("Nextcloud account authorization expired or was removed. Choose the account again.", "AUTH");
        } else if (name.contains("UnsupportedMethod")) {
            call.reject("The installed Nextcloud Files app does not support this request method.", "UNAVAILABLE");
        } else {
            // Exception text can contain the provider's response, account, or token. Do not expose it.
            call.reject("The Nextcloud Files app could not complete the request. Open it, check its connection, then retry.", "NETWORK");
        }
    }

    private static class BridgeFailure extends Exception {
        final String code;
        BridgeFailure(String code, String message) { super(message); this.code = code; }
    }
}
