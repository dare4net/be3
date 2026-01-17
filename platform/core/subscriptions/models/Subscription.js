/**
 * Subscription Model
 * PRINCIPLE: Multi-tenant by default
 * PRINCIPLE: All feature access is subscription-gated
 */

const { query } = require('../../../../config/database');
const { tenantInsert } = require('../../../../utils/dbHelpers');

class Subscription {
    static async create(tenantId, planId) {
        const periodEnd = new Date();
        periodEnd.setMonth(periodEnd.getMonth() + 1); // 1 month subscription

        return await tenantInsert('subscriptions', tenantId, {
            plan_id: planId,
            status: 'trialing',
            current_period_end: periodEnd,
            trial_end: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days
        });
    }

    static async findActive(tenantId) {
        const sql = `SELECT * FROM subscriptions WHERE tenant_id = $1 AND status = 'active' ORDER BY created_at DESC LIMIT 1`;
        const result = await query(sql, [tenantId]);
        return result.rows[0] || null;
    }

    static async hasModuleAccess(tenantId, moduleName) {
        const sql = `
      SELECT 1 FROM subscriptions s
      JOIN plan_modules pm ON s.plan_id = pm.plan_id
      WHERE s.tenant_id = $1 AND s.status IN ('active', 'trialing') 
      AND pm.module_name = $2 AND pm.is_enabled = true
      UNION
      SELECT 1 FROM tenant_module_overrides
      WHERE tenant_id = $1 AND module_name = $2 AND is_enabled = true
    `;
        const result = await query(sql, [tenantId, moduleName]);
        return result.rows.length > 0;
    }

    static async cancel(tenantId) {
        const sql = `UPDATE subscriptions SET status = 'cancelled', cancelled_at = NOW() WHERE tenant_id = $1 AND status = 'active' RETURNING *`;
        const result = await query(sql, [tenantId]);
        return result.rows[0];
    }
}

module.exports = Subscription;
