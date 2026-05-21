/**
 * Migration 084: Advanced Shipping Module (Locations, SLAs, Zonal Multipliers)
 */

const { query } = require('../config/database');

async function up() {
    console.log('Migrating: 084_advanced_shipping_module.js');

    // 1. Core Location Topology
    await query(`
        CREATE TABLE IF NOT EXISTS countries (
            id SERIAL PRIMARY KEY,
            tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            name VARCHAR(255) NOT NULL,
            code VARCHAR(10) NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(tenant_id, code)
        );

        CREATE TABLE IF NOT EXISTS states (
            id SERIAL PRIMARY KEY,
            tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            country_id INTEGER NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
            name VARCHAR(255) NOT NULL,
            code VARCHAR(10),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS landmarks (
            id SERIAL PRIMARY KEY,
            tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            state_id INTEGER NOT NULL REFERENCES states(id) ON DELETE CASCADE,
            name VARCHAR(255) NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
    `);
    console.log('  ✓ Created Location tables (countries, states, landmarks)');

    // 2. Vendor Shipping Configuration
    await query(`
        CREATE TABLE IF NOT EXISTS vendor_shipping_configs (
            id SERIAL PRIMARY KEY,
            tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            vendor_id UUID NOT NULL, -- Logical reference to user
            global_base_fee NUMERIC(10, 2) DEFAULT 0,
            global_processing_min INTEGER DEFAULT 1,
            global_processing_max INTEGER DEFAULT 2,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(tenant_id, vendor_id)
        );

        CREATE TABLE IF NOT EXISTS vendor_shipping_zones (
            id SERIAL PRIMARY KEY,
            tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            vendor_id UUID NOT NULL,
            location_type VARCHAR(50) NOT NULL, -- 'country', 'state', 'landmark'
            location_id INTEGER NOT NULL, -- references the ID of the respective type
            multiplier NUMERIC(5, 2) DEFAULT 1.00,
            transit_min INTEGER DEFAULT 1,
            transit_max INTEGER DEFAULT 3,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(tenant_id, vendor_id, location_type, location_id)
        );
    `);
    console.log('  ✓ Created Vendor Shipping Config tables');

    // 3. Update Products Table for Overrides and Exceptions
    await query(`
        ALTER TABLE products
        ADD COLUMN IF NOT EXISTS delivery_type VARCHAR(50) DEFAULT 'normal',
        ADD COLUMN IF NOT EXISTS shipping_base_fee_override NUMERIC(10, 2),
        ADD COLUMN IF NOT EXISTS disable_shipping_multiplier BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS processing_min_override INTEGER,
        ADD COLUMN IF NOT EXISTS processing_max_override INTEGER,
        ADD COLUMN IF NOT EXISTS transit_min_override INTEGER,
        ADD COLUMN IF NOT EXISTS transit_max_override INTEGER;
    `);
    console.log('  ✓ Updated Products table with delivery fields');

    console.log('Migration complete: 084_advanced_shipping_module.js');
}

async function down() {
    await query(`
        ALTER TABLE products
        DROP COLUMN IF EXISTS delivery_type,
        DROP COLUMN IF EXISTS shipping_base_fee_override,
        DROP COLUMN IF EXISTS disable_shipping_multiplier,
        DROP COLUMN IF EXISTS processing_min_override,
        DROP COLUMN IF EXISTS processing_max_override,
        DROP COLUMN IF EXISTS transit_min_override,
        DROP COLUMN IF EXISTS transit_max_override;
    `);

    await query(`DROP TABLE IF EXISTS vendor_shipping_zones CASCADE;`);
    await query(`DROP TABLE IF EXISTS vendor_shipping_configs CASCADE;`);
    await query(`DROP TABLE IF EXISTS landmarks CASCADE;`);
    await query(`DROP TABLE IF EXISTS states CASCADE;`);
    await query(`DROP TABLE IF EXISTS countries CASCADE;`);
}

module.exports = { up, down };
