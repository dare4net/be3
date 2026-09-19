/**
 * LocationService
 * Handles vendor location management
 */


const { query: dbQuery } = require('../../../config/database');

class LocationService {
    /**
     * Create a new vendor location
     */
    async createLocation(tenantId, vendorId, locationData) {
        const { scope, continent, country, state, city, address, postal_code, latitude, longitude, is_primary } = locationData;

        // If this is set as primary, unset other primary locations for this vendor
        if (is_primary) {
            await this.unsetPrimaryLocations(tenantId, vendorId);
        }

        const sql = `
            INSERT INTO vendor_locations (
                tenant_id, vendor_id, scope, continent, country, state, city, 
                address, postal_code, latitude, longitude, is_primary
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING *
        `;

        const result = await dbQuery(sql, [
            tenantId, vendorId, scope, continent, country, state, city,
            address, postal_code, latitude, longitude, is_primary || false
        ]);

        return result.rows[0];
    }

    /**
     * Get all locations for a vendor
     */
    async getVendorLocations(tenantId, vendorId) {
        const sql = `
            SELECT * FROM vendor_locations
            WHERE tenant_id = $1 AND vendor_id = $2
            ORDER BY is_primary DESC, created_at DESC
        `;
        const result = await dbQuery(sql, [tenantId, vendorId]);
        return result.rows;
    }

    /**
     * Get primary location for a vendor
     */
    async getPrimaryLocation(tenantId, vendorId) {
        const sql = `
            SELECT * FROM vendor_locations
            WHERE tenant_id = $1 AND vendor_id = $2 AND is_primary = true
            LIMIT 1
        `;
        const result = await dbQuery(sql, [tenantId, vendorId]);
        return result.rows[0] || null;
    }

    /**
     * Get a specific location by ID
     */
    async getLocationById(tenantId, locationId) {
        const sql = `
            SELECT * FROM vendor_locations
            WHERE tenant_id = $1 AND id = $2
        `;
        const result = await dbQuery(sql, [tenantId, locationId]);
        return result.rows[0] || null;
    }

    /**
     * Update a location
     */
    async updateLocation(tenantId, locationId, vendorId, locationData) {
        const { scope, continent, country, state, city, address, postal_code, latitude, longitude, is_primary } = locationData;

        // If setting as primary, unset other primary locations
        if (is_primary) {
            await this.unsetPrimaryLocations(tenantId, vendorId, locationId);
        }

        const sql = `
            UPDATE vendor_locations
            SET scope = $1, continent = $2, country = $3, state = $4, city = $5,
                address = $6, postal_code = $7, latitude = $8, longitude = $9,
                is_primary = $10, updated_at = NOW()
            WHERE tenant_id = $11 AND id = $12
            RETURNING *
        `;

        const result = await dbQuery(sql, [
            scope, continent, country, state, city, address, postal_code,
            latitude, longitude, is_primary, tenantId, locationId
        ]);

        return result.rows[0];
    }

    /**
     * Delete a location
     */
    async deleteLocation(tenantId, locationId) {
        const sql = `DELETE FROM vendor_locations WHERE tenant_id = $1 AND id = $2`;
        await dbQuery(sql, [tenantId, locationId]);
        return { success: true };
    }

    /**
     * Set a location as primary
     */
    async setPrimaryLocation(tenantId, locationId, vendorId) {
        // Unset all other primary locations for this vendor
        await this.unsetPrimaryLocations(tenantId, vendorId, locationId);

        // Set this location as primary
        const sql = `
            UPDATE vendor_locations
            SET is_primary = true, updated_at = NOW()
            WHERE tenant_id = $1 AND id = $2
            RETURNING *
        `;
        const result = await dbQuery(sql, [tenantId, locationId]);
        return result.rows[0];
    }

    /**
     * Unset primary flag for all locations except the specified one
     */
    async unsetPrimaryLocations(tenantId, vendorId, exceptLocationId = null) {
        const sql = exceptLocationId
            ? `UPDATE vendor_locations SET is_primary = false, updated_at = NOW() 
               WHERE tenant_id = $1 AND vendor_id = $2 AND id != $3`
            : `UPDATE vendor_locations SET is_primary = false, updated_at = NOW() 
               WHERE tenant_id = $1 AND vendor_id = $2`;

        const params = exceptLocationId
            ? [tenantId, vendorId, exceptLocationId]
            : [tenantId, vendorId];

        await dbQuery(sql, params);
    }

    /**
     * Format location for display
     */
    formatLocationDisplay(location) {
        if (!location) return null;

        switch (location.scope) {
            case 'worldwide':
                return 'Worldwide';
            case 'continent':
                return location.continent || 'Continental';
            case 'country':
                return location.country || 'Country-wide';
            case 'state':
                return `${location.state}${location.country ? ', ' + location.country : ''}`;
            case 'city':
                return `${location.city}${location.state ? ', ' + location.state : ''}${location.country ? ', ' + location.country : ''}`;
            case 'specific':
                return location.city && location.state
                    ? `${location.city}, ${location.state}`
                    : location.address || 'Specific Location';
            default:
                return 'Location Available';
        }
    }
}

module.exports = new LocationService();
