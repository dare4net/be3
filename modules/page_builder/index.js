/**
 * Page Builder Module
 * Manages customizable widgets for storefront pages
 */

const express = require('express');
const PageWidget = require('./models/PageWidget');
const Page = require('./models/Page');
const Theme = require('./models/Theme');
const Layout = require('./models/Layout');
const Tenant = require('../../platform/core/tenants/models/Tenant');
const { authenticate } = require('../../platform/core/auth/middleware/authenticate');
const authorize = require('../../platform/core/roles/middleware/authorize');
const { asyncHandler } = require('../../middleware/errorHandler');

async function bootstrap(context) {
    const { app } = context;
    const router = express.Router();

    // Get all widgets for a specific page (PUBLIC - for storefront display)
    router.get('/widgets', asyncHandler(async (req, res) => {
        const { page = 'home', includeInactive = 'false', layoutId } = req.query;

        let targetLayoutId = layoutId;

        // If no explicit layout requested, find the active one
        if (!targetLayoutId) {
            const activeLayout = await Layout.findActive(req.tenantId);
            if (activeLayout) {
                targetLayoutId = activeLayout.id;
            } else {
                // Fallback to 'Default' if no active layout found
                const defaultLayout = await Layout.findDefault(req.tenantId);
                targetLayoutId = defaultLayout ? defaultLayout.id : null;
            }
        }

        if (!targetLayoutId) {
            console.warn(`[PageBuilder] No layout found for tenant ${req.tenantId}`);
            return res.json({ success: true, widgets: [] });
        }

        const widgets = await PageWidget.findByPage(
            req.tenantId,
            page,
            targetLayoutId,
            includeInactive === 'true'
        );
        res.json({ success: true, widgets, layoutId: targetLayoutId });
    }));

    // Get single widget (PUBLIC - for storefront display)
    router.get('/widgets/:id', asyncHandler(async (req, res) => {
        const widget = await PageWidget.findById(req.tenantId, req.params.id);
        if (!widget) {
            return res.status(404).json({ error: 'Widget not found' });
        }
        res.json({ success: true, widget });
    }));

    // Create new widget
    router.post('/widgets', authenticate, authorize('widgets.create'), asyncHandler(async (req, res) => {
        let { layout_id } = req.body;

        if (!layout_id) {
            const activeLayout = await Layout.findActive(req.tenantId);
            layout_id = activeLayout ? activeLayout.id : null;
        }

        if (!layout_id) {
            // Fallback
            const defaultLayout = await Layout.findDefault(req.tenantId);
            layout_id = defaultLayout ? defaultLayout.id : null;
        }

        if (!layout_id) {
            return res.status(400).json({ error: 'No layout found to attach widget to' });
        }

        const widgetData = { ...req.body, layout_id };
        const widget = await PageWidget.create(req.tenantId, widgetData);

        // AUTO-COMPLETE SETUP CHECK
        try {
            const tenant = await Tenant.findById(req.tenantId);
            if (tenant && tenant.setup_status === 'NEW') {
                await Tenant.update(req.tenantId, { setup_status: 'COMPLETED' });
                console.log(`[PageBuilder] Auto-completed setup for tenant ${req.tenantId}`);
            }
        } catch (err) {
            console.error('[PageBuilder] Failed to auto-complete setup:', err);
        }

        res.status(201).json({ success: true, widget });
    }));

    // Reorder widgets
    router.put('/widgets/reorder', authenticate, authorize('widgets.reorder'), asyncHandler(async (req, res) => {
        const { widgets } = req.body; // [{ id, sort_order }, ...]
        console.log('[PageBuilder] Reorder request body:', JSON.stringify(req.body));
        if (!widgets || !Array.isArray(widgets)) {
            console.error('[PageBuilder] Invalid widgets payload:', widgets);
            return res.status(400).json({ error: 'Invalid widgets payload' });
        }
        await PageWidget.reorder(req.tenantId, widgets);
        res.json({ success: true, message: 'Widgets reordered' });
    }));

    // Update widget
    router.put('/widgets/:id', authenticate, authorize('widgets.edit'), asyncHandler(async (req, res) => {
        const widget = await PageWidget.update(req.tenantId, req.params.id, req.body);
        if (!widget) {
            return res.status(404).json({ error: 'Widget not found' });
        }

        // AUTO-COMPLETE SETUP CHECK
        try {
            // Also complete on update, in case they just edited an existing item (rare for NEW, but possible)
            const tenant = await Tenant.findById(req.tenantId);
            if (tenant && tenant.setup_status === 'NEW') {
                await Tenant.update(req.tenantId, { setup_status: 'COMPLETED' });
                console.log(`[PageBuilder] Auto-completed setup for tenant ${req.tenantId}`);
            }
        } catch (err) {
            console.error('[PageBuilder] Failed to auto-complete setup:', err);
        }

        res.json({ success: true, widget });
    }));

    // Delete widget
    router.delete('/widgets/:id', authenticate, authorize('widgets.delete'), asyncHandler(async (req, res) => {
        const widget = await PageWidget.delete(req.tenantId, req.params.id);
        if (!widget) {
            return res.status(404).json({ error: 'Widget not found' });
        }
        res.json({ success: true, message: 'Widget deleted' });
    }));



    // ========== PAGE MANAGEMENT ROUTES ==========

    // Get all pages (PUBLIC for nav, Admin sees all with includeUnpublished)
    router.get('/pages', asyncHandler(async (req, res) => {
        const { includeUnpublished = 'false' } = req.query;
        const pages = await Page.findAll(req.tenantId, includeUnpublished === 'true');
        res.json({ success: true, pages });
    }));

    // Get navigation pages (PUBLIC - for storefront nav menu)
    router.get('/pages/navigation', asyncHandler(async (req, res) => {
        const pages = await Page.getNavigationPages(req.tenantId);
        res.json({ success: true, pages });
    }));

    // Get page by slug (PUBLIC - for storefront display)
    router.get('/pages/by-slug/:slug', asyncHandler(async (req, res) => {
        const page = await Page.findBySlug(req.tenantId, req.params.slug);
        if (!page) {
            return res.status(404).json({ error: 'Page not found' });
        }
        // Only return published pages for public access (unless authenticated admin)
        if (!page.is_published) {
            return res.status(404).json({ error: 'Page not found' });
        }
        res.json({ success: true, page });
    }));

    // Create new page
    router.post('/pages', authenticate, authorize('pages.create'), asyncHandler(async (req, res) => {
        const page = await Page.create(req.tenantId, req.body);
        res.status(201).json({ success: true, page });
    }));

    // Get single page by ID
    router.get('/pages/:id', authenticate, authorize('pages.view'), asyncHandler(async (req, res) => {
        const page = await Page.findById(req.tenantId, req.params.id);
        if (!page) {
            return res.status(404).json({ error: 'Page not found' });
        }
        res.json({ success: true, page });
    }));

    // Update page
    router.put('/pages/:id', authenticate, authorize('pages.edit'), asyncHandler(async (req, res) => {
        const page = await Page.update(req.tenantId, req.params.id, req.body);
        if (!page) {
            return res.status(404).json({ error: 'Page not found' });
        }
        res.json({ success: true, page });
    }));

    // Delete page
    router.delete('/pages/:id', authenticate, authorize('pages.delete'), asyncHandler(async (req, res) => {
        try {
            const page = await Page.delete(req.tenantId, req.params.id);
            if (!page) {
                return res.status(404).json({ error: 'Page not found' });
            }
            res.json({ success: true, message: 'Page deleted' });
        } catch (error) {
            if (error.message === 'Cannot delete system page') {
                return res.status(400).json({ error: 'Cannot delete system page' });
            }
            throw error;
        }
    }));

    // ========== LAYOUT MANAGEMENT ROUTES ==========

    // Get all layouts
    router.get('/layouts', authenticate, authorize('layouts.view'), asyncHandler(async (req, res) => {
        const sql = `SELECT * FROM layouts WHERE tenant_id = $1 ORDER BY created_at DESC`;
        const { rows } = await require('../../config/database').pool.query(sql, [req.tenantId]);
        res.json({ success: true, layouts: rows });
    }));

    // Create Layout
    router.post('/layouts', authenticate, authorize('layouts.create'), asyncHandler(async (req, res) => {
        const { name, description, clone_from_layout_id } = req.body;

        // 1. Create Layout Structure
        const sql = `
            INSERT INTO layouts (tenant_id, name, description, is_active)
            VALUES ($1, $2, $3, false)
            RETURNING *
        `;
        const result = await require('../../config/database').pool.query(sql, [req.tenantId, name, description]);
        const newLayout = result.rows[0];

        // 2. Clone Widgets (if requested)
        if (clone_from_layout_id) {
            const cloneSql = `
                INSERT INTO page_widgets (tenant_id, layout_id, page_type, widget_type, config, sort_order, is_active)
                SELECT tenant_id, $1, page_type, widget_type, config, sort_order, is_active
                FROM page_widgets
                WHERE layout_id = $2 AND tenant_id = $3
             `;
            await require('../../config/database').pool.query(cloneSql, [newLayout.id, clone_from_layout_id, req.tenantId]);
        }

        res.status(201).json({ success: true, layout: newLayout });
    }));

    // Activate Layout
    router.post('/layouts/:id/activate', authenticate, authorize('layouts.activate'), asyncHandler(async (req, res) => {
        const client = await require('../../config/database').pool.connect();
        try {
            await client.query('BEGIN');

            // Deactivate others
            await client.query('UPDATE layouts SET is_active = false WHERE tenant_id = $1', [req.tenantId]);

            // Activate target
            const result = await client.query(
                'UPDATE layouts SET is_active = true WHERE id = $1 AND tenant_id = $2 RETURNING *',
                [req.params.id, req.tenantId]
            );

            await client.query('COMMIT');

            if (result.rowCount === 0) {
                return res.status(404).json({ error: 'Layout not found' });
            }

            res.json({ success: true, layout: result.rows[0] });

        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    }));


    // ========== THEME MANAGEMENT ROUTES ==========

    // Get all themes (Admin)
    router.get('/themes', authenticate, authorize('themes.view'), asyncHandler(async (req, res) => {
        const themes = await Theme.findAll(req.tenantId);
        res.json({ success: true, themes });
    }));

    // Get active theme (PUBLIC - for Storefront)
    router.get('/storefront/theme', asyncHandler(async (req, res) => {
        const theme = await Theme.findActive(req.tenantId);
        // If no theme, return null (frontend should handle defaults)
        res.json({ success: true, theme: theme || null });
    }));

    // Get single theme (Admin)
    router.get('/themes/:id', authenticate, authorize('themes.view'), asyncHandler(async (req, res) => {
        const theme = await Theme.findById(req.tenantId, req.params.id);
        if (!theme) return res.status(404).json({ error: 'Theme not found' });
        res.json({ success: true, theme });
    }));

    // Create theme (Admin)
    router.post('/themes', authenticate, authorize('themes.create'), asyncHandler(async (req, res) => {
        const theme = await Theme.create(req.tenantId, req.body);
        res.status(201).json({ success: true, theme });
    }));

    // Update theme (Admin)
    router.put('/themes/:id', authenticate, authorize('themes.edit'), asyncHandler(async (req, res) => {
        const theme = await Theme.update(req.tenantId, req.params.id, req.body);
        if (!theme) return res.status(404).json({ error: 'Theme not found' });
        res.json({ success: true, theme });
    }));

    // Activate theme (Admin)
    router.post('/themes/:id/activate', authenticate, authorize('themes.activate'), asyncHandler(async (req, res) => {
        const theme = await Theme.activate(req.tenantId, req.params.id);
        if (!theme) return res.status(404).json({ error: 'Theme not found' });
        res.json({ success: true, theme });
    }));

    // Deactivate all themes (Admin)
    router.post('/themes/deactivate', authenticate, authorize('themes.activate'), asyncHandler(async (req, res) => {
        await Theme.deactivate(req.tenantId);
        res.json({ success: true, message: 'Theme deactivated' });
    }));

    // Delete theme (Admin)
    router.delete('/themes/:id', authenticate, authorize('themes.delete'), asyncHandler(async (req, res) => {
        try {
            const theme = await Theme.delete(req.tenantId, req.params.id);
            if (!theme) return res.status(404).json({ error: 'Theme not found' });
            res.json({ success: true, message: 'Theme deleted' });
        } catch (error) {
            // Check for active theme constraint? 
            // Ideally should not allow deleting active theme, but for now simple delete is fine.
            throw error;
        }
    }));

    // ========== SEO PRESETS ROUTES ==========

    const SEOPreset = require('./models/SEOPreset');

    // Get all SEO presets
    router.get('/seo-presets', authenticate, authorize('pages.view'), asyncHandler(async (req, res) => {
        const presets = await SEOPreset.findAll(req.tenantId);
        res.json({ success: true, presets });
    }));

    // Create SEO preset
    router.post('/seo-presets', authenticate, authorize('pages.create'), asyncHandler(async (req, res) => {
        const preset = await SEOPreset.create(req.tenantId, req.body);
        res.status(201).json({ success: true, preset });
    }));

    // Update SEO preset
    router.put('/seo-presets/:id', authenticate, authorize('pages.edit'), asyncHandler(async (req, res) => {
        const preset = await SEOPreset.update(req.tenantId, req.params.id, req.body);
        if (!preset) return res.status(404).json({ error: 'SEO Preset not found' });
        res.json({ success: true, preset });
    }));

    // Delete SEO preset
    router.delete('/seo-presets/:id', authenticate, authorize('pages.delete'), asyncHandler(async (req, res) => {
        const preset = await SEOPreset.delete(req.tenantId, req.params.id);
        if (!preset) return res.status(404).json({ error: 'SEO Preset not found' });
        res.json({ success: true, message: 'SEO Preset deleted' });
    }));

    app.use('/page-builder', router);
    console.log('[Page Builder] Routes registered at /page-builder');

    return true;
}

module.exports = { bootstrap };
