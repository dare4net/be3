# Multi-Tenant SaaS eCommerce Platform

A production-ready, modular, multi-tenant SaaS eCommerce platform built with Node.js, featuring strict event-driven architecture, subscription-based module gating, and complete tenant isolation.

## 🏗️ Architecture Principles

This platform is built on **non-negotiable principles** that inform every design decision:

1. **Multi-tenant by default** - Every request scoped by `tenant_id`
2. **Modules do not import other modules** - Complete isolation
3. **No cross-module database foreign keys** - No coupling at DB level
4. **All feature access is subscription-gated** - Pay for what you use
5. **All inter-module communication is event-based** - Loose coupling via events
6. **Any module can be removed without crashing the system** - True modularity
7. **Core runs even with zero feature modules installed** - Minimal viable core

## 📁 Project Structure

```
/platform/core/
  ├─ auth/              # User authentication & JWT tokens
  ├─ tenants/           # Tenant management & isolation
  ├─ roles/             # Role-based access control (RBAC)
  ├─ subscriptions/     # Plan management & module gating
  └─ module_registry/   # Module versioning & tracking

/platform/events/
  └─ EventBus.js        # Global event system for inter-module communication

/modules/
  ├─ storefront/        # Themes, pages, navigation, SEO
  ├─ products/          # Product catalog with variants & media
  ├─ cart/              # Shopping cart (guest & authenticated)
  ├─ checkout/          # Checkout flow & validation
  ├─ orders/            # Order lifecycle management
  ├─ payments/          # Payment processing & webhooks
  ├─ shipping/          # Shipping zones & rates (optional)
  ├─ marketing/         # Promotions & campaigns (optional)
  └─ analytics/         # Metrics & reporting (optional)

/super_admin/           # Platform-wide administration
```

## 🚀 Getting Started

### Prerequisites

- Node.js >= 18.0.0
- PostgreSQL >= 13
- Redis >= 6

### Installation

1. **Clone and install dependencies:**
```bash
npm install
```

2. **Configure environment:**
```bash
cp .env.example .env
# Edit .env with your database and Redis credentials
```

3. **Create database:**
```bash
createdb saas_ecommerce
```

4. **Run migrations:**
```bash
npm run migrate
```

5. **Seed initial data:**
```bash
npm run seed
```

6. **Start development server:**
```bash
npm run dev
```

The server will start on `http://localhost:3000`.

## 📦 Module System

### How Modules Work

Each module is **completely independent** and follows this structure:

```
/modules/[module-name]/
  ├─ index.js              # Bootstrap function
  ├─ database/schema.sql   # Module-specific tables
  ├─ permissions.js        # Permission definitions
  └─ events/listeners.js   # Event subscriptions (optional)
```

### Enabling/Disabling Modules

Modules are controlled via:
1. **Environment variables** (`.env`):
   ```
   MODULE_PRODUCTS_ENABLED=true
   ```

2. **Subscription plans** - Modules are gated by subscription

3. **Per-tenant overrides** - Tenant-specific module access

### Communication Between Modules

Modules **never import each other**. They communicate via events:

```javascript
// Module A emits an event
eventBus.emitEvent('product.created', {
  tenantId,
  productId,
  name: 'New Product',
});

// Module B listens to the event
eventBus.registerListener('product.created', async (event) => {
  // React to product creation
}, 'moduleName');
```

## 🔐 Authentication & Authorization

### JWT Authentication

1. **Register a user:**
```bash
POST /auth/register
{
  "email": "user@example.com",
  "password": "secure_password",
  "first_name": "John",
  "last_name": "Doe"
}
```

2. **Login:**
```bash
POST /auth/login
{
  "email": "user@example.com",
  "password": "secure_password"
}
```

Returns `accessToken` and `refreshToken`.

3. **Use access token:**
```bash
Authorization: Bearer <accessToken>
```

### Multi-Tenant Context

Every request must include tenant context via:
- **Subdomain**: `acme.yourplatform.com`
- **Header**: `X-Tenant-ID: <tenant-uuid>`

## 💳 Subscription System

### Creating a Subscription Plan

```bash
POST /admin/plans
{
  "name": "Starter",
  "price_monthly": 29.99,
  "price_yearly": 299.99
}
```

### Adding Modules to a Plan

```bash
POST /admin/plans/:planId/modules
{
  "module_name": "products"
}
```

### Subscribing a Tenant

```bash
POST /subscriptions/subscribe
{
  "planId": "<plan-uuid>"
}
```

## 🗄️ Database Schema

### Tenant Isolation

All tenant-scoped tables include `tenant_id`:

```sql
CREATE TABLE products (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  name VARCHAR(255),
  -- ...
);
```

### No Cross-Module Foreign Keys

Modules reference other modules' data by ID only (no FK constraints):

```sql
-- ✅ Correct: No FK to products table
CREATE TABLE cart_items (
  product_id UUID NOT NULL, -- Reference only
  -- ...
);

-- ❌ Wrong: Would create cross-module coupling
-- FOREIGN KEY (product_id) REFERENCES products(id)
```

## 📊 Event System

### Event Naming Convention

Format: `module.action`

Examples:
- `product.created`
- `order.status_changed`
- `payment.success`
- `user.logged_in`

### Event Data Structure

```javascript
{
  name: 'product.created',
  data: {
    tenantId: '<uuid>',
    productId: '<uuid>',
    // ... event-specific data
  },
  timestamp: '2026-01-15T13:30:00Z'
}
```

## 🧪 Testing

```bash
# Run all tests
npm test

# Run integration tests
npm run test:integration

# Run event system tests
npm run test:events
```

## 🚢 Deployment

### Environment Variables

Key variables to set:
- `NODE_ENV=production`
- `JWT_ACCESS_SECRET` - Strong random string
- `JWT_REFRESH_SECRET` - Strong random string
- `DB_HOST`, `DB_USER`, `DB_PASSWORD`
- `REDIS_HOST`, `REDIS_PASSWORD`

### Production Checklist

- [ ] Set secure JWT secrets
- [ ] Configure SSL for database
- [ ] Enable Redis authentication
- [ ] Set up database backups
- [ ] Configure rate limiting
- [ ] Set up monitoring/logging
- [ ] Review CORS settings
- [ ] Enable Helmet security headers

## 🔧 API Reference

Base URL: `https://api.yourplatform.com`

### Core Endpoints

- `POST /tenants` - Create tenant
- `POST /auth/register` - Register user
- `POST /auth/login` - Login
- `GET /subscriptions/plans` - List plans
- `POST /subscriptions/subscribe` - Subscribe

### Module Endpoints

Products:
- `GET /products` - List products
- `POST /products` - Create product
- `GET /products/:id` - Get product
- `PATCH /products/:id` - Update product
- `DELETE /products/:id` - Delete product

Cart:
- `GET /cart` - Get cart
- `POST /cart/items` - Add item
- `DELETE /cart/items/:id` - Remove item

Orders:
- `GET /orders` - List orders
- `GET /orders/:id` - Get order
- `PATCH /orders/:id/status` - Update status

Payments:
- `POST /payments/process` - Process payment
- `POST /payments/webhooks/:provider` - Webhook handler

## 🏪Module Marketplace (Future)

The architecture supports a future module marketplace where:
- Third-party developers can create modules
- Modules are sandboxed and isolated
- Tenants can install/uninstall modules
- Module dependencies are tracked

## 🤝 Contributing

When creating new modules, follow these rules:

1. **Never import other modules** - Use events
2. **All tables must have `tenant_id`**
3. **No cross-module foreign keys**
4. **Handle bootstrap failures gracefully**
5. **Emit events for significant actions**
6. **Define permissions in `permissions.js`**
7. **Include database schema in `database/schema.sql`**

## 📄 License

MIT

## 🙋‍♂️ Support

- Documentation: `/docs`
- API Docs: `/api/docs`
- Health Check: `/health`
