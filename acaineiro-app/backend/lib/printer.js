const net = require('net');
const path = require('path');
const fs = require('fs');

// ─── ESC/POS Command Builder ───
class EscPosBuilder {
  constructor() {
    this.buffer = Buffer.from([]);
  }

  init() { return this.add(Buffer.from([0x1B, 0x40, 0x1B, 0x74, 0x03])); } // ESC @ + ESC t 3 (PC860 Portuguese)

  align(n) { return this.add(Buffer.from([0x1B, 0x61, n])); }

  fontSize(w, h) {
    const n = ((h - 1) << 4) | ((w - 1) & 0x0F);
    return this.add(Buffer.from([0x1D, 0x21, n]));
  }

  text(t) { return this.add(Buffer.from(t, 'ascii')); }

  textBR(t) {
    t = t.normalize('NFC');
    return this.add(Buffer.from(t, 'latin1'));
  }

  line(t) { 
    if (t) this.textBR(t);
    return this.add(Buffer.from('\n', 'ascii'));
  }

  feed(n) { return this.add(Buffer.from([0x1B, 0x64, n])); }

  separator(c = '-', len = 42) {
    return this.line(c.repeat(len));
  }

  cut(full = true) {
    return this.add(Buffer.from([0x1D, 0x56, full ? 0x00 : 0x01]));
  }

  doubleHeight(enable = true) {
    return this.add(Buffer.from([0x1B, 0x21, enable ? 0x10 : 0x00]));
  }

  bold(enable = true) {
    return this.add(Buffer.from([0x1B, 0x45, enable ? 0x01 : 0x00]));
  }

  add(buf) {
    this.buffer = Buffer.concat([this.buffer, buf]);
    return this;
  }

  build() { return this.buffer; }

  // ─── Receipt builders ───
  buildReceipt(order, settings) {
    const items = typeof order.items_json === 'string' ? JSON.parse(order.items_json) : (order.items || []);
    const payLabels = { pix: 'Pix', cartao: 'Cartão', dinheiro: 'Dinheiro' };
    const statusLabels = { 'novo': 'NOVO', 'preparando': 'PREPARANDO', 'entregando': 'SAIU P/ ENTREGA', 'entregue': 'ENTREGUE', 'finalizado': 'FINALIZADO', 'cancelado': 'CANCELADO' };
    const storeName = settings.store_name || 'Açaineiro';
    const storeAddress = settings.store_address || '';
    const storePhone = settings.store_phone || '';

    const now = new Date(order.created_at).toLocaleString('pt-BR');

    const COL = 42;

    this.init();
    this.align(1); // center

    // Header
    this.fontSize(2, 2);
    this.line(storeName);
    this.fontSize(1, 1);
    this.line(storeAddress);
    this.line(`Tel: ${storePhone}`);
    this.separator();

    // Order info
    this.fontSize(1, 1);
    this.align(0); // left
    this.bold(true);
    this.line(`Pedido #${order.id}`);
    this.bold(false);
    this.line(`Data: ${now}`);
    this.line(`Status: ${statusLabels[order.status] || order.status}`);
    this.separator();

    // Customer
    this.bold(true);
    this.line('Cliente:');
    this.bold(false);
    this.line(`Nome: ${order.customer_name || ''}`);
    this.line(`Tel: ${order.customer_phone || ''}`);
    if (order.customer_address) {
      this.line(`End: ${order.customer_address || ''}`);
      if (order.customer_neighborhood) this.line(`Bairro: ${order.customer_neighborhood}`);
    }
    if (order.notes) {
      this.line(`Obs: ${order.notes}`);
    }
    this.separator();

    // Items
    this.align(1);
    this.bold(true);
    this.line('-- ITENS DO PEDIDO --');
    this.bold(false);
    this.align(0);
    this.separator('-', COL);

    for (const item of items) {
      const name = `${item.qty}x ${item.name}`;
      const total = (item.price * item.qty).toFixed(2).replace('.', ',');
      const priceStr = `R$ ${total}`;
      const padded = name.length > COL - 10 ? name.slice(0, COL - 13) + '...' : name;
      const spaces = COL - padded.length - priceStr.length;
      this.line(`${padded}${' '.repeat(Math.max(1, spaces))}${priceStr}`);

      if (item.is_combo) {
        const comboItems = item.combo_items || item.items || [];
        for (const ci of comboItems) {
          this.line(`  ${ci.icon || ''} ${ci.name}`);
        }
      }
    }

    this.separator('-', COL);

    // Totals
    this.align(1);
    this.bold(true);
    this.fontSize(2, 2);
    this.line(`TOTAL: R$ ${parseFloat(order.total).toFixed(2).replace('.', ',')}`);
    this.fontSize(1, 1);
    this.bold(false);
    this.align(0);
    if (parseFloat(order.delivery_fee) > 0) {
      this.line(`Frete: R$ ${parseFloat(order.delivery_fee).toFixed(2).replace('.', ',')}`);
    }
    if (order.coupon_code) {
      this.line(`Cupom: ${order.coupon_code}`);
    }

    this.separator();

    // Payment
    this.align(1);
    this.line(`Pagamento: ${payLabels[order.payment_method] || order.payment_method}`);
    if (order.payment_method === 'dinheiro' && order.amount_paid && order.change_due) {
      this.line(`Pago: R$ ${parseFloat(order.amount_paid).toFixed(2).replace('.', ',')}`);
      this.line(`Troco: R$ ${parseFloat(order.change_due).toFixed(2).replace('.', ',')}`);
    }

    this.separator();

    // Footer
    this.align(1);
    this.fontSize(1, 1);
    this.line(`${storeName} - Obrigado pela preferência!`);
    this.line(`📱 ${storePhone}`);
    this.feed(3);
    this.cut(true);

    return this.build();
  }

  buildTestPage() {
    this.init();
    this.align(1);
    this.fontSize(2, 2);
    this.line('AÇAINEIRO');
    this.fontSize(1, 1);
    this.line('Impressão Teste');
    this.separator();
    this.align(0);
    this.line('Modelo: VT-8360');
    this.line('Largura: 80mm');
    this.line(`Data: ${new Date().toLocaleString('pt-BR')}`);
    this.separator();
    this.align(1);
    this.fontSize(2, 2);
    this.line('✅ OK!');
    this.fontSize(1, 1);
    this.line('Impressora configurada com sucesso!');
    this.feed(4);
    this.cut(true);
    return this.build();
  }
}

// ─── Printer Drivers ───
class NetworkPrinter {
  constructor(ip, port = 9100) {
    this.ip = ip;
    this.port = port;
  }

  async print(data) {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      socket.setTimeout(10000);
      socket.connect(this.port, this.ip, () => {
        socket.write(data, (err) => {
          if (err) { socket.destroy(); return reject(err); }
          socket.destroy();
          resolve();
        });
      });
      socket.on('error', reject);
      socket.on('timeout', () => { socket.destroy(); reject(new Error('Timeout')); });
    });
  }

  async test() {
    return this.print(new EscPosBuilder().buildTestPage());
  }
}

class UsbPrinter {
  constructor(vid, pid) {
    this.vid = vid;
    this.pid = pid;
    this.device = null;
  }

  async connect() {
    const { usb } = eval('require')('usb');
    const dev = await usb.findDeviceByIds(this.vid, this.pid);
    if (!dev) throw new Error('Impressora USB não encontrada');
    this.device = dev;
    await dev.open();
    await dev.claimInterface(0);
    // Find OUT endpoint
    const iface = dev.configuration?.interfaces?.[0];
    let outEp = null;
    if (iface) {
      for (const alt of (iface.alternates || [])) {
        for (const ep of (alt.endpoints || [])) {
          if (ep.direction === 'out') outEp = ep.endpointNumber;
        }
      }
    }
    if (!outEp) throw new Error('Endpoint OUT não encontrado');
    this.outEndpoint = outEp;
  }

  async print(data) {
    if (!this.device) await this.connect();
    await this.device.transferOut(this.outEndpoint, data);
  }

  async test() {
    return this.print(new EscPosBuilder().buildTestPage());
  }

  async disconnect() {
    if (this.device) {
      try { await this.device.releaseInterface(0); } catch (e) {}
      try { await this.device.close(); } catch (e) {}
    }
  }
}

class FilePrinter {
  constructor(filePath) {
    this.filePath = filePath;
  }

  async print(data) {
    const filepath = this.filePath || path.join(__dirname, '..', 'last_receipt.bin');
    fs.writeFileSync(filepath, data);
    console.log(`[Printer] Receipt saved to ${filepath}`);
  }

  async test() {
    return this.print(new EscPosBuilder().buildTestPage());
  }
}

// ─── Printer Manager ───
class PrinterManager {
  constructor() {
    this.printer = null;
    this.mode = 'none';
    this.config = {};
  }

  async init(settings) {
    this.config = settings || {};

    const mode = settings.printer_mode || 'usb';
    this.mode = mode;

    if (mode === 'usb') {
      const vid = parseInt(settings.printer_vid || '0x0416', 16);
      const pid = parseInt(settings.printer_pid || '0x5011', 16);
      try {
        this.printer = new UsbPrinter(vid, pid);
        await this.printer.connect();
        console.log(`[Printer] USB printer connected (${vid.toString(16)}:${pid.toString(16)})`);
        return true;
      } catch (e) {
        console.log(`[Printer] USB failed: ${e.message}. Trying network...`);
        this.mode = 'network';
      }
    }

    if (mode === 'network' || this.mode === 'network') {
      const ip = settings.printer_ip || '192.168.1.100';
      const port = parseInt(settings.printer_port) || 9100;
      this.printer = new NetworkPrinter(ip, port);
      console.log(`[Printer] Network printer configured (${ip}:${port})`);
      return true;
    }

    if (mode === 'file') {
      this.printer = new FilePrinter(settings.printer_filepath);
      console.log(`[Printer] File output mode (${settings.printer_filepath || 'default'})`);
      return true;
    }

    // Default: try USB, fallback to file
    try {
      const vid = parseInt('0x0416', 16);
      const pid = parseInt('0x5011', 16);
      this.printer = new UsbPrinter(vid, pid);
      await this.printer.connect();
      console.log('[Printer] USB printer auto-detected');
      this.mode = 'usb';
    } catch (e) {
      this.printer = new FilePrinter();
      this.mode = 'file';
      console.log('[Printer] No printer detected, using file output');
    }
    return true;
  }

  async printOrder(order, settings) {
    if (!this.printer) await this.init(settings);
    const builder = new EscPosBuilder();
    const data = builder.buildReceipt(order, settings || this.config);
    await this.printer.print(data);
  }

  async printTest(settings) {
    if (!this.printer) await this.init(settings);
    const builder = new EscPosBuilder();
    const data = builder.buildTestPage();
    await this.printer.print(data);
  }

  getStatus() {
    return {
      mode: this.mode,
      configured: !!this.printer,
      config: {
        mode: this.config.printer_mode || 'usb',
        ip: this.config.printer_ip,
        port: this.config.printer_port,
        vid: this.config.printer_vid,
        pid: this.config.printer_pid
      }
    };
  }
}

module.exports = { PrinterManager, EscPosBuilder, NetworkPrinter, UsbPrinter, FilePrinter };
