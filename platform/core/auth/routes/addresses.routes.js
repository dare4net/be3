const express = require('express');
const router = express.Router({ mergeParams: true });
const { authenticate } = require('../middleware/authenticate');
const { asyncHandler } = require('../../../../middleware/errorHandler');
const { query } = require('../../../../config/database');
const Joi = require('joi');

const addressSchema = Joi.object({
    first_name: Joi.string().required(),
    last_name: Joi.string().required(),
    phone: Joi.string().required(),
    street_address: Joi.string().required(),
    country_id: Joi.number().allow(null, ""),
    state_id: Joi.number().allow(null, ""),
    landmark_id: Joi.number().allow(null, ""),
    is_default: Joi.boolean().default(false)
});

// GET /auth/me/addresses
router.get('/', authenticate, asyncHandler(async (req, res) => {
    const { tenantId, user } = req;

    const result = await query(`
        SELECT 
            ua.*,
            c.name as country_name,
            s.name as state_name,
            l.name as landmark_name
        FROM user_addresses ua
        LEFT JOIN countries c ON ua.country_id = c.id
        LEFT JOIN states s ON ua.state_id = s.id
        LEFT JOIN landmarks l ON ua.landmark_id = l.id
        WHERE ua.tenant_id = $1 AND ua.user_id = $2
        ORDER BY ua.is_default DESC, ua.created_at DESC
    `, [tenantId, user.id]);

    res.json({ success: true, addresses: result.rows });
}));

// POST /auth/me/addresses
router.post('/', authenticate, asyncHandler(async (req, res) => {
    const { tenantId, user } = req;

    const { error, value } = addressSchema.validate(req.body);
    if (error) {
        return res.status(400).json({ error: 'ValidationError', message: error.details[0].message });
    }

    if (value.is_default) {
        await query(`UPDATE user_addresses SET is_default = false WHERE tenant_id = $1 AND user_id = $2`, [tenantId, user.id]);
    } else {
        const countRes = await query(`SELECT COUNT(*) FROM user_addresses WHERE tenant_id = $1 AND user_id = $2`, [tenantId, user.id]);
        if (parseInt(countRes.rows[0].count) === 0) {
            value.is_default = true;
        }
    }

    const insertRes = await query(`
        INSERT INTO user_addresses (
            tenant_id, user_id, first_name, last_name, phone, street_address, country_id, state_id, landmark_id, is_default
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
    `, [
        tenantId, user.id, value.first_name, value.last_name, value.phone,
        value.street_address,
        value.country_id || null, value.state_id || null, value.landmark_id || null,
        value.is_default
    ]);

    res.status(201).json({ success: true, address: insertRes.rows[0] });
}));

// PUT /auth/me/addresses/:id
router.put('/:id', authenticate, asyncHandler(async (req, res) => {
    const { tenantId, user } = req;
    const { id } = req.params;

    const { error, value } = addressSchema.validate(req.body);
    if (error) {
        return res.status(400).json({ error: 'ValidationError', message: error.details[0].message });
    }

    if (value.is_default) {
        await query(`UPDATE user_addresses SET is_default = false WHERE tenant_id = $1 AND user_id = $2`, [tenantId, user.id]);
    }

    const updateRes = await query(`
        UPDATE user_addresses SET
            first_name = $1, last_name = $2, phone = $3, street_address = $4,
            country_id = $5, state_id = $6, landmark_id = $7, is_default = $8,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $9 AND tenant_id = $10 AND user_id = $11
        RETURNING *
    `, [
        value.first_name, value.last_name, value.phone, value.street_address,
        value.country_id || null, value.state_id || null, value.landmark_id || null,
        value.is_default,
        id, tenantId, user.id
    ]);

    if (updateRes.rows.length === 0) {
        return res.status(404).json({ error: 'NotFound', message: 'Address not found.' });
    }

    res.json({ success: true, address: updateRes.rows[0] });
}));

// PUT /auth/me/addresses/:id/set-default
router.put('/:id/set-default', authenticate, asyncHandler(async (req, res) => {
    const { tenantId, user } = req;
    const { id } = req.params;

    await query(`UPDATE user_addresses SET is_default = false WHERE tenant_id = $1 AND user_id = $2`, [tenantId, user.id]);
    const updateRes = await query(`UPDATE user_addresses SET is_default = true WHERE id = $1 AND tenant_id = $2 AND user_id = $3 RETURNING *`, [id, tenantId, user.id]);

    if (updateRes.rows.length === 0) {
        return res.status(404).json({ error: 'NotFound', message: 'Address not found.' });
    }
    res.json({ success: true, address: updateRes.rows[0] });
}));

// DELETE /auth/me/addresses/:id
router.delete('/:id', authenticate, asyncHandler(async (req, res) => {
    const { tenantId, user } = req;
    const { id } = req.params;

    const delRes = await query(`DELETE FROM user_addresses WHERE id = $1 AND tenant_id = $2 AND user_id = $3 RETURNING *`, [id, tenantId, user.id]);

    if (delRes.rows.length === 0) {
        return res.status(404).json({ error: 'NotFound', message: 'Address not found or already deleted.' });
    }

    if (delRes.rows[0].is_default) {
        await query(`
            UPDATE user_addresses SET is_default = true 
            WHERE id = (SELECT id FROM user_addresses WHERE tenant_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 1)
        `, [tenantId, user.id]);
    }

    res.json({ success: true, message: 'Address deleted successfully.' });
}));

module.exports = router;
