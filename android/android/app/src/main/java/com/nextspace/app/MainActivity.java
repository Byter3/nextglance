package com.nextspace.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;
import com.nextcloud.android.sso.AccountImporter;
import com.nextcloud.android.sso.model.SingleSignOnAccount;

/** Keeps the Files app's account picker and consent activity in the native layer. */
public class MainActivity extends BridgeActivity {
    interface AccountSelection {
        void complete(SingleSignOnAccount account, Exception error);
    }

    private AccountSelection selection;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NextcloudSsoPlugin.class);
        registerPlugin(NativeWidgetPlugin.class);
        super.onCreate(savedInstanceState);
    }

    void chooseNextcloudAccount(AccountSelection callback) {
        if (selection != null) {
            callback.complete(null, new IllegalStateException("An account selection is already open."));
            return;
        }
        selection = callback;
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O &&
                ContextCompat.checkSelfPermission(this, Manifest.permission.GET_ACCOUNTS) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.GET_ACCOUNTS}, AccountImporter.REQUEST_GET_ACCOUNTS_PERMISSION);
        } else {
            pickAccount();
        }
    }

    private void pickAccount() {
        try {
            AccountImporter.pickNewAccount(this);
        } catch (Exception error) {
            finishSelection(null, error);
        }
    }

    private void finishSelection(SingleSignOnAccount account, Exception error) {
        AccountSelection callback = selection;
        selection = null;
        if (callback != null) callback.complete(account, error);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        if (requestCode == AccountImporter.REQUEST_GET_ACCOUNTS_PERMISSION) {
            if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) pickAccount();
            else finishSelection(null, new SecurityException("Allow account access to select your Nextcloud account."));
            return;
        }
        super.onRequestPermissionsResult(requestCode, permissions, results);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != AccountImporter.CHOOSE_ACCOUNT_SSO && requestCode != AccountImporter.REQUEST_AUTH_TOKEN_SSO) {
            super.onActivityResult(requestCode, resultCode, data);
            return;
        }
        try {
            if (resultCode != RESULT_OK || data == null) {
                // Cancellation always settles the awaiting bridge call; no background password flow.
                finishSelection(null, null);
            } else if (requestCode == AccountImporter.CHOOSE_ACCOUNT_SSO) {
                AccountImporter.requestAuthToken(this, data);
            } else {
                finishSelection(AccountImporter.extractSingleSignOnAccountFromResponse(data, this), null);
            }
        } catch (Exception error) {
            finishSelection(null, error);
        }
    }
}
