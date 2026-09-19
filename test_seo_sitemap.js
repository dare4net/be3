require('dotenv').config();
const SeoService = require('./modules/seo/services/SeoService');

async function run() {
    console.log('Testing Sitemap Generation...\n');
    try {
        const tenantId = process.env.TENANT_ID || 'cbe1df05-45ed-455a-9ce6-156b0bd45713';
        const baseUrl = 'https://example-store.com';
        
        console.log(`Using Tenant ID: ${tenantId}`);
        console.log(`Using Base URL: ${baseUrl}\n`);
        
        const xml = await SeoService.getSitemap(tenantId, baseUrl);
        
        console.log('--- GENERATED SITEMAP ---');
        console.log(xml.substring(0, 1000) + (xml.length > 1000 ? '\n... (truncated)' : ''));
        console.log('\n✅ Success! Total length:', xml.length, 'characters.');
        
    } catch (error) {
        console.error('❌ Error generating sitemap:', error);
    } finally {
        process.exit(0);
    }
}

run();
