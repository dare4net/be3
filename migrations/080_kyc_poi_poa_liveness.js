/**
 * Migration 080 — KYC Granular POI / POA / Liveness + KYB CAC Upload
 *
 * Replaces the single-URL KYC blob with structured, independently-reviewable sections:
 *   • POI (Proof of Identity)  — submitted with liveness in Phase 1
 *   • Liveness video           — submitted alongside POI
 *   • POA (Proof of Address)  — separate Phase 2, gated on poi_status = 'approved'
 *
 * Also renames kyb_document_url → kyb_cac_url for KYB direct file upload.
 *
 * The existing kyc_status / kyc_submitted_at / kyc_reviewed_* columns are kept
 * as the overall Tier-2 gate used by the vendor application check.
 */

const { query } = require('../config/database');

async function up() {
    console.log('Migrating: 080_kyc_poi_poa_liveness.js');

    // ─── POI Columns ──────────────────────────────────────────────────────────
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS poi_doc_type VARCHAR(50)`);
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS poi_doc_url TEXT`);
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS poi_status VARCHAR(20) NOT NULL DEFAULT 'none'`);
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS poi_submitted_at TIMESTAMPTZ`);
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS poi_reviewed_at TIMESTAMPTZ`);
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS poi_reviewed_by UUID`);
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS poi_rejection_reason TEXT`);

    // ─── POA Columns ──────────────────────────────────────────────────────────
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS poa_doc_type VARCHAR(50)`);
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS poa_doc_url TEXT`);
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS poa_status VARCHAR(20) NOT NULL DEFAULT 'none'`);
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS poa_submitted_at TIMESTAMPTZ`);
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS poa_reviewed_at TIMESTAMPTZ`);
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS poa_reviewed_by UUID`);
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS poa_rejection_reason TEXT`);

    // ─── Liveness Columns ─────────────────────────────────────────────────────
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS liveness_video_url TEXT`);
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS liveness_status VARCHAR(20) NOT NULL DEFAULT 'none'`);
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS liveness_reviewed_at TIMESTAMPTZ`);
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS liveness_reviewed_by UUID`);
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS liveness_rejection_reason TEXT`);

    // ─── KYB CAC Column ───────────────────────────────────────────────────────
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS kyb_cac_url TEXT`);

    // ─── Drop old single-URL columns ─────────────────────────────────────────
    await query(`ALTER TABLE users DROP COLUMN IF EXISTS kyc_document_url`);
    await query(`ALTER TABLE users DROP COLUMN IF EXISTS kyc_liveness_url`);
    await query(`ALTER TABLE users DROP COLUMN IF EXISTS kyb_document_url`);

    // ─── CHECK Constraints ────────────────────────────────────────────────────
    await query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_poi_doc_type`);
    await query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_poa_doc_type`);
    await query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_poi_status`);
    await query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_poa_status`);
    await query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_liveness_status`);

    await query(`
        ALTER TABLE users ADD CONSTRAINT chk_poi_doc_type CHECK (
            poi_doc_type IS NULL OR poi_doc_type IN (
                'NIN_SLIP','NATIONAL_ID','PASSPORT','DRIVERS_LICENSE','PVC'
            )
        )
    `);
    await query(`
        ALTER TABLE users ADD CONSTRAINT chk_poa_doc_type CHECK (
            poa_doc_type IS NULL OR poa_doc_type IN (
                'BANK_STATEMENT','UTILITY_BILL','TAX_RECEIPT',
                'TENANCY_AGREEMENT','GOVT_RESIDENCE_LETTER'
            )
        )
    `);
    await query(`
        ALTER TABLE users ADD CONSTRAINT chk_poi_status CHECK (
            poi_status IN ('none','submitted','approved','rejected')
        )
    `);
    await query(`
        ALTER TABLE users ADD CONSTRAINT chk_poa_status CHECK (
            poa_status IN ('none','submitted','approved','rejected')
        )
    `);
    await query(`
        ALTER TABLE users ADD CONSTRAINT chk_liveness_status CHECK (
            liveness_status IN ('none','submitted','approved','rejected')
        )
    `);

    console.log('✓ POI / POA / liveness / KYB CAC columns added to users table');
    console.log('✓ Old kyc_document_url, kyc_liveness_url, kyb_document_url dropped');
    console.log('Migration complete: 080_kyc_poi_poa_liveness.js');
}

async function down() {
    // Drop constraints
    await query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_poi_doc_type`);
    await query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_poa_doc_type`);
    await query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_poi_status`);
    await query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_poa_status`);
    await query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_liveness_status`);

    // Drop new columns
    await query(`ALTER TABLE users
        DROP COLUMN IF EXISTS poi_doc_type,
        DROP COLUMN IF EXISTS poi_doc_url,
        DROP COLUMN IF EXISTS poi_status,
        DROP COLUMN IF EXISTS poi_submitted_at,
        DROP COLUMN IF EXISTS poi_reviewed_at,
        DROP COLUMN IF EXISTS poi_reviewed_by,
        DROP COLUMN IF EXISTS poi_rejection_reason,
        DROP COLUMN IF EXISTS poa_doc_type,
        DROP COLUMN IF EXISTS poa_doc_url,
        DROP COLUMN IF EXISTS poa_status,
        DROP COLUMN IF EXISTS poa_submitted_at,
        DROP COLUMN IF EXISTS poa_reviewed_at,
        DROP COLUMN IF EXISTS poa_reviewed_by,
        DROP COLUMN IF EXISTS poa_rejection_reason,
        DROP COLUMN IF EXISTS liveness_video_url,
        DROP COLUMN IF EXISTS liveness_status,
        DROP COLUMN IF EXISTS liveness_reviewed_at,
        DROP COLUMN IF EXISTS liveness_reviewed_by,
        DROP COLUMN IF EXISTS liveness_rejection_reason,
        DROP COLUMN IF EXISTS kyb_cac_url
    `);

    // Restore old columns
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_document_url TEXT`);
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_liveness_url TEXT`);
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS kyb_document_url TEXT`);
}

module.exports = { up, down };
