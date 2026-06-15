require('dotenv').config();
const { createClient } = require('@libsql/client');
const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN
});
async function main() {
  const r = await db.execute({ sql: "SELECT id, status, total FROM orders ORDER BY id", args: [] });
  console.log('Orders count:', r.rows.length);
  for (const o of r.rows) {
    console.log(`  #${o.id} status='${o.status}' total=${o.total}`);
  }
}
main().catch(console.error);
