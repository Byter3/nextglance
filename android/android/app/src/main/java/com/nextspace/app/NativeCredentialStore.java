package com.nextspace.app;

import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.google.gson.Gson;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Android-only protected storage port; preferences contain authenticated ciphertext, never a token. */
final class NativeCredentialStore implements NativeLoginFlow.Store {
    private static final String KEY = "nextspace-direct-account-v1";
    private final SharedPreferences preferences;
    private final Gson gson = new Gson();
    NativeCredentialStore(SharedPreferences preferences) { this.preferences = preferences; }
    private synchronized SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (!store.containsAlias(KEY)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(KEY, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256).build());
            generator.generateKey();
        }
        return (SecretKey) store.getKey(KEY, null);
    }
    @Override public void checkAvailable() throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        cipher.doFinal(new byte[0]);
    }
    @Override public NativeLoginFlow.Account current() throws Exception {
        String name = preferences.getString("name", null);
        if (name == null) return null;
        String server = preferences.getString("serverUrl", null), username = preferences.getString("username", null);
        NativeRequestPolicy.checkedAccountIdentity(name, server, username);
        return new NativeLoginFlow.Account(name, server, username);
    }
    private static byte[] associated(NativeLoginFlow.Account account) {
        return (account.name() + '\0' + account.serverUrl() + '\0' + account.username()).getBytes(StandardCharsets.UTF_8);
    }
    private static String credentialKey(NativeLoginFlow.Account account) throws Exception { return "direct:" + NativeLoginFlow.digest(account.name()); }
    @Override public synchronized void commit(NativeLoginFlow.Credential credential) throws Exception {
        NativeLoginFlow.Account account = credential.account();
        NativeRequestPolicy.checkedAccountIdentity(account.name(), account.serverUrl(), account.username());
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        cipher.updateAAD(associated(account));
        byte[] ciphertext = cipher.doFinal(gson.toJson(credential).getBytes(StandardCharsets.UTF_8));
        String envelope = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(ciphertext, Base64.NO_WRAP);
        java.util.Map<String, String> next = new java.util.LinkedHashMap<>();
        next.put(credentialKey(account), envelope); next.put("name", account.name()); next.put("serverUrl", account.serverUrl());
        next.put("username", account.username()); next.put("transport", "direct"); next.put("providerName", null);
        replace(next);
    }
    synchronized NativeLoginFlow.Credential read() throws Exception {
        NativeLoginFlow.Account account = current();
        if (account == null || !"direct".equals(preferences.getString("transport", "sso")))
            throw new NativeLoginFlow.Failure("AUTH", "Authorize this account again through Nextcloud.");
        String envelope = preferences.getString(credentialKey(account), null);
        if (envelope == null || envelope.length() > 32000) throw new NativeLoginFlow.Failure("AUTH", "Saved authorization is unavailable. Sign in again; saved data is preserved.");
        String[] pieces = envelope.split(":", -1);
        if (pieces.length != 2) throw new NativeLoginFlow.Failure("AUTH", "Saved authorization is unreadable. Sign in again; saved data is preserved.");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(pieces[0], Base64.NO_WRAP)));
        cipher.updateAAD(associated(account));
        NativeLoginFlow.Credential credential = gson.fromJson(new String(cipher.doFinal(Base64.decode(pieces[1], Base64.NO_WRAP)), StandardCharsets.UTF_8), NativeLoginFlow.Credential.class);
        if (credential == null || !account.equals(credential.account()) || credential.loginName() == null || credential.loginName().contains(":") || credential.appPassword() == null || credential.appPassword().isEmpty())
            throw new NativeLoginFlow.Failure("AUTH", "Saved authorization does not match this account. Sign in again.");
        return credential;
    }
    void clearSelection() throws Exception {
        NativeLoginFlow.Account account;
        try { account = current(); } catch (Exception unavailableIdentity) { account = null; }
        java.util.Map<String, String> next = new java.util.LinkedHashMap<>();
        for (String field : new String[]{"name", "serverUrl", "username", "transport", "providerName"}) next.put(field, null);
        if (account != null && "direct".equals(preferences.getString("transport", "sso"))) next.put(credentialKey(account), null);
        replace(next);
    }
    void replace(java.util.Map<String, String> values) throws Exception {
        NativeSelectionCommit.replace(new NativeSelectionCommit.Preferences() {
            public String read(String key) { return preferences.getString(key, null); }
            public boolean write(java.util.Map<String, String> updates) {
                SharedPreferences.Editor edit = preferences.edit();
                updates.forEach((field, value) -> { if (value == null) edit.remove(field); else edit.putString(field, value); });
                return edit.commit();
            }
        }, values);
    }
}
