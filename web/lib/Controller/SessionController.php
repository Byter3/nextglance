<?php

declare(strict_types=1);

// SPDX-License-Identifier: AGPL-3.0-or-later

namespace OCA\Nextglance\Controller;

use OCA\Nextglance\AppInfo\Application;
use OCP\App\IAppManager;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\JSONResponse;
use OCP\IRequest;
use OCP\IURLGenerator;
use OCP\IUserSession;

final class SessionController extends Controller {
    private const INTEGRATIONS = ['dav', 'calendar', 'tasks', 'deck', 'notes', 'files', 'files_sharing', 'collectives', 'related_resources'];

    public function __construct(
        IRequest $request,
        private IUserSession $users,
        private IURLGenerator $urls,
        private IAppManager $apps,
    ) {
        parent::__construct(Application::APP_ID, $request);
    }

    // No PublicPage or NoCSRFRequired attribute: Nextcloud authenticates the
    // current session and validates the standard page request token.
    #[NoAdminRequired]
    public function show(): JSONResponse {
        $user = $this->users->getUser();
        if ($user === null) {
            return $this->privateResponse(['error' => ['code' => 'SESSION_EXPIRED', 'message' => 'Sign in to Nextcloud again.']], 401);
        }

        $serverUrl = rtrim($this->urls->getAbsoluteURL('/'), '/');
        $basePath = rtrim((string)(parse_url($serverUrl, PHP_URL_PATH) ?? ''), '/');
        $pageUrl = $this->urls->linkToRoute('nextglance.page.index');
        $appVersion = $this->apps->getAppVersion(Application::APP_ID);
        $enabledApps = array_values(array_filter(self::INTEGRATIONS, fn (string $app): bool => (bool)$this->apps->isEnabledForUser($app, $user)));

        return $this->privateResponse([
            'appId' => Application::APP_ID,
            'appVersion' => $appVersion,
            'userId' => $user->getUID(),
            'displayName' => $user->getDisplayName(),
            'serverUrl' => $serverUrl,
            'basePath' => $basePath,
            'sessionUrl' => $this->urls->linkToRoute('nextglance.session.show'),
            'loginUrl' => $this->urls->linkToRoute('core.login.showLoginForm', ['redirect_url' => $pageUrl]),
            'sourceUrl' => $this->urls->linkTo(Application::APP_ID, 'source/NextGlance-' . rawurlencode($appVersion) . '-source.tar.gz'),
            'enabledApps' => $enabledApps,
        ]);
    }

    private function privateResponse(array $body, int $status = 200): JSONResponse {
        $response = new JSONResponse($body, $status);
        $response->addHeader('Cache-Control', 'no-store, private');
        $response->addHeader('Vary', 'Cookie');
        return $response;
    }
}
