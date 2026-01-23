# Search Module API Documentation

## Overview

The Search Module provides powerful, extensible search capabilities across products, categories, and pages with advanced filtering, autocomplete, analytics, and SEO optimization.

## Base URL

All endpoints are prefixed with `/search`

## Authentication

- **Public Endpoints**: Require subscription access (gated by `subscriptionGuard`)
- **Admin Endpoints**: Require authentication (`Authorization: Bearer <token>`) and appropriate permissions

## Public Endpoints

### Search

**GET /search**

Perform a search query with optional filters.

**Query Parameters:**
- `q` (string, optional) - Search query
- `type` (string, optional) - Content types to search (comma-separated: `product,category,page`)
- `page` (number, default: 1) - Page number
- `per_page` (number, default: 20) - Results per page
- `sort` (string, default: `relevance`) - Sort order:
  - `relevance` - Sort by relevance (default)
  - `price_asc` - Sort by price (low to high)
  - `price_desc` - Sort by price (high to low)
  - `date_desc` - Sort by date (newest first)
  - `date_asc` - Sort by date (oldest first)
- `price_min` (number, optional) - Minimum price filter
- `price_max` (number, optional) - Maximum price filter
- `category_id` (string, optional) - Filter by category ID
- `category_ids` (string, optional) - Filter by multiple category IDs (comma-separated)
- `status` (string, optional) - Filter by status (e.g., `active`, `draft`)
- `is_featured` (boolean, optional) - Filter featured items
- `attribute.<key>` (string, optional) - Filter by product attribute (e.g., `attribute.color=red`)

**Example Request:**
```bash
GET /search?q=laptop&price_min=500&price_max=2000&category_id=abc-123&per_page=20&sort=price_asc
```

**Response:**
```json
{
  "success": true,
  "query": "laptop",
  "results": [
    {
      "id": "uuid",
      "content_type": "product",
      "content_id": "product-uuid",
      "title": "Laptop Pro 15",
      "content": "High-performance laptop...",
      "keywords": ["laptop", "computer", "electronics"],
      "metadata": {
        "price": 1299.99,
        "category_ids": ["abc-123"],
        "status": "active"
      },
      "rank": 0.95
    }
  ],
  "facets": {
    "price": {
      "min": 500,
      "max": 2000
    },
    "categories": {
      "abc-123": 15
    },
    "statuses": {
      "active": 20
    }
  },
  "pagination": {
    "page": 1,
    "perPage": 20,
    "total": 45,
    "totalPages": 3
  },
  "seo": {
    "title": "Search Results for \"laptop\"",
    "meta_description": "Found 45 results for \"laptop\"",
    "canonical_url": "/search?q=laptop&price_min=500&price_max=2000",
    "structured_data": {
      "@context": "https://schema.org",
      "@type": "ItemList",
      "numberOfItems": 45,
      "itemListElement": [...]
    }
  }
}
```

### Autocomplete

**GET /search/autocomplete**

Get search suggestions as user types.

**Query Parameters:**
- `q` (string, required) - Partial search query (minimum 2 characters)
- `limit` (number, default: 10) - Maximum number of suggestions

**Example Request:**
```bash
GET /search/autocomplete?q=lap&limit=5
```

**Response:**
```json
{
  "success": true,
  "suggestions": [
    {
      "text": "Laptop Pro 15",
      "type": "content",
      "content_type": "product",
      "content_id": "uuid"
    },
    {
      "text": "laptop bag",
      "type": "query"
    }
  ]
}
```

### Get Available Filters

**GET /search/filters**

Get available filters for the current search context.

**Query Parameters:**
- `q` (string, optional) - Search query (affects available filter counts)

**Response:**
```json
{
  "success": true,
  "filters": [
    {
      "id": "uuid",
      "filter_key": "price",
      "filter_type": "range",
      "label": "Price Range",
      "config": {
        "min": 0,
        "max": 5000
      }
    }
  ]
}
```

### Get Search Suggestions

**GET /search/suggestions**

Get popular or trending search queries.

**Query Parameters:**
- `type` (string, default: `popular`) - Type of suggestions:
  - `popular` - Most popular searches (last 30 days)
  - `trending` - Trending searches (last 7 days)
- `limit` (number, default: 10) - Maximum number of suggestions

**Response:**
```json
{
  "success": true,
  "suggestions": [
    {
      "query": "laptop",
      "count": 150,
      "avg_results": 45
    }
  ]
}
```

## Admin Endpoints

### Rebuild Search Index

**POST /search/index/rebuild**

Rebuild the entire search index for the tenant. This is an async operation.

**Authentication:** Required (`search.index` permission)

**Response:**
```json
{
  "success": true,
  "message": "Index rebuild started. This may take a few minutes."
}
```

### Manual Indexing

**POST /search/index/product/:productId**

Manually index a specific product.

**POST /search/index/category/:categoryId**

Manually index a specific category.

**POST /search/index/page/:pageId**

Manually index a specific page.

**Authentication:** Required (`search.index` permission)

### Synonym Management

**GET /search/synonyms**

List all search synonyms for the tenant.

**POST /search/synonyms**

Create a new synonym.

**Request Body:**
```json
{
  "term": "laptop",
  "synonyms": ["notebook", "computer"],
  "is_active": true
}
```

**PUT /search/synonyms/:id**

Update a synonym.

**DELETE /search/synonyms/:id**

Delete a synonym.

**Authentication:** Required (`search.manage` permission)

### Analytics

**GET /search/analytics**

Get search analytics data.

**Query Parameters:**
- `start_date` (ISO date, optional) - Start date for analytics
- `end_date` (ISO date, optional) - End date for analytics
- `group_by` (string, default: `day`) - Grouping:
  - `hour` - Group by hour
  - `day` - Group by day
  - `week` - Group by week
  - `month` - Group by month
- `type` (string, default: `summary`) - Analytics type:
  - `summary` - Time-series summary
  - `popular` - Popular queries
  - `no_results` - Queries with no results

**Response (summary):**
```json
{
  "success": true,
  "data": [
    {
      "period": "2024-01-15",
      "total_searches": 150,
      "unique_queries": 45,
      "unique_sessions": 120,
      "avg_results": 25.5,
      "no_result_searches": 5,
      "clicks": 80
    }
  ]
}
```

**POST /search/analytics/click**

Track a click on a search result.

**Request Body:**
```json
{
  "query": "laptop",
  "content_id": "product-uuid",
  "content_type": "product"
}
```

### Filter Management

**GET /search/filters/admin**

List all configured filters (admin view).

**POST /search/filters**

Create a filter configuration.

**Request Body:**
```json
{
  "filter_key": "price",
  "filter_type": "range",
  "label": "Price Range",
  "config": {
    "min": 0,
    "max": 5000
  },
  "sort_order": 0
}
```

**PUT /search/filters/:id**

Update a filter configuration.

**DELETE /search/filters/:id**

Delete a filter configuration.

**Authentication:** Required (`search.manage` permission)

## SEO Integration

Search result pages automatically include:

1. **Meta Tags**: Title, description, Open Graph, Twitter Card
2. **Canonical URLs**: Prevents duplicate content issues
3. **Structured Data**: Schema.org ItemList for rich snippets
4. **Robots Meta**: Proper indexing directives

The SEO metadata is included in the `seo` field of search responses.

## Event-Driven Indexing

The search module automatically indexes content when events are emitted:

- `product.created` → Indexes product
- `product.updated` → Re-indexes product
- `product.deleted` → Removes from index
- `category.created` → Indexes category (when implemented)
- `category.updated` → Re-indexes category (when implemented)
- `category.deleted` → Removes from index (when implemented)

## Best Practices

1. **Index Content**: Ensure products/categories are indexed before searching
2. **Use Filters**: Leverage faceted filters for better UX
3. **Track Analytics**: Monitor search queries to identify content gaps
4. **Configure Synonyms**: Add synonyms for better search recall
5. **SEO Optimization**: Use canonical URLs and structured data

## Error Responses

All endpoints return standard error format:

```json
{
  "error": "ErrorType",
  "message": "Human-readable error message"
}
```

Common errors:
- `403` - Module not included in subscription plan
- `401` - Authentication required
- `400` - Invalid request parameters
- `404` - Resource not found
