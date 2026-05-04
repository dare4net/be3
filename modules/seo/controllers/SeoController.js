const SeoService = require('../services/SeoService');

class SeoController {
    static async getSitemap(req, res, next) {
        try {
            const tenantId = req.tenantId;
            if (!tenantId) {
                return res.status(400).json({ error: 'Tenant ID required' });
            }

            // Attempt to determine the base URL from the request headers or fallback to a default
            const protocol = req.headers['x-forwarded-proto'] || req.protocol;
            const host = req.headers['x-forwarded-host'] || req.get('host');
            // If the storefront sends its URL via header (e.g. x-storefront-url), use that instead:
            const baseUrl = req.headers['x-storefront-url'] || `${protocol}://${host}`;

            const xml = await SeoService.getSitemap(tenantId, baseUrl);

            res.header('Content-Type', 'application/xml');
            res.send(xml);
        } catch (error) {
            next(error);
        }
    }

    static async getPresets(req, res, next) {
        try {
            const tenantId = req.tenantId;
            if (!tenantId) {
                return res.status(400).json({ error: 'Tenant ID required' });
            }

            const presets = await SeoService.getPresets(tenantId);
            res.json({ data: presets });
        } catch (error) {
            next(error);
        }
    }

    static async updatePresets(req, res, next) {
        try {
            // MOCKED: To be implemented in the future
            res.status(501).json({ error: 'Not Implemented', message: 'SEO Preset management will be added in a future update.' });
        } catch (error) {
            next(error);
        }
    }
}

module.exports = SeoController;
