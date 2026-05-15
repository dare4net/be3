'use strict';

const NotificationService = require('./NotificationService');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3003';
const ADMIN_URL    = process.env.ADMIN_URL    || 'http://localhost:3001';

/**
 * All eventBus listeners that trigger notifications.
 * Called once during module bootstrap.
 */
function register(eventBus, app) {

    // ── order.created (WhatsApp) ─────────────────────────────
    eventBus.registerListener('order.created', async ({ data }) => {
        const { tenantId, orderId, orderNumber, userId, vendorId, isWhatsapp } = data;
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
            shipped:   { type: 'order.shipped',    title: `Order ${orderNumber} has shipped 🚚`,   message: 'Your order is on its way.' },
            delivered: { type: 'order.delivered',   title: `Order ${orderNumber} delivered ✓`,      message: 'Your order has been delivered.' },
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

    console.log('✓ Notifications listeners registered');
}

module.exports = { register };
