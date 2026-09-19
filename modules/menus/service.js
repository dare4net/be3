/**
 * Menu Service
 * Manages menus and hierarchical menu items
 */

const { query } = require('../../config/database');

class MenuService {
    /**
     * Slugify helper for pretty branded URLs
     */
    static slugify(text) {
        return (text || '')
            .toString()
            .toLowerCase()
            .trim()
            .replace(/\s+/g, '-')
            .replace(/[^\w-]+/g, '')
            .replace(/--+/g, '-');
    }

    /**
     * Helper to structure flat menu items into a nested tree with dynamic expansion
     */
    static buildMenuTree(items) {
        const itemMap = new Map();
        const tree = [];

        // First pass: initialize children arrays
        items.forEach(item => {
            itemMap.set(item.id, { ...item, children: [] });
        });

        // Second pass: attach to parents or root
        items.forEach(item => {
            const mappedItem = itemMap.get(item.id);
            if (item.parent_id && itemMap.has(item.parent_id)) {
                itemMap.get(item.parent_id).children.push(mappedItem);
            } else {
                tree.push(mappedItem);
            }
        });

        return tree;
    }

    /**
     * Verify hierarchical category exclusion: is this category (or any ancestor) in the clause's excluded list?
     */
    static async isCategoryExcluded(tenantId, categoryId, excludedCategoryIds) {
        if (!excludedCategoryIds || excludedCategoryIds.length === 0) return false;

        const res = await query(
            `WITH RECURSIVE forbidden_tree AS (
                SELECT id FROM categories WHERE id = ANY($1::uuid[]) AND tenant_id = $2
                UNION ALL
                SELECT c.id FROM categories c
                INNER JOIN forbidden_tree ft ON c.parent_id = ft.id
                WHERE c.tenant_id = $2
            )
            SELECT 1 FROM forbidden_tree WHERE id = $3 LIMIT 1`,
            [excludedCategoryIds.map(String), tenantId, categoryId]
        );

        return res.rows.length > 0;
    }

    /**
     * Verify that products exist for a given category + attribute + clause value in search_indexes
     */
    static async hasProductsForClause(tenantId, categoryId, attributeCode, clauseValue, operator = '=') {
        const normalizedValue = String(clauseValue || '').toLowerCase().trim();

        let attributeCondition;
        if (operator === '=' || !operator) {
            attributeCondition = `(
                LOWER(si.metadata->'attributes'->>$3) = LOWER($4)
                OR (jsonb_typeof(si.metadata->'attributes'->$3) = 'array' AND si.metadata->'attributes'->$3 ? $4)
            )`;
        } else if (['<=', '>=', '<', '>'].includes(operator)) {
            const attrVal = `si.metadata->'attributes'->>$3`;
            const safeCast = `(CASE WHEN ${attrVal} ~ '^-?[0-9.]+$' THEN (${attrVal})::numeric ELSE NULL END)`;
            attributeCondition = `${safeCast} ${operator} $4::numeric`;
        } else if (operator === 'LIKE' || operator === 'ILIKE') {
            attributeCondition = `LOWER(si.metadata->'attributes'->>$3) LIKE LOWER('%' || $4 || '%')`;
        } else {
            attributeCondition = `LOWER(si.metadata->'attributes'->>$3) = LOWER($4)`;
        }

        const res = await query(
            `SELECT 1 FROM search_indexes si
             WHERE si.tenant_id = $1 AND si.is_active = true AND si.content_type = 'product'
               AND si.metadata->'category_ids' ? $2
               AND ${attributeCondition}
             LIMIT 1`,
            [tenantId, String(categoryId), attributeCode, normalizedValue]
        );

        return res.rows.length > 0;
    }

    /**
     * Dynamically expand category subcategories and dynamic clauses for storefront tree
     */
    static async expandDynamicTree(tenantId, tree) {
        const expandedTree = [];

        for (const node of tree) {
            const item = { ...node };

            // If item has manual children, recursively expand them
            if (item.children && item.children.length > 0) {
                item.children = await this.expandDynamicTree(tenantId, item.children);
            }

            // If item is dynamic category or category with dynamic expansion enabled
            if ((item.type === 'dynamic_category' || item.type === 'category') && item.reference_id) {
                try {
                    // 1. Fetch category basic details
                    const catRes = await query(
                        `SELECT id, name, slug, image_url FROM categories WHERE tenant_id = $1 AND id = $2 AND is_active = true`,
                        [tenantId, item.reference_id]
                    );
                    const category = catRes.rows[0];

                    if (category) {
                        // 2. Fetch real active subcategories
                        const subcatsRes = await query(
                            `SELECT id, name, slug, image_url FROM categories WHERE tenant_id = $1 AND parent_id = $2 AND is_active = true ORDER BY name ASC`,
                            [tenantId, item.reference_id]
                        );

                        const dynamicSubcatItems = subcatsRes.rows.map(sub => ({
                            id: `dyn-sub-${sub.id}`,
                            label: sub.name,
                            url: `/categories/${sub.slug}`,
                            type: 'category',
                            reference_id: sub.id,
                            image_url: sub.image_url || null,
                            is_dynamic: true,
                            children: []
                        }));

                        // 3. Fetch linked attribute clauses (with ancestor inheritance)
                        const attrsRes = await query(
                            `WITH RECURSIVE ancestor_chain AS (
                                SELECT id, parent_id FROM categories WHERE tenant_id = $1 AND id = $2
                                UNION ALL
                                SELECT c.id, c.parent_id FROM categories c
                                JOIN ancestor_chain ac ON c.id = ac.parent_id
                                WHERE c.tenant_id = $1
                            )
                            SELECT DISTINCT a.id, a.code, a.label, a.clauses
                            FROM category_attributes ca
                            JOIN ancestor_chain ac ON ca.category_id = ac.id
                            JOIN attributes a ON a.id = ca.attribute_id AND a.tenant_id = $1
                            WHERE ca.tenant_id = $1 AND a.clauses IS NOT NULL`,
                            [tenantId, item.reference_id]
                        );

                        const dynamicClauseItems = [];
                        for (const attr of attrsRes.rows) {
                            const clauses = (typeof attr.clauses === 'string' ? JSON.parse(attr.clauses) : attr.clauses) || [];
                            for (const clause of clauses) {
                                if (!clause || !clause.name) continue;

                                // Guard 1: Check excluded_category_ids (hierarchical)
                                if (clause.excluded_category_ids && clause.excluded_category_ids.length > 0) {
                                    const excluded = await this.isCategoryExcluded(tenantId, category.id, clause.excluded_category_ids);
                                    if (excluded) continue;
                                }

                                // Guard 2: Check product existence in search_indexes
                                const clauseValue = Array.isArray(clause.value) ? clause.value[0] : (clause.value ?? '1');
                                const hasProducts = await this.hasProductsForClause(
                                    tenantId, category.id, attr.code, clauseValue, clause.operator
                                );
                                if (!hasProducts) continue;

                                const prefix = (clause.prefix || '').trim();
                                const suffix = (clause.suffix || '').trim();
                                const label = (prefix || suffix)
                                    ? `${prefix ? `${prefix} ` : ''}${category.name}${suffix ? ` ${suffix}` : ''}`.trim()
                                    : (clause.label || clause.name);

                                const prettySlug = this.slugify(`${prefix}${category.slug || ''}${suffix}`);

                                dynamicClauseItems.push({
                                    id: `dyn-clause-${attr.code}-${clause.name}`,
                                    label,
                                    url: `/${prettySlug}`,
                                    filter_url: `/search?category_id=${category.id}&attribute.${attr.code}:${clause.name}=${encodeURIComponent(String(clauseValue))}`,
                                    type: 'clause',
                                    reference_id: attr.id,
                                    attribute_code: attr.code,
                                    clause_name: clause.name,
                                    // Use parent category thumbnail for clause items (no own image)
                                    image_url: category.image_url || null,
                                    is_dynamic: true,
                                    is_clause: true,
                                    children: []
                                });
                            }
                        }

                        // Determine dynamic dropdown items based on dropdown_mode:
                        // 'auto' (default): Show subcategories if any exist; if none exist, show clauses.
                        // 'subcategories': Only show subcategories
                        // 'clauses': Only show clauses
                        // 'both': Show both subcategories and clauses
                        const mode = item.dropdown_mode || 'auto';
                        let dynamicItems = [];
                        if (mode === 'subcategories') {
                            dynamicItems = dynamicSubcatItems;
                        } else if (mode === 'clauses') {
                            dynamicItems = dynamicClauseItems;
                        } else if (mode === 'both') {
                            dynamicItems = [...dynamicSubcatItems, ...dynamicClauseItems];
                        } else {
                            // 'auto'
                            dynamicItems = dynamicSubcatItems.length > 0 ? dynamicSubcatItems : dynamicClauseItems;
                        }

                        // If the menu item has no manually defined children, inject chosen dynamic items
                        if (!item.children || item.children.length === 0) {
                            item.children = dynamicItems;
                        } else if (item.type === 'dynamic_category') {
                            // Merge manual + dynamic
                            const existingLabels = new Set(item.children.map(c => c.label.toLowerCase()));
                            const newDynamic = dynamicItems.filter(c => !existingLabels.has(c.label.toLowerCase()));
                            item.children = [...item.children, ...newDynamic];
                        }

                        // Attach filtered metadata arrays for rich mega-menu rendering
                        item.dynamic_subcategories = (mode === 'clauses') ? [] : dynamicSubcatItems;
                        item.dynamic_clauses = (mode === 'subcategories') ? [] : dynamicClauseItems;
                    }
                } catch (err) {
                    console.error('[MenuService] Error expanding dynamic category:', err);
                }
            }

            expandedTree.push(item);
        }

        return expandedTree;
    }

    /**
     * Get menu and structured items by location for storefront
     */
    static async getMenuByLocation(tenantId, location) {
        const menuResult = await query(
            `SELECT * FROM menus WHERE tenant_id = $1 AND location = $2`,
            [tenantId, location]
        );

        if (menuResult.rows.length === 0) {
            return null;
        }

        const menu = menuResult.rows[0];

        const itemsResult = await query(
            `SELECT * FROM menu_items WHERE menu_id = $1 ORDER BY position ASC, created_at ASC`,
            [menu.id]
        );

        const items = itemsResult.rows;
        const tree = this.buildMenuTree(items);
        const expandedTree = await this.expandDynamicTree(tenantId, tree);

        return {
            ...menu,
            items,
            tree: expandedTree,
        };
    }

    /**
     * Get category and dynamic clause suggestions for Admin Menu Builder
     */
    static async getCatalogSuggestions(tenantId) {
        // 1. Fetch all active categories (handling null or true is_active)
        const catRes = await query(
            `SELECT id, name, slug, parent_id 
             FROM categories 
             WHERE tenant_id = $1 AND (is_active = true OR is_active IS NULL)
             ORDER BY name ASC`,
            [tenantId]
        );
        const categories = catRes.rows || [];

        // 2. Build category tree
        const catMap = new Map();
        categories.forEach(c => catMap.set(c.id, { ...c, subcategories: [], clauses: [] }));

        // 3. Fetch all attributes with clauses linked to categories safely
        try {
            const attrsRes = await query(
                `SELECT ca.category_id, a.id as attribute_id, a.code, a.label, a.clauses
                 FROM category_attributes ca
                 JOIN attributes a ON a.id = ca.attribute_id AND a.tenant_id = $1
                 WHERE ca.tenant_id = $1 AND a.clauses IS NOT NULL`,
                [tenantId]
            );

            // Group clauses by category
            if (attrsRes && attrsRes.rows) {
                for (const row of attrsRes.rows) {
                    const cat = catMap.get(row.category_id);
                    if (!cat) continue;

                    let clauses = [];
                    try {
                        clauses = (typeof row.clauses === 'string' ? JSON.parse(row.clauses) : row.clauses) || [];
                    } catch (e) {
                        clauses = [];
                    }

                    for (const cl of clauses) {
                        if (!cl || !cl.name) continue;

                        // Check exclusion
                        if (cl.excluded_category_ids && cl.excluded_category_ids.length > 0) {
                            const isExcluded = await this.isCategoryExcluded(tenantId, cat.id, cl.excluded_category_ids);
                            if (isExcluded) continue;
                        }

                        // Check has products
                        const filterValue = Array.isArray(cl.value) ? cl.value[0] : (cl.value ?? '1');
                        const hasProd = await this.hasProductsForClause(tenantId, cat.id, row.code, filterValue, cl.operator);
                        if (!hasProd) continue;

                        const prefix = (cl.prefix || '').trim();
                        const suffix = (cl.suffix || '').trim();
                        const label = (prefix || suffix)
                            ? `${prefix ? `${prefix} ` : ''}${cat.name}${suffix ? ` ${suffix}` : ''}`.trim()
                            : (cl.label || cl.name);
                        const prettySlug = this.slugify(`${prefix}${cat.slug || ''}${suffix}`);

                        cat.clauses.push({
                            attribute_id: row.attribute_id,
                            attribute_code: row.code,
                            attribute_label: row.label,
                            clause_name: cl.name,
                            clause_label: cl.label || cl.name,
                            display_label: label,
                            pretty_url: `/${prettySlug}`,
                            filter_url: `/search?category_id=${cat.id}&attribute.${row.code}:${cl.name}=${encodeURIComponent(String(filterValue))}`,
                        });
                    }
                }
            }
        } catch (attrErr) {
            console.warn('[MenuService] Warning: Could not fetch category attributes/clauses:', attrErr.message);
        }

        // Nest categories
        const tree = [];
        categories.forEach(c => {
            const mapped = catMap.get(c.id);
            if (c.parent_id && catMap.has(c.parent_id)) {
                catMap.get(c.parent_id).subcategories.push(mapped);
            } else {
                tree.push(mapped);
            }
        });

        return {
            categories: Array.from(catMap.values()),
            tree,
        };
    }

    /**
     * List all menus for tenant
     */
    static async getMenus(tenantId) {
        const result = await query(
            `SELECT m.*, COUNT(mi.id)::int as item_count 
             FROM menus m 
             LEFT JOIN menu_items mi ON m.id = mi.menu_id 
             WHERE m.tenant_id = $1 
             GROUP BY m.id 
             ORDER BY m.created_at ASC`,
            [tenantId]
        );
        return result.rows;
    }

    /**
     * Get single menu with all items
     */
    static async getMenu(tenantId, menuId) {
        const menuResult = await query(
            `SELECT * FROM menus WHERE id = $1 AND tenant_id = $2`,
            [menuId, tenantId]
        );

        if (menuResult.rows.length === 0) {
            return null;
        }

        const menu = menuResult.rows[0];

        const itemsResult = await query(
            `SELECT * FROM menu_items WHERE menu_id = $1 ORDER BY position ASC, created_at ASC`,
            [menu.id]
        );

        const items = itemsResult.rows;
        const tree = this.buildMenuTree(items);

        return {
            ...menu,
            items,
            tree,
        };
    }

    /**
     * Create menu
     */
    static async createMenu(tenantId, { name, location }) {
        const result = await query(
            `INSERT INTO menus (tenant_id, name, location) 
             VALUES ($1, $2, $3) 
             ON CONFLICT (tenant_id, location) 
             DO UPDATE SET name = EXCLUDED.name, updated_at = NOW() 
             RETURNING *`,
            [tenantId, name, location]
        );
        return result.rows[0];
    }

    /**
     * Update menu
     */
    static async updateMenu(tenantId, menuId, { name, location }) {
        const result = await query(
            `UPDATE menus 
             SET name = COALESCE($1, name), 
                 location = COALESCE($2, location), 
                 updated_at = NOW() 
             WHERE id = $3 AND tenant_id = $4 
             RETURNING *`,
            [name, location, menuId, tenantId]
        );
        return result.rows[0] || null;
    }

    /**
     * Delete menu
     */
    static async deleteMenu(tenantId, menuId) {
        const result = await query(
            `DELETE FROM menus WHERE id = $1 AND tenant_id = $2 RETURNING id`,
            [menuId, tenantId]
        );
        return result.rowCount > 0;
    }

    /**
     * Create menu item
     */
    static async createMenuItem(tenantId, menuId, itemData) {
        // Verify menu belongs to tenant
        const menu = await this.getMenu(tenantId, menuId);
        if (!menu) throw new Error('Menu not found');

        const {
            label,
            url = '/',
            type = 'custom',
            reference_id = null,
            parent_id = null,
            target = '_self',
            position = 0,
            dropdown_mode = 'auto',
            color = null,
        } = itemData;

        const result = await query(
            `INSERT INTO menu_items (menu_id, label, url, type, reference_id, parent_id, target, position, dropdown_mode, color) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
             RETURNING *`,
            [menuId, label, url, type, reference_id, parent_id, target, position, dropdown_mode || 'auto', color || null]
        );

        return result.rows[0];
    }

    /**
     * Update menu item
     */
    static async updateMenuItem(tenantId, menuId, itemId, itemData) {
        // Verify menu belongs to tenant
        const menu = await this.getMenu(tenantId, menuId);
        if (!menu) throw new Error('Menu not found');

        const {
            label,
            url,
            type,
            reference_id,
            parent_id,
            target,
            position,
            dropdown_mode,
            color,
        } = itemData;

        const result = await query(
            `UPDATE menu_items 
             SET label = COALESCE($1, label), 
                 url = COALESCE($2, url), 
                 type = COALESCE($3, type), 
                 reference_id = $4, 
                 parent_id = $5, 
                 target = COALESCE($6, target), 
                 position = COALESCE($7, position), 
                 dropdown_mode = COALESCE($8, dropdown_mode, 'auto'), 
                 color = $9,
                 updated_at = NOW() 
             WHERE id = $10 AND menu_id = $11 
             RETURNING *`,
            [label, url, type, reference_id !== undefined ? reference_id : null, parent_id !== undefined ? parent_id : null, target, position, dropdown_mode, color !== undefined ? color : null, itemId, menuId]
        );

        return result.rows[0] || null;
    }

    /**
     * Helper to validate UUID format
     */
    static isValidUUID(val) {
        return typeof val === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(val);
    }

    /**
     * Batch save / reorder all items in a menu
     */
    static async syncMenuItems(tenantId, menuId, items) {
        const menu = await this.getMenu(tenantId, menuId);
        if (!menu) throw new Error('Menu not found');

        // Clean out existing and re-insert in a safe transaction
        await query('BEGIN');
        try {
            await query(`DELETE FROM menu_items WHERE menu_id = $1`, [menuId]);

            const idMap = new Map();
            const insertedItems = [];

            // Step 1: Insert all items with parent_id = NULL to ensure all parent IDs exist
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                const originalId = item.id;
                const cleanId = this.isValidUUID(originalId) ? originalId : null;
                const cleanRefId = (item.reference_id && this.isValidUUID(item.reference_id)) ? item.reference_id : null;

                const res = await query(
                    `INSERT INTO menu_items (id, menu_id, label, url, type, reference_id, parent_id, target, position, dropdown_mode, color) 
                     VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6, NULL, $7, $8, $9, $10) 
                     RETURNING *`,
                    [
                        cleanId,
                        menuId,
                        item.label || 'Untitled',
                        item.url || '/',
                        item.type || 'custom',
                        cleanRefId,
                        item.target || '_self',
                        item.position !== undefined ? item.position : i,
                        item.dropdown_mode || 'auto',
                        item.color || null
                    ]
                );
                const inserted = res.rows[0];
                insertedItems.push(inserted);
                if (originalId) {
                    idMap.set(originalId, inserted.id);
                }
                idMap.set(inserted.id, inserted.id);
            }

            const validIds = new Set(insertedItems.map(it => it.id));

            // Step 2: Link parent_id for child items now that all IDs are in the database
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                const rawParentId = item.parent_id;
                if (!rawParentId) continue;

                const mappedParentId = idMap.get(rawParentId);
                const cleanParentId = validIds.has(mappedParentId) ? mappedParentId : null;

                if (cleanParentId) {
                    const insertedItem = insertedItems[i];
                    await query(
                        `UPDATE menu_items SET parent_id = $1 WHERE id = $2 AND menu_id = $3`,
                        [cleanParentId, insertedItem.id, menuId]
                    );
                    insertedItem.parent_id = cleanParentId;
                }
            }

            await query('COMMIT');
            return insertedItems;
        } catch (err) {
            await query('ROLLBACK');
            console.error('[MenuService] Failed to sync menu items:', err);
            throw err;
        }
    }

    /**
     * Delete menu item
     */
    static async deleteMenuItem(tenantId, menuId, itemId) {
        const menu = await this.getMenu(tenantId, menuId);
        if (!menu) throw new Error('Menu not found');

        const result = await query(
            `DELETE FROM menu_items WHERE id = $1 AND menu_id = $2 RETURNING id`,
            [itemId, menuId]
        );
        return result.rowCount > 0;
    }
}

module.exports = MenuService;
