/**
 * Tenant Module Event Listeners
 * 
 * PRINCIPLE: All inter-module communication is event-based
 */

const eventBus = require('../../../events/EventBus');

/**
 * Register event listeners for tenants module
 */
function registerListeners() {
    /**
     * Currently no events to listen to
     * This module primarily emits events that other modules listen to
     */

    console.log('[Tenants] Event listeners registered');
}

module.exports = { registerListeners };
