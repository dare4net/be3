/**
 * Cloudinary Image Migration Script (Optimized)
 * 
 * This script automates the migration of existing external image URLs to Cloudinary.
 * Features:
 * - Tenant isolation (only migrates your specific tenant).
 * - Deduplication (shares the same Cloudinary URL if source is identical).
 * - Optimized SQL (skips records already on Cloudinary).
 * 
 * Usage:
 *   node scripts/migrate_images_to_cloudinary.js           # Run migration
 *   node scripts/migrate_images_to_cloudinary.js --dry-run # Preview changes only
 */

require('dotenv').config();
const { pool } = require('../config/database');
const cloudinary = require('cloudinary').v2;

// --- CONFIGURATION ---
const TARGET_TENANT = 'cbe1df05-45ed-455a-9ce6-156b0bd45713'; 
const DRY_RUN = process.argv.includes('--dry-run');

// --- CLOUDINARY CONFIG ---
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// --- CACHE FOR DEDUPLICATION ---
// Map of sourceUrl -> cloudinaryUrl
const globalUploadCache = new Map();

/**
 * Upload an image to Cloudinary (with caching/deduplication)
 */
async function uploadToCloudinary(url, folder) {
    if (!url || typeof url !== 'string') return null;
    
    // Check if already a Cloudinary URL
    if (url.includes('cloudinary.com')) {
        return null; // Skip without noise
    }

    // Check if we already uploaded this exact URL in this session
    if (globalUploadCache.has(url)) {
        console.log(`  - Reusing cached upload for ${url.substring(0, 50)}...`);
        return globalUploadCache.get(url);
    }

    try {
        if (DRY_RUN) {
            console.log(`  [DRY RUN] Would upload ${url.substring(0, 50)}... to folder "${folder}"`);
            const mockUrl = `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload/f_auto,q_auto/v1/${folder}/mock_image`;
            globalUploadCache.set(url, mockUrl);
            return mockUrl;
        }

        console.log(`  - Uploading ${url.substring(0, 50)}...`);
        const result = await cloudinary.uploader.upload(url, {
            folder: folder,
            resource_type: 'auto'
        });

        // Construct optimized URL using f_auto, q_auto
        const optimizedUrl = result.secure_url.replace('/upload/', '/upload/f_auto,q_auto/');
        
        // Cache it for reuse
        globalUploadCache.set(url, optimizedUrl);
        return optimizedUrl;
    } catch (error) {
        console.error(`  - Failed to upload ${url}: ${error.message}`);
        return null;
    }
}

async function migrateCategories() {
    console.log('\n--- Migrating Categories (Tenant Only) ---');
    const sql = `
        SELECT id, image_url, og_image 
        FROM categories 
        WHERE tenant_id = $1 
        AND (
            (image_url IS NOT NULL AND image_url NOT LIKE '%cloudinary.com%') 
            OR (og_image IS NOT NULL AND og_image NOT LIKE '%cloudinary.com%')
        )`;
    
    const res = await pool.query(sql, [TARGET_TENANT]);
    console.log(`Items found: ${res.rows.length}`);

    for (const category of res.rows) {
        console.log(`Category ID: ${category.id}`);
        const updates = [];
        const params = [];

        if (category.image_url && !category.image_url.includes('cloudinary.com')) {
            const newUrl = await uploadToCloudinary(category.image_url, 'categories');
            if (newUrl) {
                updates.push(`image_url = $${params.length + 1}`);
                params.push(newUrl);
            }
        }

        if (category.og_image && !category.og_image.includes('cloudinary.com')) {
            const newOgUrl = await uploadToCloudinary(category.og_image, 'categories');
            if (newOgUrl) {
                updates.push(`og_image = $${params.length + 1}`);
                params.push(newOgUrl);
            }
        }

        if (updates.length > 0 && !DRY_RUN) {
            params.push(category.id);
            params.push(TARGET_TENANT);
            await pool.query(
                `UPDATE categories SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${params.length - 1} AND tenant_id = $${params.length}`,
                params
            );
            console.log(`  ✓ Updated category ${category.id}`);
        }
    }
}

async function migrateCollections() {
    console.log('\n--- Migrating Collections (Tenant Only) ---');
    const sql = `
        SELECT id, image_url, thumbnail_url 
        FROM collections 
        WHERE tenant_id = $1 
        AND (
            (image_url IS NOT NULL AND image_url NOT LIKE '%cloudinary.com%') 
            OR (thumbnail_url IS NOT NULL AND thumbnail_url NOT LIKE '%cloudinary.com%')
        )`;
    
    const res = await pool.query(sql, [TARGET_TENANT]);
    console.log(`Items found: ${res.rows.length}`);

    for (const collection of res.rows) {
        console.log(`Collection ID: ${collection.id}`);
        const updates = [];
        const params = [];

        if (collection.image_url && !collection.image_url.includes('cloudinary.com')) {
            const newUrl = await uploadToCloudinary(collection.image_url, 'collection');
            if (newUrl) {
                updates.push(`image_url = $${params.length + 1}`);
                params.push(newUrl);
            }
        }

        if (collection.thumbnail_url && !collection.thumbnail_url.includes('cloudinary.com')) {
            const newThumbUrl = await uploadToCloudinary(collection.thumbnail_url, 'collection');
            if (newThumbUrl) {
                updates.push(`thumbnail_url = $${params.length + 1}`);
                params.push(newThumbUrl);
            }
        }

        if (updates.length > 0 && !DRY_RUN) {
            params.push(collection.id);
            params.push(TARGET_TENANT);
            await pool.query(
                `UPDATE collections SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${params.length - 1} AND tenant_id = $${params.length}`,
                params
            );
            console.log(`  ✓ Updated collection ${collection.id}`);
        }
    }
}

async function migrateProducts() {
    console.log('\n--- Migrating Products (Tenant Only) ---');
    const sql = `
        SELECT id, image_url 
        FROM products 
        WHERE tenant_id = $1 
        AND image_url IS NOT NULL 
        AND image_url NOT LIKE '%cloudinary.com%'`;
    
    const res = await pool.query(sql, [TARGET_TENANT]);
    console.log(`Items found: ${res.rows.length}`);

    for (const product of res.rows) {
        console.log(`Product ID: ${product.id}`);
        const newUrl = await uploadToCloudinary(product.image_url, 'products');
        if (newUrl && !DRY_RUN) {
            await pool.query(
                'UPDATE products SET image_url = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3',
                [newUrl, product.id, TARGET_TENANT]
            );
            console.log(`  ✓ Updated product ${product.id}`);
        }
    }
}

async function main() {
    console.log('========================================');
    console.log('  Cloudinary Image Migration Utility');
    console.log(`  Tenant: ${TARGET_TENANT}`);
    console.log(`  Dry Run: ${DRY_RUN ? 'YES' : 'NO'}`);
    console.log('========================================');

    try {
        await migrateCategories();
        await migrateCollections();
        await migrateProducts();
        
        console.log('\n========================================');
        console.log('  Migration completed successfully!');
        if (DRY_RUN) {
            console.log('  (No changes were made to the database)');
            console.log(`  Unique uploads avoided by cache: ${globalUploadCache.size} proposed uploads`);
        }
        console.log('========================================');
    } catch (error) {
        console.error('\n✗ Migration failed:', error.message);
    } finally {
        await pool.end();
    }
}

main();
