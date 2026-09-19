const http = require('http');

let tenantId = null;
let accessToken = null;

function makeRequest(method, path, data = null, headers = {}) {
    return new Promise((resolve, reject) => {
        const defaultHeaders = {
            'Content-Type': 'application/json',
            ...headers
        };

        if (tenantId && !defaultHeaders['X-Tenant-ID']) {
            defaultHeaders['X-Tenant-ID'] = tenantId;
        }

        if (accessToken && !defaultHeaders['Authorization']) {
            defaultHeaders['Authorization'] = `Bearer ${accessToken}`;
        }

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
                    const parsed = JSON.parse(responseData);
                    resolve({ status: res.statusCode, data: parsed });
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
        console.log("Looking up tenant 'Demo'...");
        const lookupRes = await makeRequest('GET', '/tenants/lookup?subdomain=Demo');
        tenantId = lookupRes.data.tenant.id;
        console.log("Tenant ID:", tenantId);

        console.log("Logging in...");
        const loginRes = await makeRequest('POST', '/auth/login', {
            email: 'admin@demo.com',
            password: '123456789'
        });
        accessToken = loginRes.data.token || loginRes.data.accessToken;
        console.log("Logged in.");

        console.log("Fetching existing categories...");
        const catsRes = await makeRequest('GET', '/products/categories/all');
        const categories = catsRes.data.categories || [];
        
        const appliancesCat = categories.find(c => c.name.toLowerCase() === 'appliances');
        if (!appliancesCat) {
            throw new Error("Could not find Appliances parent category.");
        }
        
        const parentId = appliancesCat.id;
        console.log("Found Appliances ID:", parentId);

        const newCats = [
            { name: 'Small Appliances', parent_id: parentId },
            { name: 'Large Appliances', parent_id: parentId },
            { name: 'Power Solutions', parent_id: parentId }
        ];

        for (const cat of newCats) {
            console.log(`Creating ${cat.name}...`);
            const createRes = await makeRequest('POST', '/products/categories', cat);
            if (createRes.status === 201 || createRes.status === 200) {
                console.log(`✅ Created ${cat.name}`);
            } else {
                console.error(`❌ Failed to create ${cat.name}:`, createRes.data);
            }
        }
        
        console.log("Phase 1 categories created successfully.");

    } catch (e) {
        console.error("Error:", e);
    }
}

run();
