/**
 * User Management Routes
 */

const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { authenticate } = require('../middleware/authenticate');
const { requirePermission } = require('../../../../middleware/permissionMiddleware');

/**
 * GET /users
 * List all users
 */
router.get('/', authenticate, requirePermission('users.view'), async (req, res) => {
    try {
        const users = await User.findAll(req.tenantId);
        // Sanitize users (remove password hashes)
        const sanitizedUsers = users.map(u => ({
            id: u.id,
            email: u.email,
            first_name: u.first_name,
            last_name: u.last_name,
            business_name: u.business_name,
            status: u.status,
            created_at: u.created_at
        }));
        res.json({ success: true, users: sanitizedUsers });
    } catch (error) {
        console.error('[UsersAPI] Error fetching users:', error);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

/**
 * GET /users/:id
 * Get single user details
 */
router.get('/:id', authenticate, requirePermission('users.view'), async (req, res) => {
    try {
        const user = await User.findById(req.tenantId, req.params.id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({
            success: true,
            user: {
                id: user.id,
                email: user.email,
                first_name: user.first_name,
                last_name: user.last_name,
                business_name: user.business_name,
                status: user.status
            }
        });
    } catch (error) {
        console.error('[UsersAPI] Error fetching user:', error);
        res.status(500).json({ error: 'Failed to fetch user' });
    }
});

/**
 * PATCH /users/:id
 * Update user details
 */
router.patch('/:id', authenticate, requirePermission('users.manage'), async (req, res) => {
    const AuthService = require('../services/AuthService');
    try {
        const updatedUser = await AuthService.updateUser(req.tenantId, req.params.id, req.body);
        res.json({ success: true, user: updatedUser });
    } catch (error) {
        console.error('[UsersAPI] Error updating user:', error);
        res.status(500).json({ error: 'Failed to update user' });
    }
});

module.exports = router;
