const { query } = require('../../../config/database');
const Theme = require('../models/Theme');
const Page = require('../models/Page');

class HeaderFooterSyncService {
    /**
     * Syncs colors when Page (slug: 'header' | 'footer') is created or updated
     */
    static async syncPageToTheme(tenantId, slug, overrides) {
        if (!tenantId || !slug || !overrides || (slug !== 'header' && slug !== 'footer')) return;

        try {
            const activeTheme = await Theme.findActive(tenantId);
            if (!activeTheme) return;

            const vars = typeof activeTheme.variables === 'string'
                ? JSON.parse(activeTheme.variables || '{}')
                : (activeTheme.variables || {});

            const currentSection = vars[slug] || {};
            const bg = overrides.background;
            const text = overrides.textColor || overrides.text;

            let changed = false;
            if (bg && currentSection.backgroundColor !== bg) {
                currentSection.backgroundColor = bg;
                changed = true;
            }
            if (text && currentSection.textColor !== text) {
                currentSection.textColor = text;
                changed = true;
            }

            if (changed) {
                vars[slug] = currentSection;
                await Theme.update(tenantId, activeTheme.id, { variables: vars });
                console.log(`[HeaderFooterSync] Synced ${slug} page colors to active theme ${activeTheme.id}`);
            }
        } catch (err) {
            console.error(`[HeaderFooterSync] Failed to sync page to theme:`, err.message);
        }
    }

    /**
     * Syncs colors when Theme (variables.header / variables.footer) is created, updated, or activated
     */
    static async syncThemeToPage(tenantId, variables) {
        if (!tenantId || !variables) return;

        const vars = typeof variables === 'string' ? JSON.parse(variables || '{}') : variables;

        for (const slug of ['header', 'footer']) {
            const bg = vars[slug]?.backgroundColor;
            const text = vars[slug]?.textColor;

            if (bg || text) {
                try {
                    const page = await Page.findBySlug(tenantId, slug);
                    if (page) {
                        const rawOverrides = typeof page.theme_overrides === 'string'
                            ? JSON.parse(page.theme_overrides || '{}')
                            : (page.theme_overrides || {});

                        let changed = false;
                        if (bg && rawOverrides.background !== bg) {
                            rawOverrides.background = bg;
                            changed = true;
                        }
                        if (text && rawOverrides.textColor !== text) {
                            rawOverrides.textColor = text;
                            changed = true;
                        }

                        if (changed) {
                            await Page.update(tenantId, page.id, {
                                theme_overrides: rawOverrides,
                                is_published: true
                            });
                            console.log(`[HeaderFooterSync] Synced theme ${slug} colors to page ${page.id}`);
                        }
                    } else {
                        // Create page if it doesn't exist
                        const overrides = {};
                        if (bg) overrides.background = bg;
                        if (text) overrides.textColor = text;

                        await Page.create(tenantId, {
                            slug,
                            title: slug === 'header' ? 'Global Header' : 'Global Footer',
                            is_system: true,
                            is_published: true,
                            theme_overrides: overrides
                        });
                        console.log(`[HeaderFooterSync] Created ${slug} page with synced theme colors`);
                    }
                } catch (err) {
                    console.error(`[HeaderFooterSync] Failed to sync theme to page for ${slug}:`, err.message);
                }
            }
        }
    }

    /**
     * Reconcile/repair all existing tenants in the database
     */
    static async repairAll() {
        try {
            const themesResult = await query(`SELECT * FROM themes WHERE is_active = true`);
            for (const theme of themesResult.rows) {
                await this.syncThemeToPage(theme.tenant_id, theme.variables);
            }

            // Also check pages that might have background/text overrides and sync to theme
            const pagesResult = await query(`SELECT * FROM pages WHERE slug IN ('header', 'footer')`);
            for (const page of pagesResult.rows) {
                const rawOverrides = typeof page.theme_overrides === 'string'
                    ? JSON.parse(page.theme_overrides || '{}')
                    : (page.theme_overrides || {});
                if (rawOverrides.background || rawOverrides.textColor || rawOverrides.text) {
                    await this.syncPageToTheme(page.tenant_id, page.slug, rawOverrides);
                }
            }

            console.log('[HeaderFooterSync] Reconciled all active themes with header/footer pages');
        } catch (err) {
            console.error('[HeaderFooterSync] Repair failed:', err.message);
        }
    }
}

module.exports = HeaderFooterSyncService;
