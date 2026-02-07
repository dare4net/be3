/**
 * Permission Management Routes
 * API endpoints for managing user permissions and category access
 */

const express = require('express');
const router = express.Router();
const PermissionService = require('../services/PermissionService');
const Permission = require('../models/Permission');
const { authenticate } = require('../../auth/middleware/authenticate');
const { requirePermission } = require('../../../../middleware/permissionMiddleware');

/**
 * GET /api/permissions
 * List all available permissions
 */
router.get('/', authenticate, requirePermission('roles.view'), async (req, res) => {
    try {
        const permissions = await Permission.findAll();
        res.json({ permissions });
    } catch (error) {
        console.error('[PermissionsAPI] Error fetching permissions:', error);
        res.status(500).json({ error: 'Failed to fetch permissions' });
    }
});

/**
 * GET /api/permissions/user/:userId
 * Get user's permissions and category access
 */
router.get('/user/:userId', authenticate, requirePermission('users.view'), async (req, res) => {
    try {
        const { tenantId } = req;
        const { userId } = req.params;

        const permissionContext = await PermissionService.getUserPermissionContext(tenantId, userId);

        res.json({
            userId,
            permissions: permissionContext.permissions,
            roles: permissionContext.roles,
            categoryAccess: permissionContext.categoryAccess
        });
    } catch (error) {
        console.error('[PermissionsAPI] Error fetching user permissions:', error);
        res.status(500).json({ error: 'Failed to fetch user permissions' });
    }
});

/**
 * POST /api/permissions/user/:userId/categories
 * Assign categories to a user
 * Body: { categoryIds: string[] } - Empty array for unrestricted access
 */
router.post('/user/:userId/categories', authenticate, requirePermission('roles.assign'), async (req, res) => {
    try {
        const { tenantId } = req;
        const { userId } = req.params;
        const { categoryIds } = req.body;

        if (!Array.isArray(categoryIds)) {
            return res.status(400).json({ error: 'categoryIds must be an array' });
        }

        await PermissionService.assignCategoriesToUser(tenantId, userId, categoryIds);

        const categoryAccess = await PermissionService.getUserCategoryAccess(tenantId, userId);

        res.json({
            success: true,
            message: categoryIds.length === 0
                ? 'User granted unrestricted category access'
                : `User assigned to ${categoryIds.length} categories`,
            categoryAccess
        });
    } catch (error) {
        console.error('[PermissionsAPI] Error assigning categories:', error);
        res.status(500).json({ error: 'Failed to assign categories' });
    }
});

/**
 * DELETE /api/permissions/user/:userId/categories
 * Remove all category restrictions (grant full access)
 */
router.delete('/user/:userId/categories', authenticate, requirePermission('roles.assign'), async (req, res) => {
    try {
        const { tenantId } = req;
        const { userId } = req.params;

        await Permission.removeUserCategoryPermissions(tenantId, userId);

        res.json({
            success: true,
            message: 'Category restrictions removed - user has unrestricted access'
        });
    } catch (error) {
        console.error('[PermissionsAPI] Error removing category restrictions:', error);
        res.status(500).json({ error: 'Failed to remove category restrictions' });
    }
});

/**
 * GET /api/permissions/user/:userId/categories
 * Get user's allowed categories
 */
router.get('/user/:userId/categories', authenticate, requirePermission('users.view'), async (req, res) => {
    try {
        const { tenantId } = req;
        const { userId } = req.params;

        const categoryAccess = await PermissionService.getUserCategoryAccess(tenantId, userId);

        res.json({
            userId,
            hasUnrestrictedAccess: categoryAccess.hasUnrestrictedAccess,
            allowedCategories: categoryAccess.allowedCategories
        });
    } catch (error) {
        console.error('[PermissionsAPI] Error fetching user categories:', error);
        res.status(500).json({ error: 'Failed to fetch user categories' });
    }
});

module.exports = router;
