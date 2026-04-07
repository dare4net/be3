/**
 * Cloudinary Orphan Cleanup Script
 * 
 * This script identifies images in the 'products/' folder on Cloudinary
 * that are NOT currently linked to any product in the database (across all tenants).
 * It then deletes these redundant images to save space and clean up your dashboard.
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

async function getReachableCloudinaryUrls() {
    console.log(`--- Fetching product images for tenant: ${TARGET_TENANT} ---`);
    // Fetch from products table - strictly for THIS tenant
    const productsRes = await pool.query("SELECT image_url FROM products WHERE tenant_id = $1 AND image_url LIKE '%cloudinary.com%'", [TARGET_TENANT]);
    
    // Fetch from product_media table
    let mediaUrls = [];
    try {
        const mediaRes = await pool.query("SELECT url FROM product_media pm JOIN products p ON pm.product_id = p.id WHERE p.tenant_id = $1 AND pm.url LIKE '%cloudinary.com%'", [TARGET_TENANT]);
        mediaUrls = mediaRes.rows.map(r => r.url);
    } catch (e) {
        console.warn('  - product_media table not found or error, skipping...');
    }

    const allInDb = new Set([
        ...productsRes.rows.map(r => r.image_url),
        ...mediaUrls
    ]);

    console.log(`  ✓ Found ${allInDb.size} unique Cloudinary URLs referenced in database.`);
    return allInDb;
}

async function listAllCloudinaryProductImages() {
    console.log('--- Scanning Cloudinary for images in folder "products" ---');
    let assets = [];
    let nextCursor = null;

    do {
        const result = await cloudinary.api.resources({
            type: 'upload',
            prefix: 'products/',
            max_results: 500,
            next_cursor: nextCursor
        });
        
        assets = assets.concat(result.resources);
        nextCursor = result.next_cursor;
        console.log(`  - Found ${assets.length} images so far...`);
    } while (nextCursor);

    return assets;
}

async function cleanup() {
    console.log('========================================');
    console.log('  Cloudinary Orphan Image Cleanup');
    console.log(`  Dry Run: ${DRY_RUN ? 'YES' : 'NO'}`);
    console.log('========================================');

    try {
        const reachableSet = await getReachableCloudinaryUrls();
        const allAssets = await listAllCloudinaryProductImages();

        const orphans = [];
        for (const asset of allAssets) {
            // Check if any reachable URL contains this Public ID
            // We search by Public ID because the database URL might include transformation flags (f_auto, q_auto)
            const isUsed = Array.from(reachableSet).some(url => url && url.includes(asset.public_id));
            
            if (!isUsed) {
                orphans.push(asset.public_id);
            }
        }

        console.log(`\n--- Cleanup Summary ---`);
        console.log(`Total images on Cloudinary: ${allAssets.length}`);
        console.log(`Orphaned (unreferenced): ${orphans.length}`);

        if (orphans.length === 0) {
            console.log('✨ No orphans found. Your Cloudinary is already clean!');
            return;
        }

        if (DRY_RUN) {
            console.log('\n[DRY RUN] The following images would be deleted:');
            orphans.forEach(id => console.log(`  - ${id}`));
            console.log(`\nTo actually delete these, run without --dry-run`);
        } else {
            console.log(`\n--- Deleting ${orphans.length} orphans ---`);
            // Cloudinary API allows batch deletion by public IDs (up to 100 at a time)
            for (let i = 0; i < orphans.length; i += 100) {
                const batch = orphans.slice(i, i + 100);
                await cloudinary.api.delete_resources(batch);
                console.log(`  ✓ Deleted batch ${Math.floor(i / 100) + 1}...`);
            }
            console.log('\n✅ Cleanup complete!');
        }

    } catch (error) {
        console.error('\n✗ Cleanup failed:', error.message);
    } finally {
        await pool.end();
    }
}

cleanup();
