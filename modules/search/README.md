# Search Module

A powerful, extensible search module with advanced filtering, autocomplete, analytics, and SEO optimization.

## Features

- **Full-Text Search**: PostgreSQL tsvector-based search across products, categories, and pages
- **Advanced Filtering**: Faceted filters for price, category, attributes, and more
- **Autocomplete**: Real-time search suggestions
- **Search Analytics**: Track queries, clicks, and identify content gaps
- **Synonym Support**: Expand queries with custom synonyms
- **SEO Integration**: Automatic SEO metadata generation for search result pages
- **Event-Driven Indexing**: Automatically indexes content when created/updated

## Setup

1. **Run Migration**:
   ```bash
   # Run migrations using the migration script
   node database/migrate.js
   
   # Or run the search module migration directly
   psql -d saas_ecommerce -f migrations/027_search_module.sql
   ```

2. **Enable Module**:
   Add to `.env`:
   ```
   MODULE_SEARCH_ENABLED=true
   ```

3. **Index Content**:
   - Products are automatically indexed when created/updated (via events)
   - Categories can be indexed manually: `POST /search/index/category/:id`
   - Pages can be indexed manually: `POST /search/index/page/:id`

## Usage

### Basic Search
```bash
GET /search?q=laptop
```

### Search with Filters
```bash
GET /search?q=laptop&price_min=500&price_max=2000&category_id=abc-123
```

### Autocomplete
```bash
GET /search/autocomplete?q=lap
```

## Architecture

- **Module Isolation**: Does not import other modules
- **Event-Driven**: Listens to `product.created`, `product.updated`, etc.
- **Subscription-Gated**: All endpoints require subscription access
- **Multi-Tenant**: All data scoped by `tenant_id`
- **Extensible**: Designed for future Elasticsearch migration

## Future Enhancements

- Elasticsearch integration
- AI-powered semantic search
- Search personalization
- Voice search support
- Image search capabilities

See [docs/SEARCH_API.md](../../docs/SEARCH_API.md) for full API documentation.
