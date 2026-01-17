const http = require('http');

const options = {
    hostname: '127.0.0.1',
    port: 3000,
    path: '/products/storefront/products/58d5c65d-0a86-4044-8a80-6a9df9e6a3c5',
    method: 'GET',
    headers: {
        'x-tenant-id': 'cbe1df05-45ed-455a-9ce6-156b0bd45713'
    }
};

const req = http.request(options, (res) => {
    console.log(`STATUS: ${res.statusCode}`);
    let data = '';
    res.on('data', (chunk) => {
        data += chunk;
    });
    res.on('end', () => {
        console.log('BODY:', data);
    });
});

req.on('error', (e) => {
    console.error(`problem with request: ${e.message}`);
});

req.end();
