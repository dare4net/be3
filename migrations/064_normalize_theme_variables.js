/**
 * Migration 064: Normalize Theme Variables
 * Flattens nested 'colors' object and converts snake_case font keys to camelCase.
 */

const { pool } = require('../config/database');

async function up() {
    console.log('[Migration 064] Normalizing theme variables...');
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // 1. Fetch all themes
        const { rows: themes } = await client.query('SELECT id, variables FROM themes');
        
        for (const theme of themes) {
            let vars = theme.variables;
            
            // Handle if variables is a string (depends on pg-types config)
            if (typeof vars === 'string') {
                vars = JSON.parse(vars);
            }
            
            if (!vars) continue;

            const newVars = { ...vars };
            let modified = false;

            // Normalize Colors
            if (vars.colors && typeof vars.colors === 'object') {
                console.log(`  - Flattening colors for theme ${theme.id}`);
                Object.assign(newVars, vars.colors);
                delete newVars.colors;
                modified = true;
            }

            // Normalize Fonts (if they existed in sub-object)
            if (vars.fonts && typeof vars.fonts === 'object') {
                console.log(`  - Flattening fonts for theme ${theme.id}`);
                Object.assign(newVars, vars.fonts);
                delete newVars.fonts;
                modified = true;
            }

            // Convert snake_case to camelCase for fonts
            if (vars.font_heading) {
                newVars.fontHeading = vars.font_heading;
                delete newVars.font_heading;
                modified = true;
            }
            if (vars.font_body) {
                newVars.fontBody = vars.font_body;
                delete newVars.font_body;
                modified = true;
            }

            // Add primaryHover default if primary exists but hover doesn't
            if (newVars.primary && !newVars.primaryHover) {
                newVars.primaryHover = newVars.primary; 
                modified = true;
            }

            if (modified) {
                await client.query(
                    'UPDATE themes SET variables = $1, updated_at = NOW() WHERE id = $2',
                    [JSON.stringify(newVars), theme.id]
                );
            }
        }

        await client.query('COMMIT');
        console.log('✅ Theme normalization completed successfully.');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Migration 064 failed:', err);
        throw err;
    } finally {
        client.release();
    }
}

module.exports = { up };
