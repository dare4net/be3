/**
 * Subscription Plan Model
 */

const { query } = require('../../../../config/database');

class SubscriptionPlan {
    static async create(planData) {
        const sql = `
      INSERT INTO subscription_plans (name, description, price_monthly, price_yearly, features, max_users, max_products, max_orders_per_month, trial_days)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *
    `;
        const result = await query(sql, [
            planData.name, planData.description, planData.price_monthly, planData.price_yearly,
            JSON.stringify(planData.features || {}), planData.max_users, planData.max_products,
            planData.max_orders_per_month, planData.trial_days || 14
        ]);
        return result.rows[0];
    }

    static async findById(planId) {
        const sql = `SELECT * FROM subscription_plans WHERE id = $1`;
        const result = await query(sql, [planId]);
        return result.rows[0] || null;
    }

    static async findAll(publicOnly = true) {
        const sql = publicOnly
            ? `SELECT * FROM subscription_plans WHERE is_active = true AND is_public = true ORDER BY price_monthly`
            : `SELECT * FROM subscription_plans ORDER BY price_monthly`;
        const result = await query(sql);
        return result.rows;
    }

    static async addModule(planId, moduleName, limits = {}) {
        const sql = `INSERT INTO plan_modules (plan_id, module_name, is_enabled, limits) VALUES ($1, $2, true, $3) ON CONFLICT (plan_id, module_name) DO UPDATE SET is_enabled = true RETURNING *`;
        const result = await query(sql, [planId, moduleName, JSON.stringify(limits)]);
        return result.rows[0];
    }

    static async getModules(planId) {
        const sql = `SELECT * FROM plan_modules WHERE plan_id = $1 AND is_enabled = true`;
        const result = await query(sql, [planId]);
        return result.rows;
    }
}

module.exports = SubscriptionPlan;
