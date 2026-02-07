const path = require('path');

const modulePath = path.join(__dirname, 'platform/core/roles/index.js');
console.log(`Attempting to require: ${modulePath}`);

try {
    const rolesModule = require(modulePath);
    console.log('Require successful!');
    console.log('Exports:', Object.keys(rolesModule));
    if (typeof rolesModule.bootstrap === 'function') {
        console.log('Bootstrap function found.');
    } else {
        console.error('Bootstrap function MISSING!');
    }
} catch (error) {
    console.error('Require FAILED:', error);
}
