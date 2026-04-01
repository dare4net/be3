const http = require('http');

let tenantId = null;
let accessToken = null;

function makeRequest(method, path, data = null, headers = {}) {
    return new Promise((resolve, reject) => {
        const defaultHeaders = {
            'Content-Type': 'application/json',
            ...headers
        };

        if (tenantId) defaultHeaders['X-Tenant-ID'] = tenantId;
        if (accessToken) defaultHeaders['Authorization'] = `Bearer ${accessToken}`;

        const options = {
            hostname: 'localhost',
            port: 3000,
            path,
            method,
            headers: defaultHeaders
        };

        const req = http.request(options, (res) => {
            let responseData = '';
            res.on('data', chunk => responseData += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(responseData) });
                } catch (err) {
                    resolve({ status: res.statusCode, data: responseData });
                }
            });
        });

        req.on('error', reject);
        if (data) req.write(JSON.stringify(data));
        req.end();
    });
}

async function run() {
    try {
        const lookupRes = await makeRequest('GET', '/tenants/lookup?subdomain=Demo');
        tenantId = lookupRes.data.tenant.id;

        const loginRes = await makeRequest('POST', '/auth/login', {
            email: 'admin@demo.com',
            password: '123456789'
        });
        accessToken = loginRes.data.token || loginRes.data.accessToken;

        const catsRes = await makeRequest('GET', '/products/categories/all');
        const categories = catsRes.data.categories || [];
        
        // Find parents created in Part 1
        const smallAppCat = categories.find(c => c.name.toLowerCase() === 'small appliances');
        const largeAppCat = categories.find(c => c.name.toLowerCase() === 'large appliances');
        
        if (!smallAppCat || !largeAppCat) {
            throw new Error("Missing parent categories from Part 1.");
        }

        const newCats = [
            // Children of Small Appliances
            { name: 'Food Preparation', parent_id: smallAppCat.id },
            { name: 'Cooking Appliances', parent_id: smallAppCat.id },
            { name: 'Cleaning Appliances', parent_id: smallAppCat.id },
            // Children of Large Appliances
            { name: 'Laundry', parent_id: largeAppCat.id },
            { name: 'Cooling', parent_id: largeAppCat.id }
        ];

        for (const cat of newCats) {
            console.log(`Creating ${cat.name}...`);
            const createRes = await makeRequest('POST', '/products/categories', cat);
            if (createRes.status === 201 || createRes.status === 200) {
                console.log(`✅ Created ${cat.name}`);
            } else {
                console.error(`❌ Failed:`, createRes.data.message || createRes.data);
            }
        }
        
    } catch (e) {
        console.error("Error:", e.message);
    }
}

run();
