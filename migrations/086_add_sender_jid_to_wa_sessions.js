/**
 * Migration 086: Add sender_jid column to wa_sessions
 *
 * wa_phone = human-readable declared phone (shown in UI)
 * sender_jid = actual WA sender identifier (for lookup: handles @lid and @s.whatsapp.net)
 *
 * This dual-column design survives WhatsApp's @lid privacy mode:
 * the real phone is preserved for display while @lid is used for fast lookup.
 */

const { query } = require('../config/database');

async function up() {
    console.log('Migrating: 086_add_sender_jid_to_wa_sessions.js');

    await query(`
        ALTER TABLE wa_sessions
        ADD COLUMN IF NOT EXISTS sender_jid TEXT;
    `);

    // Back-fill: existing rows have no sender_jid — set it equal to wa_phone
    await query(`
        UPDATE wa_sessions SET sender_jid = wa_phone WHERE sender_jid IS NULL;
    `);

    // Index for fast lookup
    await query(`
        CREATE INDEX IF NOT EXISTS idx_wa_sessions_sender_jid
        ON wa_sessions (tenant_id, sender_jid);
    `);

    console.log('  ✓ Added sender_jid column to wa_sessions');
    console.log('Migration complete: 086_add_sender_jid_to_wa_sessions.js');
}

async function down() {
    await query(`ALTER TABLE wa_sessions DROP COLUMN IF EXISTS sender_jid;`);
    console.log('Rolled back: 086_add_sender_jid_to_wa_sessions.js');
}

module.exports = { up, down };
