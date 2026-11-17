<?php

declare(strict_types=1);

// SPDX-License-Identifier: AGPL-3.0-or-later

namespace OCA\Nextglance\Controller;

use OCA\Nextglance\AppInfo\Application;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\IRequest;
use OCP\IURLGenerator;
use OCP\Util;

final class PageController extends Controller {
    public function __construct(IRequest $request, private IURLGenerator $urls) {
        parent::__construct(Application::APP_ID, $request);
    }

    // Only ordinary page navigation omits a request token. Authentication stays
    // enforced by Nextcloud; the JSON session endpoint keeps CSRF protection.
    #[NoAdminRequired]
    #[NoCSRFRequired]
    public function index(): TemplateResponse {
        Util::addScript(Application::APP_ID, 'nextglance');
        Util::addStyle(Application::APP_ID, 'nextglance');

        $response = new TemplateResponse(Application::APP_ID, 'main', [
            'sessionUrl' => $this->urls->linkToRoute('nextglance.session.show'),
        ]);
        $response->addHeader('Cache-Control', 'no-store, private');
        $response->addHeader('Vary', 'Cookie');
        return $response;
    }
}
