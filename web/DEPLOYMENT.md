# Manually test NextGlance inside Nextcloud

This installs a private test app in Nextcloud's app navigation. It uses your existing login and edits the same native data and planner files as the other clients. It needs a connection; it has no offline mode.

**Current boundary:** automated fixtures and syntax checks are not a successful server installation. Nextcloud 34.x (including 34.0.5) and 35.x are the targets; both still need real-server acceptance. Test with a separate account and fictional items first. Nothing in these instructions deploys automatically.

## 1. Prepare the package on your computer

Use Node.js 24+ and the pnpm version in the root `package.json`. If `pnpm` is missing, install that version with `npm install --global pnpm@11.25.0`, then open a new terminal. Run from the repository root:

```powershell
pnpm install --frozen-lockfile
pnpm --filter @nextspace/nextcloud typecheck
pnpm --filter @nextspace/nextcloud test
```

For an explicitly requested installable milestone, compile and package once:

```powershell
pnpm --filter @nextspace/nextcloud build
pnpm --filter @nextspace/nextcloud package
```

Output: `web/release/NextGlance-0.6.17-Nextcloud.tar.gz` and its `.sha256` file. The archive contains a single `nextglance/` directory, compiled assets, PHP files, license and matching source archive. The package command consumes existing assets; it does not compile them. Use the version printed by the command if it changes.

## 2. Install on the server

You need administrator shell access and a configured writable custom-app directory. Nextcloud 34 requires PHP 8.2–8.5; Nextcloud 35 requires PHP 8.3–8.5. The web server and `occ` CLI must use compatible PHP. Optional Deck, Notes and Collectives apps must be enabled for the test user to use those integrations. Calendar/Tasks data and Files permissions remain native. See [Nextcloud's custom-app directory configuration](https://docs.nextcloud.com/server/stable/admin_manual/configuration_server/config_sample_php_parameters.html#apps-paths).

Copy the archive and checksum to the server, for example with SCP, SFTP or your server's file manager. The commands below assume a conventional Linux installation at `/var/www/nextcloud`, a custom directory at `custom_apps/`, and web user `www-data`. **Adapt those paths and the web user to your installation.** Docker/AIO uses the persistent mapped custom-app volume and runs `occ` inside the Nextcloud container; do not install into a disposable container layer.

```bash
cd /tmp
sha256sum -c NextGlance-0.6.17-Nextcloud.tar.gz.sha256
tar -tzf NextGlance-0.6.17-Nextcloud.tar.gz
# Check that every entry is under nextglance/ before extracting.
sudo mkdir -p /var/www/nextcloud/custom_apps
sudo tar -xzf NextGlance-0.6.17-Nextcloud.tar.gz -C /var/www/nextcloud/custom_apps
sudo chown -R www-data:www-data /var/www/nextcloud/custom_apps/nextglance
sudo -u www-data php /var/www/nextcloud/occ app:enable nextglance
```

These extraction commands are for a **first installation**. Use the update procedure below when `nextglance/` already exists. Keep your normal Nextcloud file-permission policy; never use `chmod 777`. This private package is unsigned; do not disable Nextcloud's integrity checks globally. Signing and App Store submission are later milestones.

## 3. Open and check it

Sign in normally, refresh Nextcloud and choose **NextGlance** in its app navigation. No additional password is requested. Check:

- Native header/theme stay intact; Overview, Calendar, Timeline, Board and List open.
- Expected sources and Spaces load. Planner metadata remains in `/Workspace/Nextspace/`; no account data is copied from another client.
- On disposable test items, try a supported edit and verify it in the native Nextcloud app. Then verify a Space/group change in another current NextGlance client.
- Loss of connection disables writes and shows a warning. Logout/session expiry hides private content and requires Nextcloud sign-in again.
- **Source code** in settings downloads the matching source archive. If the server blocks `.tar.gz` static downloads, allow that specific app source path through its normal static-file configuration.

Unavailable operations stay disabled. Read the [current implementation limits](README.md#current-boundaries) before testing. Check each Nextcloud major separately; passing on 34 does not establish 35 compatibility.

## 4. Update or roll back

Before updating, make your normal Nextcloud data/database backup and save the **old app directory outside the web root**. Disable the app with `occ app:disable nextglance`. Replace its directory with the new archive's `nextglance/` directory, restore ownership, then run `occ app:enable nextglance` and `occ upgrade` if Nextcloud requests an app upgrade. Refresh the browser. Do not merge new code over an old directory and leave obsolete files behind.

To roll back, disable NextGlance and restore the saved app directory and ownership, then enable it again. If a future release introduces database migrations, follow that release's migration/restore instructions; code-only rollback may then be insufficient. This initial host adds no app database schema. **Do not delete or restore older planner files as part of a code rollback:** native records and `/Workspace/Nextspace/` are shared with your other clients.

## If it does not open

- **Missing app:** check the directory is exactly `custom_apps/nextglance/appinfo/info.xml`, the configured app path, PHP version and `occ app:list`.
- **Blank page or missing styling:** check browser Network/Console for `nextglance.js` and `nextglance.css`; upload the packaged archive, not just the source folder. Review Nextcloud's server log without sharing session cookies or tokens.
- **Sign-in/session error:** reload Nextcloud and sign in again. Reverse-proxy origin/subdirectory configuration must match the URL you use; no separate API password is needed.
- **Source/edit unavailable:** check the native app is enabled and the same user can perform the action there. Do not loosen server permissions or bypass conflict errors.

Official administration reference: [using the occ command](https://docs.nextcloud.com/server/stable/admin_manual/occ_command.html). Publication, deployment to a live account, and App Store registration remain separate explicit steps.
