package com.nextspace.app;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;

/** Private native network port. Redirects/cookies/retries never carry authorization elsewhere. */
final class NativeHttp implements NativeLoginFlow.Network {
    record Response(int status, Map<String, String> headers, byte[] body) {}
    private final OkHttpClient client = new OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
            .retryOnConnectionFailure(false).connectTimeout(15, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS)
            .callTimeout(40, TimeUnit.SECONDS).build();
    void cancel() { client.dispatcher().cancelAll(); }
    @Override public NativeLoginFlow.Reply request(String base, String target, String method, String body, NativeLoginFlow.Credential credential) throws Exception {
        Map<String, List<String>> headers = Map.of("Accept", List.of("application/json"), "Content-Type", List.of("application/x-www-form-urlencoded"));
        Response response = request(base, target, method, headers, body, credential, 1024 * 1024);
        return new NativeLoginFlow.Reply(response.status, new String(response.body, StandardCharsets.UTF_8));
    }
    Response request(String base, String target, String method, Map<String, List<String>> headers, String body, NativeLoginFlow.Credential credential, int maxBytes) throws Exception {
        return request(base, target, method, headers, body, credential, maxBytes, null);
    }
    Response request(String base, String target, String method, Map<String, List<String>> headers, String body, NativeLoginFlow.Credential credential, int maxBytes, NativeRequestCancellation cancellation) throws Exception {
        RequestBody payload = body == null && !List.of("POST", "PUT", "PATCH").contains(method) ? null : RequestBody.create(body == null ? "" : body, (MediaType) null);
        return requestBody(base,target,method,headers,payload,credential,maxBytes,cancellation);
    }
    Response upload(String base,String target,Map<String,List<String>> headers,InputStream input,NativeLoginFlow.Credential credential,int maxBytes,NativeRequestCancellation cancellation)throws Exception{
        RequestBody payload=new RequestBody(){public MediaType contentType(){return null;}public void writeTo(okio.BufferedSink sink)throws java.io.IOException{byte[] buffer=new byte[8192];for(int n;(n=input.read(buffer))!=-1;){try{cancellation.check();}catch(Exception error){throw new java.io.IOException("Upload cancelled.",error);}sink.write(buffer,0,n);}}};
        return requestBody(base,target,"POST",headers,payload,credential,maxBytes,cancellation);
    }
    private Response requestBody(String base,String target,String method,Map<String,List<String>> headers,RequestBody payload,NativeLoginFlow.Credential credential,int maxBytes,NativeRequestCancellation cancellation)throws Exception{
        NativeRequestPolicy.checkedTarget(base, target);
        Request.Builder request = new Request.Builder().url(target).header("User-Agent", "NextGlance/0.6.0 Android").header("OCS-APIRequest", "true");
        for (Map.Entry<String, List<String>> entry : headers.entrySet()) request.header(entry.getKey(), String.join(", ", entry.getValue()));
        if (credential != null) request.header("Authorization", "Basic " + android.util.Base64.encodeToString((credential.loginName() + ":" + credential.appPassword()).getBytes(StandardCharsets.UTF_8), android.util.Base64.NO_WRAP));
        request.method(method, payload);
        okhttp3.Call call = client.newCall(request.build());
        if (cancellation != null) { cancellation.attach(call::cancel); cancellation.check(); }
        try (okhttp3.Response response = call.execute()) {
            if (cancellation != null) cancellation.check();
            if (response.code() >= 300 && response.code() < 400 && response.code() != 304)
                throw new NativeLoginFlow.Failure("REDIRECT", "Nextcloud redirected the request. Use the final server address and sign in again.");
            Map<String, String> outputHeaders = new LinkedHashMap<>();
            int headerBytes = 0;
            for (String name : response.headers().names()) {
                String lower = name.toLowerCase(Locale.ROOT);
                if (!List.of("content-type", "content-length", "etag", "last-modified", "date", "retry-after", "content-location", "location", "x-nc-attribute", "oc-fileid", "oc-etag").contains(lower)) continue;
                List<String> values = response.headers(name);
                if ("etag".equals(lower) && values.stream().distinct().count() > 1) throw new NativeLoginFlow.Failure("FORMAT", "Nextcloud returned conflicting version headers.");
                String value = String.join(", ", values);
                headerBytes += lower.length() + value.length();
                if (headerBytes > 65536) throw new NativeLoginFlow.Failure("LIMIT", "Too many Nextcloud response headers.");
                outputHeaders.put(lower, value);
            }
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            if (response.body() != null) {
                if (response.body().contentLength() > maxBytes) throw new NativeLoginFlow.Failure("LIMIT", "The Nextcloud response exceeds the size limit.");
                try (InputStream input = response.body().byteStream()) {
                    byte[] buffer = new byte[8192];
                    for (int count; (count = input.read(buffer)) != -1;) {
                        if (cancellation != null) cancellation.check();
                        if (bytes.size() + count > maxBytes) throw new NativeLoginFlow.Failure("LIMIT", "The Nextcloud response exceeds the size limit.");
                        bytes.write(buffer, 0, count);
                    }
                }
            }
            if (cancellation != null) cancellation.check();
            return new Response(response.code(), outputHeaders, bytes.toByteArray());
        } finally { if (cancellation != null) cancellation.release(); }
    }
}
