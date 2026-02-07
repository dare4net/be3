/**
 * Roles Module Bootstrapper
 */

const express = require('express');
const Role = require('./models/Role');
const Permission = require('./models/Permission');
const { authenticate } = require('../auth/middleware/authenticate');
const authorize = require('./middleware/authorize');
const { asyncHandler } = require('../../../middleware/errorHandler');

async function bootstrap(context) {
    const { app } = context;

    const router = express.Router();

    // Get all roles (tenant-scoped)
    router.get('/', authenticate, authorize('roles.view'), asyncHandler(async (req, res) => {
        const roles = await Role.findAll(req.tenantId);
        res.json({ success: true, roles });
    }));

    // Create role
    router.post('/', authenticate, authorize('roles.create'), asyncHandler(async (req, res) => {
        const role = await Role.create(req.tenantId, req.body);
        res.status(201).json({ success: true, role });
    }));

    // Assign permission to role
    router.post('/:roleId/permissions', authenticate, authorize('roles.manage'), asyncHandler(async (req, res) => {
        await Role.assignPermission(req.tenantId, req.params.roleId, req.body.permissionId);
        res.json({ success: true });
    }));

    // Get role permissions
    router.get('/:roleId/permissions', authenticate, authorize('roles.view'), asyncHandler(async (req, res) => {
        const permissions = await Role.getPermissions(req.tenantId, req.params.roleId);
        res.json({ success: true, permissions: permissions.map(p => p.id) });
    }));

    // Sync role permissions (Replace all)
    router.put('/:roleId/permissions', authenticate, authorize('roles.manage'), asyncHandler(async (req, res) => {
        const { permissions } = req.body; // Array of permission IDs
        const roleId = req.params.roleId;
        const tenantId = req.tenantId;

        // 1. Get current
        const currentPerms = await Role.getPermissions(tenantId, roleId);
        const currentIds = currentPerms.map(p => p.id);

        // 2. Identify to Remove
        const toRemove = currentIds.filter(id => !permissions.includes(id));
        for (const pid of toRemove) {
            await Role.removePermission(tenantId, roleId, pid);
        }

        // 3. Identify to Add
        const toAdd = permissions.filter(id => !currentIds.includes(id));
        for (const pid of toAdd) {
            await Role.assignPermission(tenantId, roleId, pid);
        }

        res.json({ success: true });
    }));

    // Assign role to user
    router.post('/:roleId/users', authenticate, authorize('roles.assign'), asyncHandler(async (req, res) => {
        const RoleService = require('./services/RoleService');
        await RoleService.assignRoleIdToUser(req.tenantId, req.body.userId, req.params.roleId);
        res.json({ success: true });
    }));

    // Remove role from user
    router.delete('/:roleId/users/:userId', authenticate, authorize('roles.assign'), asyncHandler(async (req, res) => {
        await Role.removeFromUser(req.tenantId, req.params.userId, req.params.roleId);
        res.json({ success: true });
    }));

    // Link to permission management routes
    const permissionsRouter = require('./routes/permissions.routes');

    // Mount globally at /api/permissions (Recommended architecture)
    app.use('/api/permissions', permissionsRouter);
    console.log('[Roles] Permission management routes registered at /api/permissions');

    app.use('/roles', router);
    console.log('[Roles] Roles routes registered at /roles');

    return true;

    return true;
}

module.exports = { bootstrap };
