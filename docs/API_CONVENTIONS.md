# API Design Conventions

## Base URL

- Development: `http://localhost:3000`
- Production: `https://api.yourplatform.com`

## Authentication

### Access Token

Include in Authorization header:
```
Authorization: Bearer <access_token>
```

### Tenant Identification

**Required for all tenant-scoped requests.**

Method 1: Subdomain
```
https://acme.yourplatform.com/products
```

Method 2: Header
```
X-Tenant-ID: <tenant-uuid>
```

## Response Format

### Success Response

```json
{
  "success": true,
  "data": { ... },
  "message": "Optional success message"
}
```

### Error Response

```json
{
  "error": "ErrorType",
  "message": "Human-readable error message",
  "details": { ... } // Optional validation errors
}
```

## HTTP Status Codes

- `200` - Success
- `201` - Created
- `400` - Bad Request (validation error)
- `401` - Unauthorized (authentication required)
- `403` - Forbidden (insufficient permissions or module not in plan)
- `404` - Not Found
- `429` - Too Many Requests (rate limited)
- `500` - Internal Server Error

## Module Access Errors

When tenant doesn't have access to a module:

```json
{
  "error": "Module not included in plan",
  "message": "Your Starter plan does not include the analytics module",
  "requiredModule": "analytics",
  "currentPlan": "Starter",
  "upgradeUrl": "/subscriptions/plans"
}
```

## Pagination

Use query parameters:
- `page` - Page number (1-indexed)
- `per_page` - Items per page (default: 20, max: 100)

Response includes pagination metadata:
```json
{
  "success": true,
  "data": [...],
  "pagination": {
    "page": 1,
    "perPage": 20,
    "total": 150,
    "totalPages": 8
  }
}
```

## Rate Limiting

- Default: 100 requests per 15 minutes per tenant
- Sensitive endpoints (auth, payments): 10 requests per 15 minutes

Rate limit headers:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1642612800
```

## Tenant Isolation

**CRITICAL**: All API endpoints (except `/auth/register`, `/tenants`, `/health`) require tenant context. Missing tenant context returns:

```json
{
  "error": "Tenant identification failed",
  "message": "Please provide X-Tenant-ID header or use tenant subdomain"
}
```

## Endpoint Naming

- Use plural nouns: `/products`, `/orders`
- Use kebab-case for multi-word: `/subscription-plans`
- Nested resources: `/products/:id/variants`
- Actions as verbs: `/cart/items`, `/orders/:id/refund`

## Standard CRUD Operations

### List Resources
```
GET /resource
Query: ?page=1&per_page=20&sort=created_at&order=desc
```

### Get Resource
```
GET /resource/:id
```

### Create Resource
```
POST /resource
Body: { ...resourceData }
```

### Update Resource
```
PATCH /resource/:id
Body: { ...updates }
```

### Delete Resource
```
DELETE /resource/:id
```

## Filtering

Use query parameters:
```
GET /products?status=active&min_price=10&max_price=100
```

## Sorting

```
GET /products?sort=price&order=asc
```

## Field Selection (Future)

```
GET /products?fields=id,name,price
```

## API Versioning (Future)

Will use URL versioning:
```
GET /v1/products
GET /v2/products
```

## Webhooks (Future)

Modules can register webhooks for events:
```json
{
  "url": "https://your-app.com/webhooks",
  "events": ["order.created", "payment.success"],
  "secret": "webhook_secret"
}
```

## Idempotency (Future)

Use `Idempotency-Key` header for safe retries:
```
Idempotency-Key: <unique-key>
```
