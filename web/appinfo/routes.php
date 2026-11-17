<?php

declare(strict_types=1);

// SPDX-License-Identifier: AGPL-3.0-or-later

return [
    'routes' => [
        ['name' => 'page#index', 'url' => '/', 'verb' => 'GET'],
        ['name' => 'session#show', 'url' => '/session', 'verb' => 'GET'],
    ],
];
