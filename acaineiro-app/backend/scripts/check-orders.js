require('dotenv').config();
const { createClient } = require('@libsql/client');

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN
});

async function main() {
  const orders = await db.execute({ sql: 'SELECT id, customer_name, status, total, created_at FROM orders ORDER BY id DESC LIMIT 10', args: [] });
  console.log('Total pedidos:', orders.rows.length);
  for (const o of orders.rows) {
    console.log(`  #${o.id} | ${o.customer_name} | ${o.status} | R$ ${o.total} | ${o.created_at}`);
  }
  if (orders.rows.length === 0) {
    console.log('Nenhum pedido encontrado');
  }
}
main().catch(console.error);
