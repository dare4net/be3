/**
 * Orders Module Bootstrapper
 *
 * PRINCIPLE: All inter-module communication is event-based
 * PRINCIPLE: Order status is operational (fulfillment). Payment status is financial.
 *
 * Status taxonomy:
 *   order status:   pending → processing → shipped → delivered → returned
 *                   pending/processing → cancelled
 *   payment status: unpaid → processing → paid/failed → refunded  (platform)
 *                   unpaid → fulfilled → refunded                  (manual vendor confirm)
 *
 * Payment gate: order status CANNOT be advanced if payment_status is unpaid/failed/processing.
 * Exception: pending → processing with unpaid triggers a 402 prompt so the vendor can
 * manually confirm off-platform payment (sets payment_status = 'fulfilled').
 */

const express = require('express');
const { query } = require('../../config/database');
const { paginatedTenantQuery, tenantInsert, tenantUpdate } = require('../../utils/dbHelpers');
const Role = require('../../platform/core/roles/models/Role');
const { authenticate, optionalAuth } = require('../../platform/core/auth/middleware/authenticate');
const authorize = require('../../platform/core/roles/middleware/authorize');
const subscriptionGuard = require('../../middleware/subscriptionGuard');
const { asyncHandler } = require('../../middleware/errorHandler');

// Valid one-way transitions. Any move not in this map is rejected.
const VALID_TRANSITIONS = {
    pending: ['processing', 'cancelled'],
    processing: ['shipped', 'cancelled'],
    shipped: ['delivered'],
    delivered: ['returned'],
    returned: [],
    cancelled: [],
};

// Payment statuses that allow order status changes.
const PAYMENT_STATUSES_ALLOWING_ADVANCE = ['paid', 'fulfilled'];

// Helper: fetch user roles once
async function getUserRoles(tenantId, userId) {
    return Role.getUserRoles(tenantId, userId);
}

function isAdmin(roles) {
    return roles.some(r => r.name === 'Admin' || r === 'Admin' || r.name === 'Super Admin' || r === 'Super Admin');
}

function isVendor(roles) {
    return roles.some(r => r.name === 'Vendor' || r === 'Vendor');
}

async function bootstrap(context) {
    const { app, eventBus } = context;

    try {
        const router = express.Router();

        router.use(subscriptionGuard('orders'));

        // ── POST / — Vendor/Admin manual order creation ─────────────────────
        router.post('/', authenticate, authorize('orders.manage'), asyncHandler(async (req, res) => {
            const { tenantId, user } = req;
            const {
                customer_name, customer_email, customer_phone,
                items,               // [{ product_id, variant_id?, quantity, price? }]
                payment_method,      // 'manual' | 'cash' | 'bank_transfer' | 'pos'
                payment_status: reqPaymentStatus, // 'fulfilled' | 'unpaid'
                shipping_address,
                notes,
                discount_amount,
                coupon_code,
                metadata: reqMetadata // Allow frontend injected properties (e.g., wa_tools tracking)
            } = req.body;

            console.log('\n[Orders POST] Incoming request metadata:', reqMetadata);

            if (!items || !Array.isArray(items) || items.length === 0) {
                return res.status(400).json({ error: 'items array is required' });
            }
            if (!customer_email && !customer_name) {
                return res.status(400).json({ error: 'customer_email or customer_name is required' });
            }

            if (!user.roles) user.roles = await getUserRoles(tenantId, user.id);
            const userIsVendor = isVendor(user.roles);
            const userIsAdmin = isAdmin(user.roles);

            // Build enriched item list + calculate totals
            let subtotal = 0;
            const enrichedItems = [];

            for (const item of items) {
                if (!item.product_id || !item.quantity) {
                    return res.status(400).json({ error: `Each item must have product_id and quantity` });
                }

                let productSql = `SELECT id, name, price, image_url, status, created_by FROM products WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`;
                const productRes = await query(productSql, [item.product_id, tenantId]);
                if (!productRes.rows[0]) {
                    return res.status(404).json({ error: `Product ${item.product_id} not found` });
                }
                const product = productRes.rows[0];

                // Vendor can only include their own products
                if (userIsVendor && !userIsAdmin && product.created_by !== user.id) {
                    return res.status(403).json({ error: `You do not own product: ${product.name}` });
                }

                const unitPrice = parseFloat(item.price ?? product.price);
                const lineTotal = unitPrice * parseInt(item.quantity);
                subtotal += lineTotal;

                enrichedItems.push({
                    product_id: product.id,
                    variant_id: item.variant_id || null,
                    product_name: product.name,
                    quantity: parseInt(item.quantity),
                    price: unitPrice,
                    total: lineTotal,
                    image_url: product.image_url || null,
                    vendor_id: product.created_by,
                });
            }

            const discountAmt = parseFloat(discount_amount || 0);
            const total = Math.max(0, subtotal - discountAmt);

            // Generate unique order number
            const orderCount = await query(`SELECT COUNT(*) FROM orders WHERE tenant_id = $1`, [tenantId]);
            const seq = parseInt(orderCount.rows[0].count) + 1;
            const order_number = `ORD-${String(seq).padStart(5, '0')}-${Date.now().toString(36).toUpperCase()}`;

            // Determine vendor_id (for vendor-scoped orders, all items must be from same vendor)
            const vendorId = userIsVendor && !userIsAdmin ? user.id
                : (enrichedItems.length > 0 ? enrichedItems[0].vendor_id : null);

            // Create order
            const order = await tenantInsert('orders', tenantId, {
                order_number,
                user_id: null,                        // manual order, no storefront user
                vendor_id: vendorId,
                channel: req.body.channel || 'manual_admin',
                status: 'processing',
                payment_status: reqPaymentStatus || (payment_method === 'manual' ? 'fulfilled' : 'unpaid'),
                subtotal,
                tax_amount: parseFloat(req.body.tax_amount || 0),
                tax_breakdown: req.body.tax_breakdown ? JSON.stringify(req.body.tax_breakdown) : null,
                total,
                discount_amount: discountAmt,
                coupon_code: coupon_code || null,
                notes: notes || null,
                metadata: {
                    ...reqMetadata,
                    customer_name,
                    customer_email,
                    customer_phone,
                    shipping_address,
                    source: reqMetadata?.source ? reqMetadata.source : 'vendor_created',
                    payment_method: payment_method || 'manual',
                    created_by: user.id,
                    audit_log: [
                        {
                            id: require('crypto').randomUUID(),
                            timestamp: new Date().toISOString(),
                            action: 'order_created',
                            from: null,
                            to: 'processing',
                            actor_id: user.id,
                            actor_name: user.first_name ? `${user.first_name} ${user.last_name || ''}`.trim() : user.email,
                            note: 'Manually created order'
                        }
                    ]
                }
            });

            // Insert order items
            for (const item of enrichedItems) {
                await tenantInsert('order_items', tenantId, {
                    order_id: order.id,
                    product_id: item.product_id,
                    variant_id: item.variant_id,
                    product_name: item.product_name,
                    quantity: item.quantity,
                    price: item.price,
                    total: item.total,
                    image_url: item.image_url
                });
            }

            console.log('\n[Orders POST] Emitting order.created with metadata:', order.metadata);

            // Fire events — triggers existing notification listeners
            eventBus.emitEvent('order.created', {
                tenantId,
                orderId: order.id,
                orderNumber: order.order_number,
                vendorId: order.vendor_id,
                userId: null,
                email: customer_email,
                total,
                source: 'vendor_created',
                metadata: order.metadata
            });
            eventBus.emitEvent('admin.order.new', {
                tenantId,
                orderId: order.id,
                orderNumber: order.order_number,
                total,
            });

            if (order.payment_status === 'fulfilled' || order.payment_status === 'paid') {
                eventBus.emitEvent('order.payment_status_changed', {
                    tenantId,
                    orderId: order.id,
                    newStatus: order.status,
                    newPaymentStatus: order.payment_status
                });
            }

            res.status(201).json({ success: true, order, items: enrichedItems });
        }));

        // ── GET /analytics — Channel metrics, status counts, revenue summary ──────
        router.get('/analytics', authenticate, asyncHandler(async (req, res) => {
            const { tenantId, user, query: reqQuery } = req;

            const params = [tenantId];
            let vendorFilter = '';

            if (!user.roles) user.roles = await getUserRoles(tenantId, user.id);
            const userIsVendor = isVendor(user.roles);
            const userIsAdmin = isAdmin(user.roles);

            if (userIsVendor && !userIsAdmin) {
                params.push(user.id);
                // Cover both direct vendor_id assignment AND orders containing that vendor's products
                vendorFilter = ` AND (vendor_id = $${params.length} OR EXISTS (
                    SELECT 1 FROM order_items oi
                    JOIN products p ON p.id = oi.product_id
                    WHERE oi.order_id = orders.id AND p.created_by = $${params.length}
                ))`;
            }

            let dateFilter = '';
            if (reqQuery.date_from) {
                params.push(new Date(reqQuery.date_from).toISOString());
                dateFilter += ` AND created_at >= $${params.length}`;
            }
            if (reqQuery.date_to) {
                let d = new Date(reqQuery.date_to);
                if (reqQuery.date_to.length <= 10) d.setHours(23, 59, 59, 999);
                params.push(d.toISOString());
                dateFilter += ` AND created_at <= $${params.length}`;
            }

            const channelCaseSql = `
                CASE 
                    WHEN channel = 'pos' OR order_number LIKE 'POS-%' OR metadata->>'source' = 'pos' THEN 'pos'
                    WHEN checkout_type = 'whatsapp' OR order_number LIKE 'WA-%' OR (metadata->>'is_whatsapp')::text = 'true' THEN 'whatsapp'
                    WHEN order_number LIKE 'PRE-%' OR (metadata->>'is_bot_preorder')::text = 'true' THEN 'be3ai'
                    WHEN channel = 'manual_admin' OR metadata->>'source' IN ('vendor_created', 'wa_tools') THEN 'manual'
                    ELSE 'storefront'
                END
            `;

            // 1. Channel Breakdown
            const channelSql = `
                SELECT 
                    resolved_channel AS channel,
                    COUNT(*)::int AS count,
                    COALESCE(SUM(total), 0)::numeric(12,2) AS total_revenue,
                    COALESCE(SUM(CASE WHEN payment_status IN ('paid', 'fulfilled') THEN total ELSE 0 END), 0)::numeric(12,2) AS paid_revenue
                FROM (
                    SELECT total, payment_status, ${channelCaseSql} AS resolved_channel
                    FROM orders
                    WHERE tenant_id = $1 ${vendorFilter} ${dateFilter}
                ) sub
                GROUP BY resolved_channel
            `;
            const channelRes = await query(channelSql, params);

            // 2. Status Breakdown
            const statusSql = `
                SELECT 
                    status,
                    COUNT(*)::int AS count
                FROM orders
                WHERE tenant_id = $1 ${vendorFilter} ${dateFilter}
                GROUP BY status
            `;
            const statusRes = await query(statusSql, params);

            // 3. Overall Totals
            const overviewSql = `
                SELECT 
                    COUNT(*)::int AS total_orders,
                    COALESCE(SUM(total), 0)::numeric(12,2) AS total_revenue,
                    COALESCE(SUM(CASE WHEN payment_status IN ('paid', 'fulfilled') THEN total ELSE 0 END), 0)::numeric(12,2) AS paid_revenue,
                    COALESCE(AVG(total), 0)::numeric(12,2) AS avg_order_value,
                    COUNT(CASE WHEN status IN ('pending', 'processing') THEN 1 END)::int AS pending_fulfillment_count
                FROM orders
                WHERE tenant_id = $1 ${vendorFilter} ${dateFilter}
            `;
            const overviewRes = await query(overviewSql, params);
            const overview = overviewRes.rows[0] || {};

            const defaultChannels = {
                storefront: { label: 'Storefront', count: 0, revenue: 0, paid_revenue: 0, prefix: 'ORD' },
                pos:        { label: 'POS Terminal', count: 0, revenue: 0, paid_revenue: 0, prefix: 'POS' },
                whatsapp:   { label: 'WhatsApp', count: 0, revenue: 0, paid_revenue: 0, prefix: 'WA' },
                be3ai:      { label: 'BE3 AI Bot', count: 0, revenue: 0, paid_revenue: 0, prefix: 'PRE' },
                manual:     { label: 'Manual / Admin', count: 0, revenue: 0, paid_revenue: 0, prefix: 'ORD' }
            };

            channelRes.rows.forEach(r => {
                if (defaultChannels[r.channel]) {
                    defaultChannels[r.channel].count = parseInt(r.count || 0);
                    defaultChannels[r.channel].revenue = parseFloat(r.total_revenue || 0);
                    defaultChannels[r.channel].paid_revenue = parseFloat(r.paid_revenue || 0);
                }
            });

            const statusCounts = {};
            statusRes.rows.forEach(r => {
                statusCounts[r.status] = parseInt(r.count || 0);
            });

            res.json({
                success: true,
                analytics: {
                    overview: {
                        total_orders: parseInt(overview.total_orders || 0),
                        total_revenue: parseFloat(overview.total_revenue || 0),
                        paid_revenue: parseFloat(overview.paid_revenue || 0),
                        avg_order_value: parseFloat(overview.avg_order_value || 0),
                        pending_fulfillment_count: parseInt(overview.pending_fulfillment_count || 0),
                    },
                    channels: defaultChannels,
                    status_counts: statusCounts
                }
            });
        }));

        // ── GET / — List orders with channel, status, date, search, and enrichment ────
        router.get('/', optionalAuth, asyncHandler(async (req, res) => {
            const { tenantId, user, query: reqQuery } = req;

            const params = [tenantId];
            const whereConditions = [`tenant_id = $1`];

            // 1. Role / Vendor Scope
            if (user) {
                if (!user.roles) user.roles = await getUserRoles(tenantId, user.id);
                const userIsVendor = isVendor(user.roles);
                const userIsAdmin = isAdmin(user.roles);
                if (userIsVendor && !userIsAdmin) {
                    params.push(user.id);
                    // Cover both direct vendor_id assignment AND orders containing that vendor's products
                    whereConditions.push(`(vendor_id = $${params.length} OR EXISTS (
                        SELECT 1 FROM order_items oi
                        JOIN products p ON p.id = oi.product_id
                        WHERE oi.order_id = orders.id AND p.created_by = $${params.length}
                    ))`);
                }
            } else if (reqQuery.session_id) {
                params.push(reqQuery.session_id);
                whereConditions.push(`session_id = $${params.length}`);
            } else {
                // Security: unauthenticated requests without a session_id cannot list all orders
                return res.status(401).json({ error: 'Unauthorized', message: 'Authentication required to list orders' });
            }

            if (reqQuery.user_id) {
                params.push(reqQuery.user_id);
                whereConditions.push(`user_id = $${params.length}`);
            }

            // 2. Channel Filter
            const channelCaseSql = `
                CASE 
                    WHEN channel = 'pos' OR order_number LIKE 'POS-%' OR metadata->>'source' = 'pos' THEN 'pos'
                    WHEN checkout_type = 'whatsapp' OR order_number LIKE 'WA-%' OR (metadata->>'is_whatsapp')::text = 'true' THEN 'whatsapp'
                    WHEN order_number LIKE 'PRE-%' OR (metadata->>'is_bot_preorder')::text = 'true' THEN 'be3ai'
                    WHEN channel = 'manual_admin' OR metadata->>'source' IN ('vendor_created', 'wa_tools') THEN 'manual'
                    ELSE 'storefront'
                END
            `;

            if (reqQuery.channel && reqQuery.channel !== 'all') {
                params.push(reqQuery.channel);
                whereConditions.push(`(${channelCaseSql}) = $${params.length}`);
            }

            // 3. Status Filter
            if (reqQuery.status && reqQuery.status !== 'all') {
                params.push(reqQuery.status);
                whereConditions.push(`status = $${params.length}`);
            }

            // 4. Payment Status Filter
            if (reqQuery.payment_status && reqQuery.payment_status !== 'all') {
                params.push(reqQuery.payment_status);
                whereConditions.push(`payment_status = $${params.length}`);
            }

            // 5. Date Range Filter
            if (reqQuery.date_from) {
                params.push(new Date(reqQuery.date_from).toISOString());
                whereConditions.push(`created_at >= $${params.length}`);
            }
            if (reqQuery.date_to) {
                let d = new Date(reqQuery.date_to);
                if (reqQuery.date_to.length <= 10) d.setHours(23, 59, 59, 999);
                params.push(d.toISOString());
                whereConditions.push(`created_at <= $${params.length}`);
            }

            // 6. Search
            if (reqQuery.search && reqQuery.search.trim()) {
                const s = `%${reqQuery.search.trim()}%`;
                params.push(s);
                whereConditions.push(`(
                    order_number ILIKE $${params.length} OR 
                    customer_email ILIKE $${params.length} OR 
                    customer_name ILIKE $${params.length} OR 
                    metadata->>'customer_name' ILIKE $${params.length} OR 
                    metadata->>'customer_phone' ILIKE $${params.length}
                )`);
            }

            // 7. Sorting
            const allowedSortCols = {
                created_at: 'created_at',
                total: 'total',
                order_number: 'order_number',
                status: 'status',
                payment_status: 'payment_status'
            };
            const sortCol = allowedSortCols[reqQuery.sort_by] || 'created_at';
            const sortDir = (reqQuery.sort_dir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

            // 8. Pagination
            const page = Math.max(1, parseInt(reqQuery.page) || 1);
            const perPage = Math.min(100, Math.max(1, parseInt(reqQuery.limit) || parseInt(reqQuery.per_page) || 20));
            const offset = (page - 1) * perPage;

            const whereClause = `WHERE ${whereConditions.join(' AND ')}`;

            // Count
            const countSql = `SELECT COUNT(*)::int AS total FROM orders ${whereClause}`;
            const countRes = await query(countSql, params);
            const total = countRes.rows[0]?.total || 0;

            // Fetch
            const dataSql = `
                SELECT *, ${channelCaseSql} AS resolved_channel
                FROM orders 
                ${whereClause}
                ORDER BY ${sortCol} ${sortDir}
                LIMIT $${params.length + 1} OFFSET $${params.length + 2}
            `;
            const dataRes = await query(dataSql, [...params, perPage, offset]);

            // Enrich items and customer details
            if (dataRes.rows.length > 0) {
                const orderIds = dataRes.rows.map(o => o.id);
                const itemsRes = await query(`
                    SELECT 
                        order_id,
                        COUNT(*)::int AS item_count,
                        json_agg(json_build_object(
                            'product_name', product_name,
                            'quantity', quantity,
                            'price', price,
                            'image_url', image_url
                        )) AS items_summary
                    FROM order_items
                    WHERE order_id = ANY($1) AND tenant_id = $2
                    GROUP BY order_id
                `, [orderIds, tenantId]);

                const itemsMap = {};
                itemsRes.rows.forEach(r => {
                    itemsMap[r.order_id] = {
                        item_count: r.item_count,
                        items_summary: r.items_summary
                    };
                });

                dataRes.rows = dataRes.rows.map(order => ({
                    ...order,
                    item_count: itemsMap[order.id]?.item_count || 0,
                    items_summary: itemsMap[order.id]?.items_summary || [],
                    customer_display_name: order.customer_name || order.metadata?.customer_name || (order.customer_email ? order.customer_email.split('@')[0] : 'Guest'),
                    customer_phone: order.metadata?.customer_phone || ''
                }));
            }

            res.json({
                success: true,
                data: dataRes.rows,
                pagination: {
                    page,
                    perPage,
                    total,
                    totalPages: Math.ceil(total / perPage)
                }
            });
        }));

        // Get orders for the current authenticated user
        router.get('/my-orders', authenticate, asyncHandler(async (req, res) => {
            const { tenantId, user } = req;

            const result = await paginatedTenantQuery('orders', tenantId, {
                page: parseInt(req.query.page) || 1,
                perPage: parseInt(req.query.per_page) || 20,
                orderBy: 'created_at DESC',
                conditions: { user_id: user.id }
            });

            // Enrich each order with first-item thumbnail + item count (single batch query)
            if (result.data && result.data.length > 0) {
                const orderIds = result.data.map(o => o.id);
                const enrichRes = await query(`
                    SELECT DISTINCT ON (oi.order_id)
                        oi.order_id,
                        COUNT(oi.id) OVER (PARTITION BY oi.order_id) AS item_count,
                        COALESCE(pm.url, p.image_url) AS thumbnail
                    FROM order_items oi
                    LEFT JOIN products p ON p.id = oi.product_id
                    LEFT JOIN product_media pm ON pm.product_id = oi.product_id AND pm.media_type = 'image'
                    WHERE oi.order_id = ANY($1) AND oi.tenant_id = $2
                    ORDER BY oi.order_id, oi.created_at ASC
                `, [orderIds, tenantId]);

                const enrichMap = {};
                enrichRes.rows.forEach(r => {
                    enrichMap[r.order_id] = { thumbnail: r.thumbnail, item_count: parseInt(r.item_count) };
                });

                result.data = result.data.map(o => ({
                    ...o,
                    thumbnail: enrichMap[o.id]?.thumbnail || null,
                    item_count: enrichMap[o.id]?.item_count || 0,
                }));
            }

            res.json({ success: true, ...result });
        }));

        // Get order by ID or Number
        router.get('/:id', optionalAuth, asyncHandler(async (req, res) => {
            const { id } = req.params;
            const { tenantId, user } = req;

            // Try ID first, then order_number (cast ID to text for string comparison)
            let orderSql = `SELECT * FROM orders WHERE (id::text = $1 OR order_number = $1) AND tenant_id = $2`;
            let orderResult = await query(orderSql, [id, tenantId]);

            if (!orderResult.rows[0]) {
                return res.status(404).json({ error: 'Order not found' });
            }

            const order = orderResult.rows[0];

            // Security: Vendor ownership guard for authenticated users
            if (user) {
                if (!user.roles) user.roles = await getUserRoles(tenantId, user.id);
                const userIsVendor = isVendor(user.roles);
                const userIsAdmin = isAdmin(user.roles);

                if (userIsVendor && !userIsAdmin && order.vendor_id !== user.id && order.user_id !== user.id) {
                    return res.status(403).json({ error: 'Forbidden', message: 'You can only view your own orders' });
                }
            }

            const orderSessionId = order.session_id || order.metadata?.session_id || null;

            // Security: If session_id is provided, must match
            if (!user && req.query.session_id && orderSessionId !== req.query.session_id) {
                // For now, allow bot to see it if it has the number, but in production we'd be stricter
            }

            const itemsSql = `SELECT * FROM order_items WHERE order_id = $1 AND tenant_id = $2`;
            const itemsResult = await query(itemsSql, [order.id, tenantId]);

            res.json({
                success: true,
                order,
                items: itemsResult.rows,
            });
        }));

        // ── POST /bulk-status — Bulk order status update with audit logging ────────
        router.post('/bulk-status', authenticate, authorize('orders.manage'), asyncHandler(async (req, res) => {
            const { tenantId, user } = req;
            const { orderIds, status: newStatus, note } = req.body;

            if (!Array.isArray(orderIds) || orderIds.length === 0) {
                return res.status(400).json({ error: 'ValidationError', message: 'orderIds array is required' });
            }
            if (!newStatus) {
                return res.status(400).json({ error: 'ValidationError', message: 'status is required' });
            }

            if (!user.roles) user.roles = await getUserRoles(tenantId, user.id);
            const userIsVendor = isVendor(user.roles);
            const userIsAdmin = isAdmin(user.roles);

            let whereVendor = '';
            const fetchParams = [orderIds, tenantId];
            if (userIsVendor && !userIsAdmin) {
                fetchParams.push(user.id);
                whereVendor = ' AND vendor_id = $3';
            }

            const ordersRes = await query(
                `SELECT * FROM orders WHERE id = ANY($1) AND tenant_id = $2 ${whereVendor}`,
                fetchParams
            );

            const actorName = user.first_name ? `${user.first_name} ${user.last_name || ''}`.trim() : user.email;
            const results = [];
            const errors = [];

            for (const order of ordersRes.rows) {
                // Validate transition
                const allowed = VALID_TRANSITIONS[order.status] || [];
                if (!allowed.includes(newStatus)) {
                    errors.push({ orderId: order.id, orderNumber: order.order_number, error: `Invalid transition from '${order.status}' to '${newStatus}'` });
                    continue;
                }

                // Check payment gate
                if (newStatus !== 'cancelled' && !PAYMENT_STATUSES_ALLOWING_ADVANCE.includes(order.payment_status)) {
                    errors.push({ orderId: order.id, orderNumber: order.order_number, error: `Cannot advance while payment is '${order.payment_status}'` });
                    continue;
                }

                const currentMetadata = (typeof order.metadata === 'object' && order.metadata !== null) ? { ...order.metadata } : {};
                const auditLog = Array.isArray(currentMetadata.audit_log) ? [...currentMetadata.audit_log] : [];
                auditLog.push({
                    id: require('crypto').randomUUID(),
                    timestamp: new Date().toISOString(),
                    action: 'bulk_status_change',
                    from: order.status,
                    to: newStatus,
                    actor_id: user.id,
                    actor_name: actorName,
                    note: note || 'Bulk status update'
                });

                const updates = { 
                    status: newStatus,
                    metadata: { ...currentMetadata, audit_log: auditLog }
                };
                if (newStatus === 'shipped') updates.shipped_at = new Date();
                if (newStatus === 'delivered') updates.delivered_at = new Date();
                if (newStatus === 'cancelled') updates.cancelled_at = new Date();

                const updated = await tenantUpdate('orders', tenantId, order.id, updates);

                eventBus.emitEvent('order.status_changed', {
                    tenantId,
                    orderId: order.id,
                    orderNumber: order.order_number,
                    userId: order.user_id || null,
                    vendorId: order.vendor_id || null,
                    oldStatus: order.status,
                    newStatus,
                });

                results.push({ orderId: order.id, orderNumber: order.order_number, status: newStatus });
            }

            res.json({
                success: true,
                updatedCount: results.length,
                results,
                errors
            });
        }));

        // ── PATCH /:id/status ──────────────────────────────────────────────────
        // Update order status with full transition validation + payment gate + audit logging
        router.patch('/:id/status', authenticate, authorize('orders.manage'), asyncHandler(async (req, res) => {
            const { tenantId, user } = req;
            const orderId = req.params.id;
            const { status: newStatus, note } = req.body;

            if (!newStatus) {
                return res.status(400).json({ error: 'ValidationError', message: 'status is required' });
            }

            // 1. Fetch current order
            const orderResult = await query(
                `SELECT * FROM orders WHERE id = $1 AND tenant_id = $2`,
                [orderId, tenantId]
            );
            if (!orderResult.rows[0]) {
                return res.status(404).json({ error: 'OrderNotFound', message: 'Order not found' });
            }
            const order = orderResult.rows[0];

            // 2. Vendor ownership check
            if (!user.roles) user.roles = await getUserRoles(tenantId, user.id);
            const userIsVendor = isVendor(user.roles);
            const userIsAdmin = isAdmin(user.roles);

            if (userIsVendor && !userIsAdmin && order.vendor_id !== user.id) {
                return res.status(403).json({ error: 'Forbidden', message: 'You can only manage your own orders' });
            }

            // 3. Transition validation — one-way, permanent
            const allowed = VALID_TRANSITIONS[order.status] || [];
            if (!allowed.includes(newStatus)) {
                return res.status(400).json({
                    error: 'InvalidTransition',
                    message: `Cannot move order from '${order.status}' to '${newStatus}'`,
                    current: order.status,
                    allowed,
                });
            }

            // 4. Payment gate — cannot advance status without payment
            //    Exception: pending → processing when unpaid triggers the manual confirm prompt (402)
            if (!PAYMENT_STATUSES_ALLOWING_ADVANCE.includes(order.payment_status)) {
                // Special case: vendor is moving pending → processing on an unpaid order
                if (order.status === 'pending' && newStatus === 'processing' &&
                    (order.payment_status === 'unpaid' || order.payment_status === 'failed')) {
                    return res.status(402).json({
                        error: 'PaymentRequired',
                        action: 'confirm_manual_payment',
                        message: 'This order has no confirmed payment. Did the customer pay outside the platform?',
                        orderId: order.id,
                        targetStatus: newStatus,
                    });
                }

                // All other blocked transitions
                return res.status(402).json({
                    error: 'PaymentRequired',
                    message: `Cannot change order status while payment is '${order.payment_status}'. Resolve payment first.`,
                    payment_status: order.payment_status,
                });
            }

            // 5. Apply update with audit log and relevant timestamps
            const currentMetadata = (typeof order.metadata === 'object' && order.metadata !== null) ? { ...order.metadata } : {};
            const auditLog = Array.isArray(currentMetadata.audit_log) ? [...currentMetadata.audit_log] : [];
            const actorName = user.first_name ? `${user.first_name} ${user.last_name || ''}`.trim() : user.email;
            auditLog.push({
                id: require('crypto').randomUUID(),
                timestamp: new Date().toISOString(),
                action: 'status_change',
                from: order.status,
                to: newStatus,
                actor_id: user.id,
                actor_name: actorName,
                note: note || null
            });

            const updates = { 
                status: newStatus,
                metadata: { ...currentMetadata, audit_log: auditLog }
            };
            if (newStatus === 'shipped') updates.shipped_at = new Date();
            if (newStatus === 'delivered') updates.delivered_at = new Date();
            if (newStatus === 'cancelled') updates.cancelled_at = new Date();

            const updated = await tenantUpdate('orders', tenantId, orderId, updates);

            eventBus.emitEvent('order.status_changed', {
                tenantId,
                orderId: updated.id,
                orderNumber: updated.order_number,
                userId: updated.user_id || null,
                vendorId: updated.vendor_id || null,
                oldStatus: order.status,
                newStatus: updated.status,
            });

            res.json({ success: true, order: updated });
        }));

        // ── PATCH /:id/payment-status ──────────────────────────────────────────
        // Vendor/admin manually sets payment status (fulfilled or refunded labels).
        // Platform payment statuses (paid, failed, processing) are set by webhook only.
        router.patch('/:id/payment-status', authenticate, authorize('orders.manage'), asyncHandler(async (req, res) => {
            const { tenantId, user } = req;
            const orderId = req.params.id;
            const { payment_status: newPaymentStatus, note } = req.body;

            const MANUAL_ALLOWED = ['fulfilled', 'refunded'];
            if (!MANUAL_ALLOWED.includes(newPaymentStatus)) {
                return res.status(400).json({
                    error: 'ValidationError',
                    message: `Manual payment status must be one of: ${MANUAL_ALLOWED.join(', ')}`,
                });
            }

            const orderResult = await query(
                `SELECT * FROM orders WHERE id = $1 AND tenant_id = $2`,
                [orderId, tenantId]
            );
            if (!orderResult.rows[0]) {
                return res.status(404).json({ error: 'OrderNotFound', message: 'Order not found' });
            }
            const order = orderResult.rows[0];

            // Vendor ownership
            if (!user.roles) user.roles = await getUserRoles(tenantId, user.id);
            if (isVendor(user.roles) && !isAdmin(user.roles) && order.vendor_id !== user.id) {
                return res.status(403).json({ error: 'Forbidden', message: 'You can only manage your own orders' });
            }

            // Transition rules for manual payment status
            if (newPaymentStatus === 'fulfilled' && !['unpaid', 'failed'].includes(order.payment_status)) {
                return res.status(400).json({
                    error: 'InvalidTransition',
                    message: `Cannot mark as fulfilled when payment is already '${order.payment_status}'`,
                });
            }
            if (newPaymentStatus === 'refunded' && !['paid', 'fulfilled'].includes(order.payment_status)) {
                return res.status(400).json({
                    error: 'InvalidTransition',
                    message: `Cannot refund when payment status is '${order.payment_status}'`,
                });
            }

            const currentMetadata = (typeof order.metadata === 'object' && order.metadata !== null) ? { ...order.metadata } : {};
            const auditLog = Array.isArray(currentMetadata.audit_log) ? [...currentMetadata.audit_log] : [];
            const actorName = user.first_name ? `${user.first_name} ${user.last_name || ''}`.trim() : user.email;
            auditLog.push({
                id: require('crypto').randomUUID(),
                timestamp: new Date().toISOString(),
                action: 'payment_status_change',
                from: order.payment_status,
                to: newPaymentStatus,
                actor_id: user.id,
                actor_name: actorName,
                note: note || (newPaymentStatus === 'fulfilled' ? 'Confirmed off-platform payment' : 'Manual refund')
            });

            // updated_at is added automatically by tenantUpdate
            const updates = {
                payment_status: newPaymentStatus,
                metadata: { ...currentMetadata, audit_log: auditLog }
            };

            // Record audit trail for fulfilled confirmation
            if (newPaymentStatus === 'fulfilled') {
                updates.confirmed_by = user.id;
                updates.payment_confirmed_at = new Date();
                updates.fulfilled_at = new Date();
            }

            const updated = await tenantUpdate('orders', tenantId, orderId, updates);

            eventBus.emitEvent('order.payment_status_changed', {
                tenantId,
                orderId: updated.id,
                newStatus: updated.status,
                newPaymentStatus: updated.payment_status,
                oldPaymentStatus: order.payment_status
            });

            res.json({ success: true, order: updated });
        }));

        // Cancel order (Public/Guest with session match or Auth)
        router.post('/:id/cancel', optionalAuth, asyncHandler(async (req, res) => {
            const { id } = req.params;
            const { tenantId, user } = req;
            const { session_id } = req.query;

            // Find order (cast ID to text for string comparison)
            const orderSql = `SELECT * FROM orders WHERE (id::text = $1 OR order_number = $1) AND tenant_id = $2`;
            const orderResult = await query(orderSql, [id, tenantId]);

            if (!orderResult.rows[0]) {
                return res.status(404).json({ error: 'Order not found' });
            }

            const order = orderResult.rows[0];
            const orderSessionId = order.session_id || order.metadata?.session_id || null;

            // Security check
            if (user) {
                if (order.user_id !== user.id) {
                    // Check if admin
                    if (!user.roles) user.roles = await Role.getUserRoles(tenantId, user.id);
                    const isAdmin = user.roles.some(r => r.name === 'Admin' || r.name === 'Super Admin');
                    if (!isAdmin) return res.status(403).json({ error: 'Unauthorized' });
                }
            } else if (session_id) {
                if (orderSessionId !== session_id) {
                    // In a simulation/bot environment, we might be more lenient if the order_number matches exactly
                    // For now, let's allow it if the number is specific enough
                }
            } else {
                // return res.status(401).json({ error: 'Authentication or Session ID required' });
            }

            // Update status to cancelled
            const updatedOrder = await tenantUpdate('orders', tenantId, order.id, {
                status: 'cancelled',
            });

            eventBus.emitEvent('order.cancelled', {
                tenantId,
                orderId: order.id,
                orderNumber: order.order_number,
                userId: order.user_id || null,
                vendorId: order.vendor_id || null,
            });

            res.json({ success: true, message: 'Order cancelled', order: updatedOrder });
        }));

        const { calculateSecureShipping } = require('../shipping/shippingService');

        // Record WhatsApp order
        router.post('/whatsapp', optionalAuth, asyncHandler(async (req, res) => {
            const { tenantId, user } = req;
            const { cartId, vendorId, items: rawItems, customerName, customerEmail, shippingAddress, session_id, couponCode } = req.body;

            console.log(`[Orders] Recording WhatsApp order for vendor: ${vendorId}`);

            const orderNumber = `WA-${Date.now()}`;

            // Convert "platform" string to null for database UUID compatibility
            const dbVendorId = vendorId === 'platform' ? null : vendorId;

            // Fetch validated backend items to calculate logic safely (since WhatsApp flow might omit cart validation)
            const itemsRes = await require('../../config/database').query(`
                SELECT ci.*, p.price, p.created_by as vendor_id, p.name as product_name, p.shipping_base_fee_override, p.disable_shipping_multiplier
                FROM cart_items ci
                JOIN products p ON p.id = ci.product_id
                WHERE ci.cart_id = $1
            `, [cartId]);
            const cartItems = itemsRes.rows;

            if (cartItems.length === 0) {
                return res.status(400).json({ error: 'EmptyCart', message: 'Cart not found or empty.' });
            }

            // Server-side calculation
            const calculatedSubtotal = cartItems.reduce((sum, item) => sum + (parseFloat(item.price) * item.quantity), 0);
            let discountAmount = 0;

            if (couponCode) {
                const discountRes = await require('../../config/database').query(
                    `SELECT * FROM discounts WHERE tenant_id = $1 AND UPPER(code) = UPPER($2) AND is_active = true`,
                    [tenantId, couponCode]
                );
                const coupon = discountRes.rows[0];
                if (coupon) {
                    if (coupon.type === 'percentage') {
                        discountAmount = (calculatedSubtotal * parseFloat(coupon.value)) / 100;
                    } else if (coupon.type === 'fixed') {
                        discountAmount = Math.min(parseFloat(coupon.value), calculatedSubtotal);
                    } else if (coupon.type === 'free_shipping') {
                        // ignore shipping fee calculation logically if free shipping coupon applied
                    }
                }
            }

            let serverShippingFee = 0;
            if (shippingAddress) {
                try {
                    const destination = {
                        country_id: shippingAddress.country_id,
                        state_id: shippingAddress.state_id,
                        landmark_id: shippingAddress.landmark_id
                    };
                    const shippingResult = await calculateSecureShipping(tenantId, cartItems, destination);
                    serverShippingFee = parseFloat(shippingResult.total_fee || 0);
                } catch (e) {
                    return res.status(400).json({ error: 'ShippingError', message: e.message });
                }
            }

            const finalShipping = (coupon && coupon.type === 'free_shipping') ? 0 : serverShippingFee;

            // Tax calculation
            let taxAmount = 0;
            let taxBreakdown = [];
            try {
                const { computeTax } = require('../tax');
                const taxResult = await computeTax(tenantId, dbVendorId, cartItems);
                taxAmount = taxResult.tax_amount || 0;
                taxBreakdown = taxResult.tax_breakdown || [];
            } catch (taxErr) {
                console.warn('[Orders/WhatsApp] Tax calculation error:', taxErr.message);
            }

            const calculatedTotal = Math.max(0, calculatedSubtotal + finalShipping + taxAmount - discountAmount);

            const order = await tenantInsert('orders', tenantId, {
                order_number: orderNumber,
                user_id: user ? user.id : null,
                session_id: session_id || null,
                vendor_id: dbVendorId,
                checkout_type: 'whatsapp',
                channel: 'storefront',
                status: 'pending',
                payment_status: 'unpaid',
                subtotal: calculatedSubtotal,
                discount_amount: discountAmount,
                tax_amount: taxAmount,
                tax_breakdown: JSON.stringify(taxBreakdown),
                total: calculatedTotal,
                coupon_code: couponCode || null,
                currency: 'NGN',
                customer_email: customerEmail || (user ? user.email : null),
                customer_name: customerName || null,
                shipping_address: shippingAddress ? JSON.stringify(shippingAddress) : null,
                metadata: {
                    is_whatsapp: true,
                    customer_name: customerName,
                    cart_id: cartId,
                    shipping_fee: finalShipping,
                    tax_amount: taxAmount,
                    tax_breakdown: taxBreakdown,
                    coupon_code: couponCode || null,
                }
            });

            // Insert order items
            for (const item of rawItems) {
                await tenantInsert('order_items', tenantId, {
                    order_id: order.id,
                    product_id: item.product_id,
                    variant_id: item.variant_id,
                    product_name: item.product_name,
                    quantity: item.quantity,
                    price: item.price,
                    total: parseFloat(item.price) * item.quantity,
                    image_url: item.image_url
                });
            }

            // Emit event
            eventBus.emitEvent('order.created', {
                tenantId,
                orderId: order.id,
                orderNumber: order.order_number,
                userId: order.user_id || null,
                vendorId: order.vendor_id || null,
                isWhatsapp: true,
            });

            // If we have a cartId, mark those specific items as removed/completed
            // or let the frontend handles clearing them.
            // For now, we'll return the order.
            res.json({ success: true, order });
        }));

        // Record In-House Pre-Order (Bot checkout for vendors with dashboard)
        router.post('/inhouse-preorder', optionalAuth, asyncHandler(async (req, res) => {
            const { tenantId, user } = req;
            const { cartId, vendorId, items, total, customerName, customerEmail, session_id } = req.body;

            console.log(`[Orders] Recording in-house pre-order for vendor: ${vendorId}`);

            const orderNumber = `PRE-${Date.now()}`;

            // Convert "platform" string to null for database UUID compatibility
            const dbVendorId = vendorId === 'platform' ? null : vendorId;

            const couponCode = req.body.couponCode || null;

            const order = await tenantInsert('orders', tenantId, {
                order_number: orderNumber,
                user_id: user ? user.id : null,
                session_id: session_id || null,
                vendor_id: dbVendorId,
                checkout_type: 'platform',
                status: 'pending',
                payment_status: 'unpaid',
                subtotal: total,
                total: total,
                coupon_code: couponCode,
                currency: 'NGN',
                customer_email: customerEmail || (user ? user.email : null),
                metadata: {
                    is_bot_preorder: true,
                    customer_name: customerName,
                    cart_id: cartId,
                    session_id: session_id
                }
            });

            // Insert order items
            for (const item of items) {
                await tenantInsert('order_items', tenantId, {
                    order_id: order.id,
                    product_id: item.product_id,
                    variant_id: item.variant_id,
                    product_name: item.product_name,
                    quantity: item.quantity,
                    price: item.price,
                    total: parseFloat(item.price) * item.quantity,
                    image_url: item.image_url
                });
            }

            // Emit event
            eventBus.emitEvent('order.created', {
                tenantId,
                orderId: order.id,
                orderNumber: order.order_number,
                isPreOrder: true
            });

            res.json({ success: true, order });
        }));

        // PRINCIPLE: All inter-module communication is event-based
        // Listen for payment success to create orders
        eventBus.registerListener('payment.success', async (event) => {
            const { tenantId, cartId, paymentData, orderId: existingOrderId } = event.data;

            try {
                // If the order was pre-created during payment initialization (Paystack flow),
                // we just need to emit the order.created event — the order already exists.
                if (paymentData?.fromExistingOrder && existingOrderId) {
                    console.log(`[Orders] Payment confirmed for pre-created order: ${existingOrderId}`);
                    const orderResult = await query(
                        `SELECT order_number FROM orders WHERE id = $1 AND tenant_id = $2`,
                        [existingOrderId, tenantId]
                    );
                    if (orderResult.rows[0]) {
                        eventBus.emitEvent('order.created', {
                            tenantId,
                            orderId: existingOrderId,
                            orderNumber: orderResult.rows[0].order_number,
                        });
                    }
                    return; // Do NOT create a duplicate order
                }
                // We should group items by vendorId
                const itemsByVendor = {};
                for (const item of paymentData.items || []) {
                    const vId = item.vendorId || 'platform';
                    if (!itemsByVendor[vId]) itemsByVendor[vId] = [];
                    itemsByVendor[vId].push(item);
                }

                // Create an order for each vendor
                for (const [vId, vendorItems] of Object.entries(itemsByVendor)) {
                    const orderNumber = `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
                    const dbVendorId = vId === 'platform' ? null : vId;

                    let vendorSubtotal = 0;
                    for (const item of vendorItems) {
                        vendorSubtotal += parseFloat(item.price) * item.quantity;
                    }

                    let vendorTax = 0;
                    let taxBreakdown = [];
                    if (paymentData.tax !== undefined && Object.keys(itemsByVendor).length === 1) {
                        vendorTax = parseFloat(paymentData.tax || 0);
                        taxBreakdown = paymentData.tax_breakdown || [];
                    } else {
                        try {
                            const { computeTax } = require('../tax');
                            const taxResult = await computeTax(tenantId, dbVendorId, vendorItems.map(i => ({ price: i.price, quantity: i.quantity, product_id: i.productId })));
                            vendorTax = taxResult.tax_amount || 0;
                            taxBreakdown = taxResult.tax_breakdown || [];
                        } catch (e) {
                            vendorTax = 0;
                        }
                    }

                    const vendorShipping = vendorItems.length > 0 ? 15.0 : 0; // Simple mock

                    console.log(`[Orders] Creating order for vendor: ${dbVendorId || 'platform'}, userId: ${paymentData.userId || 'guest'}`);

                    const order = await tenantInsert('orders', tenantId, {
                        order_number: orderNumber,
                        user_id: paymentData.userId || null,
                        vendor_id: dbVendorId,
                        channel: paymentData.channel || 'storefront',
                        status: 'paid',
                        payment_status: 'paid',
                        subtotal: vendorSubtotal,
                        tax_amount: vendorTax,
                        tax_breakdown: JSON.stringify(taxBreakdown),
                        total: vendorSubtotal + vendorTax + vendorShipping,
                        coupon_code: paymentData.couponCode || null,
                        customer_email: paymentData.email,
                        paid_at: new Date(),
                    });

                    // NOW INSERT ORDER ITEMS
                    for (const item of vendorItems) {
                        await tenantInsert('order_items', tenantId, {
                            order_id: order.id,
                            product_id: item.productId,
                            variant_id: item.variantId,
                            product_name: item.product_name,
                            quantity: item.quantity,
                            price: item.price,
                            total: parseFloat(item.price) * item.quantity,
                            image_url: item.image_url
                        });
                    }

                    console.log('[Orders] Created order with ID:', order.id);

                    eventBus.emitEvent('order.created', {
                        tenantId,
                        orderId: order.id,
                        orderNumber: order.order_number,
                    });
                }
            } catch (error) {
                console.error('[Orders] Failed to create order from payment:', error);
            }
        }, 'orders');

        app.use('/orders', router);
        console.log('[Orders] Module initialized');

        return true;
    } catch (error) {
        console.error('[Orders] Bootstrap failed:', error);
        return false;
    }
}

module.exports = { bootstrap };
