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
        console.error(`⚠️ Failed to create ${name}:`, createRes.data?.message || createRes.data);
        const catsRes = await makeRequest('GET', '/products/categories/all');
        return catsRes.data.categories.find(c => c.name.toLowerCase() === name.toLowerCase());
    }
}

async function run() {
    try {
        console.log("Looking up tenant 'Demo'...");
        const lookupRes = await makeRequest('GET', '/tenants/lookup?subdomain=Demo');
        tenantId = lookupRes.data.tenant.id;

        console.log("Logging in as admin...");
        const loginRes = await makeRequest('POST', '/auth/login', { email: 'admin@demo.com', password: '123456789' });
        accessToken = loginRes.data.token || loginRes.data.accessToken;

        let allCatsRes = await makeRequest('GET', '/products/categories/all');
        let allCategories = allCatsRes.data.categories || [];

        // --- 1. Components (Laptops & Computers) ---
        console.log("\n--- Injecting into Components ---");
        const compRoot = await getCategoryByName('Components', allCategories);
        if (compRoot) {
            await createCategory('Processors (CPUs)', compRoot.id);
            await createCategory('Motherboards', compRoot.id);
            await createCategory('Power Supplies (PSUs)', compRoot.id);
            await createCategory('PC Cases & Fans', compRoot.id);
        } else console.error("❌ Components Root NOT FOUND!");

        // --- 2. Clothing (Fashion) ---
        console.log("\n--- Injecting into Clothing ---");
        const clothRoot = await getCategoryByName('Clothing', allCategories) || await getCategoryByName('clothing', allCategories);
        if (clothRoot) {
            await createCategory('Tops & T-Shirts', clothRoot.id);
            await createCategory('Bottoms & Pants', clothRoot.id);
            await createCategory('Jackets & Outerwear', clothRoot.id);
            await createCategory('Activewear', clothRoot.id);
            await createCategory('Sleepwear & Loungewear', clothRoot.id);
        } else console.error("❌ Clothing Root NOT FOUND!");

        // --- 3. Shoes (Footwear / Fashion) ---
        console.log("\n--- Injecting into Shoes ---");
        const shoesRoot = await getCategoryByName('Shoes', allCategories) || await getCategoryByName('Footwear', allCategories);
        if (shoesRoot) {
            await createCategory('Sneakers & Athletic', shoesRoot.id);
            await createCategory('Formal & Dress Shoes', shoesRoot.id);
            await createCategory('Boots', shoesRoot.id);
            await createCategory('Sandals & Slippers', shoesRoot.id);
        } else console.error("❌ Shoes Root NOT FOUND!");

        // --- 4. Appliances (Large & Small) ---
        console.log("\n--- Injecting into Large Appliances ---");
        const largeAppRoot = await getCategoryByName('Large Appliances', allCategories);
        if (largeAppRoot) {
            await createCategory('Refrigerators & Freezers', largeAppRoot.id);
            await createCategory('Air Conditioners', largeAppRoot.id);
            await createCategory('Washing Machines & Dryers', largeAppRoot.id);
        }

        console.log("\n--- Injecting into Small Appliances ---");
        const smallAppRoot = await getCategoryByName('Small Appliances', allCategories);
        if (smallAppRoot) {
            await createCategory('Microwaves', smallAppRoot.id);
            await createCategory('Irons & Steamers', smallAppRoot.id);
            await createCategory('Vacuum Cleaners', smallAppRoot.id);
        }

        // --- 5. Supermarket > Household Cleaning ---
        console.log("\n--- Injecting into Household Cleaning ---");
        const cleanRoot = await getCategoryByName('Household Cleaning', allCategories);
        if (cleanRoot) {
            await createCategory('Laundry Detergents', cleanRoot.id);
            await createCategory('Dishwashing Supplies', cleanRoot.id);
            await createCategory('Surface & Floor Cleaners', cleanRoot.id);
        } else console.error("❌ Household Cleaning NOT FOUND!");

        console.log("\n🎉 Granular Deep Dive Extension completed successfully!");

    } catch (e) {
        console.error("❌ Fatal Error:", e);
    }
}

run();
