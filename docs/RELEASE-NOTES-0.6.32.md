# NextGlance 0.6.32

24 November 2026 · Android · Build 34

- Switch a saved Nextcloud Files connection in **Settings & connection → Use direct connection**. Sign in through your server with the same Nextcloud user to keep your saved data and background sync settings. NextGlance then connects directly to your server for foreground and background sync.
- Foreground and background sync send one request at a time through Nextcloud Files. NextGlance pauses new Files requests for 30 seconds after an active request times out or Files reports a transport failure.
- Opening NextGlance avoids duplicate source access checks. Queued planner changes stay saved when the app goes into the background and can sync when it returns to the foreground.

Automated checks passed. Sync reliability on physical Android devices and live Nextcloud servers still needs verification.

[User guide](GETTING-STARTED.md) · [Local APK and verification](RELEASES.md#0632--android) · [Windows and Nextcloud 0.6.31 release notes](RELEASE-NOTES-0.6.31.md)
