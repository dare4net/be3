const axios = require('axios');
async function check() {
    try {
        const res = await axios.get('http://localhost:3000/health');
        console.log(JSON.stringify(res.data, null, 2));
        process.exit(0);
    } catch (e) {
        console.error('Server Unreachable:', e.message);
        process.exit(1);
    }
}
check();
