# Widget Randomization Feature - Implementation Plan

## Overview
Add built-in randomization capabilities to Product Grid/Carousel and Category Grid/Carousel widgets. Randomization will traverse all available options for sources, sorts, and other configurable parameters.

## Current State Analysis

### RandomizerWidget
- **Purpose**: Randomly shows/hides child widgets (does NOT randomize configs)
- **Location**: `storefront-web/components/widgets/primitive/RandomizerWidget.jsx`
- **Not relevant** for config randomization

### Product Widgets (Grid & Carousel)
**Source Types:**
1. `'all'` - All products (no additional config needed)
2. `'category'` - Requires `categoryId` (UUID)
3. `'collection'` - Requires `collectionId` (UUID) OR `collectionSlug` (string)
4. `'clause'` - Requires `attributeClause` (format: `"attribute_code:clause_name"`)

**Sort Options:**
- `'newest'`, `'oldest'`, `'price_asc'`, `'price_desc'`, `'name_asc'`, `'name_desc'`, `'random'`

**Other Configurable Options:**
- `limit` (number, default: 8)
- `showFeaturedOnly` (boolean)
- `columns` (responsive object)
- Display toggles (showPrice, showAddToCart, etc.)

### Category Widgets (Grid & Carousel)
**Source Types:**
1. `'top-level'` - Only top-level categories (no parent)
2. `'subcategories'` - Requires `parentCategoryId`
3. `'all-subcategories'` - All categories with a parent
4. `'random'` - Random selection (already implemented!)
5. `'manual'` - Requires `manualCategoryIds` array

**Sort Options:**
- `'alphabetical'`, `'random'`, `'manual'`

## Data Fetching Requirements

### For Product Widgets Randomization:

#### 1. Categories
- **Endpoint**: `/api/categories` ✅ EXISTS
- **Location**: `storefront-web/app/api/categories/route.js`
- **Proxies to**: `/products/categories` (backend, public)
- **Returns**: `{ success: true, categories: [{ id, name, slug, parent_id, ... }] }`
- **Usage**: Already used by `CategoryGridWidget` and `CategoryCarouselWidget`
- **Filter**: Backend already filters active categories

#### 2. Collections
- **Backend**: `/products/collections` ✅ EXISTS (public, no auth required)
- **Location**: `modules/products/index.js` line 628
- **Returns**: `{ success: true, collections: [{ id, name, slug, image_url }] }`
- **Status**: Public endpoint, can be called directly with `proxyApi` from widgets
- **Note**: No proxy route needed, widgets can call backend directly via `proxyApi.get('/products/collections')` with tenant header

#### 3. Attributes + Clauses
- **Endpoint**: `/search/filter-schema` ✅ EXISTS (public)
- **Location**: `modules/search/index.js` line 201
- **Returns**: `{ success: true, categories: [...], attributes: [{ id, code, label, type, options, clauses: [...] }] }`
- **Usage**: Already used by `SearchFiltersWidget` via `SearchContext`
- **Clauses**: Each attribute has `clauses` array with `{ name, label, value, operator, prefix, suffix, ... }`
- **Filter**: Can filter attributes with clauses client-side

### For Category Widgets Randomization:
- Categories already fetched via `/api/categories`
- Can randomize `sourceType` among: `'top-level'`, `'all-subcategories'`, `'random'`
- If `'subcategories'` selected, need to pick random `parentCategoryId`

## Proposed Config Structure

```javascript
{
  // Existing config (these remain as FIXED defaults when randomization is disabled)
  sourceType: 'all',
  categoryId: null,
  collectionId: null,
  attributeClause: null,
  sort: 'newest',
  limit: 8,
  showFeaturedOnly: false,
  
  // NEW: Randomization Config (OPTIONAL - completely separate feature)
  randomize: {
    enabled: false, // Master toggle - when false, all existing config values are used as-is
    
    // When enabled, controls how often randomization happens
    interval: 'session', // 'page_load' | 'session' | 'daily' | 'hourly'
    
    // GRANULAR CONTROL: What to randomize vs what stays rigid
    // Each aspect can be independently enabled/disabled
    
    // Source Randomization (OPTIONAL)
    randomizeSource: false, // When true, randomizes sourceType + related IDs
    allowedSourceTypes: ['all', 'category', 'collection', 'clause'], // Which source types to randomize between
    allowedCategories: [], // Empty = all categories, or specific IDs to limit pool
    allowedCollections: [], // Empty = all collections, or specific IDs to limit pool
    allowedAttributes: [], // Empty = all attributes with clauses, or specific codes to limit pool
    
    // Sort Randomization (OPTIONAL)
    randomizeSort: false, // When true, overrides fixed 'sort' value
    allowedSorts: ['newest', 'oldest', 'price_asc', 'price_desc', 'name_asc', 'name_desc', 'random'],
    
    // Limit Randomization (OPTIONAL)
    randomizeLimit: false, // When true, overrides fixed 'limit' value
    limitRange: { min: 4, max: 12 }, // Random limit within range
    
    // Featured Filter Randomization (OPTIONAL)
    randomizeFeatured: false, // When true, randomly toggles showFeaturedOnly
    
    // Category Widgets Only (OPTIONAL)
    randomizeCategorySource: false, // When true, randomizes category sourceType
    allowedCategorySourceTypes: ['top-level', 'all-subcategories', 'random'],
  }
}
```

### Key Principles:
1. **Randomization is OPTIONAL** - Widget works normally when `randomize.enabled === false`
2. **Granular Control** - Each aspect (source, sort, limit, featured) can be independently randomized or kept rigid
3. **Fixed Values as Fallback** - When a specific aspect is NOT randomized, the widget uses the fixed config value
4. **Example Scenarios**:
   - Randomize source only: `randomizeSource: true`, `randomizeSort: false` → source changes, sort stays as `config.sort`
   - Randomize sort only: `randomizeSource: false`, `randomizeSort: true` → sort changes, source stays as `config.sourceType`
   - Randomize everything: All `randomize*` flags set to `true`
   - Keep everything rigid: `enabled: false` or all `randomize*` flags set to `false`

## Implementation Steps

### Phase 1: Data Fetching Infrastructure

#### Step 1.1: Verify Existing APIs ✅
- [x] `/api/categories` exists - `storefront-web/app/api/categories/route.js`
- [x] `/products/collections` exists (public backend endpoint)
- [x] `/search/filter-schema` exists (returns categories + attributes with clauses)

#### Step 1.2: Create Randomization Data Hook
- [ ] Create `storefront-web/lib/hooks/useRandomizationData.js`
- [ ] Hook fetches (using existing patterns):
  - **Categories**: `proxyApi.get('/api/categories')` → returns `{ success: true, categories: [...] }`
    - Already used by: `CategoryGridWidget`, `CategoryCarouselWidget`
  - **Collections**: `proxyApi.get('/products/collections', { headers: { 'X-Tenant-ID': tenantId } })` → returns `{ success: true, collections: [...] }`
    - Backend endpoint is public (no auth required)
    - Get tenantId from `useTenant()` hook (already used in widgets)
  - **Attributes**: `proxyApi.get('/search/filter-schema', { headers: { 'X-Tenant-ID': tenantId } })` → returns `{ success: true, categories: [...], attributes: [{ id, code, label, type, options, clauses: [...] }] }`
    - Already used by: `SearchFiltersWidget` via `SearchContext`
    - Returns attributes WITH clauses array
- [ ] Cache data in React state (useState) or sessionStorage (once per session)
- [ ] Filter attributes client-side to only those with `clauses.length > 0`
- [ ] Returns structured data: `{ categories: [], collections: [], attributes: [] }`
- [ ] Handle loading/error states

### Phase 2: Randomization Logic

#### Step 2.1: Create Randomization Utility
- [ ] Create `storefront-web/lib/utils/widgetRandomizer.js`
- [ ] Functions:
  - `randomizeProductSource(config, data)` - Returns randomized source config
  - `randomizeCategorySource(config, data)` - Returns randomized category source config
  - `randomizeSort(allowedSorts)` - Returns random sort
  - `randomizeLimit(range)` - Returns random limit
  - `shouldRandomize(config, interval)` - Checks if should randomize based on interval

#### Step 2.2: Randomization Flow
```javascript
// Pseudo-code
function applyRandomization(config, data) {
  // If randomization is disabled, return config as-is (use all fixed values)
  if (!config.randomize?.enabled) return config;
  
  const newConfig = { ...config }; // Start with fixed values
  
  // Check interval - if we have a cached selection within interval, use it
  const cached = getCachedRandomSelection(config.id, config.randomize.interval);
  if (cached && !shouldRandomize(config.randomize, config.randomize.interval)) {
    return { ...newConfig, ...cached.selection }; // Merge cached random values
  }
  
  // GRANULAR RANDOMIZATION: Only randomize aspects that are enabled
  // Each aspect is independent - if not randomized, keep the fixed value from config
  
  // Randomize source (ONLY if enabled)
  if (config.randomize.randomizeSource) {
    const sourceType = pickRandom(config.randomize.allowedSourceTypes);
    newConfig.sourceType = sourceType;
    
    // Clear previous source-specific values
    newConfig.categoryId = null;
    newConfig.collectionId = null;
    newConfig.collectionSlug = null;
    newConfig.attributeClause = null;
    
    switch (sourceType) {
      case 'category':
        newConfig.categoryId = pickRandomCategory(data.categories, config.randomize.allowedCategories);
        break;
      case 'collection':
        const collection = pickRandomCollection(data.collections, config.randomize.allowedCollections);
        newConfig.collectionId = collection?.id || null;
        newConfig.collectionSlug = collection?.slug || null;
        break;
      case 'clause':
        const { attribute, clause } = pickRandomAttributeClause(data.attributes, config.randomize.allowedAttributes);
        newConfig.attributeClause = `${attribute.code}:${clause.name}`;
        break;
      case 'all':
        // No additional config needed
        break;
    }
  }
  // ELSE: Keep fixed config.sourceType, config.categoryId, etc.
  
  // Randomize sort (ONLY if enabled)
  if (config.randomize.randomizeSort) {
    newConfig.sort = pickRandom(config.randomize.allowedSorts);
  }
  // ELSE: Keep fixed config.sort
  
  // Randomize limit (ONLY if enabled)
  if (config.randomize.randomizeLimit) {
    const { min, max } = config.randomize.limitRange;
    newConfig.limit = Math.floor(Math.random() * (max - min + 1)) + min;
  }
  // ELSE: Keep fixed config.limit
  
  // Randomize featured (ONLY if enabled)
  if (config.randomize.randomizeFeatured) {
    newConfig.showFeaturedOnly = Math.random() > 0.5;
  }
  // ELSE: Keep fixed config.showFeaturedOnly
  
  // Store selection for interval-based caching (only store randomized values)
  const randomizedValues = {
    ...(config.randomize.randomizeSource && { sourceType: newConfig.sourceType, categoryId: newConfig.categoryId, collectionId: newConfig.collectionId, collectionSlug: newConfig.collectionSlug, attributeClause: newConfig.attributeClause }),
    ...(config.randomize.randomizeSort && { sort: newConfig.sort }),
    ...(config.randomize.randomizeLimit && { limit: newConfig.limit }),
    ...(config.randomize.randomizeFeatured && { showFeaturedOnly: newConfig.showFeaturedOnly }),
  };
  storeRandomSelection(config.id, randomizedValues, config.randomize.interval);
  
  return newConfig;
}
```

### Phase 3: Widget Integration

#### Step 3.1: ProductGridWidget
- [ ] Import `useRandomizationData` hook
- [ ] Import randomization utilities
- [ ] In `useEffect`, apply randomization before `fetchProducts`
- [ ] Use randomized config for all API calls
- [ ] Handle loading state while fetching randomization data

#### Step 3.2: ProductCarouselWidget
- [ ] Same as ProductGridWidget

#### Step 3.3: CategoryGridWidget
- [ ] Import `useRandomizationData` hook
- [ ] Apply category-specific randomization
- [ ] Handle `sourceType` randomization

#### Step 3.4: CategoryCarouselWidget
- [ ] Same as CategoryGridWidget

### Phase 4: Admin UI

#### Step 4.1: Add Randomization Section to Builder
- [ ] Add **separate collapsible "Randomization" section** in `admin-dashboard-web/app/dashboard/storefront/builder/page.js`
- [ ] **Master Toggle**: "Enable Randomization" (controls `randomize.enabled`)
- [ ] **When enabled, show**:
  - Select: "Randomization Interval" (page_load, session, daily, hourly)
  - **Subsection: "What to Randomize"** (granular toggles):
    - ☐ Randomize Source (`randomizeSource`)
    - ☐ Randomize Sort (`randomizeSort`)
    - ☐ Randomize Limit (`randomizeLimit`)
    - ☐ Randomize Featured Filter (`randomizeFeatured`)
    - ☐ Randomize Category Source Type (`randomizeCategorySource` - category widgets only)
  
  - **Subsection: "Source Randomization Options"** (shown when `randomizeSource` is enabled):
    - Multi-select: "Allowed Source Types" (all, category, collection, clause)
    - Multi-select: "Allowed Categories" (optional - empty = all, or select specific ones)
    - Multi-select: "Allowed Collections" (optional - empty = all, or select specific ones)
    - Multi-select: "Allowed Attributes" (optional - empty = all with clauses, or select specific ones)
  
  - **Subsection: "Sort Randomization Options"** (shown when `randomizeSort` is enabled):
    - Multi-select: "Allowed Sort Orders" (newest, oldest, price_asc, price_desc, name_asc, name_desc, random)
  
  - **Subsection: "Limit Randomization Options"** (shown when `randomizeLimit` is enabled):
    - Range input: "Limit Range" (min/max sliders or number inputs)
  
  - **Subsection: "Category Source Randomization"** (category widgets only, shown when `randomizeCategorySource` is enabled):
    - Multi-select: "Allowed Source Types" (top-level, all-subcategories, random)

#### Step 4.2: UI/UX Notes
- [ ] **Visual Hierarchy**: Master toggle at top, subsections nested below with clear labels
- [ ] **Conditional Display**: Only show relevant subsections when their parent toggle is enabled
- [ ] **Help Text**: Add tooltips explaining:
  - "When disabled, widget uses fixed config values"
  - "Each aspect can be randomized independently"
  - "Empty allowed lists = use all available options"
- [ ] **Visual Indicators**: Show which aspects are randomized vs rigid (e.g., badges/icons)

#### Step 4.3: Validation
- [ ] Ensure at least one source type selected if `randomizeSource` enabled
- [ ] Ensure at least one sort selected if `randomizeSort` enabled
- [ ] Ensure `limitRange.min <= limitRange.max` if `randomizeLimit` enabled
- [ ] Ensure at least one category source type selected if `randomizeCategorySource` enabled (category widgets)

### Phase 5: Interval-Based Caching

#### Step 5.1: Session Storage
- [ ] Store random selections in `sessionStorage` with key: `widget_random_${widgetId}_${interval}`
- [ ] Include timestamp for interval checking
- [ ] Clear on interval expiry

#### Step 5.2: Interval Logic
```javascript
function shouldRandomize(config, interval) {
  const key = `widget_random_${config.id}_${interval}`;
  const stored = sessionStorage.getItem(key);
  
  if (!stored) return true;
  
  const { timestamp, selection } = JSON.parse(stored);
  const now = Date.now();
  
  switch (interval) {
    case 'page_load':
      return true; // Always randomize
    case 'session':
      return !stored; // Once per session
    case 'hourly':
      return (now - timestamp) > 3600000; // 1 hour
    case 'daily':
      return (now - timestamp) > 86400000; // 24 hours
    default:
      return true;
  }
}
```

## Edge Cases & Considerations

### 1. Empty Data Sets
- **Issue**: No categories/collections/attributes available
- **Solution**: Fallback to `'all'` source type, show warning in console

### 2. Attribute Clauses
- **Issue**: Attribute selected but has no clauses
- **Solution**: Skip that attribute, pick another, or fallback to different source type

### 3. Performance
- **Issue**: Fetching all data on every widget render
- **Solution**: Use `useRandomizationData` hook with caching, fetch once per session

### 4. SEO Concerns
- **Issue**: Random content changes on every page load
- **Solution**: 
  - Default to `'session'` interval (stable per user session)
  - Allow `'page_load'` only for authenticated/admin preview
  - Document SEO implications

### 5. Category Widgets - Subcategories
- **Issue**: `'subcategories'` requires `parentCategoryId`
- **Solution**: 
  - If randomizing to `'subcategories'`, pick random parent category
  - Ensure parent has subcategories before selecting

## Testing Checklist

- [ ] Randomization disabled → widget works normally
- [ ] Randomize source only → source changes, sort/limit stay same
- [ ] Randomize sort only → sort changes, source stays same
- [ ] Randomize all → everything randomizes
- [ ] Interval 'page_load' → changes every refresh
- [ ] Interval 'session' → same selection within session, changes on new session
- [ ] Empty allowedCategories → uses all categories
- [ ] Specific allowedCategories → only uses those
- [ ] Attribute with no clauses → skips or fallbacks
- [ ] No categories available → fallbacks to 'all'
- [ ] No collections available → fallbacks to 'all'
- [ ] Category widget: randomize sourceType → switches between top-level/subcategories

## Future Enhancements

1. **Weighted Randomization**: Assign weights to sources (e.g., show "featured" collection 3x more often)
2. **A/B Testing**: Track which random configs perform best
3. **Personalization**: Randomize based on user behavior/preferences
4. **Time-Based Rules**: Show different sources at different times of day
5. **Analytics**: Track which random combinations get most engagement

## Files to Modify/Create

### New Files:
- `storefront-web/lib/hooks/useRandomizationData.js`
- `storefront-web/lib/utils/widgetRandomizer.js`
- ~~`storefront-web/app/api/collections/route.js`~~ (NOT NEEDED - use backend directly)
- ~~`storefront-web/app/api/attributes/route.js`~~ (NOT NEEDED - use `/search/filter-schema`)

### Modified Files:
- `storefront-web/components/widgets/ProductGridWidget.jsx`
- `storefront-web/components/widgets/ProductCarouselWidget.jsx`
- `storefront-web/components/widgets/CategoryGridWidget.jsx`
- `storefront-web/components/widgets/CategoryCarouselWidget.jsx`
- `admin-dashboard-web/app/dashboard/storefront/builder/page.js`

## Questions to Resolve

1. ~~**Collections API**: Does `/api/collections` exist?~~ ✅ RESOLVED - Use `/products/collections` directly (public backend endpoint)
2. ~~**Attributes API**: Should `/api/attributes` be public?~~ ✅ RESOLVED - Use `/search/filter-schema` (already public, returns attributes with clauses)
3. **Performance**: Is fetching all categories/collections/attributes on widget mount acceptable, or should we lazy-load?
   - **Recommendation**: Fetch once per session, cache in hook state or sessionStorage
4. **SEO**: Should randomization be disabled by default for SEO reasons?
   - **Recommendation**: Default `enabled: false`, default interval `'session'` when enabled
5. ~~**Admin UX**: Should randomization config be in a separate collapsible section or inline with source config?~~
   - ✅ **RESOLVED**: Separate collapsible "Randomization" section with:
     - Master toggle to enable/disable
     - Granular toggles for each aspect (source, sort, limit, featured)
     - Conditional subsections that only show when their parent toggle is enabled
     - Clear visual distinction between randomized vs rigid aspects
