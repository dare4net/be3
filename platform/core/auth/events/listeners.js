/**
 * Authentication Module Event Listeners
 * 
 * PRINCIPLE: All inter-module communication is event-based
 * PRINCIPLE: Modules do not import other modules
 */

const User = require('../models/User');
const eventBus = require('../../../events/EventBus');

/**
 * Register event listeners for auth module
 */
function registerListeners() {
    /**
     * Listen for tenant.created events
     * Create default admin user for new tenants
     */
    eventBus.registerListener('tenant.created', async (event) => {
        const { tenantId, subdomain } = event.data;

        try {
            const bcrypt = require('bcrypt');
            const { v4: uuid } = require('uuid');

            // Create default admin user
            const passwordHash = await bcrypt.hash('Admin@123', 10);

            await User.create(tenantId, {
                email: `admin@${subdomain}.com`,
                password_hash: passwordHash,
                first_name: 'Admin',
                last_name: 'User',
                email_verification_token: uuid(),
            });

            console.log(`[Auth] Created default admin user for tenant ${tenantId}`);
        } catch (error) {
            console.error('[Auth] Failed to create default admin user:', error.message);
            // Don't throw - failing to create admin shouldn't break tenant creation
            // PRINCIPLE: Any module can be removed without crashing the system
        }
    }, 'auth');

    console.log('[Auth] Event listeners registered');
}

module.exports = { registerListeners };
