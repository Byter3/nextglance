<?php

declare(strict_types=1);

// SPDX-License-Identifier: AGPL-3.0-or-later
/** @var array $_ */
/** @var \OCP\IL10N $l */
?>
<div id="app-content">
    <div id="nextglance-root" data-session-url="<?php p($_['sessionUrl']); ?>">
        <p role="status"><?php p($l->t('Opening NextGlance…')); ?></p>
        <noscript><?php p($l->t('NextGlance needs JavaScript and a connection to this Nextcloud server.')); ?></noscript>
    </div>
</div>
