const { pool } = require('./config/database');

const vars = {
    logo: 'https://res.cloudinary.com/dqyjgssod/image/upload/v1775461921/Be3-blue_wp6zzi.png',
    primary: '#2563eb',
    primaryHover: '#1d4ed8',
    secondary: '#4b5563',
    accent: '#eff6ff',
    background: '#ffffff',
    text: '#111827',
    fontHeading: 'Manrope',
    fontBody: 'Manrope',
    radius: '0.5rem',
    copyright: ''
};

async function sync() {
    console.log('Syncing themes for tenant cbe1df05-45ed-455a-9ce6-156b0bd45713...');
    try {
        const res = await pool.query(
            'UPDATE themes SET variables = $1, updated_at = NOW() WHERE tenant_id = $2',
            [JSON.stringify(vars), 'cbe1df05-45ed-455a-9ce6-156b0bd45713']
        );
        console.log(`✅ Success: Updated ${res.rowCount} themes.`);
    } catch (err) {
        console.error('❌ Sync failed:', err);
    } finally {
        await pool.end();
        process.exit(0);
    }
}

sync();
