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

    // ─── Mount Routes ──────────────────────────────────────────────────────
    const applicationRoutes = require('./routes/application');
    const adminRoutes = require('./routes/admin');

    app.use('/vendor/application', applicationRoutes);
    app.use('/vendor/admin', adminRoutes);

    console.log('[Vendor] Routes mounted: /vendor/application, /vendor/admin');

    // ─── Register Variables ────────────────────────────────────────────────
    eventBus.emitEvent('variable.register_many', {
        variables: [
            {
                name: 'BUSINESS_NAME',
                description: 'The business name of the vendor (from user profile). Falls back to store name.',
                resolver: async (context) => {
                    if (!context.tenantId) return null;
                    if (context.userId) {
                        const User = require('../../platform/core/auth/models/User');
                        const user = await User.findById(context.tenantId, context.userId);
                        const businessName = user?.business_name || `${user?.first_name || ''} ${user?.last_name || ''}`.trim();
                        if (businessName) return businessName;
                    }
                    const VariableRegistry = require('../../modules/variables/services/VariableRegistry');
                    return await VariableRegistry.resolve('STORE_NAME', context) || 'Store';
                }
            },
            {
                name: 'STORE_NAME',
                description: 'The tenant store name.',
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
                resolver: async (context) => context.userId || context.user_id || 'platform'
            }
        ]
    });

    // ─── Event Listeners ───────────────────────────────────────────────────

    // Vendor module enabled for a tenant → seed roles
    eventBus.on('module.enabled', async (event) => {
        const data = event.data;
        if (data.moduleName === 'vendor') {
            try {
                console.log(`[Vendor] Module enabled for tenant ${data.tenantId}, seeding roles...`);
                await RoleService.seedDefaultRoles(data.tenantId);
                await VendorService.ensureVendorAttribute(data.tenantId);
            } catch (error) {
                console.error(`[Vendor] Failed to seed roles for tenant ${data.tenantId}:`, error);
            }
        }
    });

    // Vendor role assigned → initialize vendor (create collection, tag products)
    eventBus.on('role.assigned', async (event) => {
        const data = event.data;
        if (data.roleName === 'Vendor') {
            try {
                console.log(`[Vendor] Vendor role assigned to ${data.userId}, initializing...`);
                await VendorService.initializeVendor(data.tenantId, data.userId);
            } catch (error) {
                console.error(`[Vendor] Failed to initialize vendor on role assignment:`, error);
            }
        }
    });

    // Vendor role removed → deactivate collection
    eventBus.on('role.removed', async (event) => {
        const data = event.data;
        if (data.roleName === 'Vendor') {
            try {
                console.log(`[Vendor] Vendor role removed from ${data.userId}, deactivating...`);
                await VendorService.deactivateVendor(data.tenantId, data.userId);
            } catch (error) {
                console.error(`[Vendor] Failed to deactivate vendor on role removal:`, error);
            }
        }
    });

    // Business name updated → re-sync vendor collection + product tags
    eventBus.on('user.profile_updated', async (event) => {
        const data = event.data;
        try {
            const Role = require('../../platform/core/roles/models/Role');
            const userRoles = await Role.getUserRoles(data.tenantId, data.userId);
            if (userRoles.some(role => role.name === 'Vendor')) {
                console.log(`[Vendor] Business name updated for vendor ${data.userId}, re-initializing...`);
                await VendorService.initializeVendor(data.tenantId, data.userId);
            }
        } catch (error) {
            console.error(`[Vendor] Failed to update vendor on profile update:`, error);
        }
    });

    // ─── KYC Events ────────────────────────────────────────────────────────

    eventBus.on('user.kyc.submitted', async (event) => {
        const { tenantId, userId, userEmail } = event.data;
        console.log(`[Vendor] KYC submitted by user ${userEmail} (${userId}) in tenant ${tenantId}`);
        // TODO: Notify admin via email/notification when mail module is hooked
    });

    eventBus.on('user.kyc.approved', async (event) => {
        const { tenantId, userId, userEmail, reviewedBy } = event.data;
        console.log(`[Vendor] KYC approved for ${userEmail} by admin ${reviewedBy}`);
        // TODO: Send approval email to user via mail module event
        eventBus.emitEvent('mail.send', {
            tenantId,
            to: userEmail,
            template: 'kyc_approved',
            data: { userEmail }
        });
    });

    eventBus.on('user.kyc.rejected', async (event) => {
        const { tenantId, userId, userEmail, reason, reviewedBy } = event.data;
        console.log(`[Vendor] KYC rejected for ${userEmail}. Reason: ${reason}`);
        eventBus.emitEvent('mail.send', {
            tenantId,
            to: userEmail,
            template: 'kyc_rejected',
            data: { userEmail, reason }
        });
    });

    // ─── KYB Events ────────────────────────────────────────────────────────

    eventBus.on('user.kyb.submitted', async (event) => {
        const { tenantId, userId, userEmail } = event.data;
        console.log(`[Vendor] KYB submitted by ${userEmail} in tenant ${tenantId}`);
    });

    eventBus.on('user.kyb.approved', async (event) => {
        const { tenantId, userId, userEmail, reviewedBy } = event.data;
        console.log(`[Vendor] KYB approved for ${userEmail} by admin ${reviewedBy}`);
        eventBus.emitEvent('mail.send', {
            tenantId,
            to: userEmail,
            template: 'kyb_approved',
            data: { userEmail }
        });
    });

    eventBus.on('user.kyb.rejected', async (event) => {
        const { tenantId, userId, userEmail, reason, reviewedBy } = event.data;
        console.log(`[Vendor] KYB rejected for ${userEmail}. Reason: ${reason}`);
        eventBus.emitEvent('mail.send', {
            tenantId,
            to: userEmail,
            template: 'kyb_rejected',
            data: { userEmail, reason }
        });
    });

    // ─── Application Pipeline Events ───────────────────────────────────────

    eventBus.on('vendor.application.started', async (event) => {
        const { tenantId, userId, applicationId } = event.data;
        console.log(`[Vendor] Application ${applicationId} started by user ${userId}`);
    });

    eventBus.on('vendor.application.submitted', async (event) => {
        const { tenantId, userId, applicationId } = event.data;
        console.log(`[Vendor] Application ${applicationId} submitted for review by user ${userId}`);
        // TODO: Notify admin of new application pending review
    });

    eventBus.on('vendor.application.stage_advanced', async (event) => {
        const { tenantId, userId, applicationId, fromStatus, toStatus } = event.data;
        console.log(`[Vendor] Application ${applicationId} advanced: ${fromStatus} → ${toStatus}`);
        // TODO: Notify user of their application progress via mail.send event
    });

    eventBus.on('vendor.application.training_passed', async (event) => {
        const { tenantId, userId, applicationId } = event.data;
        console.log(`[Vendor] Training passed for application ${applicationId}`);
    });

    eventBus.on('vendor.application.test_products_submitted', async (event) => {
        const { tenantId, userId, applicationId, productCount } = event.data;
        console.log(`[Vendor] ${productCount} test product(s) submitted for application ${applicationId}`);
    });

    eventBus.on('vendor.application.test_reviewed', async (event) => {
        const { tenantId, applicationId, result } = event.data;
        console.log(`[Vendor] Test products reviewed for application ${applicationId}. Result: ${result}`);
        // TODO: Notify user of test results
    });

    eventBus.on('vendor.application.setup_complete', async (event) => {
        const { tenantId, userId, applicationId } = event.data;
        console.log(`[Vendor] Setup complete for application ${applicationId}`);
    });

    eventBus.on('vendor.application.approved', async (event) => {
        const { tenantId, userId, applicationId, reviewedBy } = event.data;
        console.log(`[Vendor] Application ${applicationId} APPROVED. Vendor role assigned to user ${userId}`);
        // TODO: Send welcome-as-vendor email
        eventBus.emitEvent('mail.send', {
            tenantId,
            template: 'vendor_approved',
            data: { userId }
        });
    });

    eventBus.on('vendor.application.rejected', async (event) => {
        const { tenantId, userId, applicationId, reason } = event.data;
        console.log(`[Vendor] Application ${applicationId} rejected. Reason: ${reason}`);
        // TODO: Send rejection email
    });

    // ─── Vendor Lifecycle Events ───────────────────────────────────────────

    eventBus.on('vendor.suspended', async (event) => {
        const { tenantId, userId, reason, suspendedBy } = event.data;
        console.log(`[Vendor] Vendor ${userId} suspended by ${suspendedBy}. Reason: ${reason}`);
    });

    eventBus.on('vendor.restored', async (event) => {
        const { tenantId, userId, restoredBy } = event.data;
        console.log(`[Vendor] Vendor ${userId} restored by ${restoredBy}`);
    });

    eventBus.on('vendor.terminated', async (event) => {
        const { tenantId, userId, reason, terminatedBy } = event.data;
        console.log(`[Vendor] Vendor ${userId} terminated by ${terminatedBy}. Reason: ${reason}`);
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
