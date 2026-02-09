/**
 * Chat Module Bootstrapper
 */

const express = require('express');
const RealtimeService = require('./services/RealtimeService');
const ChatService = require('./services/ChatService');
const { authenticate } = require('../../platform/core/auth/middleware/authenticate');
const { asyncHandler } = require('../../middleware/errorHandler');
const { query } = require('../../config/database');

async function bootstrap(context) {
    const { app, eventBus } = context;

    try {
        const io = app.get('io');
        if (io) {
            RealtimeService.init(io);
        }

        const router = express.Router();

        /**
         * Initialize or get a chat conversation
         * Handles routing logic: Product -> Vendor (created_by) OR Admin
         */
        router.post('/initialize', authenticate, asyncHandler(async (req, res) => {
            const { type, referenceId } = req.body;
            const { id: customerId } = req.user;
            const tenantId = req.tenantId;

            let targetId = null;

            if (type === 'product') {
                // Find vendor (creator) of the product
                const productRes = await query(
                    `SELECT id, created_by, tenant_id FROM products WHERE id = $1 AND tenant_id = $2`,
                    [referenceId, tenantId]
                );

                if (productRes.rows.length === 0) {
                    return res.status(404).json({ error: 'Product not found' });
                }

                targetId = productRes.rows[0].created_by;
            } else if (type === 'order') {
                // Find vendor associated with the order
                const orderRes = await query(
                    `SELECT vendor_id FROM orders WHERE id = $1 AND tenant_id = $2`,
                    [referenceId, tenantId]
                );

                if (orderRes.rows.length === 0) {
                    return res.status(404).json({ error: 'Order not found' });
                }

                targetId = orderRes.rows[0].vendor_id;
            }

            // Fallback to Main Store Admin if no vendor/target found
            if (!targetId) {
                const adminRes = await query(
                    `SELECT u.id FROM users u 
                     JOIN user_roles ur ON u.id = ur.user_id 
                     JOIN roles r ON ur.role_id = r.id 
                     WHERE u.tenant_id = $1 AND r.name = 'Admin' 
                     LIMIT 1`,
                    [tenantId]
                );
                targetId = adminRes.rows[0]?.id;
            }

            if (!targetId) {
                return res.status(500).json({ error: 'Could not resolve chat recipient' });
            }

            const conversation = await ChatService.getOrCreateConversation(
                tenantId, customerId, type, referenceId, targetId
            );

            res.json({ success: true, conversation });
        }));

        /**
         * Get message history
         */
        router.get('/conversations', authenticate, asyncHandler(async (req, res) => {
            const { id: userId } = req.user;
            const tenantId = req.tenantId;

            const conversationsSql = `
        SELECT c.*, 
        (SELECT content FROM chat_messages m WHERE m.conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message,
        (SELECT created_at FROM chat_messages m WHERE m.conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as latest_message_at,
        (SELECT CONCAT(u.first_name, ' ', u.last_name) 
         FROM chat_participants cp 
         JOIN users u ON cp.user_id = u.id 
         WHERE cp.conversation_id = c.id AND cp.user_id != $2 
         LIMIT 1) as other_user_name,
        CASE 
            WHEN c.type = 'product' THEN (SELECT name FROM products p WHERE p.id = c.reference_id)
            WHEN c.type = 'order' THEN (SELECT CONCAT('Order #', id) FROM orders o WHERE o.id = c.reference_id)
            ELSE NULL
        END as context_data,
        CASE 
            WHEN c.type = 'product' THEN (SELECT image_url FROM products p WHERE p.id = c.reference_id)
            ELSE NULL
        END as context_image
        FROM chat_conversations c
        JOIN chat_participants p ON c.id = p.conversation_id
        WHERE c.tenant_id = $1 AND p.user_id = $2
        ORDER BY latest_message_at DESC NULLS LAST, c.created_at DESC
    `;

            const conversations = await query(conversationsSql, [tenantId, userId]);
            res.json({ success: true, conversations: conversations.rows });
        }));

        router.get('/history/:conversationId', authenticate, asyncHandler(async (req, res) => {
            const { conversationId } = req.params;
            const tenantId = req.tenantId;

            const messages = await ChatService.getHistory(tenantId, conversationId);
            res.json({ success: true, messages });
        }));

        /**
         * Send a message
         */
        router.post('/send', authenticate, asyncHandler(async (req, res) => {
            const { conversationId, content, type } = req.body;
            const { id: senderId } = req.user;
            const tenantId = req.tenantId;

            const message = await ChatService.sendMessage(
                tenantId, conversationId, senderId, content, type
            );

            res.json({ success: true, message });
        }));

        app.use('/chat', router);
        console.log('[Chat] Module initialized');

        return true;
    } catch (error) {
        console.error('[Chat] Bootstrap failed:', error);
        return false;
    }
}

module.exports = { bootstrap };
