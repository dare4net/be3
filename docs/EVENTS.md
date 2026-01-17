# Event Schema Documentation

## Overview

All inter-module communication happens through the global Event Bus. This document defines all events emitted and consumed by modules.

## Event Format

```javascript
{
  name: 'module.action',
  data: {
    tenantId: '<uuid>',
    // ... event-specific fields
  },
  timestamp: 'ISO 8601 timestamp'
}
```

## Core Platform Events

### Authentication Module

#### `user.registered`
Emitted when a new user registers.
```javascript
{
  tenantId: UUID,
  userId: UUID,
  email: string,
  emailVerificationToken: string
}
```

#### `user.logged_in`
Emitted when user successfully logs in.
```javascript
{
  tenantId: UUID,
  userId: UUID,
  email: string
}
```

#### `user.logged_out`
Emitted when user logs out.
```javascript
{
  tenantId: UUID,
  userId: UUID
}
```

#### `password.reset_requested`
Emitted when user requests password reset.
```javascript
{
  tenantId: UUID,
  userId: UUID,
  email: string,
  resetToken: string
}
```

#### `password.reset_completed`
Emitted when password is successfully reset.
```javascript
{
  tenantId: UUID,
  userId: UUID
}
```

#### `email.verified`
Emitted when user verifies their email.
```javascript
{
  tenantId: UUID,
  userId: UUID,
  email: string
}
```

### Tenants Module

#### `tenant.created`
Emitted when new tenant is created.
```javascript
{
  tenantId: UUID,
  name: string,
  subdomain: string
}
```

#### `tenant.updated`
Emitted when tenant is updated.
```javascript
{
  tenantId: UUID,
  updates: object
}
```

#### `tenant.settings_updated`
Emitted when tenant settings change.
```javascript
{
  tenantId: UUID,
  settings: object
}
```

#### `tenant.deleted`
Emitted when tenant is deleted.
```javascript
{
  tenantId: UUID
}
```

### Subscriptions Module

#### `subscription.created`
Emitted when tenant subscribes to a plan.
```javascript
{
  tenantId: UUID,
  planId: UUID
}
```

#### `subscription.cancelled`
Emitted when subscription is cancelled.
```javascript
{
  tenantId: UUID
}
```

## Feature Module Events

### Products Module

#### `product.created`
Emitted when new product is created.
```javascript
{
  tenantId: UUID,
  productId: UUID,
  name: string
}
```

#### `product.updated`
Emitted when product is updated.
```javascript
{
  tenantId: UUID,
  productId: UUID
}
```

#### `product.deleted`
Emitted when product is deleted.
```javascript
{
  tenantId: UUID,
  productId: UUID
}
```

### Cart Module

#### `cart.item_added`
Emitted when item is added to cart.
```javascript
{
  tenantId: UUID,
  cartId: UUID,
  productId: UUID
}
```

#### `cart.updated`
Emitted when cart is modified.
```javascript
{
  tenantId: UUID,
  cartId: UUID
}
```

#### `cart.abandoned`
Emitted when cart is abandoned (no activity for X hours).
```javascript
{
  tenantId: UUID,
  cartId: UUID,
  userId: UUID | null
}
```

### Checkout Module

#### `checkout.initialized`
Emitted when checkout process starts.
```javascript
{
  tenantId: UUID,
  userId: UUID,
  cartId: UUID
}
```

#### `checkout.completed`
Emitted when checkout is ready for payment.
```javascript
{
  tenantId: UUID,
  checkoutId: UUID,
  total: decimal
}
```

### Payments Module

#### `payment.initiated`
Emitted when payment process starts.
```javascript
{
  tenantId: UUID,
  paymentId: UUID,
  amount: decimal,
  provider: string
}
```

#### `payment.success`
Emitted when payment succeeds.
```javascript
{
  tenantId: UUID,
  paymentId: UUID,
  cartId: UUID,
  paymentData: {
    userId: UUID | null,
    subtotal: decimal,
    total: decimal,
    email: string
  }
}
```

#### `payment.failed`
Emitted when payment fails.
```javascript
{
  tenantId: UUID,
  paymentId: UUID,
  error: string
}
```

### Orders Module

#### `order.created`
Emitted when order is created (usually after payment success).
```javascript
{
  tenantId: UUID,
  orderId: UUID,
  orderNumber: string
}
```

#### `order.status_changed`
Emitted when order status changes.
```javascript
{
  tenantId: UUID,
  orderId: UUID,
  status: string
}
```

#### `order.refunded`
Emitted when order is refunded.
```javascript
{
  tenantId: UUID,
  orderId: UUID,
  refundAmount: decimal
}
```

### Shipping Module

#### `shipping.shipment_created`
Emitted when a shipment is created for an order.
```javascript
{
  tenantId: UUID,
  orderId: UUID,
  trackingNumber: string,
  courier: string
}
```

### Marketing Module

#### `marketing.campaign_sent`
Emitted when an email campaign is sent.
```javascript
{
  tenantId: UUID,
  campaignId: UUID
}
```

#### `marketing.coupon_applied`
Emitted when a coupon is successfully applied to a cart.
```javascript
{
  tenantId: UUID,
  code: string,
  discountValue: decimal
}
```

### Analytics Module

#### `analytics.page_viewed`
Emitted when a page view is tracked via the collection endpoint.
```javascript
{
  tenantId: UUID,
  eventType: 'PAGE_VIEWED',
  metadata: {
    url: string,
    referrer: string,
    // ...other metadata
  }
}
```

#### `analytics.add_to_cart`
Emitted when an item is added to cart (tracked via collection endpoint).
```javascript
{
  tenantId: UUID,
  eventType: 'ADD_TO_CART',
  metadata: {
    productId: UUID,
    price: decimal
  }
}
```

## Event Flow Examples

### Complete Purchase Flow

```
1. user.logged_in
2. product.created (if new product)
3. cart.item_added
4. checkout.initialized
5. checkout.completed
6. payment.initiated
7. payment.success
8. order.created
9. order.status_changed (pending -> paid)
```

### Abandoned Cart Recovery

```
1. cart.item_added
2. [No activity for 24 hours]
3. cart.abandoned
4. [Marketing module] Send recovery email
```

### Product Deletion Cascade

```
1. product.deleted
2. [Cart module] Remove from all carts
3. [Analytics module] Update metrics
```

## Best Practices

1. **Always include `tenantId`** - For multi-tenant isolation
2. **Use past tense** - Events describe what happened
3. **Keep data minimal** - Only include necessary fields
4. **Don't throw errors** - Event listeners should fail gracefully
5. **Log all events** - Events are automatically logged to `event_logs` table
6. **Use wildcards sparingly** - Listen to specific events when possible

## Debugging Events

### View recent events

```javascript
const eventBus = require('./platform/events/EventBus');
const recent = eventBus.getRecentEvents(50);
console.log(recent);
```

### Listen to all events

```javascript
eventBus.on('*', (event) => {
  console.log(`[Event] ${event.name}`, event.data);
});
```

### Query event logs

```sql
SELECT * FROM event_logs 
WHERE tenant_id = '<uuid>' 
AND event_name = 'product.created'
ORDER BY created_at DESC
LIMIT 50;
```
