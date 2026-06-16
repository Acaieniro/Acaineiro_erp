const path = require('path');
const { PrinterManager } = require('./lib/printer');
require('dotenv').config({ path: path.join(__dirname, '.env') });

async function test() {
  console.log('');
  console.log('╔══════════════════════════════════════╗');
  console.log('║   🧪 TESTE DE IMPRESSÃO AÇAINEIRO    ║');
  console.log('╠══════════════════════════════════════╣');

  const printer = new PrinterManager();
  await printer.init({ printer_mode: 'usb' });

  const status = printer.getStatus();
  console.log(`║  📡 Modo: ${status.mode}`);
  console.log(`║  🔌 Configurado: ${status.configured}`);

  if (!status.configured) {
    console.log('╠══════════════════════════════════════╣');
    console.log('║  ❌ Impressora não encontrada!       ║');
    console.log('║  Verifique o cabo USB e o driver     ║');
    console.log('╚══════════════════════════════════════╝');
    return;
  }

  console.log('╠══════════════════════════════════════╣');
  console.log('║  🖨️ Enviando página de teste...       ║');
  console.log('╚══════════════════════════════════════╝');

  await printer.printTest({});
  console.log('✅ Teste enviado! Verifique a impressora.');
}

test().catch(e => console.log('❌ Erro:', e.message));
