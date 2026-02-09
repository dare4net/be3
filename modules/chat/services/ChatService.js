/**
 * ChatService
 * 
 * Orchestrates conversation management and message persistence.
 */

const { query, tenantInsert, findByIdTenant } = require('../../../utils/dbHelpers');
const { query: dbQuery } = require('../../../config/database');
const RealtimeService = require('./RealtimeService');

class ChatService {
    /**
     * Get or create a conversation between a customer and a target (vendor/admin)
     */
    async getOrCreateConversation(tenantId, customerId, type, referenceId, targetId) {
        // 1. Check for existing conversation with these participants
        const existingSql = `
            SELECT c.* FROM chat_conversations c
            JOIN chat_participants p1 ON c.id = p1.conversation_id
            JOIN chat_participants p2 ON c.id = p2.conversation_id
            WHERE c.tenant_id = $1 
            AND c.type = $2 
            AND c.reference_id = $3
            AND p1.user_id = $4
            AND p2.user_id = $5
            LIMIT 1
        `;

        const existing = await dbQuery(existingSql, [tenantId, type, referenceId, customerId, targetId]);

        if (existing.rows.length > 0) {
            return existing.rows[0];
        }

        // 2. Create new conversation
        const conversation = await tenantInsert('chat_conversations', tenantId, {
            type,
            reference_id: referenceId,
            metadata: JSON.stringify({ targetId })
        });

        // 3. Add participants
        // Handle case where customer is the target (self-chat), avoid duplicate insert key error
        const participants = new Set([customerId, targetId]);

        for (const userId of participants) {
            await tenantInsert('chat_participants', tenantId, {
                conversation_id: conversation.id,
                user_id: userId
            });
        }

        return conversation;
    }

    /**
     * Save a new message and broadcast it
     */
    async sendMessage(tenantId, conversationId, senderId, content, type = 'text') {
        const message = await tenantInsert('chat_messages', tenantId, {
            conversation_id: conversationId,
            sender_id: senderId,
            content,
            type
        });

        // Update conversation last_message_at
        await dbQuery(
            `UPDATE chat_conversations SET last_message_at = NOW() WHERE id = $1 AND tenant_id = $2`,
            [conversationId, tenantId]
        );

        // Broadcast via Socket.io
        RealtimeService.broadcastMessage(tenantId, conversationId, message);

        return message;
    }

    /**
     * Get conversation history
     */
    async getHistory(tenantId, conversationId, limit = 50) {
        const sql = `
            SELECT m.*, CONCAT(u.first_name, ' ', u.last_name) as sender_name 
            FROM chat_messages m
            JOIN users u ON m.sender_id = u.id
            WHERE m.conversation_id = $1 AND m.tenant_id = $2
            ORDER BY m.created_at ASC
            LIMIT $3
        `;
        const result = await dbQuery(sql, [conversationId, tenantId, limit]);
        return result.rows;
    }
}

module.exports = new ChatService();
