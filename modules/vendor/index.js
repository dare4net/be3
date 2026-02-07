/**
 * Vendor Module Bootstrapper
 * 
 * Handles multi-vendor logic, automatic tagging, and vendor isolation.
 */

async function bootstrap(context) {
    const { app, eventBus } = context;

    const RoleService = require('../../platform/core/roles/services/RoleService');
    const VendorService = require('./services/VendorService');

    // Listen for module enablement to seed vendor roles
    eventBus.on('module.enabled', async (event) => {
        const data = event.data;
        if (data.moduleName === 'vendor') {
            try {
                console.log(`[Vendor] Module enabled for tenant ${data.tenantId}, seeding roles...`);
                // RoleService.seedDefaultRoles is idempotent and includes the Vendor role
                await RoleService.seedDefaultRoles(data.tenantId);
            } catch (error) {
                console.error(`[Vendor] Failed to seed roles for tenant ${data.tenantId}:`, error);
            }
        }
    });

    // Listen for Vendor role assignment
    eventBus.on('role.assigned', async (event) => {
        const data = event.data;
        if (data.roleName === 'Vendor') {
            try {
                console.log(`[Vendor] Vendor role assigned to user ${data.userId}, initializing...`);
                await VendorService.initializeVendor(data.tenantId, data.userId);
            } catch (error) {
                console.error(`[Vendor] Failed to initialize vendor on role assignment:`, error);
            }
        }
    });

    // Listen for profile updates (business_name changes)
    eventBus.on('user.profile_updated', async (event) => {
        const data = event.data;
        try {
            const Role = require('../../platform/core/roles/models/Role');
            const userRoles = await Role.getUserRoles(data.tenantId, data.userId);
            const isVendor = userRoles.some(role => role.name === 'Vendor');

            if (isVendor) {
                console.log(`[Vendor] Business name updated for vendor ${data.userId}, re-initializing...`);
                await VendorService.initializeVendor(data.tenantId, data.userId);
            }
        } catch (error) {
            console.error(`[Vendor] Failed to update vendor on profile update:`, error);
        }
    });

    try {
        console.log('[Vendor] Module initialized');
        return true;
    } catch (error) {
        console.error('[Vendor] Bootstrap failed:', error);
        return false;
    }
}

module.exports = { bootstrap };
