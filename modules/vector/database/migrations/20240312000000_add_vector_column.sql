-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column to products table
-- Xenova/all-MiniLM-L6-v2 uses 384 dimensions
ALTER TABLE products ADD COLUMN IF NOT EXISTS embedding vector(384);

-- Add an HNSW index for fast similarity search
-- Note: This requires pgvector 0.5.0+
-- If you are on an older version, you might need Ivory (IVFFlat) instead.
CREATE INDEX IF NOT EXISTS products_embedding_hnsw_idx ON products USING hnsw (embedding vector_cosine_ops);
