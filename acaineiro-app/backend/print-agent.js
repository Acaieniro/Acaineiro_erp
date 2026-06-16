const path = require('path');
const fs = require('fs');
const http = require('http');
const { createClient } = require('@libsql/client');
const { PrinterManager } = require('./lib/printer');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const LOG_FILE = path.join(__dirname, 'print-agent.log');
const log = msg => {
  const line = `[${new Date().toLocaleString('pt-BR')}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
};

process.on('uncaughtException', err => log(`UNCAUGHT: ${err.message}`));
process.on('unhandledRejection', err => log(`UNHANDLED: ${err.message}`));

const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!TURSO_URL || !TURSO_TOKEN) {
  log('Turso não configurado. Crie o .env');
  process.exit(1);
}

const db = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });
const all = async (sql, ...params) => (await db.execute({ sql, args: params })).rows;
const printer = new PrinterManager();
const lastPrinted = new Map(); // id -> { time, updated_at }

let pollInterval = null;
let reconectando = false;

async function loadSettings() {
  const rows = await all('SELECT key, value FROM settings');
  const s = {};
  for (const r of rows) s[r.key] = r.value;
  return s;
}

async function pollOrders() {
  try {
    const orders = await all("SELECT * FROM orders WHERE status = 'preparando' ORDER BY id ASC LIMIT 10");
    for (const order of orders) {
      const id = Number(order.id);
      const prev = lastPrinted.get(id);
      const updatedAt = order.updated_at || '';

      // Ja imprimiu esse pedido e o status nao mudou? Pula.
      if (prev && prev.updated_at === updatedAt) continue;

      log(`Imprimindo pedido #${id} - ${order.customer_name}`);
      if (prev) log(`  ↪ Reimpressao (status alterado pelo admin)`);

      try {
        const settings = await loadSettings();
        await printer.printOrder(order, settings);
        log(`Pedido #${id} impresso!`);
        lastPrinted.set(id, { time: Date.now(), updated_at: updatedAt });
      } catch (e) {
        log(`Erro ao imprimir #${id}: ${e.message}`);
      }
    }
  } catch (e) {
    log(`Erro na consulta: ${e.message}`);
    if (!reconectando) {
      reconectando = true;
      setTimeout(() => { reconectando = false; }, 30000);
    }
  }
}

function startHttpServer() {
  const PORT = parseInt(process.env.PRINT_API_PORT) || 3099;

  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const url = new URL(req.url, `http://localhost:${PORT}`);
    const send = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };

    try {
      if (req.method === 'POST' && url.pathname === '/api/print/test') {
        const settings = await loadSettings();
        await printer.printTest(settings);
        send(200, { ok: true, msg: 'Teste enviado!' });
        return;
      }

      if (req.method === 'POST' && url.pathname.startsWith('/api/print/')) {
        const id = url.pathname.split('/').pop();
        if (!id || isNaN(id)) { send(400, { error: 'ID inválido' }); return; }

        const rows = await all('SELECT * FROM orders WHERE id = ?', Number(id));
        if (!rows.length) { send(404, { error: 'Pedido não encontrado' }); return; }

        const settings = await loadSettings();
        const status = printer.getStatus();
        if (!status.configured) { send(400, { error: 'IMPRIMIR_NO_NAVEGADOR' }); return; }

        await printer.printOrder(rows[0], settings);
        lastPrinted.set(id, { time: Date.now(), updated_at: rows[0].updated_at || '' });
        send(200, { ok: true, msg: `Pedido #${id} impresso!` });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/print/status') {
        send(200, printer.getStatus());
        return;
      }

      send(404, { error: 'Rota não encontrada' });
    } catch (e) {
      send(500, { error: e.message });
    }
  });

  server.listen(PORT, '127.0.0.1', () => {
    log(`API HTTP em http://127.0.0.1:${PORT}/api/print/status`);
  });
}

async function init() {
  log('=== AÇAINEIRO - Serviço de Impressão ===');

  let ok = false;
  for (let tentativa = 1; tentativa <= 5; tentativa++) {
    try {
      const test = await all('SELECT COUNT(*) as c FROM orders');
      log(`Turso conectado! ${test[0].c} pedidos`);
      ok = true;
      break;
    } catch (e) {
      log(`Turso falhou (tentativa ${tentativa}/5): ${e.message}`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  if (!ok) {
    log('Não foi possível conectar ao Turso. Encerrando.');
    process.exit(1);
  }

  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    try {
      const settings = await loadSettings();
      await printer.init(settings);
      log(`Impressora: ${printer.getStatus().mode}`);
      break;
    } catch (e) {
      log(`Impressora falhou (tentativa ${tentativa}/3): ${e.message}`);
      if (tentativa < 3) await new Promise(r => setTimeout(r, 2000));
    }
  }

  startHttpServer();

  const interval = parseInt(process.env.POLL_INTERVAL) || 5000;
  pollInterval = setInterval(pollOrders, interval);
  log(`Monitorando a cada ${interval/1000}s...`);
  setTimeout(pollOrders, 500);
}

process.on('SIGINT', () => {
  log('Encerrando...');
  clearInterval(pollInterval);
  process.exit(0);
});

init();
