/**
 * Test Script for Search Module
 * Tests search functionality with real data
 */

const axios = require('axios');

const BASE_URL = process.env.API_URL || 'http://localhost:3000';
const TENANT_ID = process.env.TENANT_ID || 'cbe1df05-45ed-455a-9ce6-156b0bd45713';

let authToken = '';
let sessionId = `test-session-${Date.now()}`;

async function makeRequest(method, endpoint, data = null, headers = {}) {
    // Extract tenant ID from headers if provided, otherwise use global
    const tenantId = headers['X-Tenant-ID'] !== undefined ? headers['X-Tenant-ID'] : TENANT_ID;
    
    // Create clean headers object without X-Tenant-ID to avoid duplication
    const cleanHeaders = { ...headers };
    delete cleanHeaders['X-Tenant-ID'];
    
    const config = {
        method,
        url: `${BASE_URL}${endpoint}`,
        headers: {
            'Content-Type': 'application/json',
            'X-Tenant-ID': tenantId,
            ...cleanHeaders
        }
    };

    if (data) {
        config.data = data;
    }

    if (authToken) {
        config.headers.Authorization = `Bearer ${authToken}`;
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

async function runTests() {
    console.log('🔍 Testing Search Module\n');
    console.log(`Base URL: ${BASE_URL}`);
    
    let tenantId = TENANT_ID;
    
    // If no tenant ID provided, try to create one
    if (!tenantId) {
        console.log('⚠️  No TENANT_ID provided. Attempting to create a test tenant...\n');
        try {
            // Create tenant without tenant header (tenant creation is public)
            const tenantConfig = {
                method: 'POST',
                url: `${BASE_URL}/tenants`,
                headers: {
                    'Content-Type': 'application/json'
                },
                data: {
                    name: `Search Test ${Date.now()}`,
                    subdomain: `searchtest${Date.now()}`
                }
            };
            
            const tenantRes = await axios(tenantConfig);
            
            if (tenantRes.data.success) {
                tenantId = tenantRes.data.tenant.id;
                console.log('✅ Test tenant created!');
                console.log(`   Tenant ID: ${tenantId}`);
                console.log(`   Subdomain: ${tenantRes.data.tenant.subdomain}\n`);
            } else {
                throw new Error('Failed to create tenant');
            }
        } catch (error) {
            console.error('❌ Failed to create tenant:', error.message);
            console.log('\n💡 To use an existing tenant, set the TENANT_ID environment variable:');
            console.log('   Windows: $env:TENANT_ID="your-tenant-id"');
            console.log('   Linux/Mac: export TENANT_ID="your-tenant-id"');
            console.log('\n   Or create a tenant manually:');
            console.log('   POST http://localhost:3000/tenants');
            console.log('   Body: { "name": "Test", "subdomain": "test" }');
            process.exit(1);
        }
    } else {
        console.log(`Tenant ID: ${tenantId}\n`);
    }

    try {
        // 1. Test Search (should work even without products indexed)
        console.log('1️⃣ Testing Search Endpoint...');
        const searchRes = await makeRequest('GET', '/search', null, {
            'X-Tenant-ID': tenantId
        });
        console.log('✅ Search endpoint accessible');
        console.log(`   Results: ${searchRes.data.pagination?.total || 0}`);
        console.log(`   SEO metadata: ${searchRes.data.seo ? 'Present' : 'Missing'}\n`);

        // 2. Test Autocomplete
        console.log('2️⃣ Testing Autocomplete...');
        const autocompleteRes = await makeRequest('GET', '/search/autocomplete?q=test', null, {
            'X-Tenant-ID': tenantId
        });
        console.log('✅ Autocomplete endpoint accessible');
        console.log(`   Suggestions: ${autocompleteRes.data.suggestions?.length || 0}\n`);

        // 3. Test Filters Endpoint
        console.log('3️⃣ Testing Filters Endpoint...');
        const filtersRes = await makeRequest('GET', '/search/filters', null, {
            'X-Tenant-ID': tenantId
        });
        console.log('✅ Filters endpoint accessible');
        console.log(`   Available filters: ${filtersRes.data.filters?.length || 0}\n`);

        // 4. Test Suggestions
        console.log('4️⃣ Testing Suggestions Endpoint...');
        const suggestionsRes = await makeRequest('GET', '/search/suggestions?type=popular&limit=5', null, {
            'X-Tenant-ID': tenantId
        });
        console.log('✅ Suggestions endpoint accessible');
        console.log(`   Suggestions: ${suggestionsRes.data.suggestions?.length || 0}\n`);

        // 5. Test Search with Query
        console.log('5️⃣ Testing Search with Query...');
        const querySearchRes = await makeRequest('GET', '/search?q=laptop&per_page=10', null, {
            'X-Tenant-ID': tenantId
        });
        console.log('✅ Search with query works');
        console.log(`   Query: "laptop"`);
        console.log(`   Results: ${querySearchRes.data.pagination?.total || 0}`);
        console.log(`   Facets: ${Object.keys(querySearchRes.data.facets || {}).length} types\n`);

        // 6. Test Search with Filters
        console.log('6️⃣ Testing Search with Filters...');
        const filteredSearchRes = await makeRequest('GET', '/search?q=product&price_min=10&price_max=1000', null, {
            'X-Tenant-ID': tenantId
        });
        console.log('✅ Search with filters works');
        console.log(`   Applied filters: price_min, price_max\n`);

        // Note: Admin endpoints require authentication
        console.log('📝 Note: Admin endpoints require authentication');
        console.log('   To test admin endpoints, set AUTH_TOKEN environment variable\n');

        console.log('✅ All public search tests passed!\n');
        console.log('Next steps:');
        console.log('1. Run migration: node database/migrate.js (or run migrations/027_search_module.sql)');
        console.log('2. Index some products: POST /search/index/product/:productId (requires auth)');
        console.log('3. Test search with indexed content');

    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        process.exit(1);
    }
}

runTests();
