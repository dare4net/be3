/**
 * Vendor Admin Routes
 * Requires authentication + appropriate vendor.* permissions
 * 
 * Covers: KYC/KYB review, application pipeline management,
 * test product review, vendor suspension/termination
 */

const express = require('express');
const router = express.Router();
const { query } = require('../../../config/database');
const { asyncHandler } = require('../../../middleware/errorHandler');
const { authenticate } = require('../../../platform/core/auth/middleware/authenticate');
const authorize = require('../../../platform/core/roles/middleware/authorize');

// ─── KYC Auto-Promotion Helper ────────────────────────────────────────────────
// Called after each granular KYC section is approved.
// If all three sections pass, flips kyc_status → 'approved' and emits the event.
async function tryPromoteKyc(tenantId, userId, adminUserId) {
    const User = require('../../../platform/core/auth/models/User');
    const u = await User.findById(tenantId, userId);
    if (!u) return;
    if (u.poi_status === 'approved' && u.liveness_status === 'approved' && u.poa_status === 'approved') {
        await User.update(tenantId, userId, {
            kyc_status: 'approved',
            kyc_reviewed_at: new Date(),
            kyc_reviewed_by: adminUserId,
            kyc_rejection_reason: null,
        });
        const eventBus = require('../../../platform/events/EventBus');
        eventBus.emitEvent('user.kyc.approved', {
            tenantId, userId, userEmail: u.email, reviewedBy: adminUserId
        });
        return true; // promoted
    }
    return false;
}

// ─── KYC Queue ────────────────────────────────────────────────────────────────

/**
 * GET /vendor/admin/kyc?status=submitted&page=1&limit=20
 */
router.get('/kyc', authenticate, authorize('vendors.kyc.review'), asyncHandler(async (req, res) => {
    const { tenantId } = req;
    const status = req.query.status || 'submitted';
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const result = await query(
        `SELECT id, email, first_name, last_name,
                kyc_status, kyc_submitted_at,
                poi_doc_type, poi_doc_url, poi_status, poi_submitted_at, poi_reviewed_at, poi_rejection_reason,
                poa_doc_type, poa_doc_url, poa_status, poa_submitted_at, poa_reviewed_at, poa_rejection_reason,
                liveness_video_url, liveness_status, liveness_reviewed_at, liveness_rejection_reason
         FROM users
         WHERE tenant_id = $1 AND kyc_status = $2 AND deleted_at IS NULL
         ORDER BY kyc_submitted_at ASC
         LIMIT $3 OFFSET $4`,
        [tenantId, status, limit, offset]
    );
    const count = await query(
        `SELECT COUNT(*) FROM users WHERE tenant_id=$1 AND kyc_status=$2 AND deleted_at IS NULL`,
        [tenantId, status]
    );

    res.json({
        success: true,
        data: result.rows,
        pagination: { page, limit, total: parseInt(count.rows[0].count), totalPages: Math.ceil(count.rows[0].count / limit) }
    });
}));

// ─── POI ──────────────────────────────────────────────────────────────────────

/** POST /vendor/admin/kyc/:userId/poi/approve */
router.post('/kyc/:userId/poi/approve', authenticate, authorize('vendors.kyc.review'), asyncHandler(async (req, res) => {
    const { tenantId, user: adminUser } = req;
    const { userId } = req.params;

    const User = require('../../../platform/core/auth/models/User');
    const targetUser = await User.findById(tenantId, userId);
    if (!targetUser) return res.status(404).json({ error: 'NotFound', message: 'User not found' });
    if (targetUser.poi_status !== 'submitted')
        return res.status(400).json({ error: 'InvalidState', message: `POI status is '${targetUser.poi_status}', not 'submitted'` });

    await User.update(tenantId, userId, {
        poi_status: 'approved',
        poi_reviewed_at: new Date(),
        poi_reviewed_by: adminUser.id,
        poi_rejection_reason: null,
    });

    const eventBus = require('../../../platform/events/EventBus');
    eventBus.emitEvent('user.kyc.poi.approved', { tenantId, userId, userEmail: targetUser.email, reviewedBy: adminUser.id });

    const promoted = await tryPromoteKyc(tenantId, userId, adminUser.id);
    res.json({ success: true, message: `POI approved for ${targetUser.email}`, kyc_fully_approved: promoted });
}));

/** POST /vendor/admin/kyc/:userId/poi/reject */
router.post('/kyc/:userId/poi/reject', authenticate, authorize('vendors.kyc.review'), asyncHandler(async (req, res) => {
    const { tenantId, user: adminUser } = req;
    const { userId } = req.params;
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ error: 'ValidationError', message: 'A rejection reason is required' });

    const User = require('../../../platform/core/auth/models/User');
    const targetUser = await User.findById(tenantId, userId);
    if (!targetUser) return res.status(404).json({ error: 'NotFound', message: 'User not found' });

    await User.update(tenantId, userId, {
        // POI rejected
        poi_status: 'rejected',
        poi_reviewed_at: new Date(),
        poi_reviewed_by: adminUser.id,
        poi_rejection_reason: reason,
        // Liveness is tied to the POI document — a new POI requires a new video
        liveness_status: 'rejected',
        liveness_reviewed_at: new Date(),
        liveness_reviewed_by: adminUser.id,
        liveness_rejection_reason: 'POI document was rejected — please resubmit with your new document',
        // Overall KYC status
        kyc_status: 'rejected',
        kyc_rejection_reason: reason,
    });

    const eventBus = require('../../../platform/events/EventBus');
    eventBus.emitEvent('user.kyc.poi.rejected', { tenantId, userId, userEmail: targetUser.email, reason, reviewedBy: adminUser.id });
    res.json({ success: true, message: `POI rejected for ${targetUser.email}` });
}));

// ─── Liveness ─────────────────────────────────────────────────────────────────

/** POST /vendor/admin/kyc/:userId/liveness/approve */
router.post('/kyc/:userId/liveness/approve', authenticate, authorize('vendors.kyc.review'), asyncHandler(async (req, res) => {
    const { tenantId, user: adminUser } = req;
    const { userId } = req.params;

    const User = require('../../../platform/core/auth/models/User');
    const targetUser = await User.findById(tenantId, userId);
    if (!targetUser) return res.status(404).json({ error: 'NotFound', message: 'User not found' });
    if (targetUser.liveness_status !== 'submitted')
        return res.status(400).json({ error: 'InvalidState', message: `Liveness status is '${targetUser.liveness_status}', not 'submitted'` });

    await User.update(tenantId, userId, {
        liveness_status: 'approved',
        liveness_reviewed_at: new Date(),
        liveness_reviewed_by: adminUser.id,
        liveness_rejection_reason: null,
    });

    const eventBus = require('../../../platform/events/EventBus');
    eventBus.emitEvent('user.kyc.liveness.approved', { tenantId, userId, userEmail: targetUser.email, reviewedBy: adminUser.id });

    const promoted = await tryPromoteKyc(tenantId, userId, adminUser.id);
    res.json({ success: true, message: `Liveness approved for ${targetUser.email}`, kyc_fully_approved: promoted });
}));

/** POST /vendor/admin/kyc/:userId/liveness/reject */
router.post('/kyc/:userId/liveness/reject', authenticate, authorize('vendors.kyc.review'), asyncHandler(async (req, res) => {
    const { tenantId, user: adminUser } = req;
    const { userId } = req.params;
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ error: 'ValidationError', message: 'A rejection reason is required' });

    const User = require('../../../platform/core/auth/models/User');
    const targetUser = await User.findById(tenantId, userId);
    if (!targetUser) return res.status(404).json({ error: 'NotFound', message: 'User not found' });

    await User.update(tenantId, userId, {
        liveness_status: 'rejected',
        liveness_reviewed_at: new Date(),
        liveness_reviewed_by: adminUser.id,
        liveness_rejection_reason: reason,
        kyc_status: 'rejected',
        kyc_rejection_reason: reason,
    });

    const eventBus = require('../../../platform/events/EventBus');
    eventBus.emitEvent('user.kyc.liveness.rejected', { tenantId, userId, userEmail: targetUser.email, reason, reviewedBy: adminUser.id });
    res.json({ success: true, message: `Liveness rejected for ${targetUser.email}` });
}));

// ─── POA ──────────────────────────────────────────────────────────────────────

/** POST /vendor/admin/kyc/:userId/poa/approve */
router.post('/kyc/:userId/poa/approve', authenticate, authorize('vendors.kyc.review'), asyncHandler(async (req, res) => {
    const { tenantId, user: adminUser } = req;
    const { userId } = req.params;

    const User = require('../../../platform/core/auth/models/User');
    const targetUser = await User.findById(tenantId, userId);
    if (!targetUser) return res.status(404).json({ error: 'NotFound', message: 'User not found' });
    if (targetUser.poa_status !== 'submitted')
        return res.status(400).json({ error: 'InvalidState', message: `POA status is '${targetUser.poa_status}', not 'submitted'` });

    await User.update(tenantId, userId, {
        poa_status: 'approved',
        poa_reviewed_at: new Date(),
        poa_reviewed_by: adminUser.id,
        poa_rejection_reason: null,
    });

    const eventBus = require('../../../platform/events/EventBus');
    eventBus.emitEvent('user.kyc.poa.approved', { tenantId, userId, userEmail: targetUser.email, reviewedBy: adminUser.id });

    const promoted = await tryPromoteKyc(tenantId, userId, adminUser.id);
    res.json({ success: true, message: `POA approved for ${targetUser.email}`, kyc_fully_approved: promoted });
}));

/** POST /vendor/admin/kyc/:userId/poa/reject */
router.post('/kyc/:userId/poa/reject', authenticate, authorize('vendors.kyc.review'), asyncHandler(async (req, res) => {
    const { tenantId, user: adminUser } = req;
    const { userId } = req.params;
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ error: 'ValidationError', message: 'A rejection reason is required' });

    const User = require('../../../platform/core/auth/models/User');
    const targetUser = await User.findById(tenantId, userId);
    if (!targetUser) return res.status(404).json({ error: 'NotFound', message: 'User not found' });

    await User.update(tenantId, userId, {
        poa_status: 'rejected',
        poa_reviewed_at: new Date(),
        poa_reviewed_by: adminUser.id,
        poa_rejection_reason: reason,
        kyc_status: 'rejected',
        kyc_rejection_reason: reason,
    });

    const eventBus = require('../../../platform/events/EventBus');
    eventBus.emitEvent('user.kyc.poa.rejected', { tenantId, userId, userEmail: targetUser.email, reason, reviewedBy: adminUser.id });
    res.json({ success: true, message: `POA rejected for ${targetUser.email}` });
}));

// ─── KYB Queue ────────────────────────────────────────────────────────────────

/**
 * GET /vendor/admin/kyb?status=submitted
 */
router.get('/kyb', authenticate, authorize('vendors.kyb.review'), asyncHandler(async (req, res) => {
    const { tenantId } = req;
    const status = req.query.status || 'submitted';
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const result = await query(
        `SELECT id, email, first_name, last_name, business_name,
                kyb_status, kyb_cac_url, kyb_submitted_at,
                kyb_reviewed_at, kyb_rejection_reason, kyb_reviewed_by
         FROM users
         WHERE tenant_id=$1 AND kyb_status=$2 AND deleted_at IS NULL
         ORDER BY kyb_submitted_at ASC
         LIMIT $3 OFFSET $4`,
        [tenantId, status, limit, offset]
    );
    const count = await query(
        `SELECT COUNT(*) FROM users WHERE tenant_id=$1 AND kyb_status=$2 AND deleted_at IS NULL`,
        [tenantId, status]
    );

    res.json({
        success: true,
        data: result.rows,
        pagination: { page, limit, total: parseInt(count.rows[0].count), totalPages: Math.ceil(count.rows[0].count / limit) }
    });
}));

/**
 * POST /vendor/admin/kyb/:userId/approve
 */
router.post('/kyb/:userId/approve', authenticate, authorize('vendors.kyb.review'), asyncHandler(async (req, res) => {
    const { tenantId, user: adminUser } = req;
    const { userId } = req.params;

    const User = require('../../../platform/core/auth/models/User');
    const targetUser = await User.findById(tenantId, userId);
    if (!targetUser) return res.status(404).json({ error: 'NotFound', message: 'User not found' });
    if (targetUser.kyc_status !== 'approved')
        return res.status(400).json({ error: 'KYCRequired', message: 'User must have approved KYC before KYB' });
    if (targetUser.kyb_status !== 'submitted')
        return res.status(400).json({ error: 'InvalidState', message: `KYB status is '${targetUser.kyb_status}'` });

    await User.update(tenantId, userId, {
        kyb_status: 'approved',
        kyb_reviewed_at: new Date(),
        kyb_reviewed_by: adminUser.id,
        kyb_rejection_reason: null,
    });

    const eventBus = require('../../../platform/events/EventBus');
    eventBus.emitEvent('user.kyb.approved', { tenantId, userId, userEmail: targetUser.email, reviewedBy: adminUser.id });
    res.json({ success: true, message: `KYB approved for ${targetUser.email}` });
}));

/**
 * POST /vendor/admin/kyb/:userId/reject
 */
router.post('/kyb/:userId/reject', authenticate, authorize('vendors.kyb.review'), asyncHandler(async (req, res) => {
    const { tenantId, user: adminUser } = req;
    const { userId } = req.params;
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ error: 'ValidationError', message: 'A rejection reason is required' });

    const User = require('../../../platform/core/auth/models/User');
    const targetUser = await User.findById(tenantId, userId);
    if (!targetUser) return res.status(404).json({ error: 'NotFound', message: 'User not found' });

    await User.update(tenantId, userId, {
        kyb_status: 'rejected',
        kyb_reviewed_at: new Date(),
        kyb_reviewed_by: adminUser.id,
        kyb_rejection_reason: reason,
    });

    const eventBus = require('../../../platform/events/EventBus');
    eventBus.emitEvent('user.kyb.rejected', { tenantId, userId, userEmail: targetUser.email, reason, reviewedBy: adminUser.id });
    res.json({ success: true, message: `KYB rejected for ${targetUser.email}` });
}));

// ─── Application Management ───────────────────────────────────────────────────

/**
 * GET /vendor/admin/applications?status=application_review&page=1
 */
router.get('/applications', authenticate, authorize('vendors.applications.review'), asyncHandler(async (req, res) => {
    const { tenantId } = req;
    const { status, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const conditions = ['va.tenant_id = $1'];
    const params = [tenantId];
    let idx = 2;

    if (status) {
        conditions.push(`va.status = $${idx++}`);
        params.push(status);
    }

    const where = conditions.join(' AND ');

    const result = await query(
        `SELECT va.*,
                u.email, u.first_name, u.last_name, u.avatar_url,
                u.kyc_status, u.kyb_status
         FROM vendor_applications va
         JOIN users u ON u.id = va.user_id AND u.tenant_id = va.tenant_id
         WHERE ${where}
         ORDER BY va.created_at DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, parseInt(limit), offset]
    );

    const count = await query(
        `SELECT COUNT(*) FROM vendor_applications va WHERE ${where}`,
        params
    );

    res.json({
        success: true,
        data: result.rows,
        pagination: { page: parseInt(page), limit: parseInt(limit), total: parseInt(count.rows[0].count), totalPages: Math.ceil(count.rows[0].count / limit) }
    });
}));

/**
 * GET /vendor/admin/applications/:id
 */
router.get('/applications/:id', authenticate, authorize('vendors.applications.review'), asyncHandler(async (req, res) => {
    const { tenantId } = req;
    const { id } = req.params;

    const appResult = await query(
        `SELECT va.*,
                u.email, u.first_name, u.last_name, u.avatar_url,
                u.kyc_status, u.kyc_reviewed_at, u.kyb_status, u.kyb_reviewed_at
         FROM vendor_applications va
         JOIN users u ON u.id = va.user_id AND u.tenant_id = va.tenant_id
         WHERE va.id = $1 AND va.tenant_id = $2`,
        [id, tenantId]
    );

    if (!appResult.rows[0])
        return res.status(404).json({ error: 'NotFound', message: 'Application not found' });

    const application = appResult.rows[0];

    // Include test products
    const tp = await query(
        `SELECT * FROM vendor_test_products WHERE application_id = $1 ORDER BY created_at`,
        [id]
    );
    application.test_products = tp.rows;

    res.json({ success: true, application });
}));

/**
 * POST /vendor/admin/applications/:id/approve
 * Advances the application to the next stage, or gives final approval (assigns vendor role).
 * Body: { notes?: string }
 */
router.post('/applications/:id/approve', authenticate, authorize('vendors.applications.review'), asyncHandler(async (req, res) => {
    const { tenantId, user: adminUser } = req;
    const { id } = req.params;
    const { notes } = req.body;

    const appResult = await query(
        `SELECT * FROM vendor_applications WHERE id=$1 AND tenant_id=$2`,
        [id, tenantId]
    );
    if (!appResult.rows[0])
        return res.status(404).json({ error: 'NotFound', message: 'Application not found' });

    const application = appResult.rows[0];

    // Determine next stage
    const STAGE_FLOW = {
        'application_review': 'training',
        'product_test': 'setup',       // product test passed → move to setup
        'setup': 'approved',           // final approval
    };

    const nextStatus = STAGE_FLOW[application.status];
    if (!nextStatus)
        return res.status(400).json({ error: 'InvalidStage', message: `Cannot approve at stage: ${application.status}` });

    await query(
        `UPDATE vendor_applications
         SET status=$1, reviewed_by=$2, reviewed_at=NOW(), updated_at=NOW()
         WHERE id=$3`,
        [nextStatus, adminUser.id, id]
    );

    const eventBus = require('../../../platform/events/EventBus');

    if (nextStatus === 'approved') {
        // Final approval — assign Vendor role (triggers VendorService.initializeVendor)
        const RoleService = require('../../../platform/core/roles/services/RoleService');
        await RoleService.assignRoleToUser(tenantId, application.user_id, 'Vendor');

        // Update store details from application if provided
        const User = require('../../../platform/core/auth/models/User');
        const updates = {};
        if (application.store_info?.logo_url) updates.business_thumbnail = application.store_info.logo_url;
        if (application.store_name) updates.business_name = application.store_name;
        if (application.store_description) updates.business_description = application.store_description;
        if (Object.keys(updates).length > 0) await User.update(tenantId, application.user_id, updates);

        // Clear test products staging data
        await query(`DELETE FROM vendor_test_products WHERE application_id=$1`, [id]);

        eventBus.emitEvent('vendor.application.approved', {
            tenantId, userId: application.user_id, applicationId: id, reviewedBy: adminUser.id
        });
    } else {
        eventBus.emitEvent('vendor.application.stage_advanced', {
            tenantId, userId: application.user_id, applicationId: id,
            fromStatus: application.status, toStatus: nextStatus, reviewedBy: adminUser.id
        });
    }

    res.json({
        success: true,
        message: nextStatus === 'approved' ? 'Application approved. Vendor role assigned.' : `Application advanced to '${nextStatus}' stage.`,
        new_status: nextStatus
    });
}));

/**
 * POST /vendor/admin/applications/:id/reject
 */
router.post('/applications/:id/reject', authenticate, authorize('vendors.applications.review'), asyncHandler(async (req, res) => {
    const { tenantId, user: adminUser } = req;
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason) return res.status(400).json({ error: 'ValidationError', message: 'Rejection reason is required' });

    const appResult = await query(`SELECT * FROM vendor_applications WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
    if (!appResult.rows[0]) return res.status(404).json({ error: 'NotFound', message: 'Application not found' });

    const application = appResult.rows[0];
    if (['approved', 'rejected', 'withdrawn'].includes(application.status))
        return res.status(400).json({ error: 'InvalidStage', message: `Cannot reject at stage: ${application.status}` });

    await query(
        `UPDATE vendor_applications SET status='rejected', rejection_reason=$1, reviewed_by=$2, reviewed_at=NOW(), updated_at=NOW() WHERE id=$3`,
        [reason, adminUser.id, id]
    );

    const eventBus = require('../../../platform/events/EventBus');
    eventBus.emitEvent('vendor.application.rejected', {
        tenantId, userId: application.user_id, applicationId: id, reason, reviewedBy: adminUser.id
    });

    res.json({ success: true, message: 'Application rejected.' });
}));

// ─── Test Product Review ──────────────────────────────────────────────────────

/**
 * POST /vendor/admin/test-products/:productId/review
 * Body: { status: 'passed'|'failed', notes?: string }
 */
router.post('/test-products/:productId/review', authenticate, authorize('vendors.test_products.review'), asyncHandler(async (req, res) => {
    const { tenantId, user: adminUser } = req;
    const { productId } = req.params;
    const { status, notes } = req.body;

    if (!['passed', 'failed'].includes(status))
        return res.status(400).json({ error: 'ValidationError', message: "status must be 'passed' or 'failed'" });

    const tpResult = await query(
        `SELECT vtp.*, va.tenant_id as app_tenant_id
         FROM vendor_test_products vtp
         JOIN vendor_applications va ON va.id = vtp.application_id
         WHERE vtp.id=$1 AND vtp.tenant_id=$2`,
        [productId, tenantId]
    );
    if (!tpResult.rows[0]) return res.status(404).json({ error: 'NotFound', message: 'Test product not found' });

    await query(
        `UPDATE vendor_test_products SET review_status=$1, review_notes=$2, reviewed_by=$3, reviewed_at=NOW(), updated_at=NOW() WHERE id=$4`,
        [status, notes || null, adminUser.id, productId]
    );

    // Check if all products in this application are reviewed
    const applicationId = tpResult.rows[0].application_id;
    const summary = await query(
        `SELECT
           COUNT(*) as total,
           COUNT(*) FILTER (WHERE review_status='pending') as pending,
           COUNT(*) FILTER (WHERE review_status='passed') as passed,
           COUNT(*) FILTER (WHERE review_status='failed') as failed
         FROM vendor_test_products WHERE application_id=$1`,
        [applicationId]
    );
    const { total, pending, passed: passedCount, failed: failedCount } = summary.rows[0];

    let overallResult = null;
    if (parseInt(pending) === 0) {
        // All reviewed
        overallResult = parseInt(failedCount) === 0 ? 'passed' : (parseInt(passedCount) > 0 ? 'partial' : 'failed');
        await query(
            `UPDATE vendor_applications SET test_reviewed_at=NOW(), test_result=$1, updated_at=NOW() WHERE id=$2`,
            [overallResult, applicationId]
        );

        const eventBus = require('../../../platform/events/EventBus');
        eventBus.emitEvent('vendor.application.test_reviewed', {
            tenantId, applicationId, result: overallResult
        });
    }

    res.json({
        success: true,
        message: `Product marked as '${status}'.`,
        summary: { total: parseInt(total), pending: parseInt(pending), passed: parseInt(passedCount), failed: parseInt(failedCount) },
        overall_result: overallResult
    });
}));

// ─── Active Vendor Management ─────────────────────────────────────────────────

/**
 * GET /vendor/admin/vendors — list active vendors
 */
router.get('/vendors', authenticate, authorize('vendors.view'), asyncHandler(async (req, res) => {
    const { tenantId } = req;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const result = await query(
        `SELECT u.id, u.email, u.first_name, u.last_name, u.business_name,
                u.avatar_url, u.business_thumbnail, u.status,
                u.kyc_status, u.kyb_status, u.created_at,
                c.id as collection_id, c.is_active as collection_active,
                (SELECT COUNT(*) FROM products p WHERE p.tenant_id=u.tenant_id AND p.created_by=u.id AND p.deleted_at IS NULL) as product_count
         FROM users u
         JOIN user_roles ur ON ur.user_id = u.id AND ur.tenant_id = u.tenant_id
         JOIN roles r ON r.id = ur.role_id AND r.name = 'Vendor'
         LEFT JOIN collections c ON c.tenant_id=u.tenant_id AND c.created_by=u.id AND c.collection_type='vendor'
         WHERE u.tenant_id=$1 AND u.deleted_at IS NULL
         ORDER BY u.created_at DESC
         LIMIT $2 OFFSET $3`,
        [tenantId, limit, offset]
    );
    const count = await query(
        `SELECT COUNT(DISTINCT u.id) FROM users u
         JOIN user_roles ur ON ur.user_id=u.id AND ur.tenant_id=u.tenant_id
         JOIN roles r ON r.id=ur.role_id AND r.name='Vendor'
         WHERE u.tenant_id=$1 AND u.deleted_at IS NULL`,
        [tenantId]
    );

    res.json({
        success: true,
        data: result.rows,
        pagination: { page, limit, total: parseInt(count.rows[0].count), totalPages: Math.ceil(count.rows[0].count / limit) }
    });
}));

/**
 * POST /vendor/admin/vendors/:userId/suspend
 * Deactivates vendor collection + unlists products. Role is kept.
 */
router.post('/vendors/:userId/suspend', authenticate, authorize('vendors.terminate'), asyncHandler(async (req, res) => {
    const { tenantId, user: adminUser } = req;
    const { userId } = req.params;
    const { reason } = req.body;

    const User = require('../../../platform/core/auth/models/User');
    const targetUser = await User.findById(tenantId, userId);
    if (!targetUser) return res.status(404).json({ error: 'NotFound', message: 'User not found' });

    // Deactivate collection
    await query(
        `UPDATE collections SET is_active=false WHERE tenant_id=$1 AND created_by=$2 AND collection_type='vendor'`,
        [tenantId, userId]
    );
    // Unlist all products
    await query(
        `UPDATE products SET status='unlisted' WHERE tenant_id=$1 AND created_by=$2 AND deleted_at IS NULL`,
        [tenantId, userId]
    );

    const eventBus = require('../../../platform/events/EventBus');
    eventBus.emitEvent('vendor.suspended', {
        tenantId, userId, reason: reason || null, suspendedBy: adminUser.id
    });

    res.json({ success: true, message: `Vendor ${targetUser.email} suspended. Products unlisted, collection deactivated.` });
}));

/**
 * POST /vendor/admin/vendors/:userId/restore
 */
router.post('/vendors/:userId/restore', authenticate, authorize('vendors.terminate'), asyncHandler(async (req, res) => {
    const { tenantId, user: adminUser } = req;
    const { userId } = req.params;

    const User = require('../../../platform/core/auth/models/User');
    const targetUser = await User.findById(tenantId, userId);
    if (!targetUser) return res.status(404).json({ error: 'NotFound', message: 'User not found' });

    await query(
        `UPDATE collections SET is_active=true WHERE tenant_id=$1 AND created_by=$2 AND collection_type='vendor'`,
        [tenantId, userId]
    );
    await query(
        `UPDATE products SET status='active' WHERE tenant_id=$1 AND created_by=$2 AND deleted_at IS NULL AND status='unlisted'`,
        [tenantId, userId]
    );

    const eventBus = require('../../../platform/events/EventBus');
    eventBus.emitEvent('vendor.restored', { tenantId, userId, restoredBy: adminUser.id });

    res.json({ success: true, message: `Vendor ${targetUser.email} restored.` });
}));

/**
 * POST /vendor/admin/vendors/:userId/terminate
 * Removes Vendor role, archives products, deletes vendor collection.
 */
router.post('/vendors/:userId/terminate', authenticate, authorize('vendors.terminate'), asyncHandler(async (req, res) => {
    const { tenantId, user: adminUser } = req;
    const { userId } = req.params;
    const { reason } = req.body;

    if (!reason) return res.status(400).json({ error: 'ValidationError', message: 'Termination reason required' });

    const User = require('../../../platform/core/auth/models/User');
    const targetUser = await User.findById(tenantId, userId);
    if (!targetUser) return res.status(404).json({ error: 'NotFound', message: 'User not found' });

    // 1. Remove Vendor role (emits role.removed → VendorService.deactivateVendor)
    const RoleService = require('../../../platform/core/roles/services/RoleService');
    await RoleService.removeRoleFromUser(tenantId, userId, 'Vendor');

    // 2. Archive products (soft-delete preserves data for restore)
    await query(
        `UPDATE products SET status='archived', updated_at=NOW()
         WHERE tenant_id=$1 AND created_by=$2 AND deleted_at IS NULL`,
        [tenantId, userId]
    );

    // 3. Delete the vendor collection
    await query(
        `DELETE FROM collections WHERE tenant_id=$1 AND created_by=$2 AND collection_type='vendor'`,
        [tenantId, userId]
    );

    const eventBus = require('../../../platform/events/EventBus');
    eventBus.emitEvent('vendor.terminated', {
        tenantId, userId, reason, terminatedBy: adminUser.id
    });

    res.json({ success: true, message: `Vendor ${targetUser.email} terminated. Products archived, collection removed.` });
}));

module.exports = router;
