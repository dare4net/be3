/**
 * Attribute Routes
 * Global attribute management and category-attribute linking
 */

const { query } = require('../../../config/database');
const { paginatedTenantQuery, tenantInsert, tenantUpdate, tenantDelete } = require('../../../utils/dbHelpers');
const { authenticate } = require('../../../platform/core/auth/middleware/authenticate');
const { asyncHandler } = require('../../../middleware/errorHandler');
const MediaInterceptor = require('../../media/services/MediaInterceptor');

/**
 * Helper to keep pivot table (category_attributes.excluded_clauses) in sync 
 * with the clause configurations natively on the attribute JSON.
 */
async function syncCategoryExclusions(tenantId, attributeId, clausesArray) {
    // 1. Clear existing exclusions for this attribute in the pivot table (reset)
    await query(
        `UPDATE category_attributes SET excluded_clauses = '[]'::jsonb WHERE attribute_id = $1 AND tenant_id = $2`,
        [attributeId, tenantId]
    );

    if (!clausesArray || !Array.isArray(clausesArray)) return;

    // 2. Map category_id -> array of excluded clause names
    const catExclusions = {};
    for (const clause of clausesArray) {
        if (clause.excluded_category_ids && Array.isArray(clause.excluded_category_ids)) {
            for (const catId of clause.excluded_category_ids) {
                if (!catExclusions[catId]) catExclusions[catId] = [];
                if (clause.name) catExclusions[catId].push(clause.name);
            }
        }
    }

    // 3. Upsert into category_attributes
    for (const [catId, excludedClauseNames] of Object.entries(catExclusions)) {
        if (excludedClauseNames.length === 0) continue;

        const excludedJson = JSON.stringify(excludedClauseNames);

        await query(
            `INSERT INTO category_attributes (tenant_id, category_id, attribute_id, excluded_clauses)
             VALUES ($1, $2, $3, $4::jsonb)
             ON CONFLICT (category_id, attribute_id) 
             DO UPDATE SET excluded_clauses = EXCLUDED.excluded_clauses`,
            [tenantId, catId, attributeId, excludedJson]
        );
    }
}

function registerAttributeRoutes(router) {
    // List Global Attributes (All - for Admin dropdowns)
    // Merges tenant-specific attributes with global system attributes
    router.get('/attributes/all', authenticate, asyncHandler(async (req, res) => {
        // 1. Get tenant-specific attributes (exclude any with is_system flag)
        const tenantResult = await query(
            `SELECT * FROM attributes WHERE tenant_id = $1 AND (is_system = false OR is_system IS NULL) ORDER BY label`,
            [req.tenantId]
        );

        // 2. Get global system attributes (gracefully handle if table doesn't exist)
        let systemRows = [];
        try {
            const systemResult = await query(`SELECT * FROM system_attributes ORDER BY label`);
            systemRows = systemResult.rows.map(attr => ({
                ...attr,
                is_system: true,
                _source: 'system'
            }));
        } catch (e) {
            // system_attributes table may not exist yet
        }

        // 3. Merge: system attributes first, then tenant attributes
        const merged = [...systemRows, ...tenantResult.rows];
        res.json({ success: true, data: merged });
    }));

    // List Global Attributes (paginated, excludes system attributes)
    router.get('/attributes', authenticate, asyncHandler(async (req, res) => {
        const includeSystem = req.query.include_system === 'true';
        const extraWhere = includeSystem ? '' : `AND (is_system = false OR is_system IS NULL)`;
        const result = await paginatedTenantQuery('attributes', req.tenantId, {}, extraWhere);
        res.json({ success: true, ...result });
    }));

    // Create Global Attribute
    router.post('/attributes', authenticate, asyncHandler(async (req, res) => {
        // Intercept and mirror images (including nested options/swatches)
        await MediaInterceptor.interceptAttribute(req.body);

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
            image_url: req.body.image_url,
            allow_custom: req.body.allow_custom || false
        });

        // Sync exclusions to pivot table
        await syncCategoryExclusions(req.tenantId, attribute.id, req.body.clauses);

        res.status(201).json({ success: true, attribute });
    }));

    // Update Global Attribute (blocks system attributes from admin edits)
    router.put('/attributes/:id', authenticate, asyncHandler(async (req, res) => {
        // Intercept and mirror images (including nested options/swatches)
        await MediaInterceptor.interceptAttribute(req.body);

        // Check if this is a system attribute
        const existing = await query(
            `SELECT is_system FROM attributes WHERE id = $1 AND tenant_id = $2`,
            [req.params.id, req.tenantId]
        );
        if (existing.rows.length > 0 && existing.rows[0].is_system && req.query.force !== 'superadmin') {
            return res.status(403).json({ success: false, error: 'System attributes cannot be modified from the admin dashboard' });
        }

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
            image_url: req.body.image_url,
            allow_custom: req.body.allow_custom
        });

        // Sync exclusions to pivot table
        await syncCategoryExclusions(req.tenantId, attribute.id, req.body.clauses);

        res.json({ success: true, attribute });
    }));

    // Delete Global Attribute (blocks system attributes from admin deletion)
    router.delete('/attributes/:id', authenticate, asyncHandler(async (req, res) => {
        // Check if this is a system attribute
        const existing = await query(
            `SELECT is_system FROM attributes WHERE id = $1 AND tenant_id = $2`,
            [req.params.id, req.tenantId]
        );
        if (existing.rows.length > 0 && existing.rows[0].is_system && req.query.force !== 'superadmin') {
            return res.status(403).json({ success: false, error: 'System attributes cannot be deleted from the admin dashboard' });
        }

        await tenantDelete('attributes', req.tenantId, req.params.id);
        res.json({ success: true, message: 'Attribute deleted' });
    }));

    // Get Categories for an Attribute
    router.get('/attributes/:id/categories', authenticate, asyncHandler(async (req, res) => {
        const result = await query(
            `SELECT category_id FROM category_attributes 
             WHERE attribute_id = $1 AND tenant_id = $2 AND is_ignored = false`,
            [req.params.id, req.tenantId]
        );
        res.json({ success: true, category_ids: result.rows.map(r => r.category_id) });
    }));

    // Get ALL categories affected by this attribute (direct + inherited)
    router.get('/attributes/:id/affected-categories', authenticate, asyncHandler(async (req, res) => {
        const sql = `
            WITH RECURSIVE affected_tree AS (
                -- Anchor: Direct links (not ignored)
                SELECT c.id, c.name, c.parent_id, 0 as depth
                FROM categories c
                JOIN category_attributes ca ON ca.category_id = c.id
                WHERE ca.attribute_id = $1 AND c.tenant_id = $2 AND ca.is_ignored = false
                
                UNION ALL
                
                -- Recursive: Descendants (unless they specifically ignore the attribute)
                SELECT c.id, c.name, c.parent_id, at.depth + 1
                FROM categories c
                JOIN affected_tree at ON c.parent_id = at.id
                LEFT JOIN category_attributes ca ON (ca.category_id = c.id AND ca.attribute_id = $1)
                WHERE c.tenant_id = $2
                  AND (ca.is_ignored = false OR ca.is_ignored IS NULL)
                  AND at.depth < 10
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
