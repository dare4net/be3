/**
 * Vendor Module Bootstrapper
 * 
 * Handles multi-vendor logic, automatic tagging, vendor isolation,
 * and system attribute management for vendor identification.
 * 
 * PRINCIPLE: Modules do not import other modules
 * PRINCIPLE: All inter-module communication is event-based
 */

async function bootstrap(context) {
    const { app, eventBus } = context;

    const RoleService = require('../../platform/core/roles/services/RoleService');
    const VendorService = require('./services/VendorService');

    // ─── Register Variables ───────────────────────────────────────────
    // Register vendor-specific variables that the Variables module can resolve.
    // This uses events so the vendor module doesn't depend on the variables module.
    eventBus.emitEvent('variable.register_many', {
        variables: [
            {
                name: 'BUSINESS_NAME',
                description: 'The business name of the vendor (from user profile). Falls back to store name.',
                resolver: async (context) => {
                    if (!context.tenantId) return null;
                    const { query: dbQuery } = require('../../config/database');
                    // Try user's business name first
                    if (context.userId) {
                        const User = require('../../platform/core/auth/models/User');
                        const user = await User.findById(context.tenantId, context.userId);
                        const businessName = user?.business_name || `${user?.first_name || ''} ${user?.last_name || ''}`.trim();
                        if (businessName) return businessName;
                    }
                    // Fallback: resolve [STORE_NAME] variable
                    const VariableRegistry = require('../../modules/variables/services/VariableRegistry');
                    return await VariableRegistry.resolve('STORE_NAME', context) || 'Store';
                }
            },
            {
                name: 'STORE_NAME',
                description: 'The tenant store name. Used in footers, widgets, and as a fallback for BUSINESS_NAME.',
                resolver: async (context) => {
                    if (!context.tenantId) return null;
                    const { query } = require('../../config/database');
                    const result = await query('SELECT name FROM tenants WHERE id = $1', [context.tenantId]);
                    return result.rows[0]?.name || 'Store';
                }
            },
            {
                name: 'VENDOR_ID',
                description: 'The unique UUID of the vendor',
                resolver: async (context) => {
                    return context.userId || context.user_id || 'platform';
                }
            }
        ]
    });

    // ─── Event Listeners ──────────────────────────────────────────────

    // Listen for module enablement to seed vendor roles
    eventBus.on('module.enabled', async (event) => {
        const data = event.data;
        if (data.moduleName === 'vendor') {
            try {
                console.log(`[Vendor] Module enabled for tenant ${data.tenantId}, seeding roles...`);
                // RoleService.seedDefaultRoles is idempotent and includes the Vendor role
                await RoleService.seedDefaultRoles(data.tenantId);

                // Ensure the system "Vendor" attribute exists for this tenant
                await VendorService.ensureVendorAttribute(data.tenantId);
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

    // Listen for Vendor role removal
    eventBus.on('role.removed', async (event) => {
        const data = event.data;
        if (data.roleName === 'Vendor') {
            try {
                console.log(`[Vendor] Vendor role removed from user ${data.userId}, deactivating collection...`);
                await VendorService.deactivateVendor(data.tenantId, data.userId);
            } catch (error) {
                console.error(`[Vendor] Failed to deactivate vendor on role removal:`, error);
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
