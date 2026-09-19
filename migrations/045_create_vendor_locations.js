/**
 * Migration: Create vendor_locations table
 * Allows vendors to set business locations with different geographic scopes
 */

const { query } = require('../config/database');

async function up() {
    console.log('Creating vendor_locations table...');

    await query(`
        CREATE TABLE IF NOT EXISTS vendor_locations (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            tenant_id UUID NOT NULL,
            vendor_id UUID NOT NULL,
            scope VARCHAR(50) NOT NULL CHECK (scope IN ('worldwide', 'continent', 'country', 'state', 'city', 'specific')),
            continent VARCHAR(100),
            country VARCHAR(100),
            state VARCHAR(100),
            city VARCHAR(100),
            address TEXT,
            postal_code VARCHAR(20),
            latitude DECIMAL(10, 8),
            longitude DECIMAL(11, 8),
            is_primary BOOLEAN DEFAULT false,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW(),
            CONSTRAINT fk_vendor_locations_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
            CONSTRAINT fk_vendor_locations_vendor FOREIGN KEY (vendor_id) REFERENCES users(id) ON DELETE CASCADE
        );
    `);

    console.log('Creating indexes for vendor_locations...');

    await query(`
        CREATE INDEX IF NOT EXISTS idx_vendor_locations_vendor 
        ON vendor_locations(vendor_id, tenant_id);
    `);

    await query(`
        CREATE INDEX IF NOT EXISTS idx_vendor_locations_scope 
        ON vendor_locations(scope);
    `);

    await query(`
        CREATE INDEX IF NOT EXISTS idx_vendor_locations_primary 
        ON vendor_locations(is_primary) WHERE is_primary = true;
    `);

    console.log('✓ vendor_locations table created successfully');
}

async function down() {
    console.log('Dropping vendor_locations table...');
    await query('DROP TABLE IF EXISTS vendor_locations CASCADE;');
    console.log('✓ vendor_locations table dropped');
}

module.exports = { up, down };
