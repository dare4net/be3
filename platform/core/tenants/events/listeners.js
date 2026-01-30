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
     * Listen for tenant.created to run high-quality onboarding
     */
    eventBus.on('tenant.created', async (data) => {
        const TenantInitializationService = require('../services/TenantInitializationService');
        await TenantInitializationService.initialize(data.tenantId);
    });

    console.log('[Tenants] Event listeners registered');
}

module.exports = { registerListeners };
