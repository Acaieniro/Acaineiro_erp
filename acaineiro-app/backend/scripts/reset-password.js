require('dotenv').config();
const { createClient } = require('@libsql/client');
const crypto = require('crypto');

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN
});

async function main() {
  const phone = '31972497228';
  const newPass = '123456';

  const r = await db.execute({ sql: 'SELECT id, name, phone FROM users WHERE phone=?', args: [phone] });
  const user = r.rows[0];
  if (!user) {
    console.log('Usuário não encontrado');
    return;
  }
  console.log('Usuário:', JSON.stringify(user));

  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(newPass, salt, 64).toString('hex');
  const passwordHash = salt + ':' + hash;
  const token = crypto.randomBytes(32).toString('hex');

  await db.execute({ sql: 'UPDATE users SET password_hash=?, auth_token=? WHERE phone=?', args: [passwordHash, token, phone] });
  console.log('Senha resetada para:', newPass);
}
main().catch(console.error);
