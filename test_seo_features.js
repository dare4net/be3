const Page = require('./modules/page_builder/models/Page');
const SEOPreset = require('./modules/page_builder/models/SEOPreset');

async function testSEOFeatures() {
    console.log('=== Testing SEO Metadata Features ===\n');

    const testTenantId = '129d825e-9483-4899-89d6-c4552e0e5938';

    try {
        // Test 1: Create page with full SEO metadata
        console.log('📝 Test 1: Creating page with full SEO metadata...');
        const testPage = await Page.create(testTenantId, {
            slug: 'seo-test-page',
            title: 'SEO Test Page',
            meta_description: 'Testing comprehensive SEO fields',
            og_title: 'Amazing SEO Test Page',
            og_description: 'Discover how our SEO features work',
            og_image: 'https://example.com/og-image.jpg',
            og_type: 'article',
            twitter_card: 'summary_large_image',
            twitter_title: 'Check Out Our SEO Test',
            canonical_url: 'https://mystore.com/seo-test-page',
            robots: 'index,follow',
            structured_data: {
                "@context": "https://schema.org",
                "@type": "Article",
                "headline": "SEO Test Page",
                "author": "Test Author"
            }
        });
        console.log('✅ Page created with ID:', testPage.id);
        console.log('   OG Title:', testPage.og_title);
        console.log('   Twitter Card:', testPage.twitter_card);
        console.log('   Robots:', testPage.robots);

        // Test 2: Create SEO Preset
        console.log('\n📋 Test 2: Creating SEO preset...');
        const preset = await SEOPreset.create(testTenantId, {
            name: 'Blog Post Template',
            description: 'Default SEO settings for blog posts',
            og_type: 'article',
            twitter_card: 'summary',
            robots: 'index,follow',
            structured_data: {
                "@context": "https://schema.org",
                "@type": "BlogPosting"
            }
        });
        console.log('✅ SEO Preset created:', preset.name);

        // Test 3: Fetch and verify
        console.log('\n🔍 Test 3: Fetching created page...');
        const fetchedPage = await Page.findById(testTenantId, testPage.id);
        console.log('✅ Page fetched successfully');
        console.log('   Has OG fields:', !!fetchedPage.og_title);
        console.log('   Has Twitter fields:', !!fetchedPage.twitter_card);
        console.log('   Has structured data:', !!fetchedPage.structured_data);

        // Test 4: Update SEO fields
        console.log('\n✏️  Test 4: Updating SEO metadata...');
        const updated = await Page.update(testTenantId, testPage.id, {
            og_title: 'Updated OG Title',
            robots: 'noindex,follow'
        });
        console.log('✅ Updated successfully');
        console.log('   New OG Title:', updated.og_title);
        console.log('   New Robots:', updated.robots);

        // Cleanup
        console.log('\n🧹 Cleaning up test data...');
        await Page.delete(testTenantId, testPage.id);
        await SEOPreset.delete(testTenantId, preset.id);
        console.log('✅ Cleanup complete');

        console.log('\n✅ All SEO tests passed!');
        process.exit(0);
    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

testSEOFeatures();
