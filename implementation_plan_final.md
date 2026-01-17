# Implementation Plan - Final Modules

## Goal
Implement the final three feature modules: **Shipping**, **Marketing**, and **Analytics**. These modules will further demonstrate the event-driven architecture and multi-tenant isolation.

## User Review Required
> [!IMPORTANT]
> These modules will largely depend on listening to events from other modules (`orders`, `cart`, `products`). Ensure the EventBus is working reliably (verified in previous steps).

## Proposed Changes

### 1. Shipping Module (`modules/shipping/`)
Logic for calculating shipping rates and managing shipments.

#### [NEW] Database Schema (`modules/shipping/database/schema.sql`)
- **shipping_zones**: Defines regions (e.g., "US", "EU").
- **shipping_rates**: Defines rates per zone (e.g., Flat Rate $5, Free > $50).
- **shipments**: Tracks shipment status for specific orders.

#### [NEW] Implementation (`modules/shipping/index.js`)
- **Routes**:
    - `GET /shipping/zones`
    - `POST /shipping/calculate` (Public/Auth) - Used by checkout to get cost.
- **Events**:
    - Listen to `order.created` -> Create a pending shipment record.

### 2. Marketing Module (`modules/marketing/`)
Logic for discounts and simple email campaigns.

#### [NEW] Database Schema (`modules/marketing/database/schema.sql`)
- **coupons** (if not already in cart, but cart had logic. We'll move/centralize or add campaigns here). Let's focus on **Campaigns**.
- **campaigns**: Email blasts (Subject, Body, Status).
- **campaign_logs**: Who got the email.

#### [NEW] Implementation (`modules/marketing/index.js`)
- **Routes**:
    - `POST /marketing/campaigns`
    - `POST /marketing/campaigns/:id/send`
- **Events**:
    - Listen to `user.registered` -> Send "Welcome" email (simulated log).
    - Listen to `cart.updated` -> Log "abandoned cart" potential (simulated).

### 3. Analytics Module (`modules/analytics/`)
Aggregated data for tenant dashboards.

#### [NEW] Database Schema (`modules/analytics/database/schema.sql`)
- **daily_stats**: Aggregated metrics (date, total_sales, order_count, new_customers).

#### [NEW] Implementation (`modules/analytics/index.js`)
- **Routes**:
    - `GET /analytics/dashboard` - Returns aggregated stats.
- **Events**:
    - Listen to `order.created` -> Increment daily sales & order count.
    - Listen to `user.registered` -> Increment new customer count.
    - Listen to `product.created` -> Track catalog growth.

## Verification Plan

### Automated
- Create a test script `test-modules-final.js` that:
    1. Creates a shipping zone/rate.
    2. Calculates shipping for a cart.
    3. Simulates an order (triggering analytics update).
    4. Simulates a user registration (triggering marketing welcome log).
    5. Fetches analytics dashboard to verify aggregation.
