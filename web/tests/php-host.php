<?php

declare(strict_types=1);

// SPDX-License-Identifier: AGPL-3.0-or-later
// Small interface fixtures test our controllers, not Nextcloud's middleware.
namespace OCP {
    interface IRequest {}
    interface IUserSession { public function getUser(); }
    interface IURLGenerator {
        public function getAbsoluteURL(string $url): string;
        public function linkToRoute(string $route, array $arguments = []): string;
        public function linkTo(string $app, string $file): string;
    }
    final class Util {
        public static array $scripts = [];
        public static array $styles = [];
        public static function addScript(string $app, string $file): void { self::$scripts[] = [$app, $file]; }
        public static function addStyle(string $app, string $file): void { self::$styles[] = [$app, $file]; }
    }
}
namespace OCP\App {
    interface IAppManager {
        public function isEnabledForUser($appId, $user = null);
        public function getAppVersion(string $appId, bool $useCache = true): string;
    }
}
namespace OCP\AppFramework {
    class App { public function __construct(public string $appId) {} }
    class Controller { public function __construct(public string $appId, public \OCP\IRequest $request) {} }
}
namespace OCP\AppFramework\Http {
    class Response {
        public array $headers = [];
        public function __construct(public int $status = 200) {}
        public function addHeader(string $name, string $value): void { $this->headers[$name] = $value; }
    }
    class JSONResponse extends Response {
        public function __construct(public array $data, int $status = 200) { parent::__construct($status); }
    }
    class TemplateResponse extends Response {
        public function __construct(public string $app, public string $template, public array $params) { parent::__construct(); }
    }
}
namespace OCP\AppFramework\Http\Attribute {
    #[\Attribute] class NoAdminRequired {}
    #[\Attribute] class NoCSRFRequired {}
}
namespace {
    require __DIR__ . '/../lib/AppInfo/Application.php';
    require __DIR__ . '/../lib/Controller/PageController.php';
    require __DIR__ . '/../lib/Controller/SessionController.php';

    function expect(bool $condition, string $message): void {
        if (!$condition) { throw new \RuntimeException($message); }
    }
    function same(mixed $actual, mixed $expected, string $message): void {
        expect($actual === $expected, $message . ': ' . json_encode($actual));
    }
    final class User {
        public function __construct(private string $uid) {}
        public function getUID(): string { return $this->uid; }
        public function getDisplayName(): string { return 'Example user'; }
    }
    final class Users implements \OCP\IUserSession {
        public function __construct(public ?User $current) {}
        public function getUser(): ?User { return $this->current; }
    }
    final class Urls implements \OCP\IURLGenerator {
        public function __construct(private string $base) {}
        public function getAbsoluteURL(string $url): string { return 'https://cloud.example.test' . $this->base . '/' . ltrim($url, '/'); }
        public function linkTo(string $app, string $file): string { return $this->base . '/apps/' . $app . '/' . $file; }
        public function linkToRoute(string $route, array $arguments = []): string {
            return $this->base . match ($route) {
                'nextglance.page.index' => '/index.php/apps/nextglance/',
                'nextglance.session.show' => '/index.php/apps/nextglance/session',
                'core.login.showLoginForm' => '/index.php/login?redirect_url=' . rawurlencode($arguments['redirect_url']),
                default => throw new \RuntimeException('Unexpected route'),
            };
        }
    }
    final class Apps implements \OCP\App\IAppManager {
        public array $checks = [];
        public function isEnabledForUser($appId, $user = null) {
            $this->checks[] = [$appId, $user?->getUID()];
            return in_array($appId, ['dav', 'files', 'deck'], true) && $user?->getUID() === 'alice';
        }
        public function getAppVersion(string $appId, bool $useCache = true): string {
            same($appId, 'nextglance', 'Own version only');
            return '0.6.12';
        }
    }

    $request = new class implements \OCP\IRequest {};
    foreach (['', '/cloud'] as $base) {
        $users = new Users(new User('alice'));
        $urls = new Urls($base);
        $apps = new Apps();
        $controller = new \OCA\Nextglance\Controller\SessionController($request, $users, $urls, $apps);
        $response = $controller->show();
        same($response->status, 200, 'Authenticated status');
        same($response->data, [
            'appId' => 'nextglance', 'appVersion' => '0.6.12',
            'userId' => 'alice', 'displayName' => 'Example user',
            'serverUrl' => 'https://cloud.example.test' . $base,
            'basePath' => $base,
            'sessionUrl' => $base . '/index.php/apps/nextglance/session',
            'loginUrl' => $base . '/index.php/login?redirect_url=' . rawurlencode($base . '/index.php/apps/nextglance/'),
            'sourceUrl' => $base . '/apps/nextglance/source/NextGlance-0.6.12-source.tar.gz',
            'enabledApps' => ['dav', 'deck', 'files'],
        ], 'Exact session contract');
        same($response->headers, ['Cache-Control' => 'no-store, private', 'Vary' => 'Cookie'], 'Private session response');
        foreach ($apps->checks as $check) { same($check[1], 'alice', 'Integration access uses authenticated user'); }

        $users->current = new User('bob');
        $second = $controller->show();
        same($second->data['userId'], 'bob', 'Fresh account identity');
        same($second->data['enabledApps'], [], 'No old-account integrations');
        $users->current = null;
        $before = count($apps->checks);
        $denied = $controller->show();
        same($denied->status, 401, 'Expired session status');
        same($denied->data['error']['code'], 'SESSION_EXPIRED', 'Explicit expiry code');
        same(count($apps->checks), $before, 'No source discovery without session');
        expect(!isset($denied->data['userId']), 'No retained user data');

        $page = (new \OCA\Nextglance\Controller\PageController($request, $urls))->index();
        same([$page->app, $page->template], ['nextglance', 'main'], 'Native host template');
        same($page->params, ['sessionUrl' => $base . '/index.php/apps/nextglance/session'], 'Page carries no private data');
        same($page->headers['Cache-Control'], 'no-store, private', 'Page no-store');
    }
    $sessionMethod = new \ReflectionMethod(\OCA\Nextglance\Controller\SessionController::class, 'show');
    same(array_map(fn ($attribute) => $attribute->getName(), $sessionMethod->getAttributes()), [\OCP\AppFramework\Http\Attribute\NoAdminRequired::class], 'Session keeps native authentication and CSRF defaults');
    $pageMethod = new \ReflectionMethod(\OCA\Nextglance\Controller\PageController::class, 'index');
    same(array_map(fn ($attribute) => $attribute->getName(), $pageMethod->getAttributes()), [\OCP\AppFramework\Http\Attribute\NoAdminRequired::class, \OCP\AppFramework\Http\Attribute\NoCSRFRequired::class], 'Only page navigation skips CSRF');
    same(\OCP\Util::$scripts, [['nextglance', 'nextglance'], ['nextglance', 'nextglance']], 'Local script registration');
    same(\OCP\Util::$styles, [['nextglance', 'nextglance'], ['nextglance', 'nextglance']], 'Local stylesheet registration');
    same(require __DIR__ . '/../appinfo/routes.php', ['routes' => [
        ['name' => 'page#index', 'url' => '/', 'verb' => 'GET'],
        ['name' => 'session#show', 'url' => '/session', 'verb' => 'GET'],
    ]], 'Only page/session routes, no mutation proxy');

    function p(string $value): void { echo htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); }
    $_ = ['sessionUrl' => '/cloud/index.php/apps/nextglance/session?x="<unsafe>'];
    $l = new class { public function t(string $text): string { return $text; } };
    ob_start();
    require __DIR__ . '/../templates/main.php';
    $html = ob_get_clean();
    expect(str_contains($html, 'id="nextglance-root"'), 'Frontend mount exists');
    expect(str_contains($html, 'data-session-url="/cloud/index.php/apps/nextglance/session?x=&quot;&lt;unsafe&gt;"'), 'Bootstrap attribute escaped');
    expect(!str_contains($html, '<script'), 'No executable inline bootstrap payload');
    echo "PHP host controller and template fixtures passed.\n";
}
