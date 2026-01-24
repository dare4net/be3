const express = require('express');
const router = express.Router();
const service = require('./service');
const { authenticate } = require('../../platform/core/auth/middleware/authenticate');
const { asyncHandler } = require('../../middleware/errorHandler');

// Get all banner groups
router.get('/groups', authenticate, asyncHandler(async (req, res) => {
    const groups = await service.getGroups(req.tenantId);
    res.json({ success: true, data: groups });
}));

// Get specific banner group
router.get('/groups/:id', authenticate, asyncHandler(async (req, res) => {
    const group = await service.getGroup(req.tenantId, req.params.id);
    if (!group) {
        return res.status(404).json({ success: false, message: 'Group not found' });
    }
    res.json({ success: true, data: group });
}));

// Create banner group
router.post('/groups', authenticate, asyncHandler(async (req, res) => {
    const group = await service.createGroup(req.tenantId, req.body);
    res.json({ success: true, data: group });
}));

// Update banner group
router.put('/groups/:id', authenticate, asyncHandler(async (req, res) => {
    const group = await service.updateGroup(req.tenantId, req.params.id, req.body);
    res.json({ success: true, data: group });
}));

// Delete banner group
router.delete('/groups/:id', authenticate, asyncHandler(async (req, res) => {
    await service.deleteGroup(req.tenantId, req.params.id);
    res.json({ success: true, message: 'Group deleted' });
}));

// Public endpoint for storefront (no auth required if just fetching by ID, but context usually helps)
// Currently assume public access via existing patterns or tenant ID header if needed.
// For simplicity, we reuse the authenticated routes for admin. 
// Storefront will likely need a public-facing route or use the generic API with a public key if that architecture exists.
// Replicating pattern: Public routes often separate. 
// Adding public route for storefront to fetch by ID
router.get('/public/groups/:id', asyncHandler(async (req, res) => {
    // Ideally tenantId comes from host header or middleware in a real multi-tenant public setup
    // For now assuming the caller passes it or we extract from context if available
    // But standardized public API usually requires x-tenant-id or similar.
    // Let's rely on the widget fetching via proxy which might use a read-only token or IP check.
    // For now, allow standard public access but require tenant_id in query if missing from context
    const tenantId = req.headers['x-tenant-id'] || req.query.tenant_id;
    if (!tenantId) return res.status(400).json({ success: false, message: 'Tenant ID required' });

    const group = await service.getGroup(tenantId, req.params.id);
    if (!group) {
        return res.status(404).json({ success: false, message: 'Group not found' });
    }
    res.json({ success: true, data: group });
}));

module.exports = router;
