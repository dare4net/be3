/**
 * Migration 076 — Tiered Verification (KYC / KYB) Foundation
 *
 * Adds KYC (Tier 2) and KYB (Tier 3) columns to the users table.
 * Designed for external verification service integration later.
 * Admin staff can manually toggle status via the admin dashboard.
 */

const { query } = require('../config/database');

async function up() {
    console.log('Migrating: 076_tiered_verification.js');

    // Tier 2: KYC
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_status VARCHAR(20) DEFAULT 'none'`);
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_document_url TEXT`);
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_liveness_url TEXT`);
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_submitted_at TIMESTAMPTZ`);
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_reviewed_at TIMESTAMPTZ`);
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_reviewed_by UUID`);
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_rejection_reason TEXT`);

    // Tier 3: KYB
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS kyb_status VARCHAR(20) DEFAULT 'none'`);
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS kyb_document_url TEXT`);
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS kyb_submitted_at TIMESTAMPTZ`);
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS kyb_reviewed_at TIMESTAMPTZ`);
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS kyb_reviewed_by UUID`);
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS kyb_rejection_reason TEXT`);

    // Drop constraints if they already exist (idempotent)
    await query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_kyc_status`);
    await query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_kyb_status`);

    await query(`ALTER TABLE users ADD CONSTRAINT chk_kyc_status CHECK (kyc_status IN ('none','submitted','approved','rejected'))`);
    await query(`ALTER TABLE users ADD CONSTRAINT chk_kyb_status CHECK (kyb_status IN ('none','submitted','approved','rejected'))`);

    console.log('✓ KYC/KYB columns added to users table');
    console.log('Migration complete: 076_tiered_verification.js');
}

async function down() {
    await query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_kyc_status`);
    await query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_kyb_status`);
    await query(`ALTER TABLE users
        DROP COLUMN IF EXISTS kyc_status,
        DROP COLUMN IF EXISTS kyc_document_url,
        DROP COLUMN IF EXISTS kyc_liveness_url,
        DROP COLUMN IF EXISTS kyc_submitted_at,
        DROP COLUMN IF EXISTS kyc_reviewed_at,
        DROP COLUMN IF EXISTS kyc_reviewed_by,
        DROP COLUMN IF EXISTS kyc_rejection_reason,
        DROP COLUMN IF EXISTS kyb_status,
        DROP COLUMN IF EXISTS kyb_document_url,
        DROP COLUMN IF EXISTS kyb_submitted_at,
        DROP COLUMN IF EXISTS kyb_reviewed_at,
        DROP COLUMN IF EXISTS kyb_reviewed_by,
        DROP COLUMN IF EXISTS kyb_rejection_reason`);
}

module.exports = { up, down };
