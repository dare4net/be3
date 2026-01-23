## Search widgets (Page Builder + Storefront)

This repo supports rendering Page Builder widgets on the storefront (`storefront-web`) via:

- `GET /page-builder/widgets?page=<page_type>`
- `storefront-web/components/widgets/WidgetRenderer.jsx`

This document describes the **search-targeted widgets** and how to use them to build a full `/search` page.

### Widget types added

- **`search_bar`**: query input + autocomplete suggestions
- **`search_filters`**: category/price/status/featured + product-attribute filters
- **`search_results`**: results grid + sorting + pagination

These widgets share state automatically on the `/search` page via `SearchProvider` (`storefront-web/components/providers/SearchContext.js`).

### Search page route

The storefront has a dedicated page at:

- `storefront-web/app/search/page.js`

It fetches `page=search` widgets from the backend, and falls back to defaults if none exist.

### Backend API used by the widgets

- `GET /search` (already exists): results + facets + seo
- `GET /search/autocomplete` (already exists)
- `GET /search/filter-schema` (added): provides categories + attribute definitions for building UI

### Default Search Page widgets (fallback)

If `GET /page-builder/widgets?page=search` returns no widgets, the storefront uses `DEFAULT_SEARCH_WIDGETS` from:

- `storefront-web/lib/default-content.js`

Equivalent Page Builder widgets you can create (example configs):

#### 1) Search Bar (`search_bar`)

```json
{
  "placeholder": "Search products…",
  "autocomplete": true,
  "autocomplete_limit": 8,
  "container": true
}
```

#### 2) Search Filters (`search_filters`)

```json
{
  "container": true,
  "showTitle": true
}
```

#### 3) Search Results (`search_results`)

```json
{
  "container": true,
  "showHeader": true,
  "columns": { "desktop": 4, "tablet": 2, "mobile": 1 }
}
```

### How to add these widgets in Page Builder

Create 3 widgets in `page_widgets` with:

- `page_type`: `search`
- `widget_type`: one of `search_bar`, `search_filters`, `search_results`
- `config`: one of the JSON configs above

You can do this via your admin dashboard Page Builder UI (or by calling `POST /page-builder/widgets` as an admin).

