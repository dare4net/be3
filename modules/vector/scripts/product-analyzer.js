/**
 * Product Embedding Analyzer & Pruner
 * 
 * Standalone REPL for analyzing product semantic overlaps.
 * 
 * Usage:
 *   node modules/vector/scripts/product-analyzer.js
 */

require('dotenv').config();
const readline = require('readline');
const { query } = require('../../../config/database');
const VectorEngine = require('../services/VectorEngine');

const C = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    red: '\x1b[31m',
    dim: '\x1b[2m',
    magenta: '\x1b[35m',
    white: '\x1b[37m'
};

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

/**
 * Spherical K-Means (Cosine-based)
 */
class KMeans {
    constructor(k, data, maxIterations = 50) {
        this.k = k;
        this.data = data; // Array of embeddings
        this.maxIterations = maxIterations;
        this.centroids = [];
        this.assignments = [];
        this.inertia = 0;
    }

    initCentroids() {
        const indices = new Set();
        while (indices.size < Math.min(this.k, this.data.length)) {
            indices.add(Math.floor(Math.random() * this.data.length));
        }
        this.centroids = Array.from(indices).map(i => [...this.data[i]]);
    }

    cosineDistance(a, b) {
        let dot = 0;
        for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
        }
        return 1 - dot;
    }

    fit(n_init = 5) {
        let bestInertia = Infinity;
        let bestCentroids = [];
        let bestAssignments = [];

        for (let i = 0; i < n_init; i++) {
            this.runOnce();
            if (this.inertia < bestInertia) {
                bestInertia = this.inertia;
                bestCentroids = [...this.centroids.map(c => [...c])];
                bestAssignments = [...this.assignments];
            }
        }

        this.inertia = bestInertia;
        this.centroids = bestCentroids;
        this.assignments = bestAssignments;
    }

    runOnce() {
        this.initCentroids();
        let changed = true;
        let iter = 0;
        this.assignments = [];

        while (changed && iter < this.maxIterations) {
            changed = false;
            iter++;

            const newAssignments = [];
            for (let i = 0; i < this.data.length; i++) {
                let minDist = Infinity;
                let clusterIndex = 0;
                for (let j = 0; j < this.centroids.length; j++) {
                    const dist = this.cosineDistance(this.data[i], this.centroids[j]);
                    if (dist < minDist) {
                        minDist = dist;
                        clusterIndex = j;
                    }
                }
                newAssignments.push(clusterIndex);
            }

            if (JSON.stringify(newAssignments) !== JSON.stringify(this.assignments)) {
                changed = true;
                this.assignments = newAssignments;
            } else {
                changed = false;
            }

            const newCentroids = Array.from({ length: this.centroids.length }, () => new Array(this.data[0].length).fill(0));
            const counts = new Array(this.centroids.length).fill(0);

            for (let i = 0; i < this.data.length; i++) {
                const c = this.assignments[i];
                counts[c]++;
                for (let j = 0; j < this.data[0].length; j++) {
                    newCentroids[c][j] += this.data[i][j];
                }
            }

            for (let i = 0; i < this.centroids.length; i++) {
                if (counts[i] > 0) {
                    let magnitude = 0;
                    for (let j = 0; j < this.data[0].length; j++) {
                        newCentroids[i][j] /= counts[i];
                        magnitude += newCentroids[i][j] * newCentroids[i][j];
                    }
                    magnitude = Math.sqrt(magnitude);
                    if (magnitude > 0) {
                        for (let j = 0; j < this.data[0].length; j++) {
                            newCentroids[i][j] /= magnitude;
                        }
                    }
                    this.centroids[i] = newCentroids[i];
                }
            }
        }

        this.inertia = 0;
        for (let i = 0; i < this.data.length; i++) {
            this.inertia += this.cosineDistance(this.data[i], this.centroids[this.assignments[i]]);
        }
    }
}

function cosineDistance(a, b) {
    let dot = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
    }
    return 1 - dot;
}

async function suggestOptimalK(data) {
    console.log(`${C.dim}Finding optimal clusters (Elbow Method)...${C.reset}`);
    const maxK = Math.min(15, Math.floor(data.length / 3) + 1);
    const inertias = [];
    for (let k = 1; k <= maxK; k++) {
        const km = new KMeans(k, data);
        km.fit(5);
        inertias.push(km.inertia);
    }
    let bestK = 1;
    let maxDrop = 0;
    for (let i = 1; i < inertias.length - 1; i++) {
        const drop = (inertias[i-1] - inertias[i]) / (inertias[i] - inertias[i+1] || 1);
        if (drop > maxDrop) {
            maxDrop = drop;
            bestK = i + 1;
        }
    }
    return bestK;
}

async function main() {
    const TENANT_ID = process.env.TENANT_ID;
    if (!TENANT_ID) {
        console.error('❌ TENANT_ID not set in .env');
        process.exit(1);
    }

    console.log(`\n${C.bold}${C.blue}╔══════════════════════════════════════════════╗
║        Product Semantic Analyzer             ║
╚══════════════════════════════════════════════╝${C.reset}`);

    while (true) {
        // 1. Fetch Categories
        const catRes = await query(
            `SELECT id, name FROM categories WHERE tenant_id = $1 ORDER BY name`,
            [TENANT_ID]
        );
        const categories = catRes.rows;

        console.log(`\n${C.bold}Select Scope:${C.reset}`);
        console.log(`  ${C.cyan}0. All Products${C.reset}`);
        categories.forEach((c, i) => console.log(`  ${C.cyan}${i + 1}. ${c.name}${C.reset}`));

        const choice = await question(`\nSelect ID (or ':q' to quit): `);
        if (choice === ':q' || choice === 'exit') break;

        let sql = `SELECT id, name, embedding::text FROM products WHERE tenant_id = $1 AND status = 'active' AND embedding IS NOT NULL`;
        const params = [TENANT_ID];
        let label = 'All Products';

        if (choice !== '0') {
            const catIndex = parseInt(choice) - 1;
            if (categories[catIndex]) {
                sql += ` AND id IN (SELECT product_id FROM product_categories WHERE category_id = $2)`;
                params.push(categories[catIndex].id);
                label = `Category: ${categories[catIndex].name}`;
            } else {
                console.log(`${C.red}Invalid selection.${C.reset}`);
                continue;
            }
        }

        console.log(`${C.dim}Fetching data...${C.reset}`);
        const prodRes = await query(sql, params);
        const rawProducts = prodRes.rows.map(r => ({
            id: r.id,
            name: r.name,
            embedding: JSON.parse(r.embedding)
        }));

        if (rawProducts.length === 0) {
            console.log(`${C.yellow}No products with embeddings found in this scope.${C.reset}`);
            continue;
        }

        // Shuffle
        for (let i = rawProducts.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [rawProducts[i], rawProducts[j]] = [rawProducts[j], rawProducts[i]];
        }

        console.log(`\nAnalyzing ${C.bold}${label}${C.reset} (${rawProducts.length} products)...`);
        console.log(`\n${C.bold}Select Mode:${C.reset}`);
        console.log(`  ${C.cyan}1. Clustering${C.reset} (Group items together)`);
        console.log(`  ${C.cyan}2. Pruning${C.reset} (Identify redundant products)`);
        
        const mode = await question(`Choice (1/2): `);
        const embeddings = rawProducts.map(p => p.embedding);

        if (mode === '2') {
            const thresholdStr = await question(`Enter cosine distance threshold (default 0.1): `);
            const threshold = parseFloat(thresholdStr) || 0.1;

            const kept = [];
            const pruned = [];

            for (let i = 0; i < rawProducts.length; i++) {
                let minDistance = Infinity;
                let closest = null;

                for (const k of kept) {
                    const d = cosineDistance(embeddings[i], k.embedding);
                    if (d < minDistance) {
                        minDistance = d;
                        closest = k.name;
                    }
                }

                if (minDistance < threshold) {
                    pruned.push({ name: rawProducts[i].name, distance: minDistance, closest });
                } else {
                    kept.push({ name: rawProducts[i].name, embedding: embeddings[i] });
                }
            }

            console.log(`\n${C.bold}${C.red}--- REDUNDANT PRODUCTS (${pruned.length}) ---${C.reset}`);
            pruned.forEach(p => {
                console.log(`  ${C.red}✗${C.reset} ${p.name} ${C.dim}(similar to: "${p.closest}", dist: ${p.distance.toFixed(4)})${C.reset}`);
            });

            console.log(`\n${C.bold}${C.magenta}═══ Summary ═══${C.reset}`);
            console.log(`  Total:     ${rawProducts.length}`);
            console.log(`  Unique:    ${kept.length}`);
            console.log(`  Redundant: ${pruned.length} (${((pruned.length/rawProducts.length)*100).toFixed(1)}%)`);

        } else {
            const suggestedK = await suggestOptimalK(embeddings);
            const kStr = await question(`Number of clusters (Enter for suggested ${suggestedK}): `);
            const k = parseInt(kStr) || suggestedK;

            const kmeans = new KMeans(k, embeddings);
            kmeans.fit(8);

            const clusters = Array.from({ length: k }, () => []);
            kmeans.assignments.forEach((assignment, i) => {
                clusters[assignment].push({
                    name: rawProducts[i].name,
                    dist: cosineDistance(embeddings[i], kmeans.centroids[assignment])
                });
            });

            clusters.forEach((cluster, i) => {
                cluster.sort((a, b) => a.dist - b.dist);
                console.log(`\n${C.bold}${C.yellow}Cluster #${i+1}${C.reset} (${cluster.length} items)`);
                console.log(`${C.dim}Center: ${C.reset}${C.bold}${cluster[0].name}${C.reset}`);
                cluster.forEach((item, j) => {
                    const color = j === 0 ? C.green : (item.dist < 0.1 ? C.dim : C.white);
                    console.log(`  ${color}• ${item.name}${C.reset} ${C.dim}(dist: ${item.dist.toFixed(4)})${C.reset}`);
                });
            });
        }
        await question(`\nPress Enter to continue...`);
    }
    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
