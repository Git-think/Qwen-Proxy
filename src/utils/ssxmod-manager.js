/**
 * SSXMOD Cookie Manager
 * Responsible for generating and periodically refreshing ssxmod_itna and ssxmod_itna2 cookies
 */

const { generateCookies } = require('./cookie-generator');
const { logger } = require('./logger');

// Global cookie storage
let currentCookies = {
    ssxmod_itna: '',
    ssxmod_itna2: '',
    timestamp: 0
};

// Refresh interval (15 minutes)
const REFRESH_INTERVAL = 15 * 60 * 1000;

// Timer reference
let refreshTimer = null;

/**
 * Refresh SSXMOD cookies
 */
function refreshCookies() {
    try {
        const result = generateCookies();
        currentCookies = {
            ssxmod_itna: result.ssxmod_itna,
            ssxmod_itna2: result.ssxmod_itna2,
            timestamp: result.timestamp
        };
        logger.info('SSXMOD cookies refreshed', 'SSXMOD');
    } catch (error) {
        logger.error('SSXMOD cookie refresh failed', 'SSXMOD', '', error.message);
    }
}

/**
 * Initialize SSXMOD manager
 * Generate cookies once at startup and set up periodic refresh
 */
function initSsxmodManager() {
    // Generate immediately
    refreshCookies();

    // Set up periodic refresh (every 15 minutes)
    if (refreshTimer) {
        clearInterval(refreshTimer);
    }
    refreshTimer = setInterval(refreshCookies, REFRESH_INTERVAL);

    logger.info(`SSXMOD manager started, refresh interval: ${REFRESH_INTERVAL / 1000 / 60} minutes`, 'SSXMOD');
}

/**
 * Get current ssxmod_itna
 * @returns {string} ssxmod_itna value
 */
function getSsxmodItna() {
    return currentCookies.ssxmod_itna;
}

/**
 * Get current ssxmod_itna2
 * @returns {string} ssxmod_itna2 value
 */
function getSsxmodItna2() {
    return currentCookies.ssxmod_itna2;
}

/**
 * Get complete cookie object
 * @returns {Object} Object containing ssxmod_itna and ssxmod_itna2
 */
function getCookies() {
    return { ...currentCookies };
}

/**
 * Stop periodic refresh
 */
function stopRefresh() {
    if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
        logger.info('SSXMOD periodic refresh stopped', 'SSXMOD');
    }
}

module.exports = {
    initSsxmodManager,
    getSsxmodItna,
    getSsxmodItna2,
    getCookies,
    refreshCookies,
    stopRefresh
};
