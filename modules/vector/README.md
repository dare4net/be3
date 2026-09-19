# Vector Module

Semantic search engine powered by **pgvector** + **be3-ai-transformer**.

## Setup

1. **Run the migration:**
   ```bash
   node database/migrate.js   # runs 051_enable_pgvector.js
   ```

2. **Start the transformer:**
   ```bash
   cd ../be3-ai-transformer && npm start
   ```

3. **Generate embeddings:**
   ```bash
   node modules/vector/scripts/generateEmbeddings.js          # embed new products
   node modules/vector/scripts/generateEmbeddings.js --force   # re-embed all
   node modules/vector/scripts/generateEmbeddings.js --stats   # check coverage
   ```

## API Routes

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/vector/status` | Health check + coverage stats |
| `GET` | `/vector/search?query=...&limit=20` | Semantic product search |
| `GET` | `/vector/similar/:productId` | Find similar products |
| `POST` | `/vector/embed/product/:id` | Embed a single product |
| `POST` | `/vector/embed/all` | Bulk embed all products |
| `DELETE` | `/vector/embeddings` | Clear all embeddings |

## VectorEngine Methods

| Method | Description |
|--------|-------------|
| `getEmbedding(text)` | Get a 384-dim vector from the transformer |
| `getEmbeddings(texts)` | Batch embed multiple texts |
| `embedProduct(tenantId, productId)` | Embed a single product |
| `embedAllProducts(tenantId, opts)` | Bulk embed all products |
| `upsertEmbedding(tenantId, id, vec)` | Store/update a vector |
| `getProductEmbedding(tenantId, id)` | Read a product's vector |
| `hasEmbedding(tenantId, id)` | Check if embedding exists |
| `clearProductEmbedding(tenantId, id)` | Remove a product's vector |
| `clearEmbeddings(tenantId)` | Remove all tenant vectors |
| `semanticSearch(tenantId, query, opts)` | Vector similarity search |
| `findSimilarProducts(tenantId, id, opts)` | Find similar products |
| `hybridSearch(tenantId, query, opts)` | Combined text + vector search |
| `nearestNeighbors(tenantId, vec, n)` | K-NN from a raw vector |
| `computeDistance(tenantId, idA, idB)` | Distance between two products |
| `getStats(tenantId)` | Embedding coverage stats |
| `getMissingEmbeddings(tenantId)` | List un-embedded products |
| `verifyEmbeddings(tenantId)` | Check dimension integrity |
| `getCentroid(tenantId, ids)` | Average vector of a group |

## Auto-Sync

The module listens to `product:created`, `product:updated`, and `product:deleted` events via the event bus. Embeddings are automatically generated or cleaned up when products change.
