package com.nextspace.app;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.function.LongSupplier;
import java.util.function.Supplier;

/** Pure authorization state machine. Network, protected storage, clock and IDs are host ports. */
final class NativeLoginFlow {
    static final long LIFETIME = 600_000;
    record Account(String name, String serverUrl, String username) {}
    record Credential(Account account, String loginName, String appPassword) {}
    record Reply(int status, String body) {}
    record Started(String flowId, String loginUrl) {}
    record Polled(boolean pending, Account account) {}
    interface Network { Reply request(String base, String target, String method, String body, Credential credential) throws Exception; }
    interface Store {
        void checkAvailable() throws Exception;
        Account current() throws Exception;
        void commit(Credential credential) throws Exception;
    }
    static final class Failure extends Exception {
        final String code;
        Failure(String code, String message) { super(message); this.code = code; }
    }
    private record Flow(String id, String server, String endpoint, String token, long deadline, long epoch) {}
    private final Network network;
    private final Store store;
    private final LongSupplier clock;
    private final Supplier<String> ids;
    private long epoch;
    private Flow flow;
    private boolean polling;
    private String committedFlow;
    private Account committedAccount;
    private Credential pendingCredential;

    NativeLoginFlow(Network network, Store store, LongSupplier clock, Supplier<String> ids) {
        this.network = network; this.store = store; this.clock = clock; this.ids = ids;
    }
    Started begin(String rawServer) throws Exception {
        final long started;
        synchronized (this) { invalidate(); started = epoch; }
        String server = normalizeServer(rawServer);
        store.checkAvailable();
        JsonObject json = document(network.request(server, server + "/index.php/login/v2", "POST", "", null));
        String login = text(json, "login", 16384);
        JsonObject poll = json.has("poll") && json.get("poll").isJsonObject() ? json.getAsJsonObject("poll") : new JsonObject();
        String endpoint = text(poll, "endpoint", 16384), token = text(poll, "token", 16384);
        NativeRequestPolicy.checkedTarget(server, login);
        NativeRequestPolicy.checkedTarget(server, endpoint);
        synchronized (this) {
            if (started != epoch || Thread.currentThread().isInterrupted()) throw cancelled();
            String id = ids.get();
            if (id == null || !id.matches("[A-Za-z0-9-]{1,128}")) throw new Failure("FORMAT", "The authorization flow could not be created.");
            flow = new Flow(id, server, endpoint, token, clock.getAsLong() + LIFETIME, started);
            return new Started(id, login);
        }
    }
    Polled poll(String id) throws Exception {
        final Flow selected;
        synchronized (this) {
            if (id != null && id.equals(committedFlow)) return new Polled(false, committedAccount);
            selected = current(id);
            if (polling) return new Polled(true, null);
            polling = true;
        }
        try {
            Credential candidate;
            synchronized (this) { current(id); candidate = pendingCredential; }
            if (candidate == null) {
                Reply reply = network.request(selected.server, selected.endpoint, "POST", "token=" + URLEncoder.encode(selected.token, "UTF-8"), null);
                synchronized (this) { current(id); }
                if (reply.status == 404) return new Polled(true, null);
                try {
                    JsonObject json = document(reply);
                    String returnedServer = normalizeServer(text(json, "server", 4096));
                    if (!returnedServer.equals(selected.server)) throw new Failure("SECURITY", "Nextcloud returned a different server address. Use its final address and try again.");
                    String loginName = text(json, "loginName", 512), password = text(json, "appPassword", 4096);
                    if (loginName.contains(":")) throw new Failure("FORMAT", "Nextcloud returned an invalid account name.");
                    candidate = new Credential(new Account("candidate", returnedServer, loginName), loginName, password);
                    synchronized (this) { current(id); pendingCredential = candidate; }
                } catch (Exception error) {
                    // A successful poll is single-use. Malformed credentials cannot
                    // turn into endless pending responses on a consumed endpoint.
                    if (reply.status >= 200 && reply.status <= 299) synchronized (this) { if (flow == selected) invalidate(); }
                    throw error;
                }
            }
            String server = candidate.account.serverUrl;
            JsonObject userDocument = document(network.request(server, server + "/ocs/v2.php/cloud/user?format=json", "GET", null, candidate));
            JsonObject ocs = object(userDocument, "ocs"), meta = object(ocs, "meta");
            int status = meta.has("statuscode") ? meta.get("statuscode").getAsInt() : 0;
            if (status != 100 && status != 200) throw new Failure("AUTH", "Nextcloud could not verify the authorized account.");
            String canonical = text(object(ocs, "data"), "id", 512);
            synchronized (this) {
                current(id);
                Account previous;
                try { previous = store.current(); } catch (Exception unavailableIdentity) { previous = null; }
                String name = previous != null && server.equals(normalizeServer(previous.serverUrl)) && canonical.equals(previous.username)
                        ? previous.name : "nextspace-direct:" + digest(server + '\0' + canonical);
                Account account = new Account(name, server, canonical);
                store.commit(new Credential(account, candidate.loginName, candidate.appPassword));
                // Commit and cancellation serialize: cancellation can report, never undo, a committed result.
                committedFlow = id; committedAccount = account; flow = null; pendingCredential = null;
                return new Polled(false, account);
            }
        } finally { synchronized (this) { if (selected.epoch == epoch) polling = false; } }
    }
    synchronized Account cancel(String id) {
        if (committedFlow != null && (id == null || committedFlow.equals(id))) return committedAccount;
        if (id == null || flow != null && flow.id.equals(id)) invalidate();
        return null;
    }
    synchronized void invalidate() { epoch++; flow = null; polling = false; committedFlow = null; committedAccount = null; pendingCredential = null; }
    private Flow current(String id) throws Failure {
        if (Thread.currentThread().isInterrupted()) throw cancelled();
        if (flow == null || id == null || !flow.id.equals(id) || flow.epoch != epoch) throw cancelled();
        if (clock.getAsLong() >= flow.deadline) { invalidate(); throw new Failure("EXPIRED", "Authorization expired. Start sign-in again."); }
        return flow;
    }
    private static Failure cancelled() { return new Failure("CANCELLED", "This authorization flow is no longer active."); }
    static String normalizeServer(String raw) throws Exception {
        if (raw == null) throw new Failure("VALIDATION", "Enter your Nextcloud server address.");
        String value = raw.trim().replaceAll("/+$", "");
        URI uri = NativeRequestPolicy.checkedTarget(value, value);
        String host = uri.getHost().toLowerCase(java.util.Locale.ROOT);
        int port = uri.getPort();
        if (port == ("https".equals(uri.getScheme()) ? 443 : 80)) port = -1;
        return new URI(uri.getScheme().toLowerCase(java.util.Locale.ROOT), null, host, port, uri.getPath(), null, null).toASCIIString();
    }
    static String digest(String value) throws Exception {
        byte[] bytes = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
        StringBuilder hex = new StringBuilder(64);
        for (byte current : bytes) hex.append(Character.forDigit((current >>> 4) & 15, 16)).append(Character.forDigit(current & 15, 16));
        return hex.toString();
    }
    static JsonObject document(Reply reply) throws Failure {
        if (reply.status == 401 || reply.status == 403) throw new Failure("AUTH", "Nextcloud authorization was denied. Start sign-in again.");
        if (reply.status < 200 || reply.status > 299) throw new Failure("NETWORK", "Nextcloud could not complete authorization. Check the server address and retry.");
        try { return JsonParser.parseString(reply.body).getAsJsonObject(); }
        catch (RuntimeException error) { throw new Failure("FORMAT", "Nextcloud returned an invalid authorization response."); }
    }
    private static JsonObject object(JsonObject value, String name) throws Failure {
        if (!value.has(name) || !value.get(name).isJsonObject()) throw new Failure("FORMAT", "Nextcloud returned incomplete account information.");
        return value.getAsJsonObject(name);
    }
    private static String text(JsonObject value, String name, int max) throws Failure {
        if (!value.has(name) || !value.get(name).isJsonPrimitive() || !value.getAsJsonPrimitive(name).isString()) throw new Failure("FORMAT", "Nextcloud returned incomplete authorization information.");
        String result = value.get(name).getAsString();
        if (result.trim().isEmpty() || result.length() > max || result.chars().anyMatch(c -> c < 32 || c == 127)) throw new Failure("FORMAT", "Nextcloud returned invalid authorization information.");
        return result;
    }
}
