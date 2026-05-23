require('dotenv').config();
const { query } = require('../config/database');

async function analyzeDbSize() {
    try {
        const dbUrl = process.env.DATABASE_URL || 'Local / Default';
        console.log("=========================================================================================");
        console.log(`Analyzing PostgreSQL Database: ${dbUrl.replace(/:[^:@]+@/, ':***@')}`);
        console.log("=========================================================================================\n");

        const sql = `
            SELECT
                c.relname AS "table_name",
                c.reltuples::bigint AS "row_count",
                pg_size_pretty(pg_total_relation_size(c.oid)) AS "total_size",
                pg_size_pretty(pg_relation_size(c.oid)) AS "table_size",
                pg_size_pretty(pg_total_relation_size(c.oid) - pg_relation_size(c.oid) - COALESCE(pg_total_relation_size(c.reltoastrelid), 0)) AS "index_size",
                pg_size_pretty(COALESCE(pg_total_relation_size(c.reltoastrelid), 0)) AS "toast_size",
                pg_total_relation_size(c.oid) AS "raw_bytes"
            FROM pg_class c
            LEFT JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' 
              AND c.relkind = 'r'
            ORDER BY pg_total_relation_size(c.oid) DESC;
        `;

        const result = await query(sql);

        if (result.rows.length === 0) {
            console.log("No user tables found in the database.");
            return;
        }

        // Print header
        console.log(
            "TABLE NAME".padEnd(30) +
            "ROWS".padEnd(10) +
            "TOTAL".padEnd(12) +
            "DATA".padEnd(12) +
            "INDEXES".padEnd(12) +
            "TOAST (VECTORS/LOBs)"
        );
        console.log("-".repeat(95));

        // Print rows
        result.rows.forEach(row => {
            console.log(
                row.table_name.padEnd(30) +
                String(row.row_count).padEnd(10) +
                row.total_size.padEnd(12) +
                row.table_size.padEnd(12) +
                row.index_size.padEnd(12) +
                row.toast_size
            );
        });

        console.log("-".repeat(95));
        console.log(`\nNote: Vector embeddings, large text arrays, and JSONB are stored in TOAST tables.`);
        console.log(`If your total size is just KB's, confirm the row count above is populated as expected!`);

    } catch (e) {
        console.error("\n[Error analyzing DB size]:", e.message);
    } finally {
        process.exit();
    }
}

analyzeDbSize();
