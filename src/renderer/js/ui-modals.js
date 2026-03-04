"use strict";

// Legacy entry kept for compatibility with old HTML/script references.
// Actual implementation has moved to `js/ui/ui-modals.js`.
(function loadUiModalsFromNewLocation() {
    const path = require('path');
    const targetPath = path.join(__dirname, 'js', 'ui', 'ui-modals.js');
    require(targetPath);
})();
