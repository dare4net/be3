const { pool } = require('./config/database');

async function syncGranularThemes() {
    console.log('🔄 Starting Granular Theme Synchronization...');
    try {
        const result = await pool.query(`SELECT id, name, variables FROM themes`);
        const themes = result.rows;

        console.log(`Found ${themes.length} themes to update.`);

        for (const theme of themes) {
            let vars = theme.variables || {};

            // Keep existing core values, but ensure they exist
            vars.primary = vars.primary || "#2563eb";
            vars.primaryHover = vars.primaryHover || "#1d4ed8";
            vars.secondary = vars.secondary || "#4b5563";
            vars.accent = vars.accent || "#facc15";
            vars.background = vars.background || "#ffffff";
            vars.text = vars.text || "#111827";
            vars.fontHeading = vars.fontHeading || "Inter";
            vars.fontBody = vars.fontBody || "Inter";
            vars.radius = vars.radius || "0.5rem";

            // Inject NEW granular variables (only if missing, to preserve any edits if script runs twice)
            if (!vars.primaryContent) vars.primaryContent = "#ffffff";
            if (!vars.accentSoft) vars.accentSoft = "#eff6ff";
            if (!vars.accentContent) vars.accentContent = "#2563eb";
            if (!vars.buttonRadius) vars.buttonRadius = "9999px";
            if (!vars.cardBg) vars.cardBg = "#ffffff";
            if (!vars.cardRadius) vars.cardRadius = "0.5rem";

            await pool.query(
                `UPDATE themes SET variables = $1 WHERE id = $2`,
                [JSON.stringify(vars), theme.id]
            );
            console.log(`✅ Updated theme: ${theme.name} (${theme.id})`);
        }

        console.log('🎉 Granular Theme Synchronization Complete!');

    } catch (e) {
        console.error('❌ Error updating themes:', e);
    } finally {
        pool.end();
    }
}

syncGranularThemes();
