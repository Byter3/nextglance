package com.nextspace.app;

import static org.junit.Assert.*;
import org.junit.Test;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

/** Production pure flow against deterministic ports; no real account or Android storage. */
public class NativeLoginFlowTest {
    private static final String SERVER = "https://cloud.example/nc";
    private static final String BEGIN = "{\"login\":\"" + SERVER + "/login/flow\",\"poll\":{\"endpoint\":\"" + SERVER + "/poll\",\"token\":\"private-poll-token\"}}";
    private static final String COMPLETE = "{\"server\":\"" + SERVER + "\",\"loginName\":\"login-alias\",\"appPassword\":\"fixture-app-token\"}";
    private static final String USER = "{\"ocs\":{\"meta\":{\"statuscode\":200},\"data\":{\"id\":\"canonical\"}}}";
    static class Storage implements NativeLoginFlow.Store {
        NativeLoginFlow.Account account;
        NativeLoginFlow.Credential credential;
        boolean available = true, failCommit;
        public void checkAvailable() throws Exception { if (!available) throw new Exception("fixture storage unavailable"); }
        public NativeLoginFlow.Account current() { return account; }
        public void commit(NativeLoginFlow.Credential next) throws Exception { if (failCommit) throw new Exception("fixture commit failure"); credential = next; account = next.account(); }
    }
    static class Network implements NativeLoginFlow.Network {
        int pollStatus = 200, requests;
        String begin = BEGIN, complete = COMPLETE, user = USER;
        public NativeLoginFlow.Reply request(String base, String target, String method, String body, NativeLoginFlow.Credential credential) throws Exception {
            requests++;
            if (target.endsWith("/index.php/login/v2")) { assertNull(credential); return new NativeLoginFlow.Reply(200, begin); }
            if (target.endsWith("/poll")) { assertNull(credential); assertEquals("token=private-poll-token", body); return new NativeLoginFlow.Reply(pollStatus, complete); }
            assertEquals(SERVER + "/ocs/v2.php/cloud/user?format=json", target);
            assertEquals("login-alias", credential.loginName());
            return new NativeLoginFlow.Reply(200, user);
        }
    }
    private NativeLoginFlow flow(Network network, Storage store, AtomicLong clock) { return new NativeLoginFlow(network, store, clock::get, () -> "flow-1"); }
    @Test public void commitsOnlyCanonicalIdentityAndPrivateCredential() throws Exception {
        Storage store = new Storage(); Network network = new Network(); NativeLoginFlow flow = flow(network, store, new AtomicLong());
        NativeLoginFlow.Started started = flow.begin(SERVER + "/");
        assertEquals("flow-1", started.flowId()); assertEquals(SERVER + "/login/flow", started.loginUrl());
        NativeLoginFlow.Polled result = flow.poll(started.flowId());
        assertFalse(result.pending()); assertEquals("canonical", result.account().username());
        assertEquals("nextspace-direct:" + NativeLoginFlow.digest(SERVER + '\0' + "canonical"), result.account().name());
        assertEquals(3, network.requests); assertEquals(result.account(), flow.cancel(started.flowId()));
    }
    @Test public void sameCanonicalAccountReusesProviderCacheLocator() throws Exception {
        Storage store = new Storage(); store.account = new NativeLoginFlow.Account("existing-files-provider", SERVER, "canonical");
        NativeLoginFlow flow = flow(new Network(), store, new AtomicLong()); flow.begin(SERVER, store.account);
        assertEquals("existing-files-provider", flow.poll("flow-1").account().name());
    }
    @Test public void switchingTransportRejectsAnotherBrowserUserBeforeCommitting() throws Exception {
        Storage store = new Storage();
        NativeLoginFlow.Account expected = new NativeLoginFlow.Account("existing-files-provider", SERVER, "original");
        store.account = expected;
        NativeLoginFlow flow = flow(new Network(), store, new AtomicLong()); flow.begin(SERVER, expected);
        assertEquals("AUTH", assertThrows(NativeLoginFlow.Failure.class, () -> flow.poll("flow-1")).code);
        assertEquals(expected, store.account);
        assertNull(store.credential);
        assertNull(flow.cancel("flow-1"));
    }
    @Test public void switchingTransportRejectsAChangedSelectionBeforeStartingOrCommitting() throws Exception {
        Storage store = new Storage(); Network network = new Network();
        NativeLoginFlow.Account expected = new NativeLoginFlow.Account("existing-files-provider", SERVER, "canonical");
        NativeLoginFlow.Account other = new NativeLoginFlow.Account("new-files-provider", SERVER, "other");
        store.account = other;
        NativeLoginFlow flow = flow(network, store, new AtomicLong());
        assertEquals("CANCELLED", assertThrows(NativeLoginFlow.Failure.class, () -> flow.begin(SERVER, expected)).code);
        assertEquals(0, network.requests);
        store.account = expected;
        flow.begin(SERVER, expected);
        store.account = other;
        assertEquals("CANCELLED", assertThrows(NativeLoginFlow.Failure.class, () -> flow.poll("flow-1")).code);
        assertEquals(other, store.account);
        assertNull(store.credential);
    }
    @Test public void pending404LeavesPriorAccountAndSecretsUncommitted() throws Exception {
        Storage store = new Storage(); store.account = new NativeLoginFlow.Account("old", SERVER, "old-user");
        Network network = new Network(); network.pollStatus = 404;
        NativeLoginFlow flow = flow(network, store, new AtomicLong()); flow.begin(SERVER);
        assertTrue(flow.poll("flow-1").pending()); assertEquals("old", store.account.name()); assertNull(store.credential);
        assertNull(flow.cancel("flow-1")); assertThrows(NativeLoginFlow.Failure.class, () -> flow.poll("flow-1"));
    }
    @Test public void expiryAndReplacementInvalidateOldFlow() throws Exception {
        Storage store = new Storage(); AtomicLong clock = new AtomicLong(); NativeLoginFlow flow = flow(new Network(), store, clock);
        flow.begin(SERVER); clock.set(NativeLoginFlow.LIFETIME);
        assertEquals("EXPIRED", assertThrows(NativeLoginFlow.Failure.class, () -> flow.poll("flow-1")).code); assertNull(store.credential);
        flow.begin(SERVER); flow.invalidate(); assertThrows(NativeLoginFlow.Failure.class, () -> flow.poll("flow-1"));
    }
    @Test public void unavailableVaultFailsBeforeCreatingRemoteFlow() {
        Storage store = new Storage(); store.available = false; Network network = new Network(); NativeLoginFlow flow = flow(network, store, new AtomicLong());
        assertThrows(Exception.class, () -> flow.begin(SERVER)); assertEquals(0, network.requests);
    }
    @Test public void unsafeReturnedEndpointsAndDifferentInstallationAreRejected() throws Exception {
        Storage store = new Storage(); Network network = new Network(); network.begin = BEGIN.replace(SERVER + "/poll", "https://evil.example/poll");
        NativeLoginFlow flow = flow(network, store, new AtomicLong()); assertThrows(Exception.class, () -> flow.begin(SERVER));
        network.begin = BEGIN; network.complete = COMPLETE.replace(SERVER, SERVER + "/other"); flow.begin(SERVER);
        assertEquals("SECURITY", assertThrows(NativeLoginFlow.Failure.class, () -> flow.poll("flow-1")).code); assertNull(store.credential);
    }
    @Test public void failedIdentityOrStoragePreservesPriorSelection() throws Exception {
        Storage store = new Storage(); store.account = new NativeLoginFlow.Account("old", SERVER, "old"); Network network = new Network(); network.user = "{}";
        NativeLoginFlow flow = flow(network, store, new AtomicLong()); flow.begin(SERVER); assertThrows(Exception.class, () -> flow.poll("flow-1"));
        assertEquals("old", store.account.name()); network.user = USER; store.failCommit = true;
        assertThrows(Exception.class, () -> flow.poll("flow-1")); assertEquals("old", store.account.name());
    }
    @Test public void retriesCanonicalLookupWithoutConsumingSingleUsePollAgain() throws Exception {
        Storage store = new Storage(); Network network = new Network(); network.user = "{}";
        NativeLoginFlow flow = flow(network, store, new AtomicLong()); flow.begin(SERVER);
        assertThrows(Exception.class, () -> flow.poll("flow-1")); assertEquals(3, network.requests);
        network.user = USER; network.pollStatus = 404;
        assertFalse(flow.poll("flow-1").pending()); assertEquals(4, network.requests);
        assertEquals("canonical", store.account.username());
    }
    @Test public void malformedSuccessfulPollTerminatesRatherThanPollingConsumedToken() throws Exception {
        Storage store = new Storage(); Network network = new Network(); network.complete = "{}";
        NativeLoginFlow flow = flow(network, store, new AtomicLong()); flow.begin(SERVER);
        assertEquals("FORMAT", assertThrows(NativeLoginFlow.Failure.class, () -> flow.poll("flow-1")).code);
        assertEquals("CANCELLED", assertThrows(NativeLoginFlow.Failure.class, () -> flow.poll("flow-1")).code);
        assertEquals(2, network.requests); assertNull(store.credential);
    }
    @Test public void cancellationDuringPollingCannotCommitLateCredentials() throws Exception {
        Storage store = new Storage(); CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
        Network network = new Network() { @Override public NativeLoginFlow.Reply request(String base, String target, String method, String body, NativeLoginFlow.Credential credential) throws Exception {
            if (target.endsWith("/poll")) { entered.countDown(); assertTrue(release.await(2, TimeUnit.SECONDS)); }
            return super.request(base, target, method, body, credential);
        }};
        NativeLoginFlow flow = flow(network, store, new AtomicLong()); flow.begin(SERVER);
        java.util.concurrent.CompletableFuture<Exception> pending = java.util.concurrent.CompletableFuture.supplyAsync(() -> { try { flow.poll("flow-1"); return null; } catch (Exception error) { return error; } });
        assertTrue(entered.await(2, TimeUnit.SECONDS)); flow.cancel("flow-1"); release.countDown();
        assertEquals("CANCELLED", ((NativeLoginFlow.Failure) pending.get(2, TimeUnit.SECONDS)).code); assertNull(store.credential);
    }
    @Test public void normalizedServerAndDigestAreStable() throws Exception {
        assertEquals("https://cloud.example/nc", NativeLoginFlow.normalizeServer(" https://CLOUD.example:443/nc/// "));
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", NativeLoginFlow.digest("abc"));
    }
    @Test public void timedOutCanonicalLookupCannotCommitLateCredentials() throws Exception {
        Storage store = new Storage(); store.account = new NativeLoginFlow.Account("prior", SERVER, "prior");
        Network network = new Network() { @Override public NativeLoginFlow.Reply request(String base, String target, String method, String body, NativeLoginFlow.Credential credential) throws Exception {
            NativeLoginFlow.Reply reply = super.request(base, target, method, body, credential);
            if (target.contains("/cloud/user")) Thread.currentThread().interrupt();
            return reply;
        }};
        NativeLoginFlow flow = flow(network, store, new AtomicLong()); flow.begin(SERVER);
        try { assertEquals("CANCELLED", assertThrows(NativeLoginFlow.Failure.class, () -> flow.poll("flow-1")).code); }
        finally { Thread.interrupted(); }
        assertEquals("prior", store.account.name()); assertNull(store.credential);
    }
    @Test public void interruptedBeginCannotPublishLateAuthorizationFlow() {
        Storage store = new Storage();
        Network network = new Network() { @Override public NativeLoginFlow.Reply request(String base, String target, String method, String body, NativeLoginFlow.Credential credential) throws Exception {
            NativeLoginFlow.Reply reply = super.request(base, target, method, body, credential); Thread.currentThread().interrupt(); return reply;
        }};
        NativeLoginFlow flow = flow(network, store, new AtomicLong());
        try { assertEquals("CANCELLED", assertThrows(NativeLoginFlow.Failure.class, () -> flow.begin(SERVER)).code); }
        finally { Thread.interrupted(); }
        assertEquals("CANCELLED", assertThrows(NativeLoginFlow.Failure.class, () -> flow.poll("flow-1")).code);
        assertNull(store.credential);
    }
    @Test public void failedDurableCommitRestoresPreviousMemoryEvenIfRollbackDiskWriteFails() {
        java.util.Map<String,String> values = new java.util.HashMap<>(java.util.Map.of("name", "prior", "transport", "sso", "unrelated", "keep"));
        NativeSelectionCommit.Preferences preferences = new NativeSelectionCommit.Preferences() {
            public String read(String key) { return values.get(key); }
            public boolean write(java.util.Map<String,String> update) {
                update.forEach((key,value) -> { if (value == null) values.remove(key); else values.put(key,value); });
                return false;
            }
        };
        assertThrows(NativeLoginFlow.Failure.class, () -> NativeSelectionCommit.replace(preferences, java.util.Map.of("name", "candidate", "transport", "direct", "ciphertext", "encrypted")));
        assertEquals(java.util.Map.of("name", "prior", "transport", "sso", "unrelated", "keep"), values);
    }
}
