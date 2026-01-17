/**
 * Subscription Guard Middleware
 * 
 * PRINCIPLE: All feature access is subscription-gated
 * 
 * Verifies that tenant's subscription plan includes access to the requested module
 * Uses Redis caching to minimize database queries
 */

const { query } = require('../config/database');
const {
    getModuleAccessCache,
    setModuleAccessCache,
    getSubscriptionCache,
    setSubscriptionCache
} = require('../config/redis');

/**
 * Create middleware to check module access
 * @param {string} moduleName - Name of the module to check access for
 * @returns {Function} Express middleware
 */
function subscriptionGuard(moduleName) {
    return async (req, res, next) => {
        try {
            // Skip guard for OPTIONS (CORS preflight)
            if (req.method === 'OPTIONS') {
                return next();
            }

            const { tenantId } = req;

            // Log for debugging
            console.log(`[SubscriptionGuard] Checking access for tenant: ${tenantId}, module: ${moduleName}`);

            if (!tenantId) {
                return res.status(400).json({
                    error: 'Tenant required',
                    message: 'Tenant context is required for this operation',
                });
            }

            // Check cache first
            const cachedAccess = await getModuleAccessCache(tenantId, moduleName);
            if (cachedAccess === true) {
                return next();
            }

            // 1. Check for specific tenant override (tenant_modules)
            // PRINCIPLE: Tenant-specific settings override plan settings
            const tenantOverride = await query(
                `SELECT is_enabled FROM tenant_modules 
                 WHERE tenant_id = $1 AND module_name = $2`,
                [tenantId, moduleName]
            );

            if (tenantOverride.rows.length > 0) {
                console.log(`[SubscriptionGuard] Found tenant override:`, tenantOverride.rows[0]);
                // If override exists, strictly follow it
                if (!tenantOverride.rows[0].is_enabled) {
                    return res.status(403).json({
                        error: 'Module disabled',
                        message: `The ${moduleName} module has been disabled for your tenant.`,
                        requiredModule: moduleName
                    });
                }
                // If enabled, proceed
                await setModuleAccessCache(tenantId, moduleName, true);
                return next();
            }

            // Query database for subscription
            let subscription = await getSubscriptionCache(tenantId);

            if (!subscription) {
                const result = await query(
                    `SELECT s.*, sp.name as plan_name
           FROM subscriptions s
           JOIN subscription_plans sp ON s.plan_id = sp.id
           WHERE s.tenant_id = $1 AND s.status IN ('active', 'trialing')
           ORDER BY s.created_at DESC
           LIMIT 1`,
                    [tenantId]
                );

                if (result.rows.length === 0) {
                    return res.status(403).json({
                        error: 'No active subscription',
                        message: 'Please subscribe to a plan to access this feature',
                        requiredModule: moduleName,
                    });
                }

                subscription = result.rows[0];
                await setSubscriptionCache(tenantId, subscription);
            }

            console.log(`[SubscriptionGuard] No override, checking plan...`);
            // 2. Check if plan includes this module (Fallback if no override)
            const moduleCheck = await query(
                `SELECT 1 FROM plan_modules pm
         JOIN subscription_plans sp ON pm.plan_id = sp.id
         JOIN subscriptions s ON s.plan_id = sp.id
         WHERE s.tenant_id = $1 
         AND s.status IN ('active', 'trialing')
         AND pm.module_name = $2
         AND pm.is_enabled = true`,
                [tenantId, moduleName]
            );

            if (moduleCheck.rows.length === 0) {
                return res.status(403).json({
                    error: 'Module not included in plan',
                    message: `Your ${subscription.plan_name} plan does not include the ${moduleName} module`,
                    requiredModule: moduleName,
                    currentPlan: subscription.plan_name,
                    upgradeUrl: '/subscriptions/plans',
                });
            }

            // Cache the positive result
            await setModuleAccessCache(tenantId, moduleName, true);

            next();
        } catch (error) {
            console.error('[SubscriptionGuard] Error:', error);
            return res.status(500).json({
                error: 'Subscription verification failed',
                message: 'Unable to verify module access',
            });
        }
    };
}

module.exports = subscriptionGuard;
