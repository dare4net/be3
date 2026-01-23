/**
 * Bulk Index Content Script
 * Indexes all existing products, categories, and pages for a tenant
 */

const axios = require('axios');

const BASE_URL = process.env.API_URL || 'http://localhost:3000';
const TENANT_ID = process.env.TENANT_ID;
const AUTH_TOKEN = process.env.AUTH_TOKEN;

if (!TENANT_ID) {
    console.error('❌ TENANT_ID environment variable is required');
    console.log('\nUsage:');
    console.log('  TENANT_ID=your-tenant-id AUTH_TOKEN=your-token node bulk_index_content.js');
    process.exit(1);
}

if (!AUTH_TOKEN) {
    console.error('❌ AUTH_TOKEN environment variable is required');
    console.log('\nUsage:');
    console.log('  TENANT_ID=your-tenant-id AUTH_TOKEN=your-token node bulk_index_content.js');
    process.exit(1);
}

async function makeRequest(method, endpoint, data = null) {
    const config = {
        method,
        url: `${BASE_URL}${endpoint}`,
        headers: {
            'Content-Type': 'application/json',
            'X-Tenant-ID': TENANT_ID,
            'Authorization': `Bearer ${AUTH_TOKEN}`
        }
    };

    if (data) {
        config.data = data;
    }

    try {
        const response = await axios(config);
        return response;
    } catch (error) {
        if (error.response) {
            console.error(`❌ Error ${error.response.status}:`, error.response.data);
        } else {
            console.error('❌ Request failed:', error.message);
        }
        throw error;
    }
}

async function bulkIndex() {
    console.log('🔍 Bulk Indexing Content');
    console.log(`Base URL: ${BASE_URL}`);
    console.log(`Tenant ID: ${TENANT_ID}\n`);

    try {
        console.log('📦 Starting index rebuild...');
        console.log('   This may take a few minutes depending on the amount of content.\n');
        
        const response = await makeRequest('POST', '/search/index/rebuild');
        
        if (response.data.success) {
            console.log('✅ Index rebuild completed successfully!');
            if (response.data.indexedCount !== undefined) {
                console.log(`   Indexed ${response.data.indexedCount} items total`);
            }
            console.log('\n📝 Next steps:');
            console.log('   1. Test search: node test_search_module.js');
            console.log('   2. Check search results at: GET /search?q=your-query');
        } else {
            console.log('❌ Index rebuild failed:', response.data);
        }
    } catch (error) {
        console.error('❌ Failed to rebuild index:', error.message);
        if (error.response?.data) {
            console.error('   Details:', error.response.data);
        }
        process.exit(1);
    }
}

bulkIndex();
