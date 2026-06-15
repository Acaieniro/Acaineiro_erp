require('dotenv').config();
const { createClient } = require('@libsql/client');
const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN
});
db.execute({
  sql: "SELECT payment_method, payment_method_detail, COUNT(*) as count, SUM(total) as total FROM orders WHERE status NOT IN ('novo','cancelado') GROUP BY payment_method, payment_method_detail",
  args: []
}).then(r => { console.log(JSON.stringify(r.rows)); process.exit(0); }).catch(e => { console.error(e); process.exit(1); });
