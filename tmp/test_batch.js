
const axios = require('axios');

async function testBatch() {
    try {
        const res = await axios.post('http://localhost:3000/search/randomization/batch-products', {
            widgets: [
                { widgetId: 'test', filter: 'category_id=d8aed750-6164-4065-881c-652ef888179f', sort: 'relevance', perPage: 8 }
            ]
        }, {
            headers: { 'X-Tenant-ID': 'cbe1df05-45ed-455a-9ce6-156b0bd45713' }
        });
        console.log('Success:', res.data.success);
        console.log('Results keys:', Object.keys(res.data.results));
    } catch (e) {
        console.error('Error:', e.message);
        if (e.response) console.error('Data:', e.response.data);
    }
}

testBatch();
