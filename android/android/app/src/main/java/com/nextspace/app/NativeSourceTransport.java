package com.nextspace.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.RemoteException;
import com.google.gson.Gson;
import com.nextcloud.android.sso.AccountImporter;
import com.nextcloud.android.sso.QueryParam;
import com.nextcloud.android.sso.aidl.NextcloudRequest;
import com.nextcloud.android.sso.api.AidlNetworkRequest;
import com.nextcloud.android.sso.api.NextcloudAPI;
import com.nextcloud.android.sso.api.Response;
import com.nextcloud.android.sso.exceptions.NextcloudApiNotRespondingException;
import com.nextcloud.android.sso.exceptions.NextcloudHttpRequestFailedException;
import com.nextcloud.android.sso.model.SingleSignOnAccount;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

/** Native account-bound I/O usable by a foreground plugin or a JobService, never a hidden WebView. */
final class NativeSourceTransport implements AutoCloseable {
    record Reply(int status, String statusSource, Map<String, String> headers, byte[] body) {}
    private final Context context;
    private final SharedPreferences preferences;
    private final NativeLoginFlow.Account account;
    private final NativeResourceCache.Guard guard;
    private final NativeDeadline.Lane lane;
    private final NativeHttp http = new NativeHttp();
    private final java.util.Set<InputStream> bodyStreams = java.util.concurrent.ConcurrentHashMap.newKeySet();
    private final java.util.Set<NativeRequestCancellation> requests = java.util.concurrent.ConcurrentHashMap.newKeySet();
    private record FilesConnection(NextcloudAPI api, AtomicReference<Exception> bindingError) {}
    private final AtomicReference<FilesConnection> filesConnection = new AtomicReference<>();
    private final AtomicBoolean filesRequestRunning = new AtomicBoolean();
    private final AtomicBoolean closed = new AtomicBoolean();
    boolean isClosed() { return closed.get(); }
    NativeSourceTransport(Context context, NativeLoginFlow.Account account, NativeResourceCache.Guard guard) {
        this(context, account, guard, NativeDeadline.Lane.FOREGROUND);
    }
    NativeSourceTransport(Context context, NativeLoginFlow.Account account, NativeResourceCache.Guard guard, NativeDeadline.Lane lane) {
        this.context = context.getApplicationContext(); this.account = account; this.guard = guard;
        this.lane = lane;
        preferences = this.context.getSharedPreferences("nextspace-account-selection", Context.MODE_PRIVATE);
    }
    Reply request(String target, String method, Map<String, List<String>> headers, String body, int max, long deadline) throws Exception {
        if (max < 1 || max > NativeSyncPolicy.RESPONSE_BYTES) throw NativeSyncPolicy.failure("VALIDATION", "Invalid response size limit.");
        check();
        String transport = selectedTransport();
        NativeRequestCancellation cancellation = new NativeRequestCancellation(); requests.add(cancellation);
        try { return run(transport, () -> perform(transport, target, method, headers, body, null, max, cancellation), cancellation, deadline); }
        catch (NativeLoginFlow.Failure known) { throw known; }
        catch (Exception error) {
            String name = error.getClass().getSimpleName();
            if (name.contains("TokenMismatch") || name.contains("AccountNotFound")) throw NativeSyncPolicy.failure("AUTH", "Nextcloud account authorization expired or was removed. Reconnect to continue.");
            if (name.contains("Permission") || error instanceof SecurityException) throw NativeSyncPolicy.failure("PERMISSION", "Nextcloud Files access was revoked. Reconnect and allow access.");
            if (name.contains("NotInstalled") || name.contains("NotSupported")) throw NativeSyncPolicy.failure("UNAVAILABLE", "Nextcloud Files is unavailable. Open or update it, then reconnect.");
            throw error;
        } finally { requests.remove(cancellation); }
    }
    Reply upload(String board,String stack,String card,String name,InputStream file,long size,long deadline)throws Exception{
        for(String id:List.of(board,stack,card))if(!id.matches("[1-9]\\d{0,15}")||Double.parseDouble(id)>9007199254740991d)throw NativeSyncPolicy.failure("VALIDATION","Choose a valid Deck card.");
        String target=account.serverUrl()+"/index.php/apps/deck/api/v1.1/boards/"+board+"/stacks/"+stack+"/cards/"+card+"/attachments",boundary="NextGlance-"+java.util.UUID.randomUUID();
        String transport = selectedTransport();
        NativeRequestCancellation cancellation=new NativeRequestCancellation();requests.add(cancellation);
        try(InputStream input=NativeMultipart.stream(name,file,size,boundary)){
            Reply result=run(transport,()->perform(transport,target,"POST",Map.of("Content-Type",List.of("multipart/form-data; boundary="+boundary)),null,input,1024*1024,cancellation),cancellation,deadline);
            if(result.status()<200||result.status()>=300)throw NativeSyncPolicy.failure(result.status()==401?"AUTH":result.status()==403?"PERMISSION":"NEXTCLOUD","Nextcloud did not accept the attachment.");return result;
        }finally{requests.remove(cancellation);}
    }
    private String selectedTransport() { return preferences.getString("transport", "sso"); }
    private <T> T run(String transport, Callable<T> work, NativeRequestCancellation cancellation, long deadline) throws Exception {
        return "direct".equals(transport) ? NativeDeadline.run(lane, work, cancellation::cancel, deadline)
                : NativeDeadline.runFiles(work, cancellation::cancel, deadline);
    }
    private void check() throws Exception { guard.check(); if (closed.get() || Thread.currentThread().isInterrupted()) throw NativeSyncPolicy.failure("CANCELLED", "The source request was cancelled."); }
    private Reply perform(String transport, String target, String method, Map<String, List<String>> headers, String body, InputStream upload, int max, NativeRequestCancellation cancellation) throws Exception {
        check(); cancellation.check();
        if (!transport.equals(selectedTransport())) throw NativeSyncPolicy.failure("CANCELLED", "The selected connection method changed.");
        if(upload==null)NativeRequestPolicy.checkedRequest(transport, account.serverUrl(), account.username(), target, method, headers, body);
        else {NativeRequestPolicy.checkedTarget(account.serverUrl(),target);cancellation.attach(()->NativeDeadline.cleanup(()->{try{upload.close();}catch(Exception ignored){}}));}
        if ("direct".equals(transport)) {
            NativeLoginFlow.Credential credential = new NativeCredentialStore(preferences).read(); check();
            if (!credential.account().equals(account)) throw NativeSyncPolicy.failure("CANCELLED", "The selected account changed.");
            NativeHttp.Response response = upload==null?http.request(account.serverUrl(), target, method, headers, body, credential, max, cancellation):http.upload(account.serverUrl(),target,headers,upload,credential,max,cancellation); check(); cancellation.check();
            return new Reply(response.status(), "native-http", response.headers(), response.body());
        }
        filesRequestRunning.set(true);
        try {
            return performFiles(target, method, headers, body, upload, max, cancellation);
        } catch (RemoteException | NextcloudApiNotRespondingException unavailable) {
            check(); cancellation.check();
            closeFilesConnection();
            throw NativeDeadline.filesUnavailable();
        } catch (NativeLoginFlow.Failure error) {
            if ("FILES_TRANSPORT".equals(error.code)) closeFilesConnection();
            throw error;
        } finally {
            filesRequestRunning.set(false);
            if (closed.get()) closeFilesConnection();
        }
    }
    private Reply performFiles(String target, String method, Map<String, List<String>> headers, String body, InputStream upload, int max, NativeRequestCancellation cancellation) throws Exception {
        NextcloudAPI client = client(); check(); cancellation.check();
        URI uri = NativeRequestPolicy.checkedTarget(account.serverUrl(), target);
        String path = uri.getRawPath().substring(new URI(account.serverUrl()).getRawPath().replaceAll("/+$", "").length());
        List<QueryParam> query = new ArrayList<>();
        if (uri.getRawQuery() != null) for (String pair : uri.getRawQuery().split("&")) { String[] parts = pair.split("=", 2); query.add(new QueryParam(URLDecoder.decode(parts[0], "UTF-8"), parts.length == 2 ? URLDecoder.decode(parts[1], "UTF-8") : "")); }
        NextcloudRequest.Builder builder = new NextcloudRequest.Builder().setMethod(method).setUrl(path.isEmpty() ? "/" : path).setParameter(query).setHeader(headers).setFollowRedirects(false);
        if(upload==null)builder.setRequestBody(body);else builder.setRequestBodyAsStream(upload);
        NextcloudRequest request=builder.build();
        Response response;
        try { response = client.performNetworkRequestV2(request); }
        catch (NextcloudHttpRequestFailedException error) {
            check(); cancellation.check(); int status = error.getStatusCode();
            if (status < 100 || status > 599) throw NativeSyncPolicy.failure("FORMAT", "The Files app returned an invalid HTTP status.");
            if (status >= 300 && status < 400 && status != 304) throw NativeSyncPolicy.failure("REDIRECT", "Nextcloud redirected the request. Check the server address.");
            return new Reply(status, "sso-error", Map.of(), new byte[0]);
        }
        InputStream stream = response.getBody();
        if (stream != null) {
            bodyStreams.add(stream);
            cancellation.attach(() -> NativeDeadline.cleanup(() -> { try { stream.close(); } catch (Exception ignored) {} }));
        }
        try (InputStream input = stream) {
            check(); cancellation.check(); Map<String, String> outputHeaders = headers(response); String length = outputHeaders.get("content-length");
            if (length != null) try { if (Long.parseLong(length) > max) throw NativeSyncPolicy.failure("LIMIT", "The Nextcloud response is too large."); } catch (NumberFormatException invalid) { throw NativeSyncPolicy.failure("FORMAT", "Nextcloud returned an invalid response length."); }
            ByteArrayOutputStream output = new ByteArrayOutputStream(); byte[] buffer = new byte[8192];
            if (input != null) for (int count; (count = input.read(buffer)) != -1;) { check(); cancellation.check(); if (output.size() + count > max) throw NativeSyncPolicy.failure("LIMIT", "The Nextcloud response is too large."); output.write(buffer, 0, count); }
            check(); cancellation.check(); return new Reply(200, "sso-success", outputHeaders, output.toByteArray());
        } finally { cancellation.release(); if (stream != null) bodyStreams.remove(stream); }
    }
    private NextcloudAPI client() throws Exception {
        check(); FilesConnection connection = filesConnection.get();
        if (connection == null) {
            String providerName = preferences.getString("providerName", account.name());
            if (AccountImporter.getAccountForName(context, providerName) == null) throw NativeSyncPolicy.failure("AUTH", "The selected account is no longer available in Nextcloud Files. Reconnect to continue.");
            SingleSignOnAccount provider = AccountImporter.getSingleSignOnAccount(context, providerName);
            NativeRequestPolicy.checkedAccountIdentity(provider.name, provider.url, provider.userId);
            if (!NativeLoginFlow.normalizeServer(provider.url).equals(NativeLoginFlow.normalizeServer(account.serverUrl())) || !provider.userId.equals(account.username())) throw NativeSyncPolicy.failure("AUTH", "Nextcloud Files returned another account. Reconnect to continue.");
            check();
            AtomicReference<Exception> bindingError = new AtomicReference<>();
            try {
                NextcloudAPI api = new NextcloudAPI(context, provider, new Gson(), new NextcloudAPI.ApiConnectedListener() {
                    @Override public void onConnected() { bindingError.set(null); }
                    @Override public void onError(Exception error) { bindingError.set(error); }
                });
                connection = new FilesConnection(api, bindingError);
                filesConnection.set(connection);
            } catch (IllegalStateException bindFailed) { throw NativeDeadline.filesUnavailable(); }
        }
        if (connection.bindingError().get() != null) throw NativeDeadline.filesUnavailable();
        return connection.api();
    }
    private static Map<String, String> headers(Response response) throws Exception {
        Map<String, String> result = new LinkedHashMap<>(); int bytes = 0;
        for (AidlNetworkRequest.PlainHeader header : response.getPlainHeaders()) {
            if (header.getName() == null || header.getValue() == null) continue;
            String key = header.getName().toLowerCase(Locale.ROOT), value = header.getValue();
            if (!List.of("content-type", "content-length", "etag", "last-modified", "date", "retry-after", "content-location", "location", "x-nc-attribute", "oc-fileid", "oc-etag").contains(key)) continue;
            bytes += key.length() + value.length(); if (bytes > 65536) throw NativeSyncPolicy.failure("LIMIT", "Too many Nextcloud response headers.");
            if ("etag".equals(key) && result.containsKey(key) && !result.get(key).equals(value)) throw NativeSyncPolicy.failure("FORMAT", "Nextcloud returned conflicting version headers.");
            result.put(key, result.containsKey(key) && !"etag".equals(key) ? result.get(key) + ", " + value : value);
        }
        return result;
    }
    private void closeFilesConnection() {
        FilesConnection connection = filesConnection.getAndSet(null);
        if (connection != null) NativeDeadline.cleanup(() -> { try { connection.api().close(); } catch (Exception ignored) {} });
    }
    @Override public void close() {
        if (!closed.compareAndSet(false, true)) return;
        for (NativeRequestCancellation request : requests) request.cancel(); http.cancel();
        // Provider pipe close/unbind can also stall. Signal cancellation now; bounded cleanup
        // must not occupy the authorization, deadline, Activity, or cache thread.
        InputStream[] streams = bodyStreams.toArray(new InputStream[0]); bodyStreams.clear();
        if (streams.length != 0) NativeDeadline.cleanup(() -> {
            for (InputStream stream : streams) try { stream.close(); } catch (Exception ignored) {}
        });
        // Do not clear the SDK's Binder or Context while it is inside a call.
        if (!filesRequestRunning.get()) closeFilesConnection();
    }
}
