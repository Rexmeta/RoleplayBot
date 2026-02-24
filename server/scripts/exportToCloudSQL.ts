import { Pool } from "pg";

const TABLES_TO_EXPORT = [
  "supported_languages",
  "companies",
  "organizations",
  "categories",
  "users",
  "operator_assignments",
  "scenarios",
  "mbti_personas",
  "evaluation_criteria_sets",
  "evaluation_dimensions",
  "system_settings",
  "scenario_translations",
  "persona_translations",
  "category_translations",
  "evaluation_criteria_set_translations",
  "evaluation_dimension_translations",
];

function buildPoolConfig(url: string): import("pg").PoolConfig {
  try {
    const parsed = new URL(url);
    const hostParam = parsed.searchParams.get("host");
    if (hostParam && hostParam.startsWith("/cloudsql/")) {
      return {
        host: hostParam,
        user: parsed.username,
        password: parsed.password,
        database: parsed.pathname.slice(1),
        ssl: false,
      };
    }
  } catch {}
  const isUnixSocket = url.includes("/cloudsql/");
  const disableSsl = url.includes("sslmode=disable") || isUnixSocket;
  return {
    connectionString: url,
    ssl: disableSsl ? false : { rejectUnauthorized: false },
  };
}

async function getTableColumns(
  pool: Pool,
  tableName: string,
): Promise<string[]> {
  const result = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`,
    [tableName],
  );
  return result.rows.map((r: any) => r.column_name);
}

async function exportTable(
  source: Pool,
  target: Pool,
  tableName: string,
): Promise<number> {
  const sourceColumns = await getTableColumns(source, tableName);
  const targetColumns = await getTableColumns(target, tableName);

  if (sourceColumns.length === 0) {
    console.log(`  ⏭️  Source table "${tableName}" not found or empty schema`);
    return 0;
  }
  if (targetColumns.length === 0) {
    console.log(`  ⏭️  Target table "${tableName}" not found or empty schema`);
    return 0;
  }

  const commonColumns = sourceColumns.filter((c) => targetColumns.includes(c));
  if (commonColumns.length === 0) {
    console.log(`  ⏭️  No common columns for "${tableName}"`);
    return 0;
  }

  const columnList = commonColumns.map((c) => `"${c}"`).join(", ");
  const rows = await source.query(
    `SELECT ${columnList} FROM "${tableName}"`,
  );

  if (rows.rows.length === 0) {
    console.log(`  ⏭️  "${tableName}" has 0 rows`);
    return 0;
  }

  const client = await target.connect();
  try {
    await client.query("BEGIN");

    const pkResult = await target.query(
      `SELECT a.attname FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
       WHERE i.indrelid = $1::regclass AND i.indisprimary`,
      [tableName],
    );
    const pkColumns = pkResult.rows.map((r: any) => r.attname);

    let inserted = 0;
    const batchSize = 50;

    for (let i = 0; i < rows.rows.length; i += batchSize) {
      const batch = rows.rows.slice(i, i + batchSize);

      for (const row of batch) {
        const values = commonColumns.map((c) => row[c]);
        const placeholders = values.map((_, idx) => `$${idx + 1}`).join(", ");

        let query: string;
        if (pkColumns.length > 0) {
          const conflictCols = pkColumns.map((c) => `"${c}"`).join(", ");
          const updateCols = commonColumns
            .filter((c) => !pkColumns.includes(c))
            .map((c) => `"${c}" = EXCLUDED."${c}"`)
            .join(", ");

          if (updateCols) {
            query = `INSERT INTO "${tableName}" (${columnList}) VALUES (${placeholders}) ON CONFLICT (${conflictCols}) DO UPDATE SET ${updateCols}`;
          } else {
            query = `INSERT INTO "${tableName}" (${columnList}) VALUES (${placeholders}) ON CONFLICT (${conflictCols}) DO NOTHING`;
          }
        } else {
          query = `INSERT INTO "${tableName}" (${columnList}) VALUES (${placeholders})`;
        }

        try {
          const result = await client.query(query, values);
          inserted += result.rowCount ?? 0;
        } catch (err: any) {
          console.error(
            `  ❌ Row insert failed for "${tableName}":`,
            err.message,
          );
        }
      }
    }

    await client.query("COMMIT");
    return inserted;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  const sourceUrl = process.env.DATABASE_URL;
  const targetUrl = process.env.TARGET_DATABASE_URL;

  if (!sourceUrl) {
    console.error("❌ DATABASE_URL (source Neon DB) is not set");
    process.exit(1);
  }
  if (!targetUrl) {
    console.error("❌ TARGET_DATABASE_URL (target Cloud SQL) is not set");
    console.error(
      "   Set it like: TARGET_DATABASE_URL=postgresql://user:pass@host:5432/db",
    );
    process.exit(1);
  }

  console.log("🔄 Neon DB → Cloud SQL data export");
  console.log("━".repeat(50));

  const source = new Pool({
    ...buildPoolConfig(sourceUrl),
    connectionTimeoutMillis: 10000,
  });
  const target = new Pool({
    ...buildPoolConfig(targetUrl),
    connectionTimeoutMillis: 10000,
  });

  try {
    const sourceTest = await source.query("SELECT 1");
    console.log("✅ Source (Neon DB) connected");

    const targetTest = await target.query("SELECT 1");
    console.log("✅ Target (Cloud SQL) connected");

    console.log("━".repeat(50));

    const results: { table: string; count: number }[] = [];

    for (const table of TABLES_TO_EXPORT) {
      try {
        console.log(`📦 Exporting "${table}"...`);
        const count = await exportTable(source, target, table);
        results.push({ table, count });
        console.log(
          `  ✅ ${count} rows upserted`,
        );
      } catch (err: any) {
        console.error(`  ❌ Failed: ${err.message}`);
        results.push({ table, count: -1 });
      }
    }

    console.log("\n" + "━".repeat(50));
    console.log("📊 Export Summary:");
    for (const r of results) {
      const status =
        r.count < 0 ? "❌ FAILED" : r.count === 0 ? "⏭️  SKIPPED" : `✅ ${r.count} rows`;
      console.log(`  ${r.table}: ${status}`);
    }

    const totalRows = results
      .filter((r) => r.count > 0)
      .reduce((sum, r) => sum + r.count, 0);
    const failedTables = results.filter((r) => r.count < 0).length;
    console.log(
      `\n🏁 Done: ${totalRows} total rows exported, ${failedTables} failures`,
    );
  } finally {
    await source.end();
    await target.end();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
