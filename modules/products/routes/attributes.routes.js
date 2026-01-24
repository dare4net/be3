/**
 * Attribute Routes
 * Global attribute management and category-attribute linking
 */

const { query } = require('../../../config/database');
const { paginatedTenantQuery, tenantInsert, tenantUpdate, tenantDelete } = require('../../../utils/dbHelpers');
const { authenticate } = require('../../../platform/core/auth/middleware/authenticate');
const { asyncHandler } = require('../../../middleware/errorHandler');

function registerAttributeRoutes(router) {
    // List Global Attributes (All - for Admin dropdowns)
    router.get('/attributes/all', authenticate, asyncHandler(async (req, res) => {
        const result = await query(
            `SELECT * FROM attributes WHERE tenant_id = $1 ORDER BY label`,
            [req.tenantId]
        );
        res.json({ success: true, data: result.rows });
    }));

    // List Global Attributes
    router.get('/attributes', authenticate, asyncHandler(async (req, res) => {
        const result = await paginatedTenantQuery('attributes', req.tenantId, {});
        res.json({ success: true, ...result });
    }));

    // Create Global Attribute
    router.post('/attributes', authenticate, asyncHandler(async (req, res) => {
        let options = req.body.options;
        // Ensure options is a JSON string for DB
        if (options && typeof options === 'object') {
            options = JSON.stringify(options);
        }

        let clauses = req.body.clauses;
        // Ensure clauses is a JSON string for DB
        if (clauses && typeof clauses === 'object') {
            clauses = JSON.stringify(clauses);
        }

        const attribute = await tenantInsert('attributes', req.tenantId, {
            code: req.body.code,
            label: req.body.label,
            type: req.body.type,
            options: options || null,
            clauses: clauses || '[]',
            image_url: req.body.image_url
        });
        res.status(201).json({ success: true, attribute });
    }));

    // Update Global Attribute
    router.put('/attributes/:id', authenticate, asyncHandler(async (req, res) => {
        let options = req.body.options;
        // Ensure options is a JSON string for DB
        if (options && typeof options === 'object') {
            options = JSON.stringify(options);
        }

        let clauses = req.body.clauses;
        // Ensure clauses is a JSON string for DB
        if (clauses && typeof clauses === 'object') {
            clauses = JSON.stringify(clauses);
        }

        const attribute = await tenantUpdate('attributes', req.tenantId, req.params.id, {
            code: req.body.code,
            label: req.body.label,
            type: req.body.type,
            options: options || null,
            clauses: clauses || '[]',
            image_url: req.body.image_url
        });
        res.json({ success: true, attribute });
    }));

    // Delete Global Attribute
    router.delete('/attributes/:id', authenticate, asyncHandler(async (req, res) => {
        await tenantDelete('attributes', req.tenantId, req.params.id);
        res.json({ success: true, message: 'Attribute deleted' });
    }));

    // Get Categories for an Attribute
    router.get('/attributes/:id/categories', authenticate, asyncHandler(async (req, res) => {
        const result = await query(
            `SELECT category_id FROM category_attributes WHERE attribute_id = $1 AND tenant_id = $2`,
            [req.params.id, req.tenantId]
        );
        res.json({ success: true, category_ids: result.rows.map(r => r.category_id) });
    }));

    // Get ALL categories affected by this attribute (direct + inherited)
    router.get('/attributes/:id/affected-categories', authenticate, asyncHandler(async (req, res) => {
        const sql = `
            WITH RECURSIVE affected_tree AS (
                -- Anchor: Direct links
                SELECT c.id, c.name, c.parent_id, 0 as depth
                FROM categories c
                JOIN category_attributes ca ON ca.category_id = c.id
                WHERE ca.attribute_id = $1 AND c.tenant_id = $2
                
                UNION ALL
                
                -- Recursive: Descendants
                SELECT c.id, c.name, c.parent_id, at.depth + 1
                FROM categories c
                JOIN affected_tree at ON c.parent_id = at.id
                WHERE c.tenant_id = $2
            )
            SELECT DISTINCT ON (id) id, name, parent_id, depth FROM affected_tree ORDER BY id, depth ASC
        `;
        const result = await query(sql, [req.params.id, req.tenantId]);
        res.json({ success: true, categories: result.rows });
    }));

    // Attach Attribute to Category
    router.post('/categories/:id/attributes', authenticate, asyncHandler(async (req, res) => {
        const { attribute_id, is_required, is_ignored } = req.body;

        await query(
            `INSERT INTO category_attributes (tenant_id, category_id, attribute_id, is_required, is_ignored)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (category_id, attribute_id) DO UPDATE SET 
                is_required = EXCLUDED.is_required,
                is_ignored = EXCLUDED.is_ignored`,
            [req.tenantId, req.params.id, attribute_id, is_required || false, is_ignored || false]
        );

        res.json({ success: true, message: 'Attribute attached to category' });
    }));

    // Unlink Attribute
    router.delete('/categories/:id/attributes/:attrId', authenticate, asyncHandler(async (req, res) => {
        await query(
            `DELETE FROM category_attributes WHERE tenant_id = $1 AND category_id = $2 AND attribute_id = $3`,
            [req.tenantId, req.params.id, req.params.attrId]
        );
        res.json({ success: true, message: 'Attribute unlinked' });
    }));
}

module.exports = { registerAttributeRoutes };
