const Theme = require('../modules/page_builder/models/Theme');
const { query } = require('../config/database');

async function verifyTheming() {
    const tenantId = '11111111-1111-1111-1111-111111111111'; // Test Tenant

    try {
        console.log('Starting Theming Verification...');

        // 1. Create a Theme
        console.log('1. Creating Theme...');
        const newTheme = await Theme.create(tenantId, {
            name: 'Verification Theme',
            variables: { primary: '#ff0000', radius: '1rem' },
            is_active: false
        });
        console.log('✓ Theme created:', newTheme.id);

        // 2. Activate Theme
        console.log('2. Activating Theme...');
        await Theme.activate(tenantId, newTheme.id);
        const activeTheme = await Theme.findActive(tenantId);

        if (activeTheme && activeTheme.id === newTheme.id && activeTheme.is_active) {
            console.log('✓ Theme activated successfully');
        } else {
            console.error('✗ Theme activation failed');
        }

        // 3. Update Theme
        console.log('3. Updating Theme...');
        const updated = await Theme.update(tenantId, newTheme.id, {
            name: 'Updated Verification Theme'
        });
        if (updated.name === 'Updated Verification Theme') {
            console.log('✓ Theme updated successfully');
        }

        // 4. Cleanup
        console.log('4. Cleaning up...');
        await Theme.delete(tenantId, newTheme.id);
        console.log('✓ Cleanup complete');

        process.exit(0);
    } catch (error) {
        console.error('✗ Verification failed:', error);
        process.exit(1);
    }
}

verifyTheming();
