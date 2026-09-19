// Debug script - Run this in browser console to check permissions
console.log('=== PERMISSION DEBUG ===');
console.log('User:', JSON.parse(localStorage.getItem('user') || '{}'));
console.log('Permissions:', JSON.parse(localStorage.getItem('permissions') || '[]'));
console.log('Roles:', JSON.parse(localStorage.getItem('roles') || '[]'));
console.log('Has wildcard?', JSON.parse(localStorage.getItem('permissions') || '[]').includes('*'));
console.log('Has settings.view?', JSON.parse(localStorage.getItem('permissions') || '[]').includes('settings.view'));
console.log('Has admin.access?', JSON.parse(localStorage.getItem('permissions') || '[]').includes('admin.access'));
