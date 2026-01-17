/**
 * Module Registry Bootstrapper
 * PRINCIPLE: Any module can be removed without crashing the system
 */

const express = require('express');
const { query } = require('../../../config/database');
const { setModuleAccessCache } = require('../../../config/redis');
const { authenticate } = require('../auth/middleware/authenticate');
const { asyncHandler } = require('../../../middleware/errorHandler');

async function bootstrap(context) {
    const { app } = context;
    const router = express.Router();

    // Get all available modules
    router.get('/', asyncHandler(async (req, res) => {
        const sql = `SELECT * FROM modules ORDER BY is_core DESC, name`;
        const result = await query(sql);
        res.json({ success: true, modules: result.rows });
    }));

    // Get enabled modules for tenant
    router.get('/tenant', authenticate, asyncHandler(async (req, res) => {
        const sql = `SELECT * FROM tenant_modules WHERE tenant_id = $1 AND is_enabled = true`;
        const result = await query(sql, [req.tenantId]);
        res.json({ success: true, modules: result.rows });
    }));

    // Enable module for tenant
    router.post('/:moduleName/enable', authenticate, asyncHandler(async (req, res) => {
        const sql = `
      INSERT INTO tenant_modules (tenant_id, module_name, is_enabled)
      VALUES ($1, $2, true)
      ON CONFLICT (tenant_id, module_name) 
      DO UPDATE SET is_enabled = true, enabled_at = NOW()
      RETURNING *
    `;
        const result = await query(sql, [req.tenantId, req.params.moduleName]);
        res.json({ success: true, module: result.rows[0] });
    }));

    // Disable module for tenant
    router.post('/:moduleName/disable', authenticate, asyncHandler(async (req, res) => {
        const sql = `
      UPDATE tenant_modules 
      SET is_enabled = false, disabled_at = NOW()
      WHERE tenant_id = $1 AND module_name = $2
      RETURNING *
    `;
        const result = await query(sql, [req.tenantId, req.params.moduleName]);
        res.json({ success: true, module: result.rows[0] });
    }));

    // ==========================================
    // Super Admin Routes (No Tenant Auth required, just Admin Middleware)
    // ==========================================

    // Get modules for specific tenant
    router.get('/admin/tenants/:tenantId/modules', asyncHandler(async (req, res) => {
        // First get all enabled modules
        const enabledParams = [req.params.tenantId];
        const enabledSql = `SELECT * FROM tenant_modules WHERE tenant_id = $1 AND is_enabled = true`;
        const enabledRes = await query(enabledSql, enabledParams);

        // Also get all available modules to show what can be enabled
        const allModulesRes = await query(`SELECT * FROM modules`);

        // Map enabled status
        const modules = allModulesRes.rows.map(mod => {
            const isEnabled = enabledRes.rows.some(em => em.module_name === mod.name);
            return { ...mod, is_enabled: isEnabled };
        });

        res.json({ success: true, modules });
    }));

    // Toggle module for specific tenant (Admin)
    router.post('/admin/tenants/:tenantId/modules/:moduleName/toggle', asyncHandler(async (req, res) => {
        const { is_enabled } = req.body;

        let sql;
        if (is_enabled) {
            sql = `
                INSERT INTO tenant_modules (tenant_id, module_name, is_enabled)
                VALUES ($1, $2, true)
                ON CONFLICT (tenant_id, module_name) 
                DO UPDATE SET is_enabled = true, enabled_at = NOW()
            `;
        } else {
            sql = `
                UPDATE tenant_modules 
                SET is_enabled = false, disabled_at = NOW()
                WHERE tenant_id = $1 AND module_name = $2
            `;
        }

        await query(sql, [req.params.tenantId, req.params.moduleName]);

        // Update Cache immediately
        await setModuleAccessCache(req.params.tenantId, req.params.moduleName, is_enabled);

        res.json({ success: true, message: `Module ${is_enabled ? 'enabled' : 'disabled'}` });
    }));

    app.use('/modules', router);
    console.log('[ModuleRegistry] Routes registered at /modules');

    return true;
}

module.exports = { bootstrap };
