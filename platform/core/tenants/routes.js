/**
 * Tenant Routes
 * 
 * PRINCIPLE: Multi-tenant by default
 * Most routes are protected and scoped to the authenticated tenant
 */

const express = require('express');
const Joi = require('joi');
const TenantService = require('./services/TenantService');
const { authenticate } = require('../auth/middleware/authenticate');
const { asyncHandler } = require('../../../middleware/errorHandler');

const router = express.Router();

/**
 * Validation schemas
 */
const createTenantSchema = Joi.object({
    name: Joi.string().required(),
    subdomain: Joi.string().pattern(/^[a-z0-9-]+$/).required(),
    domain: Joi.string().optional(),
    settings: Joi.object().optional(),
    logo_url: Joi.string().uri().optional(),
    timezone: Joi.string().optional(),
    setup_status: Joi.string().valid('NEW', 'COMPLETED', 'RESET').optional(),
});

const updateTenantSchema = Joi.object({
    name: Joi.string().optional(),
    domain: Joi.string().optional(),
    status: Joi.string().valid('active', 'suspended', 'trial', 'cancelled').optional(),
    settings: Joi.object().optional(),
    logo_url: Joi.string().uri().optional(),
    timezone: Joi.string().optional(),
    setup_status: Joi.string().valid('NEW', 'COMPLETED', 'RESET').optional(),
});

const checkSubdomainSchema = Joi.object({
    subdomain: Joi.string().pattern(/^[a-z0-9-]+$/).required(),
});

/**
 * POST /tenants
 * Create a new tenant (public endpoint for signup)
 */
router.post('/', asyncHandler(async (req, res) => {
    // Validate input
    const { error, value } = createTenantSchema.validate(req.body);
    if (error) {
        return res.status(400).json({
            error: 'ValidationError',
            message: error.details[0].message,
        });
    }

    try {
        const tenant = await TenantService.createTenant(value);

        res.status(201).json({
            success: true,
            message: 'Tenant created successfully',
            tenant,
        });
    } catch (err) {
        res.status(400).json({
            error: 'TenantCreationFailed',
            message: err.message,
        });
    }
}));

/**
 * GET /tenants/current
 * Get current tenant (authenticated)
 */
router.get('/current', authenticate, asyncHandler(async (req, res) => {
    const { tenantId } = req;

    const tenant = await TenantService.getTenant(tenantId);

    res.json({
        success: true,
        tenant,
    });
}));

/**
 * GET /tenants/lookup
 * Resolve subdomain to tenant (public)
 */
router.get('/lookup', asyncHandler(async (req, res) => {
    const { subdomain } = req.query;

    if (!subdomain) {
        return res.status(400).json({ error: 'ValidationError', message: 'Subdomain is required' });
    }

    const tenant = await TenantService.getTenantBySubdomain(subdomain);

    if (!tenant) {
        return res.status(404).json({ error: 'NotFound', message: 'Tenant not found' });
    }

    res.json({
        success: true,
        tenant,
    });
}));

/**
 * GET /tenants/:id
 * Get tenant by ID (super admin only - will add auth later)
 */
router.get('/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;

    try {
        const tenant = await TenantService.getTenant(id);

        res.json({
            success: true,
            tenant,
        });
    } catch (err) {
        res.status(404).json({
            error: 'NotFound',
            message: err.message,
        });
    }
}));

/**
 * PATCH /tenants/current
 * Update current tenant
 */
router.patch('/current', authenticate, asyncHandler(async (req, res) => {
    const { tenantId } = req;

    // Validate input
    const { error, value } = updateTenantSchema.validate(req.body);
    if (error) {
        return res.status(400).json({
            error: 'ValidationError',
            message: error.details[0].message,
        });
    }

    try {
        const updatedTenant = await TenantService.updateTenant(tenantId, value);

        res.json({
            success: true,
            message: 'Tenant updated successfully',
            tenant: updatedTenant,
        });
    } catch (err) {
        res.status(400).json({
            error: 'UpdateFailed',
            message: err.message,
        });
    }
}));

/**
 * GET /tenants/current/settings
 * Get tenant settings
 */
router.get('/current/settings', authenticate, asyncHandler(async (req, res) => {
    const { tenantId } = req;

    const settings = await TenantService.getSettings(tenantId);

    res.json({
        success: true,
        settings,
    });
}));

/**
 * PATCH /tenants/current/settings
 * Update tenant settings
 */
router.patch('/current/settings', authenticate, asyncHandler(async (req, res) => {
    const { tenantId } = req;

    try {
        const updatedTenant = await TenantService.updateSettings(tenantId, req.body);

        res.json({
            success: true,
            message: 'Settings updated successfully',
            settings: updatedTenant.settings,
        });
    } catch (err) {
        res.status(400).json({
            error: 'UpdateFailed',
            message: err.message,
        });
    }
}));

/**
 * DELETE /tenants/current
 * Delete current tenant
 */
router.delete('/current', authenticate, asyncHandler(async (req, res) => {
    const { tenantId } = req;

    try {
        await TenantService.deleteTenant(tenantId);

        res.json({
            success: true,
            message: 'Tenant deleted successfully',
        });
    } catch (err) {
        res.status(400).json({
            error: 'DeleteFailed',
            message: err.message,
        });
    }
}));

/**
 * POST /tenants/check-subdomain
 * Check if subdomain is available (public)
 */
router.post('/check-subdomain', asyncHandler(async (req, res) => {
    const { error, value } = checkSubdomainSchema.validate(req.body);
    if (error) {
        return res.status(400).json({
            error: 'ValidationError',
            message: error.details[0].message,
        });
    }

    const isAvailable = await TenantService.checkSubdomainAvailability(value.subdomain);

    res.json({
        success: true,
        available: isAvailable,
        subdomain: value.subdomain,
    });
}));

module.exports = router;
