/**
 * Migration 085: WA Auth Tables
 * - wa_verifications: pending phone verification codes (TTL 10 min)
 * - wa_sessions:      permanent WA number ↔ user account bindings
 * - magic_tokens:     one-time magic link tokens (TTL 15 min)
 */

const { query } = require('../config/database');

async function up() {
    console.log('Migrating: 085_wa_auth_tables.js');

    await query(`
        CREATE TABLE IF NOT EXISTS wa_verifications (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id   UUID        NOT NULL,
            user_id     UUID        NOT NULL,
            phone       TEXT        NOT NULL,
            code        TEXT        NOT NULL,
            expires_at  TIMESTAMPTZ NOT NULL,
            created_at  TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_wa_verifications_code   ON wa_verifications (code);
        CREATE INDEX IF NOT EXISTS idx_wa_verifications_phone  ON wa_verifications (phone);
        CREATE INDEX IF NOT EXISTS idx_wa_verifications_expiry ON wa_verifications (expires_at);
    `);
    console.log('  ✓ Created wa_verifications table');

    await query(`
        CREATE TABLE IF NOT EXISTS wa_sessions (
            id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id    UUID        NOT NULL,
            user_id      UUID        NOT NULL,
            wa_phone     TEXT        NOT NULL,
            connected_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE (tenant_id, wa_phone)
        );

        CREATE INDEX IF NOT EXISTS idx_wa_sessions_user  ON wa_sessions (tenant_id, user_id);
        CREATE INDEX IF NOT EXISTS idx_wa_sessions_phone ON wa_sessions (tenant_id, wa_phone);
    `);
    console.log('  ✓ Created wa_sessions table');

    await query(`
        CREATE TABLE IF NOT EXISTS magic_tokens (
            token       TEXT        PRIMARY KEY,
            tenant_id   UUID        NOT NULL,
            user_id     UUID        NOT NULL,
            wa_phone    TEXT        NOT NULL,
            destination TEXT,
            expires_at  TIMESTAMPTZ NOT NULL,
            created_at  TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_magic_tokens_expiry ON magic_tokens (expires_at);
    `);
    console.log('  ✓ Created magic_tokens table');

    console.log('Migration complete: 085_wa_auth_tables.js');
}

async function down() {
    await query(`DROP TABLE IF EXISTS magic_tokens CASCADE;`);
    await query(`DROP TABLE IF EXISTS wa_sessions CASCADE;`);
    await query(`DROP TABLE IF EXISTS wa_verifications CASCADE;`);
    console.log('Rolled back: 085_wa_auth_tables.js');
}

module.exports = { up, down };
