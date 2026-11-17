<?php

declare(strict_types=1);

// SPDX-License-Identifier: AGPL-3.0-or-later

namespace OCA\Nextglance\AppInfo;

use OCP\AppFramework\App;

final class Application extends App {
    public const APP_ID = 'nextglance';

    public function __construct() {
        parent::__construct(self::APP_ID);
    }
}
