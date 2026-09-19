const axios = require('axios');

async function testBatchResolution() {
    const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
    const tenantId = 'cbe1df05-45ed-455a-9ce6-156b0bd45713'; // Use valid tenant from .env

    console.log('--- Testing Batch Product Resolution API ---');

    const payload = {
        widgets: [
            {
                widgetId: 'widget_1',
                filter: 'category_id=1',
                sort: 'price_asc',
                perPage: 4
            },
            {
                widgetId: 'widget_2',
                filter: 'attribute.color=red',
                sort: 'relevance',
                perPage: 4
            }
        ]
    };

    try {
        const response = await axios.post(`${API_URL}/search/randomization/batch-products`, payload, {
            headers: { 'x-tenant-id': tenantId }
        });

        console.log('Response Success:', response.data.success);
        if (response.data.success) {
            const results = response.data.results;
            Object.keys(results).forEach(id => {
                console.log(`Widget ${id}: ${results[id].results?.length || 0} products found`);
                if (results[id].error) console.error(`Widget ${id} Error:`, results[id].error);
            });
        } else {
            console.error('API Error:', response.data.error);
        }
    } catch (error) {
        console.error('Network Error:', error.message);
        if (error.response) console.error('Response Data:', error.response.data);
    }
}

testBatchResolution();
