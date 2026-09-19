'use strict';

const { query } = require('../../../config/database');

/**
 * In-app channel — writes a notification row and pushes a real-time socket event.
 */
async function deliver({ app, tenantId, userId, type, title, message, actionUrl, metadata = {} }) {
    // 1. Persist
    const result = await query(
        `INSERT INTO notifications (tenant_id, user_id, target, type, title, message, action_url, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [tenantId, userId || null, metadata.target || 'customer', type, title, message || null, actionUrl || null, JSON.stringify(metadata)]
    );
    const notification = result.rows[0];

    // 2. Real-time push via socket.io
    const io = app?.get('io');
    if (io && userId) {
        io.to(`user:${userId}`).emit('notification.new', {
            id:         notification.id,
            type,
            title,
            message,
            actionUrl,
            createdAt:  notification.created_at,
        });
    }

    return notification;
}

module.exports = { deliver };
