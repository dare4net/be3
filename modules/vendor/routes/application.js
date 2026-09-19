/**
 * Vendor Application Routes (Storefront-Facing)
 * Pipeline: draft → application_review → training → product_test → setup → approved
 */

const express = require('express');
const router = express.Router();
const { query } = require('../../../config/database');
const { asyncHandler } = require('../../../middleware/errorHandler');
const { authenticate } = require('../../../platform/core/auth/middleware/authenticate');

async function getUserApplication(tenantId, userId) {
    const result = await query(
        `SELECT * FROM vendor_applications
         WHERE tenant_id = $1 AND user_id = $2 AND status NOT IN ('rejected','withdrawn')
         ORDER BY created_at DESC LIMIT 1`,
        [tenantId, userId]
    );
    return result.rows[0] || null;
}

// GET /vendor/application
router.get('/', authenticate, asyncHandler(async (req, res) => {
    const { tenantId, user } = req;

    // Always tell the client if this user is already a vendor
    const Role = require('../../../platform/core/roles/models/Role');
    const roles = await Role.getUserRoles(tenantId, user.id);
    const isVendor = roles.some(r => r.name === 'Vendor');

    const application = await getUserApplication(tenantId, user.id);
    if (!application) return res.json({ success: true, application: null, is_vendor: isVendor });

    let testProducts = [];
    if (['product_test', 'setup', 'approved'].includes(application.status)) {
        const tp = await query(
            `SELECT id, title, price, images, review_status, review_notes, reviewed_at
             FROM vendor_test_products WHERE application_id = $1 ORDER BY created_at`,
            [application.id]
        );
        testProducts = tp.rows;
    }

    res.json({ success: true, application: { ...application, test_products: testProducts }, is_vendor: isVendor });
}));

// POST /vendor/application/start
router.post('/start', authenticate, asyncHandler(async (req, res) => {
    const { tenantId, user } = req;

    if (!user.email_verified)
        return res.status(403).json({ error: 'Tier1Required', message: 'Email verification required.' });
    if (user.kyc_status !== 'approved')
        return res.status(403).json({ error: 'Tier2Required', message: 'KYC approval required to apply.' });

    const existing = await getUserApplication(tenantId, user.id);
    if (existing) return res.status(409).json({ error: 'ApplicationExists', message: 'Active application exists.', status: existing.status });

    const Role = require('../../../platform/core/roles/models/Role');
    const roles = await Role.getUserRoles(tenantId, user.id);
    if (roles.some(r => r.name === 'Vendor'))
        return res.status(409).json({ error: 'AlreadyVendor', message: 'You are already a vendor.' });

    const result = await query(
        `INSERT INTO vendor_applications (tenant_id, user_id, status) VALUES ($1,$2,'draft') RETURNING *`,
        [tenantId, user.id]
    );
    const application = result.rows[0];

    const eventBus = require('../../../platform/events/EventBus');
    eventBus.emitEvent('vendor.application.started', { tenantId, userId: user.id, applicationId: application.id });

    res.status(201).json({ success: true, application });
}));

// PUT /vendor/application/form — saves form, advances to application_review
router.put('/form', authenticate, asyncHandler(async (req, res) => {
    const { tenantId, user } = req;
    const { store_name, store_description, primary_category } = req.body;

    if (!store_name || !primary_category)
        return res.status(400).json({ error: 'ValidationError', message: 'store_name and primary_category are required' });

    const application = await getUserApplication(tenantId, user.id);
    if (!application) return res.status(404).json({ error: 'NotFound', message: 'No active application found' });
    if (!['draft', 'application_review'].includes(application.status))
        return res.status(400).json({ error: 'InvalidStage', message: `Cannot update form at stage: ${application.status}` });

    const result = await query(
        `UPDATE vendor_applications
         SET store_name=$1, store_description=$2, primary_category=$3, status='application_review', updated_at=NOW()
         WHERE id=$4 RETURNING *`,
        [store_name, store_description || null, primary_category, application.id]
    );

    const eventBus = require('../../../platform/events/EventBus');
    eventBus.emitEvent('vendor.application.submitted', { tenantId, userId: user.id, applicationId: application.id });

    res.json({ success: true, application: result.rows[0] });
}));

// POST /vendor/application/training/start
router.post('/training/start', authenticate, asyncHandler(async (req, res) => {
    const { tenantId, user } = req;
    const application = await getUserApplication(tenantId, user.id);
    if (!application) return res.status(404).json({ error: 'NotFound', message: 'No active application found' });
    if (application.status !== 'training')
        return res.status(400).json({ error: 'InvalidStage', message: `Not in training stage` });

    await query(
        `UPDATE vendor_applications SET training_started_at=COALESCE(training_started_at,NOW()), updated_at=NOW() WHERE id=$1`,
        [application.id]
    );
    res.json({ success: true, message: 'Training started' });
}));

// POST /vendor/application/training/submit — score must be 100 to pass
router.post('/training/submit', authenticate, asyncHandler(async (req, res) => {
    const { tenantId, user } = req;
    const { score } = req.body;

    if (typeof score !== 'number' || score < 0 || score > 100)
        return res.status(400).json({ error: 'ValidationError', message: 'score must be 0–100' });

    const application = await getUserApplication(tenantId, user.id);
    if (!application) return res.status(404).json({ error: 'NotFound', message: 'No active application found' });
    if (application.status !== 'training')
        return res.status(400).json({ error: 'InvalidStage', message: 'Not in training stage' });

    const attempts = (application.assessment_attempts || 0) + 1;
    const passed = score === 100;

    await query(
        `UPDATE vendor_applications
         SET assessment_score=$1, assessment_attempts=$2, assessment_last_attempt_at=NOW(),
             training_completed_at=$3, status=$4, updated_at=NOW()
         WHERE id=$5`,
        [score, attempts, passed ? new Date() : null, passed ? 'product_test' : 'training', application.id]
    );

    if (passed) {
        const eventBus = require('../../../platform/events/EventBus');
        eventBus.emitEvent('vendor.application.training_passed', { tenantId, userId: user.id, applicationId: application.id });
    }

    res.json({
        success: true, passed, score, attempts,
        message: passed
            ? 'Assessment passed! Proceed to the product upload test.'
            : `Score: ${score}/100. You need 100 to pass. Review the material and try again.`
    });
}));

// POST /vendor/application/test-products — submit 1–5 test products
router.post('/test-products', authenticate, asyncHandler(async (req, res) => {
    const { tenantId, user } = req;
    const { products } = req.body;

    if (!Array.isArray(products) || products.length === 0 || products.length > 5)
        return res.status(400).json({ error: 'ValidationError', message: 'Submit between 1 and 5 products' });
    if (products.some(p => !p.title || !p.price))
        return res.status(400).json({ error: 'ValidationError', message: 'Each product needs title and price' });

    const application = await getUserApplication(tenantId, user.id);
    if (!application) return res.status(404).json({ error: 'NotFound', message: 'No active application found' });
    if (application.status !== 'product_test')
        return res.status(400).json({ error: 'InvalidStage', message: 'Not in product test stage' });

    await query(`DELETE FROM vendor_test_products WHERE application_id=$1`, [application.id]);

    for (const p of products) {
        await query(
            `INSERT INTO vendor_test_products
             (application_id, tenant_id, user_id, title, description, price, compare_price, sku, images, category_id, attributes, whats_included, review_status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending')`,
            [application.id, tenantId, user.id, p.title, p.description || null, p.price,
             p.compare_price || null, p.sku || null, JSON.stringify(p.images || []),
             p.category_id || null, JSON.stringify(p.attributes || {}), p.whats_included || null]
        );
    }

    await query(
        `UPDATE vendor_applications SET test_submitted_at=NOW(), test_result='pending', updated_at=NOW() WHERE id=$1`,
        [application.id]
    );

    const eventBus = require('../../../platform/events/EventBus');
    eventBus.emitEvent('vendor.application.test_products_submitted', {
        tenantId, userId: user.id, applicationId: application.id, productCount: products.length
    });

    res.json({ success: true, message: `${products.length} product(s) submitted for review.` });
}));

// POST /vendor/application/setup — final step, submit bank + store info
router.post('/setup', authenticate, asyncHandler(async (req, res) => {
    const { tenantId, user } = req;
    const { bank_details, contact_info, store_info } = req.body;

    if (!bank_details?.account_name || !bank_details?.account_number || !bank_details?.bank_name)
        return res.status(400).json({ error: 'ValidationError', message: 'bank_details must include account_name, account_number, bank_name' });

    const application = await getUserApplication(tenantId, user.id);
    if (!application) return res.status(404).json({ error: 'NotFound', message: 'No active application found' });
    if (application.status !== 'setup')
        return res.status(400).json({ error: 'InvalidStage', message: 'Application is not in setup stage' });

    const result = await query(
        `UPDATE vendor_applications
         SET bank_details=$1, contact_info=$2, store_info=$3, setup_completed_at=NOW(), updated_at=NOW()
         WHERE id=$4 RETURNING *`,
        [JSON.stringify(bank_details), JSON.stringify(contact_info || {}), JSON.stringify(store_info || {}), application.id]
    );

    const eventBus = require('../../../platform/events/EventBus');
    eventBus.emitEvent('vendor.application.setup_complete', { tenantId, userId: user.id, applicationId: application.id });

    res.json({ success: true, message: 'Store setup complete. Your application is being finalised.', application: result.rows[0] });
}));

module.exports = router;
