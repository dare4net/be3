'use strict';

const NotificationService = require('./NotificationService');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3003';
const ADMIN_URL = process.env.ADMIN_URL || 'http://localhost:3001';

/**
 * All eventBus listeners that trigger notifications.
 * Called once during module bootstrap.
 */
function register(eventBus, app) {

    // ── order.created (WhatsApp & Vendor Tools) ─────────────────────────────
    eventBus.registerListener('order.created', async ({ data }) => {
        const { tenantId, orderId, orderNumber, userId, vendorId, isWhatsapp, metadata } = data;
        console.log('\n[Listeners] Caught order.created. Metadata:', metadata);

        // 1. Check for automated vendor PDF dispatch via wa_tools
        if (metadata && metadata.source === 'wa_tools') {
            try {
                const resolvedUserId = vendorId || metadata.created_by;
                if (!resolvedUserId) {
                    console.warn('[Listeners] wa_tools: No user ID to look up WA session — skipping invoice.');
                } else {
                    // Look up the authenticated user's linked WhatsApp JID directly from wa_sessions
                    const { query: dbQuery } = require('../../config/database');
                    const sessionRes = await dbQuery(
                        `SELECT sender_jid FROM wa_sessions WHERE user_id = $1 AND tenant_id = $2 LIMIT 1`,
                        [resolvedUserId, tenantId]
                    );
                    const jid = sessionRes.rows[0]?.sender_jid;
                    console.log('[Listeners] wa_tools: resolved JID from wa_sessions:', jid);

                    if (jid) {
                        const axios = require('axios');
                        const BE3_WA_URL = process.env.BE3_WA_URL || 'http://localhost:3040';
                        const INTERNAL_SECRET = process.env.WA_AUTH_INTERNAL_SECRET || 'damilare';
                        const INVOICE_URL = `${process.env.API_URL || 'http://localhost:3000'}/invoices/orders/${orderId}`;

                        try {
                            // 1. Fetch PDF locally on the backend using the X-Tenant-ID header
                            console.log('[Listeners] Fetching PDF locally:', INVOICE_URL);
                            const pdfRes = await axios.get(INVOICE_URL, {
                                responseType: 'arraybuffer',
                                headers: { 'X-Tenant-ID': tenantId }
                            });
                            const pdfBase64 = Buffer.from(pdfRes.data).toString('base64');

                            // 2. Transmit the base64 string to be3-WA
                            await axios.post(`${BE3_WA_URL}/api/send-invoice-buffer`, {
                                wa_phone: jid,
                                pdf_base64: pdfBase64,
                                order_number: orderNumber
                            }, {
                                headers: { 'x-internal-secret': INTERNAL_SECRET },
                                maxBodyLength: Infinity,
                                maxContentLength: Infinity
                            });
                            console.log('[Listeners] Invoice buffer dispatched to:', jid);
                        } catch (pdfErr) {
                            console.error('[Listeners] Local PDF generation failed:', pdfErr.message);
                        }
                    } else {
                        console.warn('[Listeners] wa_tools: No WA session found for user:', resolvedUserId);
                    }
                }
            } catch (err) {
                console.error('[Notifications] Failed to send automated wa_tools invoice PDF:', err.message);
            }
        }

        if (!isWhatsapp) return; // Platform orders emit via payment.success instead

        // Customer notification
        if (userId) {
            await NotificationService.send(app, tenantId, userId, 'order.whatsapp.created', {
                title: `WhatsApp order ${orderNumber} placed`,
                message: 'Your WhatsApp order has been recorded. The vendor will be in touch.',
                actionUrl: `${FRONTEND_URL}/account/orders/${orderId}`,
                templateData: { orderNumber },
            });
        }

        // Admin/vendor notification
        await NotificationService.sendAdmin(app, tenantId, vendorId, 'notifications.orders', 'admin.order.whatsapp', {
            title: `New WhatsApp order: ${orderNumber}`,
            message: 'A customer placed a WhatsApp order. Review and confirm.',
            actionUrl: `${ADMIN_URL}/dashboard/orders/${orderId}`,
            templateData: { orderNumber },
        });
    }, 'NotificationsModule');


    // ── payment.success ──────────────────────────────────────
    eventBus.registerListener('payment.success', async ({ data }) => {
        const { tenantId, orderId, orderNumber, vendorId, paymentData } = data;
        const userId = paymentData?.userId;
        const amount = paymentData?.amount;
        const currency = paymentData?.currency?.toUpperCase() || 'NGN';

        // Customer
        if (userId) {
            await NotificationService.send(app, tenantId, userId, 'payment.success', {
                title: `Payment confirmed — ${orderNumber}`,
                message: `Your payment of ${currency} ${Number(amount || 0).toLocaleString()} was successful.`,
                actionUrl: `${FRONTEND_URL}/account/orders/${orderId}`,
                templateData: { orderNumber, amount, currency },
            });
        }

        // Vendor/admin
        await NotificationService.sendAdmin(app, tenantId, vendorId, 'notifications.payments', 'admin.payment.received', {
            title: `Payment received — ${orderNumber}`,
            message: `${currency} ${Number(amount || 0).toLocaleString()} received for order ${orderNumber}.`,
            actionUrl: `${ADMIN_URL}/dashboard/orders/${orderId}`,
            templateData: { orderNumber, amount, currency },
        });
    }, 'NotificationsModule');


    // ── payment.failed ───────────────────────────────────────
    eventBus.registerListener('payment.failed', async ({ data }) => {
        const { tenantId, orderId, orderNumber, vendorId, userId } = data;

        if (userId) {
            await NotificationService.send(app, tenantId, userId, 'payment.failed', {
                title: `Payment failed — ${orderNumber}`,
                message: 'Your payment could not be processed. Please try again.',
                actionUrl: `${FRONTEND_URL}/account/orders/${orderId}`,
                templateData: { orderNumber },
            });
        }
    }, 'NotificationsModule');


    // ── order.status_changed ─────────────────────────────────
    eventBus.registerListener('order.status_changed', async ({ data }) => {
        const { tenantId, orderId, orderNumber, userId, vendorId, newStatus } = data;
        if (!userId) return;

        const statusMap = {
            shipped: { type: 'order.shipped', title: `Order ${orderNumber} has shipped 🚚`, message: 'Your order is on its way.' },
            delivered: { type: 'order.delivered', title: `Order ${orderNumber} delivered ✓`, message: 'Your order has been delivered.' },
        };

        const event = statusMap[newStatus];
        if (!event) return; // Don't notify for other status changes (processing, etc.)

        await NotificationService.send(app, tenantId, userId, event.type, {
            title: event.title,
            message: event.message,
            actionUrl: `${FRONTEND_URL}/account/orders/${orderId}`,
            templateData: { orderNumber },
        });
    }, 'NotificationsModule');


    // ── order.cancelled ──────────────────────────────────────
    eventBus.registerListener('order.cancelled', async ({ data }) => {
        const { tenantId, orderId, orderNumber, userId } = data;
        if (!userId) return;

        await NotificationService.send(app, tenantId, userId, 'order.cancelled', {
            title: `Order ${orderNumber} cancelled`,
            message: 'Your order has been cancelled.',
            actionUrl: `${FRONTEND_URL}/account/orders/${orderId}`,
            templateData: { orderNumber },
        });
    }, 'NotificationsModule');


    // ── chat.message ─────────────────────────────────────────
    eventBus.registerListener('chat.message', async ({ data }) => {
        const { tenantId, recipientId, senderName, messagePreview, conversationId } = data;
        if (!recipientId) return;

        await NotificationService.send(app, tenantId, recipientId, 'chat.message', {
            title: `New message from ${senderName || 'Support'}`,
            message: messagePreview || 'You have a new message.',
            actionUrl: `${FRONTEND_URL}/account/messages/${conversationId}`,
        });
    }, 'NotificationsModule');

    // ── pos.cashier.assigned ─────────────────────────────────────────
    eventBus.registerListener('pos.cashier.assigned', async ({ data }) => {
        const { tenantId, cashierUserId, vendorName, vendorId } = data;
        if (!cashierUserId) return;

        await NotificationService.send(app, tenantId, cashierUserId, 'pos.cashier.assigned', {
            title: `You've been added as a cashier`,
            message: `${vendorName || 'A vendor'} has linked you as a cashier on their POS. You can now open and operate their register.`,
            actionUrl: `${ADMIN_URL}/dashboard/pos`,
            templateData: { vendorName },
        });
    }, 'NotificationsModule');


    // ── pos.cashier.disconnected ─────────────────────────────────────
    eventBus.registerListener('pos.cashier.disconnected', async ({ data }) => {
        const { tenantId, cashierUserId, vendorName, reason } = data;
        if (!cashierUserId) return;

        const reasonMap = {
            revoked:  'manually removed you from their cashier list',
            expired:  'your link has automatically expired due to 7 days of inactivity',
        };
        const reasonText = reasonMap[reason] || 'disconnected your cashier link';

        await NotificationService.send(app, tenantId, cashierUserId, 'pos.cashier.disconnected', {
            title: `Cashier access removed`,
            message: `${vendorName || 'A vendor'} has ${reasonText}. You will no longer be able to operate their POS register.`,
            actionUrl: `${ADMIN_URL}/dashboard/pos`,
            templateData: { vendorName, reason },
        });
    }, 'NotificationsModule');


    // ── pos.shift.discrepancy ────────────────────────────────────────
    eventBus.registerListener('pos.shift.discrepancy', async ({ data }) => {
        const { tenantId, vendorId, cashierName, sessionId, registerId, registerName, expected, actual, discrepancy } = data;
        if (!vendorId) return;

        const shortfall = Math.abs(discrepancy).toLocaleString('en', { minimumFractionDigits: 2 });
        const direction = discrepancy < 0 ? 'short by' : 'over by';

        await NotificationService.send(app, tenantId, vendorId, 'pos.shift.discrepancy', {
            title: `Cash discrepancy detected — ${registerName || 'Register'}`,
            message: `${cashierName || 'A cashier'} closed a shift with a cash ${direction} ₦${shortfall}. Expected: ₦${Number(expected).toLocaleString()}, Actual: ₦${Number(actual).toLocaleString()}.`,
            actionUrl: `${ADMIN_URL}/dashboard/pos?session=${sessionId}`,
            templateData: { cashierName, registerName, expected, actual, discrepancy },
        });
    }, 'NotificationsModule');


    // ── inventory.low_stock ──────────────────────────────────────────
    eventBus.registerListener('inventory.low_stock', async ({ data }) => {
        const { tenantId, vendorId, productId, productName, quantity, threshold } = data;
        if (!vendorId) return;

        await NotificationService.send(app, tenantId, vendorId, 'inventory.low_stock', {
            title: `Low stock alert — ${productName}`,
            message: `"${productName}" is running low with only ${quantity} unit${quantity === 1 ? '' : 's'} remaining (threshold: ${threshold}).`,
            actionUrl: `${ADMIN_URL}/dashboard/inventory`,
            templateData: { productName, quantity, threshold },
        });
    }, 'NotificationsModule');


    console.log('✓ Notifications listeners registered');
}

module.exports = { register };
