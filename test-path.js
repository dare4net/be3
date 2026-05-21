const fs = require('fs');
const path = require('path');

const schemas = [
    'migrations/071_create_user_addresses.sql',
    'migrations/084_advanced_shipping_module.js'
];

schemas.forEach(schemaPath => {
    const fullPath = path.join(__dirname, '..', schemaPath);
    console.log(fullPath, "EXISTS: ", fs.existsSync(fullPath));
});
