const fs = require('fs');
const path = require('path');

function analyzeDirectory(dir, results = []) {
    const files = fs.readdirSync(dir);

    for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            analyzeDirectory(fullPath, results);
        } else if (file.endsWith('.js')) {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const lines = content.split('\n').length;
            const sizeKB = (stat.size / 1024).toFixed(2);

            results.push({
                file: fullPath.replace(/\\/g, '/').replace(process.cwd().replace(/\\/g, '/') + '/modules/', ''),
                lines,
                sizeKB
            });
        }
    }

    return results;
}

const modulesDir = path.join(__dirname, 'modules');
const results = analyzeDirectory(modulesDir);

// Sort by lines descending
results.sort((a, b) => b.lines - a.lines);

console.log('\n=== MODULE FILE ANALYSIS ===\n');
console.log('Files with >500 lines:\n');
const largeFiles = results.filter(r => r.lines > 500);
largeFiles.forEach(r => {
    console.log(`${r.lines.toString().padStart(6)} lines | ${r.sizeKB.toString().padStart(8)} KB | ${r.file}`);
});

console.log('\n\nFiles with >1000 lines (CRITICAL):\n');
const criticalFiles = results.filter(r => r.lines > 1000);
criticalFiles.forEach(r => {
    console.log(`${r.lines.toString().padStart(6)} lines | ${r.sizeKB.toString().padStart(8)} KB | ${r.file}`);
});

console.log(`\n\nTotal files analyzed: ${results.length}`);
console.log(`Files >500 lines: ${largeFiles.length}`);
console.log(`Files >1000 lines: ${criticalFiles.length}`);
