const { query, pool } = require('../config/database');

async function seed() {
    console.log('Seeding database...\n');

    try {
        // Create subscription plans
        console.log('Creating subscription plans...');
        await query(`
      INSERT INTO subscription_plans (name, description, price_monthly, price_yearly)
      VALUES ('Starter', 'Perfect for small businesses', 29.99, 299.99)
      ON CONFLICT (name) DO NOTHING
    `);

        await query(`
      INSERT INTO subscription_plans (name, description, price_monthly, price_yearly)
      VALUES ('Professional', 'For growing businesses', 99.99, 999.99)
      ON CONFLICT (name) DO NOTHING
    `);

        // Get plan IDs
        const plans = await query('SELECT * FROM subscription_plans');
        const starter = plans.rows.find(p => p.name === 'Starter');
        const pro = plans.rows.find(p => p.name === 'Professional');

        if (!starter || !pro) {
            throw new Error('Failed to create subscription plans');
        }

        // Add modules to plans
        console.log('Adding modules to plans...');
        const modules = ['storefront', 'products', 'cart', 'checkout', 'orders', 'payments'];

        for (const module of modules) {
            await query(`
        INSERT INTO plan_modules (plan_id, module_name, is_enabled)
        VALUES ($1, $2, true), ($3, $4, true)
        ON CONFLICT (plan_id, module_name) DO NOTHING
      `, [starter.id, module, pro.id, module]);
        }

        // Register modules in catalog
        console.log('Registering modules...');
        const allModules = [
            { name: 'storefront', display_name: 'Storefront', version: '1.0.0' },
            { name: 'products', display_name: 'Products', version: '1.0.0' },
            { name: 'cart', display_name: 'Shopping Cart', version: '1.0.0' },
            { name: 'checkout', display_name: 'Checkout', version: '1.0.0' },
            { name: 'orders', display_name: 'Orders', version: '1.0.0' },
            { name: 'payments', display_name: 'Payments', version: '1.0.0' },
        ];

        for (const mod of allModules) {
            await query(`
        INSERT INTO modules (name, display_name, version, is_core, description)
        VALUES ($1, $2, $3, false, $4)
        ON CONFLICT (name) DO NOTHING
      `, [mod.name, mod.display_name, mod.version, `${mod.display_name} module`]);
        }

        console.log('\n✅ Database seeded successfully!');
    } catch (error) {
        console.error('❌ Seed failed:', error);
    } finally {
        await pool.end();
        process.exit(0);
    }
}

seed();
