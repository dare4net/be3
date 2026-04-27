/**
 * Tenant Service
 * 
 * PRINCIPLE: Multi-tenant by default
 * PRINCIPLE: Modules do not import other modules (uses event bus)
 */

const Tenant = require('../models/Tenant');
const eventBus = require('../../../events/EventBus');
const { clearTenantCache } = require('../../../../config/redis');
const MediaInterceptor = require('../../../../modules/media/services/MediaInterceptor');

class TenantService {
    /**
     * Create a new tenant
     */
    static async createTenant(tenantData) {
        // Validate subdomain format
        const subdomainRegex = /^[a-z0-9-]+$/;
        if (!subdomainRegex.test(tenantData.subdomain)) {
            throw new Error('Subdomain must contain only lowercase letters, numbers, and hyphens');
        }

        // Reserved subdomains
        const reserved = ['www', 'api', 'admin', 'app', 'platform', 'dashboard', 'mail', 'ftp'];
        if (reserved.includes(tenantData.subdomain.toLowerCase())) {
            throw new Error('This subdomain is reserved');
        }

        // Check if subdomain is available
        const isAvailable = await Tenant.isSubdomainAvailable(tenantData.subdomain);
        if (!isAvailable) {
            throw new Error('Subdomain is already taken');
        }

        // Mirror logo if provided
        if (tenantData.logo_url) {
            await MediaInterceptor.intercept(tenantData, 'branding', 'logo_url');
        }
        if (tenantData.settings) {
            await MediaInterceptor.interceptSettings(tenantData.settings);
        }

        // Create tenant
        const tenant = await Tenant.create({
            name: tenantData.name,
            subdomain: tenantData.subdomain.toLowerCase(),
            domain: tenantData.domain,
            settings: tenantData.settings || {},
            logo_url: tenantData.logo_url,
            timezone: tenantData.timezone || 'UTC',
        });

        // PRINCIPLE: All inter-module communication is event-based
        // Emit event so other modules can initialize for this tenant
        eventBus.emitEvent('tenant.created', {
            tenantId: tenant.id,
            name: tenant.name,
            subdomain: tenant.subdomain,
        });

        return tenant;
    }

    /**
     * Get tenant by ID
     */
    static async getTenant(tenantId) {
        const tenant = await Tenant.findById(tenantId);
        if (!tenant) {
            throw new Error('Tenant not found');
        }
        return tenant;
    }

    /**
     * Get tenant by subdomain
     */
    static async getTenantBySubdomain(subdomain) {
        const tenant = await Tenant.findBySubdomain(subdomain);
        if (!tenant) {
            throw new Error('Tenant not found');
        }
        return tenant;
    }

    /**
     * Update tenant
     */
    static async updateTenant(tenantId, updates) {
        // Validate tenant exists
        const oldTenant = await this.getTenant(tenantId);

        // Mirror assets
        if (updates.logo_url) {
            await MediaInterceptor.intercept(updates, 'branding', 'logo_url', oldTenant.logo_url);
        }
        if (updates.settings) {
            await MediaInterceptor.interceptSettings(updates.settings);
        }

        // Update tenant
        const updatedTenant = await Tenant.update(tenantId, updates);

        // Clear cache
        await clearTenantCache(tenantId);

        // Emit event
        eventBus.emitEvent('tenant.updated', {
            tenantId: updatedTenant.id,
            updates,
        });

        return updatedTenant;
    }

    /**
     * Update tenant settings
     */
    static async updateSettings(tenantId, settings) {
        await this.getTenant(tenantId);

        // Mirror images within settings
        await MediaInterceptor.interceptSettings(settings);

        const updatedTenant = await Tenant.updateSettings(tenantId, settings);

        await clearTenantCache(tenantId);

        eventBus.emitEvent('tenant.settings_updated', {
            tenantId,
            settings,
        });

        return updatedTenant;
    }

    /**
     * Get tenant by subdomain (Public info only)
     */
    async getTenantBySubdomain(subdomain) {
        const result = await query(
            'SELECT id, name, subdomain, settings, status FROM tenants WHERE subdomain = $1',
            [subdomain]
        );

        if (result.rows.length === 0) {
            return null;
        }

        return result.rows[0];
    }

    /**
     * Get tenant settings
     */
    static async getSettings(tenantId) {
        return await Tenant.getSettings(tenantId);
    }

    /**
     * Delete tenant
     */
    static async deleteTenant(tenantId) {
        await this.getTenant(tenantId);

        const deletedTenant = await Tenant.softDelete(tenantId);

        await clearTenantCache(tenantId);

        // Emit event for cleanup in other modules
        eventBus.emitEvent('tenant.deleted', {
            tenantId,
        });

        return deletedTenant;
    }

    /**
     * List all tenants (for super admin)
     */
    static async listTenants(options = {}) {
        return await Tenant.findAll(options);
    }

    /**
     * Check subdomain availability
     */
    static async checkSubdomainAvailability(subdomain) {
        return await Tenant.isSubdomainAvailable(subdomain);
    }
}

module.exports = TenantService;
