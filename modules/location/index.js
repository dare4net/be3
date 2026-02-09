/**
 * Location Module Routes
 * Handles vendor location management endpoints
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../../platform/core/auth/middleware/authenticate');
const { asyncHandler } = require('../../middleware/errorHandler');
const LocationService = require('./services/LocationService');

/**
 * Create a new location
 * POST /location
 */
router.post('/', authenticate, asyncHandler(async (req, res) => {
    const { id: vendorId } = req.user;
    const tenantId = req.tenantId;
    const locationData = req.body;

    const location = await LocationService.createLocation(tenantId, vendorId, locationData);

    res.status(201).json({
        success: true,
        location
    });
}));

/**
 * Get all locations for the authenticated vendor
 * GET /location
 */
router.get('/', authenticate, asyncHandler(async (req, res) => {
    const { id: vendorId } = req.user;
    const tenantId = req.tenantId;

    const locations = await LocationService.getVendorLocations(tenantId, vendorId);

    res.json({
        success: true,
        locations
    });
}));

/**
 * Get a specific location
 * GET /location/:id
 */
router.get('/:id', authenticate, asyncHandler(async (req, res) => {
    const { id: locationId } = req.params;
    const { id: vendorId } = req.user;
    const tenantId = req.tenantId;

    const location = await LocationService.getLocationById(tenantId, locationId);

    if (!location) {
        return res.status(404).json({
            success: false,
            error: 'Location not found'
        });
    }

    // Verify ownership
    if (location.vendor_id !== vendorId) {
        return res.status(403).json({
            success: false,
            error: 'Access denied'
        });
    }

    res.json({
        success: true,
        location
    });
}));

/**
 * Update a location
 * PUT /location/:id
 */
router.put('/:id', authenticate, asyncHandler(async (req, res) => {
    const { id: locationId } = req.params;
    const { id: vendorId } = req.user;
    const tenantId = req.tenantId;
    const locationData = req.body;

    // Verify ownership
    const existingLocation = await LocationService.getLocationById(tenantId, locationId);
    if (!existingLocation) {
        return res.status(404).json({
            success: false,
            error: 'Location not found'
        });
    }

    if (existingLocation.vendor_id !== vendorId) {
        return res.status(403).json({
            success: false,
            error: 'Access denied'
        });
    }

    const location = await LocationService.updateLocation(tenantId, locationId, vendorId, locationData);

    res.json({
        success: true,
        location
    });
}));

/**
 * Delete a location
 * DELETE /location/:id
 */
router.delete('/:id', authenticate, asyncHandler(async (req, res) => {
    const { id: locationId } = req.params;
    const { id: vendorId } = req.user;
    const tenantId = req.tenantId;

    // Verify ownership
    const existingLocation = await LocationService.getLocationById(tenantId, locationId);
    if (!existingLocation) {
        return res.status(404).json({
            success: false,
            error: 'Location not found'
        });
    }

    if (existingLocation.vendor_id !== vendorId) {
        return res.status(403).json({
            success: false,
            error: 'Access denied'
        });
    }

    await LocationService.deleteLocation(tenantId, locationId);

    res.json({
        success: true,
        message: 'Location deleted successfully'
    });
}));

/**
 * Set a location as primary
 * PUT /location/:id/primary
 */
router.put('/:id/primary', authenticate, asyncHandler(async (req, res) => {
    const { id: locationId } = req.params;
    const { id: vendorId } = req.user;
    const tenantId = req.tenantId;

    // Verify ownership
    const existingLocation = await LocationService.getLocationById(tenantId, locationId);
    if (!existingLocation) {
        return res.status(404).json({
            success: false,
            error: 'Location not found'
        });
    }

    if (existingLocation.vendor_id !== vendorId) {
        return res.status(403).json({
            success: false,
            error: 'Access denied'
        });
    }

    const location = await LocationService.setPrimaryLocation(tenantId, locationId, vendorId);

    res.json({
        success: true,
        location
    });
}));

/**
 * Bootstrap function for module loading
 */
async function bootstrap(context) {
    const { app } = context;

    app.use('/location', router);
    console.log('[Location] Module initialized at /location');

    return true;
}

module.exports = { bootstrap };
