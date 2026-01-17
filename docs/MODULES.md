# Module Reference

This document lists all available modules in the platform, their responsibilities, and key API endpoints.

## Core Modules

### 1. Auth (`platform/core/auth`)
Handles user authentication and session management.
- `POST /auth/register` - Register new user
- `POST /auth/login` - Login
- `POST /auth/refresh` - Refresh access token
- `POST /auth/logout` - Logout

### 2. Tenants (`platform/core/tenants`)
Manages tenant isolation and settings.
- `POST /tenants` - Create tenant
- `GET /tenants/check-subdomain` - Check availability
- `PATCH /tenants/:id` - Update settings

### 3. Subscriptions (`platform/core/subscriptions`)
Gates feature access based on plans.
- `GET /subscriptions/plans` - List available plans
- `POST /subscriptions/subscribe` - Subscribe to plan
- `GET /subscriptions/current` - Check status

### 4. Roles (`platform/core/roles`)
RBAC system for user permissions.
- `POST /roles` - Create role
- `POST /roles/assign` - Assign role to user

## Feature Modules

### 5. Products (`modules/products`)
Product catalog management.
- `GET /products` - List products
- `POST /products` - Create product
- `POST /products/categories` - Create category
- `GET /products/categories/all` - List categories

### 6. Cart (`modules/cart`)
Shopping cart functionality.
- `POST /cart/items` - Add item
- `PATCH /cart/items/:id` - Update quantity
- `DELETE /cart/items/:id` - Remove item
- `GET /cart` - View cart

### 7. Orders (`modules/orders`)
Order processing and management.
- `GET /orders` - List orders
- `GET /orders/:id` - View details

### 8. Checkout (`modules/checkout`)
Checkout orchestration.
- `POST /checkout/init` - Start checkout
- `POST /checkout/calculate` - Get totals (including shipping/taxes)

### 9. Shipping (`modules/shipping`)
Logistics and tracking.
- `GET /shipping/zones` - Manage shipping zones
- `POST /shipping/rates` - Manage rates
- **Tracking**: Automatically generates tracking numbers on order creation.

### 10. Marketing (`modules/marketing`)
Promotions and campaigns.
- `POST /marketing/campaigns` - Create email campaign
- `POST /marketing/coupons` - Create coupon
- `POST /marketing/coupons/validate` - Validate coupon code

### 11. Analytics (`modules/analytics`)
Data reporting and funnel tracking.
- `GET /analytics/dashboard` - View aggregated stats (Sales, Orders)
- `POST /analytics/collect` - Public endpoint to send raw events (e.g., Page Views)

## Module Interdependency
Modules are decoupled and communicate via the **Event Bus**.
- **Example**: `Orders` module listens to `payment.success` to create an order.
- **Example**: `Marketing` module listens to `user.registered` to send welcome emails.
