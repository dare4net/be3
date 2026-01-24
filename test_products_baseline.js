/**
 * Baseline Integration Test for Products Module
 * 
 * PURPOSE: Capture current behavior BEFORE refactoring
 * This test validates that all endpoints return expected responses
 * Run this BEFORE refactoring, then run again AFTER to ensure nothing broke
 */

const axios = require('axios');

const BASE_URL = process.env.API_URL || 'http://localhost:3000';
const TENANT_ID = process.env.TENANT_ID || 'cbe1df05-45ed-455a-9ce6-156b0bd45713';

let testResults = {
    passed: 0,
    failed: 0,
    errors: []
};

async function makeRequest(method, endpoint, data = null, headers = {}) {
    const tenantId = headers['X-Tenant-ID'] !== undefined ? headers['X-Tenant-ID'] : TENANT_ID;

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

    try {
        const response = await axios(config);
        return response;
    } catch (error) {
        if (error.response) {
            // Return error response for validation
            return error.response;
        }
        throw error;
    }
}

function assert(condition, testName, errorMsg) {
    if (condition) {
        console.log(`✅ ${testName}`);
        testResults.passed++;
    } else {
        console.error(`❌ ${testName}: ${errorMsg}`);
        testResults.failed++;
        testResults.errors.push({ test: testName, error: errorMsg });
    }
}

async function runBaselineTests() {
    console.log('🧪 Running Products Module Baseline Tests\n');
    console.log(`Base URL: ${BASE_URL}`);
    console.log(`Tenant ID: ${TENANT_ID}\n`);
    console.log('='.repeat(60));

    try {
        // ==============================================
        // 1. PUBLIC STOREFRONT ENDPOINTS
        // ==============================================
        console.log('\n📋 Testing Public Storefront Endpoints...\n');

        // Test 1: Get products from storefront
        const storefrontRes = await makeRequest('GET', '/products/storefront?page=1&per_page=10');
        assert(
            storefrontRes.status === 200,
            'GET /products/storefront',
            `Expected 200, got ${storefrontRes.status}`
        );
        assert(
            storefrontRes.data.success === true,
            'Storefront returns success',
            'Response should have success: true'
        );
        assert(
            Array.isArray(storefrontRes.data.data),
            'Storefront returns data array',
            'Response should have data array'
        );
        assert(
            storefrontRes.data.pagination !== undefined,
            'Storefront returns pagination',
            'Response should have pagination object'
        );

        // Test 2: Get featured products
        const featuredRes = await makeRequest('GET', '/products/storefront?featured=true&limit=5');
        assert(
            featuredRes.status === 200,
            'GET /products/storefront?featured=true',
            `Expected 200, got ${featuredRes.status}`
        );

        // Test 3: Get products with sorting
        const sortedRes = await makeRequest('GET', '/products/storefront?sort=price_asc');
        assert(
            sortedRes.status === 200,
            'GET /products/storefront?sort=price_asc',
            `Expected 200, got ${sortedRes.status}`
        );

        // ==============================================
        // 2. CATEGORY ENDPOINTS
        // ==============================================
        console.log('\n📁 Testing Category Endpoints...\n');

        // Test 4: Get all categories (PUBLIC)
        const categoriesRes = await makeRequest('GET', '/products/categories');
        assert(
            categoriesRes.status === 200,
            'GET /products/categories',
            `Expected 200, got ${categoriesRes.status}`
        );
        assert(
            categoriesRes.data.success === true,
            'Categories endpoint returns success',
            'Response should have success: true'
        );
        assert(
            Array.isArray(categoriesRes.data.categories),
            'Categories returns array',
            'Response should have categories array'
        );

        // Test 5: Check category structure
        if (categoriesRes.data.categories.length > 0) {
            const category = categoriesRes.data.categories[0];
            assert(
                category.id !== undefined,
                'Category has id field',
                'Category object should have id'
            );
            assert(
                category.name !== undefined,
                'Category has name field',
                'Category object should have name'
            );
            assert(
                category.product_count !== undefined,
                'Category has product_count field',
                'Category should have product_count (recursive)'
            );
        }

        // ==============================================
        // 3. SINGLE PRODUCT/CATEGORY ENDPOINTS
        // ==============================================
        console.log('\n🔍 Testing Single Resource Endpoints...\n');

        // Get a sample product and category for detailed testing
        let sampleProductHandle = null;
        let sampleCategoryId = null;

        if (storefrontRes.data.data.length > 0) {
            sampleProductHandle = storefrontRes.data.data[0].handle || storefrontRes.data.data[0].id;
        }

        if (categoriesRes.data.categories.length > 0) {
            sampleCategoryId = categoriesRes.data.categories[0].id;
        }

        // Test 6: Get single product by handle
        if (sampleProductHandle) {
            const productDetailRes = await makeRequest('GET', `/products/storefront/products/${sampleProductHandle}`);
            assert(
                productDetailRes.status === 200 || productDetailRes.status === 404,
                'GET /products/storefront/products/:handle',
                `Expected 200 or 404, got ${productDetailRes.status}`
            );

            if (productDetailRes.status === 200) {
                assert(
                    productDetailRes.data.product !== undefined,
                    'Product detail returns product object',
                    'Response should have product object'
                );
                assert(
                    Array.isArray(productDetailRes.data.product.images),
                    'Product has images array',
                    'Product should have images array'
                );
                assert(
                    Array.isArray(productDetailRes.data.product.categories),
                    'Product has categories array',
                    'Product should have categories array'
                );
                assert(
                    productDetailRes.data.product.seo !== undefined,
                    'Product has SEO object',
                    'Product should have merged SEO data'
                );
            }
        } else {
            console.log('⚠️  Skipping product detail test (no products found)');
        }

        // Test 7: Get single category by ID
        if (sampleCategoryId) {
            const categoryDetailRes = await makeRequest('GET', `/products/categories/${sampleCategoryId}`);
            assert(
                categoryDetailRes.status === 200,
                'GET /products/categories/:id',
                `Expected 200, got ${categoryDetailRes.status}`
            );

            if (categoryDetailRes.status === 200) {
                assert(
                    categoryDetailRes.data.category !== undefined,
                    'Category detail returns category object',
                    'Response should have category object'
                );
            }
        } else {
            console.log('⚠️  Skipping category detail test (no categories found)');
        }

        // ==============================================
        // 4. ATTRIBUTES ENDPOINTS
        // ==============================================
        console.log('\n🏷️  Testing Attributes Endpoints...\n');

        // Test 8: Get attributes endpoint exists (may require auth)
        // This is a basic connectivity test
        const attributesRes = await makeRequest('GET', '/products/attributes');
        assert(
            attributesRes.status === 200 || attributesRes.status === 401,
            'GET /products/attributes (endpoint exists)',
            `Expected 200 or 401, got ${attributesRes.status}`
        );

        // ==============================================
        // 5. RESPONSE STRUCTURE VALIDATION
        // ==============================================
        console.log('\n📊 Validating Response Structures...\n');

        // Test 9: Storefront pagination structure
        const pagination = storefrontRes.data.pagination;
        assert(
            pagination.page !== undefined &&
            pagination.perPage !== undefined &&
            pagination.total !== undefined &&
            pagination.totalPages !== undefined,
            'Pagination has correct structure',
            'Pagination should have page, perPage, total, totalPages'
        );

        // Test 10: Category product_count is numeric
        if (categoriesRes.data.categories.length > 0) {
            const hasValidCounts = categoriesRes.data.categories.every(
                cat => typeof cat.product_count === 'number'
            );
            assert(
                hasValidCounts,
                'All categories have numeric product_count',
                'product_count should be a number'
            );
        }

        // ==============================================
        // RESULTS SUMMARY
        // ==============================================
        console.log('\n' + '='.repeat(60));
        console.log('\n📊 TEST RESULTS SUMMARY\n');
        console.log(`✅ Passed: ${testResults.passed}`);
        console.log(`❌ Failed: ${testResults.failed}`);
        console.log(`📈 Success Rate: ${((testResults.passed / (testResults.passed + testResults.failed)) * 100).toFixed(1)}%`);

        if (testResults.failed > 0) {
            console.log('\n❌ Failed Tests:');
            testResults.errors.forEach(err => {
                console.log(`   - ${err.test}: ${err.error}`);
            });
            console.log('\n⚠️  WARNING: Some tests failed. Review before proceeding with refactoring.');
            process.exit(1);
        } else {
            console.log('\n✅ All baseline tests passed!');
            console.log('✅ Safe to proceed with refactoring.');
            console.log('\n💡 After refactoring, run this test again to verify nothing broke.');
        }

    } catch (error) {
        console.error('\n❌ Fatal error during testing:', error.message);
        if (error.code === 'ECONNREFUSED') {
            console.error('\n💡 Make sure the server is running:');
            console.error('   node server.js');
        }
        process.exit(1);
    }
}

// Run tests
runBaselineTests();
