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

async function getCategoryByName(name, allCats) {
    if (!allCats) {
        const catsRes = await makeRequest('GET', '/products/categories/all');
        allCats = catsRes.data.categories || [];
    }
    return allCats.find(c => c.name.toLowerCase() === name.toLowerCase());
}

async function createCategory(name, parentId = null) {
    console.log(`Creating ${name}...`);
    const createRes = await makeRequest('POST', '/products/categories', { name, parent_id: parentId });
    if (createRes.status === 201 || createRes.status === 200) {
        console.log(`✅ Created ${name}`);
        return createRes.data.category;
    } else {
        // If it already exists it triggers 400 or 500, we can fetch it
        console.error(`⚠️ Failed to create ${name}:`, createRes.data.message || createRes.data);
        const catsRes = await makeRequest('GET', '/products/categories/all');
        return catsRes.data.categories.find(c => c.name.toLowerCase() === name.toLowerCase());
    }
}

async function run() {
    try {
        const lookupRes = await makeRequest('GET', '/tenants/lookup?subdomain=Demo');
        tenantId = lookupRes.data.tenant.id;

        const loginRes = await makeRequest('POST', '/auth/login', { email: 'admin@demo.com', password: '123456789' });
        accessToken = loginRes.data.token || loginRes.data.accessToken;

        let allCatsRes = await makeRequest('GET', '/products/categories/all');
        let allCategories = allCatsRes.data.categories || [];

        // PHASE 2
        console.log("\n--- PHASE 2: Electronics & Computing ---");
        const elec = await getCategoryByName('Electronics', allCategories);
        const lap = await getCategoryByName('Laptops & Computers', allCategories);

        if (elec) {
            await createCategory('Television & Video', elec.id);
            await createCategory('Home Audio', elec.id);
            const camCat = await createCategory('Cameras & Photography', elec.id);
            if (camCat) {
                await createCategory('CCTV', camCat.id);
                await createCategory('Drones', camCat.id);
            }
        }

        if (lap) {
            await createCategory('Computing Accessories', lap.id);
            await createCategory('Data Storage', lap.id);
            await createCategory('Printers & Scanners', lap.id);
        }

        // PHASE 3
        console.log("\n--- PHASE 3: Health & Beauty ---");
        // Create root
        let hbRoot = await getCategoryByName('Health & Beauty', null); // refresh
        if (!hbRoot) {
            hbRoot = await createCategory('Health & Beauty', null);
        }
        
        if (hbRoot) {
            await createCategory('Skin Care', hbRoot.id);
            await createCategory('Hair Care', hbRoot.id);
            await createCategory('Fragrances', hbRoot.id);
            await createCategory('Makeup', hbRoot.id);
            await createCategory('Personal Care', hbRoot.id);
        }

        // PHASE 4
        console.log("\n--- PHASE 4: Fashion ---");
        const fash = await getCategoryByName('Fashion', null);
        if (fash) {
            await createCategory('Footwear', fash.id);
            await createCategory('Clothing', fash.id);
            await createCategory('Handbags & Bags', fash.id);
            await createCategory('Watches & Eyewear', fash.id);
        }

        console.log("\n🎉 All phases completed!");

    } catch (e) {
        console.error("Error:", e.message);
    }
}

run();
