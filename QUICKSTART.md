# Quick Start - Local Development

## Prerequisites

Before you start, make sure you have installed:
- **Node.js 18+** ([Download](https://nodejs.org/))
- **PostgreSQL 13+** ([Download](https://www.postgresql.org/download/))
- **Redis 6+** ([Download](https://redis.io/download))

## Step-by-Step Setup

### 1. Install Dependencies

```bash
cd c:\Users\chatz\Downloads\eCommerce
npm install
```

### 2. Start PostgreSQL & Redis

**PostgreSQL:**
```bash
# Windows - if installed as service, it should already be running
# Check status in Services app or:
pg_ctl status
```

**Redis:**
```bash
# Windows - Download Redis for Windows or use WSL
# Or use Docker:
docker run --name redis -p 6379:6379 -d redis:6-alpine
```

### 3. Create Database

```bash
# Using psql command line:
psql -U postgres

# In psql prompt:
CREATE DATABASE saas_ecommerce;
\q
```

### 4. Configure Environment

```bash
# Copy example env file
copy .env.example .env

# Edit .env file with your local settings
```

**Minimal `.env` for local development:**
```env
NODE_ENV=development
PORT=3000

# Database (adjust if needed)
DB_HOST=localhost
DB_PORT=5432
DB_NAME=saas_ecommerce
DB_USER=postgres
DB_PASSWORD=your_postgres_password

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# JWT Secrets (for development only - use strong secrets in production)
JWT_ACCESS_SECRET=dev_access_secret_change_in_production_12345678901234567890
JWT_REFRESH_SECRET=dev_refresh_secret_change_in_production_12345678901234567890

# Module toggles (enable what you want to test)
MODULE_PRODUCTS_ENABLED=true
MODULE_CART_ENABLED=true
MODULE_CHECKOUT_ENABLED=true
MODULE_ORDERS_ENABLED=true
MODULE_PAYMENTS_ENABLED=true
```

### 5. Run Database Migrations

Create the migration script:

**database/migrate.js** (already created):
```javascript
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');

async function runMigrations() {
  console.log('Running database migrations...\n');
  
  const schemas = [
    'platform/events/database/schema.sql',
    'platform/core/auth/database/schema.sql',
    'platform/core/tenants/database/schema.sql',
    'platform/core/roles/database/schema.sql',
    'platform/core/subscriptions/database/schema.sql',
    'platform/core/module_registry/database/schema.sql',
    'modules/products/database/schema.sql',
    'modules/cart/database/schema.sql',
    'modules/orders/database/schema.sql',
    'modules/payments/database/schema.sql',
  ];

  for (const schemaPath of schemas) {
    const fullPath = path.join(__dirname, '..', schemaPath);
    if (fs.existsSync(fullPath)) {
      const sql = fs.readFileSync(fullPath, 'utf8');
      console.log(`✓ Running: ${schemaPath}`);
      await pool.query(sql);
    } else {
      console.log(`⚠ Skipped (not found): ${schemaPath}`);
    }
  }

  console.log('\n✅ All migrations completed!');
  await pool.end();
  process.exit(0);
}

runMigrations().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
```

Run it:
```bash
node database/migrate.js
```

### 6. Seed Initial Data (Optional)

**database/seed.js**:
```javascript
const { query, pool } = require('../config/database');

async function seed() {
  console.log('Seeding database...\n');

  try {
    // Create subscription plans
    console.log('Creating subscription plans...');
    const starterPlan = await query(`
      INSERT INTO subscription_plans (name, description, price_monthly, price_yearly)
      VALUES ('Starter', 'Perfect for small businesses', 29.99, 299.99)
      ON CONFLICT (name) DO NOTHING
      RETURNING *
    `);

    const proPlan = await query(`
      INSERT INTO subscription_plans (name, description, price_monthly, price_yearly)
      VALUES ('Professional', 'For growing businesses', 99.99, 999.99)
      ON CONFLICT (name) DO NOTHING
      RETURNING *
    `);

    // Get plan IDs
    const plans = await query('SELECT * FROM subscription_plans');
    const starter = plans.rows.find(p => p.name === 'Starter');
    const pro = plans.rows.find(p => p.name === 'Professional');

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
```

Run it:
```bash
node database/seed.js
```

### 7. Start Development Server

```bash
npm run dev
```

You should see:
```
========================================
  Multi-Tenant SaaS eCommerce Platform
========================================

✓ Database connection established
✓ Event Logger initialized
✓ Events module initialized

--- Loading Core Modules ---
✓ Module loaded: auth
✓ Module loaded: tenants
✓ Module loaded: roles
✓ Module loaded: subscriptions
✓ Module loaded: module_registry

--- Loading Feature Modules ---
✓ Module loaded: products
✓ Module loaded: cart
✓ Module loaded: orders
✓ Module loaded: payments

✓ Application initialized successfully

========================================
  Server running on port 3000
  Environment: development
========================================
```

### 8. Test the API

**Health Check:**
```bash
curl http://localhost:3000/health
```

**Create a Tenant:**
```bash
curl -X POST http://localhost:3000/tenants ^
  -H "Content-Type: application/json" ^
  -d "{\"name\":\"Test Company\",\"subdomain\":\"testco\"}"
```

**Register a User:**
```bash
curl -X POST http://localhost:3000/auth/register ^
  -H "Content-Type: application/json" ^
  -H "X-Tenant-ID: <tenant-id-from-previous-response>" ^
  -d "{\"email\":\"user@test.com\",\"password\":\"Test1234!\",\"first_name\":\"John\",\"last_name\":\"Doe\"}"
```

**Login:**
```bash
curl -X POST http://localhost:3000/auth/login ^
  -H "Content-Type: application/json" ^
  -H "X-Tenant-ID: <tenant-id>" ^
  -d "{\"email\":\"user@test.com\",\"password\":\"Test1234!\"}"
```

## Common Issues & Solutions

### Issue: Database connection fails
```
Error: Connection refused
```
**Solution:** Make sure PostgreSQL is running:
```bash
# Check status
pg_ctl status

# Start if needed
pg_ctl start
```

### Issue: Redis connection fails
```
Error: Redis connection failed
```
**Solution:** 
- Check if Redis is running
- Or disable Redis temporarily by commenting out Redis calls in code
- Or use Docker: `docker run -p 6379:6379 -d redis:6-alpine`

### Issue: Module not loading
```
[ModuleBootstrapper] Module products not found
```
**Solution:** Check that `MODULE_PRODUCTS_ENABLED=true` in your `.env`

### Issue: JWT errors
```
Error: jwt must be provided
```
**Solution:** Make sure JWT secrets are set in `.env`

## Development Tools

### Useful Commands

```bash
# View logs in real-time
npm run dev

# Check database tables
psql -U postgres -d saas_ecommerce -c "\dt"

# View Redis data
redis-cli
> KEYS *
> GET tenant:*:subscription

# Clear Redis cache
redis-cli FLUSHALL
```

### API Testing with Postman

Import this collection structure:
1. Create Tenant
2. Register User
3. Login (save token)
4. Create Product (use token)
5. Add to Cart
6. Checkout
7. Process Payment
8. View Order

## Next Steps

1. ✅ Create your first tenant
2. ✅ Register users
3. ✅ Create products
4. ✅ Test the checkout flow
5. ✅ Explore the event system (check `event_logs` table)
6. ✅ Try disabling modules and see graceful degradation

## Getting Help

- **README**: `c:\Users\chatz\Downloads\eCommerce\README.md`
- **Events**: `docs\EVENTS.md`
- **API**: `docs\API_CONVENTIONS.md`
- **Production**: `docs\DEPLOYMENT.md`

Happy coding! 🚀
