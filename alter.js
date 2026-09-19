const { query } = require('./config/database');

async function run() {
    try {
        await query('ALTER TABLE magic_tokens ADD COLUMN IF NOT EXISTS target_app TEXT DEFAULT \'storefront\'');
        await query('ALTER TABLE magic_tokens ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT \'{}\'::jsonb');
        console.log('Successfully altered magic_tokens table');
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}
run();
