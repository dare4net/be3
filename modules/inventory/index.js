/**
 * Inventory Management Module (IVM)
 *
 * Manages stock tracking for products that have opted into inventory management.
 * All products remain in the products table — inventory is purely additive.
 *
 * Routes:
 *   GET    /inventory                       — list tracked products with live quantities
 *   POST   /inventory/import-from-catalog   — enable tracking on existing catalog products
 *   POST   /inventory/remove               — disable tracking on a product
 *   PATCH  /inventory/:id/stock            — adjust stock (restock/recount/damage)
 *   PATCH  /inventory/:id/toggle-marketplace — toggle marketplace visibility
 *   POST   /inventory/bulk-publish         — publish/unpublish all inventory to marketplace
 *   GET    /inventory/ledger               — full audit trail
 *   GET    /inventory/low-stock            — items below threshold
 *   GET    /inventory/summary              — stats: total items, valuation, alerts
 *
 * Event Listeners:
 *   order.created          — deduct stock for storefront sales
 *   pos.sale.completed     — deduct stock for POS sales
 *   order.cancelled        — restock cancelled orders
 */

const express = require('express');
const { query } = require('../../config/database');
const { paginatedTenantQuery, tenantInsert, tenantUpdate } = require('../../utils/dbHelpers');
const { authenticate } = require('../../platform/core/auth/middleware/authenticate');
const authorize = require('../../platform/core/roles/middleware/authorize');
const { asyncHandler } = require('../../middleware/errorHandler');

// ── Migration ──────────────────────────────────────────────────────────────────
async function runMigration() {
    // Products inventory columns
    try {
        await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS track_inventory BOOLEAN DEFAULT false;`);
        await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS inventory_quantity INTEGER DEFAULT 0;`);
        await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS low_stock_threshold INTEGER DEFAULT NULL;`);
        await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS is_pos_visible BOOLEAN DEFAULT true;`);
        await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS is_marketplace_published BOOLEAN DEFAULT true;`);
        await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS tax_class VARCHAR(32) DEFAULT NULL;`);
        await query(`UPDATE products SET track_inventory = false WHERE track_inventory IS NULL;`);
        await query(`UPDATE products SET inventory_quantity = 0 WHERE inventory_quantity IS NULL;`);
        await query(`UPDATE products SET is_pos_visible = true WHERE is_pos_visible IS NULL;`);
        await query(`UPDATE products SET is_marketplace_published = true WHERE is_marketplace_published IS NULL;`);
    } catch (e) {
        console.warn('[Inventory] Products column migration warnings:', e.message);
    }

    // Inventory Ledger
    await query(`
        CREATE TABLE IF NOT EXISTS inventory_ledger (
            id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id         UUID NOT NULL,
            product_id        UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
            variant_id        UUID DEFAULT NULL,
            vendor_id         UUID DEFAULT NULL,
            change_quantity   INTEGER NOT NULL,
            previous_quantity INTEGER NOT NULL,
            new_quantity      INTEGER NOT NULL,
            reason            VARCHAR(64) NOT NULL,
            reference_id      UUID DEFAULT NULL,
            created_by        UUID NOT NULL,
            notes             TEXT DEFAULT NULL,
            created_at        TIMESTAMPTZ DEFAULT NOW()
        );
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_inv_ledger_tenant_product ON inventory_ledger (tenant_id, product_id);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_inv_ledger_vendor ON inventory_ledger (tenant_id, vendor_id);`);
    console.log('[Inventory] Migration complete');
}

// ── Stock adjustment helper ────────────────────────────────────────────────────
async function adjustStock(tenantId, productId, variantId, delta, reason, referenceId, createdBy, notes = null) {
    // Lock the row and adjust in one atomic operation
    const updated = await query(`
        UPDATE products
        SET inventory_quantity = GREATEST(0, inventory_quantity + $1),
            updated_at = NOW()
        WHERE id = $2 AND tenant_id = $3 AND track_inventory = true
        RETURNING id, inventory_quantity, low_stock_threshold, created_by
    `, [delta, productId, tenantId]);

    if (!updated.rows[0]) return null;

    const { inventory_quantity: newQty } = updated.rows[0];
    const prevQty = newQty - delta < 0 ? 0 : newQty - delta;

    // Write ledger entry
    await tenantInsert('inventory_ledger', tenantId, {
        product_id: productId,
        variant_id: variantId || null,
        vendor_id: updated.rows[0].created_by,
        change_quantity: delta,
        previous_quantity: prevQty,
        new_quantity: newQty,
        reason,
        reference_id: referenceId || null,
        created_by: createdBy,
        notes,
    });

    return { productId, newQty, prevQty };
}

// ── Role helper ────────────────────────────────────────────────────────────────
async function getVendorContext(tenantId, userId) {
    const Role = require('../../platform/core/roles/models/Role');
    const roles = await Role.getUserRoles(tenantId, userId);
    const isVendor = roles.some(r => r.name === 'Vendor' || r === 'Vendor');
    const isAdmin = roles.some(r => r.name === 'Admin' || r === 'Admin' || r.name === 'Super Admin');
    return { isVendor, isAdmin };
}

async function bootstrap(context) {
    const { app, eventBus } = context;

    try {
        await runMigration();
        const router = express.Router();

        // ── GET /summary — dashboard stats ────────────────────────────────────
        router.get('/summary', authenticate, authorize('products.view'), asyncHandler(async (req, res) => {
            const { tenantId, user } = req;
            const { isVendor, isAdmin } = await getVendorContext(tenantId, user.id);

            const vendorFilter = (isVendor && !isAdmin) ? `AND created_by = '${user.id}'` : '';

            const stats = await query(`
                SELECT
                    COUNT(*) FILTER (WHERE track_inventory = true)::int AS tracked_items,
                    COUNT(*) FILTER (WHERE track_inventory = true AND inventory_quantity = 0)::int AS out_of_stock,
                    COUNT(*) FILTER (WHERE track_inventory = true AND inventory_quantity > 0 AND inventory_quantity <= COALESCE(low_stock_threshold, 5))::int AS low_stock,
                    SUM(CASE WHEN track_inventory = true THEN inventory_quantity ELSE 0 END)::int AS total_units,
                    SUM(CASE WHEN track_inventory = true THEN inventory_quantity * COALESCE(price, 0) ELSE 0 END) AS inventory_value
                FROM products
                WHERE tenant_id = $1 AND deleted_at IS NULL ${vendorFilter}
            `, [tenantId]);

            res.json({ success: true, summary: stats.rows[0] });
        }));

        // ── GET / — list tracked inventory products (with variant support) ─────
        router.get('/', authenticate, authorize('products.view'), asyncHandler(async (req, res) => {
            const { tenantId, user } = req;
            const { isVendor, isAdmin } = await getVendorContext(tenantId, user.id);

            const page = parseInt(req.query.page) || 1;
            const perPage = parseInt(req.query.per_page) || 50;
            const offset = (page - 1) * perPage;
            const filter = req.query.filter; // 'low_stock' | 'out_of_stock' | 'in_stock'

            const params = [tenantId];
            let where = `WHERE p.tenant_id = $1 AND p.deleted_at IS NULL AND (p.is_variant = false OR p.is_variant IS NULL)
                         AND (p.track_inventory = true OR EXISTS (SELECT 1 FROM products v WHERE v.parent_id = p.id AND v.track_inventory = true AND v.deleted_at IS NULL))`;

            if (isVendor && !isAdmin) {
                params.push(user.id);
                where += ` AND p.created_by = $${params.length}`;
            }

            if (filter === 'out_of_stock') {
                where += ` AND (
                    (p.inventory_quantity = 0 AND NOT EXISTS (SELECT 1 FROM products v WHERE v.parent_id = p.id AND v.track_inventory = true AND v.deleted_at IS NULL))
                    OR
                    (EXISTS (SELECT 1 FROM products v WHERE v.parent_id = p.id AND v.track_inventory = true AND v.deleted_at IS NULL)
                     AND NOT EXISTS (SELECT 1 FROM products v2 WHERE v2.parent_id = p.id AND v2.track_inventory = true AND v2.inventory_quantity > 0 AND v2.deleted_at IS NULL))
                )`;
            } else if (filter === 'low_stock') {
                where += ` AND (
                    (p.inventory_quantity > 0 AND p.inventory_quantity <= COALESCE(p.low_stock_threshold, 5))
                    OR EXISTS (
                        SELECT 1 FROM products v WHERE v.parent_id = p.id AND v.track_inventory = true AND v.deleted_at IS NULL
                        AND v.inventory_quantity > 0 AND v.inventory_quantity <= COALESCE(v.low_stock_threshold, 5)
                    )
                )`;
            } else if (filter === 'in_stock') {
                where += ` AND (
                    (p.inventory_quantity > COALESCE(p.low_stock_threshold, 5))
                    OR EXISTS (
                        SELECT 1 FROM products v WHERE v.parent_id = p.id AND v.track_inventory = true AND v.deleted_at IS NULL
                        AND v.inventory_quantity > COALESCE(v.low_stock_threshold, 5)
                    )
                )`;
            }

            if (req.query.search) {
                params.push(`%${req.query.search}%`);
                where += ` AND (p.name ILIKE $${params.length} OR p.sku ILIKE $${params.length} OR EXISTS (
                    SELECT 1 FROM products v WHERE v.parent_id = p.id AND v.deleted_at IS NULL
                    AND (v.name ILIKE $${params.length} OR v.sku ILIKE $${params.length} OR v.variant_label ILIKE $${params.length})
                ))`;
            }

            const countRes = await query(`SELECT COUNT(*)::int FROM products p ${where}`, params);
            const { rows } = await query(`
                SELECT p.id, p.name, p.sku, p.price, p.image_url,
                       p.inventory_quantity, p.low_stock_threshold,
                       p.is_pos_visible, p.is_marketplace_published, p.track_inventory,
                       p.created_by as vendor_id,
                       u.business_name as vendor_name,
                       CASE
                           WHEN p.inventory_quantity = 0 THEN 'out_of_stock'
                           WHEN p.inventory_quantity <= COALESCE(p.low_stock_threshold, 5) THEN 'low_stock'
                           ELSE 'in_stock'
                       END AS stock_status
                FROM products p
                LEFT JOIN users u ON p.created_by = u.id
                ${where}
                ORDER BY p.updated_at DESC
                LIMIT $${params.length + 1} OFFSET $${params.length + 2}
            `, [...params, perPage, offset]);

            // Enrich with child variants
            const parentIds = rows.map(r => r.id);
            let variantsByParent = {};
            if (parentIds.length > 0) {
                const vRes = await query(`
                    SELECT v.id, v.parent_id, v.name, v.sku, v.price, v.image_url,
                           v.variant_label, v.inventory_quantity, v.low_stock_threshold,
                           v.is_pos_visible, v.is_marketplace_published, v.track_inventory,
                           CASE
                               WHEN v.inventory_quantity = 0 THEN 'out_of_stock'
                               WHEN v.inventory_quantity <= COALESCE(v.low_stock_threshold, 5) THEN 'low_stock'
                               ELSE 'in_stock'
                           END AS stock_status
                    FROM products v
                    WHERE v.parent_id = ANY($1) AND v.tenant_id = $2 AND v.deleted_at IS NULL
                    ORDER BY v.price ASC, v.name ASC
                `, [parentIds, tenantId]);
                for (const v of vRes.rows) {
                    if (!variantsByParent[v.parent_id]) variantsByParent[v.parent_id] = [];
                    variantsByParent[v.parent_id].push(v);
                }
            }

            const enrichedRows = rows.map(p => {
                const vars = variantsByParent[p.id] || [];
                if (vars.length > 0) {
                    const totalQty = vars.reduce((sum, v) => sum + (parseInt(v.inventory_quantity) || 0), 0);
                    const allOut = vars.every(v => v.stock_status === 'out_of_stock');
                    const anyLow = vars.some(v => v.stock_status === 'low_stock');
                    return {
                        ...p,
                        has_variants: true,
                        variants: vars,
                        inventory_quantity: totalQty,
                        stock_status: allOut ? 'out_of_stock' : anyLow ? 'low_stock' : 'in_stock',
                    };
                }
                return {
                    ...p,
                    has_variants: false,
                    variants: [],
                };
            });

            res.json({
                success: true,
                data: enrichedRows,
                pagination: {
                    page, perPage,
                    total: countRes.rows[0].count,
                    totalPages: Math.ceil(countRes.rows[0].count / perPage)
                }
            });
        }));

        // ── POST /import-from-catalog — enable tracking on existing products ───
        router.post('/import-from-catalog', authenticate, authorize('products.manage'), asyncHandler(async (req, res) => {
            const { tenantId, user } = req;
            const { product_ids, initial_quantity = 0 } = req.body;

            if (!Array.isArray(product_ids) || product_ids.length === 0) {
                return res.status(400).json({ error: 'product_ids array is required' });
            }

            const { isVendor, isAdmin } = await getVendorContext(tenantId, user.id);

            // Verify ownership for vendors
            let ownedProducts;
            if (isVendor && !isAdmin) {
                const owned = await query(`
                    SELECT id FROM products
                    WHERE id = ANY($1) AND tenant_id = $2 
                      AND (created_by = $3 OR attributes->>'vendor' = $3) 
                      AND deleted_at IS NULL
                `, [product_ids, tenantId, user.id]);
                ownedProducts = owned.rows.map(r => r.id);
            } else {
                ownedProducts = product_ids;
            }

            if (ownedProducts.length === 0) {
                return res.status(403).json({ error: 'None of the specified products belong to you' });
            }

            const initQty = parseInt(initial_quantity) || 0;

            // Enable inventory on each product that was selected
            const updated = await query(`
                UPDATE products
                SET track_inventory = true,
                    inventory_quantity = CASE 
                        WHEN $1::int > 0 THEN $1::int 
                        ELSE COALESCE(inventory_quantity, 0) 
                    END,
                    is_pos_visible = COALESCE(is_pos_visible, true),
                    is_marketplace_published = COALESCE(is_marketplace_published, true),
                    updated_at = NOW()
                WHERE id = ANY($2) AND tenant_id = $3
                RETURNING id, name, inventory_quantity, created_by
            `, [initQty, ownedProducts, tenantId]);

            // Write ledger entries for initial stock if quantity > 0
            for (const product of updated.rows) {
                const stockQty = product.inventory_quantity;
                if (stockQty > 0) {
                    await tenantInsert('inventory_ledger', tenantId, {
                        product_id: product.id,
                        vendor_id: product.created_by || user.id,
                        change_quantity: stockQty,
                        previous_quantity: 0,
                        new_quantity: stockQty,
                        reason: 'catalog_import',
                        created_by: user.id,
                        notes: 'Imported from catalog',
                    });
                }
            }

            // Also enable tracking on child variants of imported products
            await query(`
                UPDATE products
                SET track_inventory = true,
                    is_pos_visible = COALESCE(is_pos_visible, true),
                    is_marketplace_published = COALESCE(is_marketplace_published, true),
                    updated_at = NOW()
                WHERE parent_id = ANY($1) AND tenant_id = $2
            `, [ownedProducts, tenantId]);

            res.json({
                success: true,
                imported: updated.rows.length,
                products: updated.rows
            });
        }));

        // ── POST /remove — disable inventory tracking on a product ────────────
        router.post('/remove', authenticate, authorize('products.manage'), asyncHandler(async (req, res) => {
            const { tenantId, user } = req;
            const { product_id } = req.body;

            if (!product_id) return res.status(400).json({ error: 'product_id is required' });

            const { isVendor, isAdmin } = await getVendorContext(tenantId, user.id);

            const productRes = await query(
                `SELECT id, created_by FROM products WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
                [product_id, tenantId]
            );
            if (!productRes.rows[0]) return res.status(404).json({ error: 'Product not found' });

            if (isVendor && !isAdmin && productRes.rows[0].created_by !== user.id) {
                return res.status(403).json({ error: 'Forbidden' });
            }

            await query(`
                UPDATE products
                SET track_inventory = false, inventory_quantity = 0, updated_at = NOW()
                WHERE (id = $1 OR parent_id = $1) AND tenant_id = $2
            `, [product_id, tenantId]);

            // Log removal to ledger
            await tenantInsert('inventory_ledger', tenantId, {
                product_id,
                vendor_id: productRes.rows[0].created_by,
                change_quantity: 0,
                previous_quantity: 0,
                new_quantity: 0,
                reason: 'tracking_disabled',
                created_by: user.id,
                notes: 'Inventory tracking removed',
            });

            res.json({ success: true, message: 'Inventory tracking removed from product' });
        }));

        // ── PATCH /:id/stock — adjust stock (restock/recount/damage) ──────────
        router.patch('/:id/stock', authenticate, authorize('products.manage'), asyncHandler(async (req, res) => {
            const { tenantId, user } = req;
            const { adjustment_type, quantity, notes, supplier_name, purchase_order_ref } = req.body;
            // adjustment_type: 'restock' | 'recount' | 'damage'

            if (!adjustment_type || quantity === undefined) {
                return res.status(400).json({ error: 'adjustment_type and quantity are required' });
            }
            if (!['restock', 'recount', 'damage'].includes(adjustment_type)) {
                return res.status(400).json({ error: 'adjustment_type must be restock, recount, or damage' });
            }

            const { isVendor, isAdmin } = await getVendorContext(tenantId, user.id);
            const productRes = await query(
                `SELECT id, created_by, inventory_quantity, track_inventory, is_variant, parent_id FROM products WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
                [req.params.id, tenantId]
            );
            if (!productRes.rows[0]) return res.status(404).json({ error: 'Product not found' });
            if (isVendor && !isAdmin && productRes.rows[0].created_by !== user.id) {
                return res.status(403).json({ error: 'Forbidden' });
            }

            const product = productRes.rows[0];
            if (!product.track_inventory) {
                await query(`UPDATE products SET track_inventory = true WHERE id = $1 AND tenant_id = $2`, [product.id, tenantId]);
            }

            let delta;
            if (adjustment_type === 'recount') {
                delta = parseInt(quantity) - (product.inventory_quantity || 0);
            } else if (adjustment_type === 'damage') {
                delta = -Math.abs(parseInt(quantity));
            } else {
                delta = Math.abs(parseInt(quantity));
            }

            let fullNotes = notes ? notes.trim() : '';
            if (supplier_name) fullNotes += (fullNotes ? ' | ' : '') + `Supplier: ${supplier_name.trim()}`;
            if (purchase_order_ref) fullNotes += (fullNotes ? ' | ' : '') + `PO: ${purchase_order_ref.trim()}`;

            const result = await adjustStock(
                tenantId, req.params.id, product.is_variant ? product.id : null, delta,
                adjustment_type, null, user.id, fullNotes || null
            );

            res.json({ success: true, ...result });
        }));

        // ── PATCH /:id/threshold — quick threshold update ─────────────────────
        router.patch('/:id/threshold', authenticate, authorize('products.manage'), asyncHandler(async (req, res) => {
            const { tenantId, user } = req;
            const threshold = parseInt(req.body.low_stock_threshold);
            if (isNaN(threshold) || threshold < 0) {
                return res.status(400).json({ error: 'Valid threshold number required' });
            }
            const { isVendor, isAdmin } = await getVendorContext(tenantId, user.id);
            const productRes = await query(`SELECT id, created_by FROM products WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`, [req.params.id, tenantId]);
            if (!productRes.rows[0]) return res.status(404).json({ error: 'Product not found' });
            if (isVendor && !isAdmin && productRes.rows[0].created_by !== user.id) {
                return res.status(403).json({ error: 'Forbidden' });
            }

            await query(`UPDATE products SET low_stock_threshold = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`, [threshold, req.params.id, tenantId]);
            res.json({ success: true, low_stock_threshold: threshold });
        }));

        // ── PATCH /:id/quick-adjust — fast +/- delta ──────────────────────────
        router.patch('/:id/quick-adjust', authenticate, authorize('products.manage'), asyncHandler(async (req, res) => {
            const { tenantId, user } = req;
            const delta = parseInt(req.body.delta);
            if (isNaN(delta) || delta === 0) return res.status(400).json({ error: 'Non-zero delta required' });

            const { isVendor, isAdmin } = await getVendorContext(tenantId, user.id);
            const productRes = await query(`SELECT id, created_by, is_variant, track_inventory FROM products WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`, [req.params.id, tenantId]);
            if (!productRes.rows[0]) return res.status(404).json({ error: 'Product not found' });
            if (isVendor && !isAdmin && productRes.rows[0].created_by !== user.id) {
                return res.status(403).json({ error: 'Forbidden' });
            }

            const product = productRes.rows[0];
            if (!product.track_inventory) {
                await query(`UPDATE products SET track_inventory = true WHERE id = $1 AND tenant_id = $2`, [product.id, tenantId]);
            }

            const result = await adjustStock(
                tenantId, product.id, product.is_variant ? product.id : null,
                delta, delta > 0 ? 'restock' : 'damage', null, user.id, 'Quick inline adjust'
            );
            res.json({ success: true, ...result });
        }));

        // ── PATCH /:id/toggle-marketplace — toggle marketplace visibility ──────
        router.patch('/:id/toggle-marketplace', authenticate, authorize('products.manage'), asyncHandler(async (req, res) => {
            const { tenantId, user } = req;
            const { isVendor, isAdmin } = await getVendorContext(tenantId, user.id);

            const productRes = await query(
                `SELECT id, created_by, is_marketplace_published FROM products WHERE id = $1 AND tenant_id = $2 AND track_inventory = true`,
                [req.params.id, tenantId]
            );
            if (!productRes.rows[0]) return res.status(404).json({ error: 'Tracked product not found' });
            if (isVendor && !isAdmin && productRes.rows[0].created_by !== user.id) {
                return res.status(403).json({ error: 'Forbidden' });
            }

            const newValue = !productRes.rows[0].is_marketplace_published;
            await query(
                `UPDATE products SET is_marketplace_published = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
                [newValue, req.params.id, tenantId]
            );

            res.json({ success: true, is_marketplace_published: newValue });
        }));

        // ── PATCH /:id/toggle-pos — toggle POS visibility ─────────────────────
        router.patch('/:id/toggle-pos', authenticate, authorize('products.manage'), asyncHandler(async (req, res) => {
            const { tenantId, user } = req;
            const { isVendor, isAdmin } = await getVendorContext(tenantId, user.id);

            const productRes = await query(
                `SELECT id, created_by, is_pos_visible FROM products WHERE id = $1 AND tenant_id = $2 AND track_inventory = true`,
                [req.params.id, tenantId]
            );
            if (!productRes.rows[0]) return res.status(404).json({ error: 'Tracked product not found' });
            if (isVendor && !isAdmin && productRes.rows[0].created_by !== user.id) {
                return res.status(403).json({ error: 'Forbidden' });
            }

            const newValue = !productRes.rows[0].is_pos_visible;
            await query(
                `UPDATE products SET is_pos_visible = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
                [newValue, req.params.id, tenantId]
            );

            res.json({ success: true, is_pos_visible: newValue });
        }));

        // ── POST /bulk-publish — publish/unpublish all vendor inventory ────────
        router.post('/bulk-publish', authenticate, authorize('products.manage'), asyncHandler(async (req, res) => {
            const { tenantId, user } = req;
            const { publish } = req.body; // true = publish, false = unpublish
            const { isVendor, isAdmin } = await getVendorContext(tenantId, user.id);

            let where = `tenant_id = $1 AND track_inventory = true`;
            const params = [tenantId, !!publish];

            if (isVendor && !isAdmin) {
                params.push(user.id);
                where += ` AND created_by = $${params.length}`;
            }

            const result = await query(
                `UPDATE products SET is_marketplace_published = $2, updated_at = NOW() WHERE ${where}
                 RETURNING id`,
                params
            );

            res.json({ success: true, updated: result.rows.length, published: !!publish });
        }));

        // ── GET /ledger — full audit trail ────────────────────────────────────
        router.get('/ledger', authenticate, authorize('products.view'), asyncHandler(async (req, res) => {
            const { tenantId, user } = req;
            const { isVendor, isAdmin } = await getVendorContext(tenantId, user.id);

            const page = parseInt(req.query.page) || 1;
            const perPage = parseInt(req.query.per_page) || 50;
            const offset = (page - 1) * perPage;

            const params = [tenantId];
            let where = `WHERE l.tenant_id = $1`;

            if (isVendor && !isAdmin) {
                params.push(user.id);
                where += ` AND l.vendor_id = $${params.length}`;
            }
            if (req.query.product_id) {
                params.push(req.query.product_id);
                where += ` AND l.product_id = $${params.length}`;
            }
            if (req.query.reason) {
                params.push(req.query.reason);
                where += ` AND l.reason = $${params.length}`;
            }

            const countRes = await query(`SELECT COUNT(*)::int FROM inventory_ledger l ${where}`, params);
            const { rows } = await query(`
                SELECT l.*, p.name as product_name, p.sku, p.image_url,
                       u.business_name as vendor_name,
                       cb.first_name || ' ' || cb.last_name as created_by_name
                FROM inventory_ledger l
                LEFT JOIN products p ON l.product_id = p.id
                LEFT JOIN users u ON l.vendor_id = u.id
                LEFT JOIN users cb ON l.created_by = cb.id
                ${where}
                ORDER BY l.created_at DESC
                LIMIT $${params.length + 1} OFFSET $${params.length + 2}
            `, [...params, perPage, offset]);

            res.json({
                success: true,
                data: rows,
                pagination: { page, perPage, total: countRes.rows[0].count, totalPages: Math.ceil(countRes.rows[0].count / perPage) }
            });
        }));

        // ── GET /low-stock — items below threshold ────────────────────────────
        router.get('/low-stock', authenticate, authorize('products.view'), asyncHandler(async (req, res) => {
            const { tenantId, user } = req;
            const { isVendor, isAdmin } = await getVendorContext(tenantId, user.id);

            const params = [tenantId];
            let where = `WHERE p.tenant_id = $1 AND p.track_inventory = true AND p.deleted_at IS NULL
                         AND p.inventory_quantity <= COALESCE(p.low_stock_threshold, 5)`;

            if (isVendor && !isAdmin) {
                params.push(user.id);
                where += ` AND p.created_by = $${params.length}`;
            }

            const { rows } = await query(`
                SELECT p.id, p.name, p.sku, p.image_url, p.inventory_quantity,
                       p.low_stock_threshold, p.price,
                       CASE WHEN p.inventory_quantity = 0 THEN 'out_of_stock' ELSE 'low_stock' END as status
                FROM products p ${where}
                ORDER BY p.inventory_quantity ASC
            `, params);

            res.json({ success: true, data: rows });
        }));

        // ── Event Listeners ───────────────────────────────────────────────────

        // Deduct stock on storefront order creation
        eventBus.registerListener('order.created', async (event) => {
            const { tenantId, orderId, channel } = event.data;
            // Only auto-deduct for storefront orders (POS handles its own deduction)
            if (channel === 'pos') return;

            try {
                const itemsRes = await query(
                    `SELECT oi.product_id, oi.variant_id, oi.quantity
                     FROM order_items oi
                     JOIN products p ON p.id = oi.product_id
                     WHERE oi.order_id = $1 AND oi.tenant_id = $2 AND p.track_inventory = true`,
                    [orderId, tenantId]
                );

                for (const item of itemsRes.rows) {
                    await adjustStock(
                        tenantId, item.product_id, item.variant_id,
                        -item.quantity, 'online_sale', orderId,
                        '00000000-0000-0000-0000-000000000000', // system
                        `Online order ${orderId}`
                    );
                }

                if (itemsRes.rows.length > 0) {
                    console.log(`[Inventory] Deducted stock for ${itemsRes.rows.length} items from order ${orderId}`);
                }
            } catch (error) {
                console.error('[Inventory] Error deducting stock for order:', error.message);
            }
        });

        // Restock on order cancellation
        eventBus.registerListener('order.cancelled', async (event) => {
            const { tenantId, orderId } = event.data;

            try {
                const itemsRes = await query(
                    `SELECT oi.product_id, oi.variant_id, oi.quantity
                     FROM order_items oi
                     JOIN products p ON p.id = oi.product_id
                     WHERE oi.order_id = $1 AND oi.tenant_id = $2 AND p.track_inventory = true`,
                    [orderId, tenantId]
                );

                for (const item of itemsRes.rows) {
                    await adjustStock(
                        tenantId, item.product_id, item.variant_id,
                        item.quantity, 'order_cancel', orderId,
                        '00000000-0000-0000-0000-000000000000',
                        `Restocked from cancelled order ${orderId}`
                    );
                }

                if (itemsRes.rows.length > 0) {
                    console.log(`[Inventory] Restocked ${itemsRes.rows.length} items from cancelled order ${orderId}`);
                }
            } catch (error) {
                console.error('[Inventory] Error restocking from cancellation:', error.message);
            }
        });

        // POS sale deduction (emitted by POS module)
        eventBus.registerListener('pos.sale.completed', async (event) => {
            const { tenantId, orderId, items, cashierId } = event.data;

            try {
                for (const item of (items || [])) {
                    if (!item.track_inventory) continue;
                    await adjustStock(
                        tenantId, item.product_id, item.variant_id || null,
                        -item.quantity, 'pos_sale', orderId,
                        cashierId,
                        `POS sale - Order ${orderId}`
                    );
                }
                console.log(`[Inventory] Deducted stock for POS order ${orderId}`);
            } catch (error) {
                console.error('[Inventory] Error deducting stock for POS sale:', error.message);
            }
        });

        app.use('/inventory', router);
        console.log('[Inventory] Module initialized');
        return true;

    } catch (error) {
        console.error('[Inventory] Bootstrap failed:', error);
        return false;
    }
}

module.exports = { bootstrap, adjustStock };
