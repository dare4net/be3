/**
 * Migration 077 — Vendor Applications Table
 *
 * Pipeline: draft → application_review → training → product_test → setup → approved
 */

const { query } = require('../config/database');

async function up() {
    console.log('Migrating: 077_vendor_applications.js');

    await query(`
        CREATE TABLE IF NOT EXISTS vendor_applications (
            id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id       UUID        NOT NULL,
            user_id         UUID        NOT NULL,

            status          VARCHAR(30) NOT NULL DEFAULT 'draft',

            -- Step 2: Application form
            store_name          VARCHAR(255),
            store_description   TEXT,
            primary_category    TEXT,

            -- Step 3: Training
            training_started_at         TIMESTAMPTZ,
            training_completed_at       TIMESTAMPTZ,
            assessment_score            INTEGER,
            assessment_attempts         INTEGER DEFAULT 0,
            assessment_last_attempt_at  TIMESTAMPTZ,

            -- Step 4: Product test
            test_submitted_at   TIMESTAMPTZ,
            test_reviewed_at    TIMESTAMPTZ,
            test_result         VARCHAR(20),
            test_feedback       TEXT,

            -- Step 5: Store setup
            bank_details        JSONB,
            contact_info        JSONB,
            store_info          JSONB,
            setup_completed_at  TIMESTAMPTZ,

            -- Admin review
            reviewed_by         UUID,
            reviewed_at         TIMESTAMPTZ,
            rejection_reason    TEXT,

            created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

            CONSTRAINT chk_application_status CHECK (status IN (
                'draft','application_review','training','product_test','setup','approved','rejected','withdrawn'
            )),
            CONSTRAINT chk_assessment_score CHECK (assessment_score IS NULL OR (assessment_score >= 0 AND assessment_score <= 100)),
            CONSTRAINT chk_test_result CHECK (test_result IS NULL OR test_result IN ('pending','passed','partial','failed'))
        )
    `);

    await query(`CREATE INDEX IF NOT EXISTS idx_vendor_applications_tenant_user ON vendor_applications(tenant_id, user_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_vendor_applications_tenant_status ON vendor_applications(tenant_id, status)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_vendor_applications_created_at ON vendor_applications(created_at DESC)`);

    console.log('✓ vendor_applications table created');
    console.log('Migration complete: 077_vendor_applications.js');
}

async function down() {
    await query(`DROP TABLE IF EXISTS vendor_applications CASCADE`);
}

module.exports = { up, down };
