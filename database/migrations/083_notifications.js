'use strict';

/**
 * Migration 083 — Notifications module tables
 * Creates: notifications, fcm_tokens, notification_preferences
 */
module.exports = {
    name: '083_notifications',

    async up(client) {
        // 1. notifications
        await client.query(`
            CREATE TABLE IF NOT EXISTS notifications (
                id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                tenant_id   UUID NOT NULL,
                user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
                target      VARCHAR(20) NOT NULL DEFAULT 'customer',
                type        VARCHAR(100) NOT NULL,
                title       VARCHAR(255) NOT NULL,
                message     TEXT,
                action_url  TEXT,
                metadata    JSONB DEFAULT '{}',
                is_read     BOOLEAN NOT NULL DEFAULT false,
                read_at     TIMESTAMPTZ,
                created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (tenant_id, user_id, is_read, created_at DESC)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_notifications_target ON notifications (tenant_id, target, is_read, created_at DESC)`);

        // 2. fcm_tokens (browser + PWA push via Firebase)
        await client.query(`
            CREATE TABLE IF NOT EXISTS fcm_tokens (
                id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                tenant_id    UUID NOT NULL,
                user_id      UUID REFERENCES users(id) ON DELETE CASCADE,
                token        TEXT NOT NULL UNIQUE,
                platform     VARCHAR(20) NOT NULL DEFAULT 'web',
                user_agent   TEXT,
                created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                last_used_at TIMESTAMPTZ
            )
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_fcm_tokens_user ON fcm_tokens (user_id)`);

        // 3. notification_preferences
        await client.query(`
            CREATE TABLE IF NOT EXISTS notification_preferences (
                id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                tenant_id  UUID NOT NULL,
                user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
                type       VARCHAR(100) NOT NULL,
                channel    VARCHAR(20) NOT NULL,
                enabled    BOOLEAN NOT NULL DEFAULT true,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE (user_id, type, channel)
            )
        `);

        console.log('[Migration 083] notifications tables created');
    },

    async down(client) {
        await client.query(`DROP TABLE IF EXISTS notification_preferences`);
        await client.query(`DROP TABLE IF EXISTS fcm_tokens`);
        await client.query(`DROP TABLE IF EXISTS notifications`);
        console.log('[Migration 083] notifications tables dropped');
    },
};
