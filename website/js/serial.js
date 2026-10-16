// Talks to the SwampTag Arduino over USB using the Web Serial API (Chrome / Edge).
// Usage:
//   const link = new SerialLink();
//   link.onLine = (line) => { ... };          // every line the Arduino prints
//   link.onStatus = (connected) => { ... };   // connection changes
//   await link.connect();                     // must be called from a click
//   link.send('OK');

class SerialLink {
  constructor() {
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.connected = false;
    this.onLine = () => {};
    this.onStatus = () => {};

    if (SerialLink.supported()) {
      navigator.serial.addEventListener('disconnect', (e) => {
        if (e.target === this.port) this._closed();
      });
    }
  }

  static supported() {
    return 'serial' in navigator;
  }

  // Ask the user to pick a port. Needs a user gesture (button click).
  async connect() {
    const port = await navigator.serial.requestPort();
    await this._open(port);
  }

  // Reconnect to a port the user already allowed earlier (no prompt needed).
  async reconnect() {
    if (!SerialLink.supported()) return false;
    const ports = await navigator.serial.getPorts();
    if (ports.length === 0) return false;
    try {
      await this._open(ports[0]);
      return true;
    } catch {
      return false;
    }
  }

  async send(text) {
    if (!this.writer) return;
    try {
      await this.writer.write(text + '\n');
    } catch (err) {
      console.warn('Serial write failed', err);
    }
  }

  async disconnect() {
    try { await this.reader?.cancel(); } catch {}
    try { await this.writer?.close(); } catch {}
    try { await this.port?.close(); } catch {}
    this._closed();
  }

  async _open(port) {
    await port.open({ baudRate: 115200 });
    this.port = port;

    const encoder = new TextEncoderStream();
    encoder.readable.pipeTo(port.writable).catch(() => {});
    this.writer = encoder.writable.getWriter();

    this.connected = true;
    this.onStatus(true);
    this._readLoop();
  }

  async _readLoop() {
    const decoder = new TextDecoderStream();
    this.port.readable.pipeTo(decoder.writable).catch(() => {});
    this.reader = decoder.readable.getReader();

    let buffer = '';
    try {
      while (true) {
        const { value, done } = await this.reader.read();
        if (done) break;
        buffer += value;
        let idx;
        while ((idx = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (line) this.onLine(line);
        }
      }
    } catch (err) {
      console.warn('Serial read stopped', err);
    } finally {
      this._closed();
    }
  }

  _closed() {
    if (!this.connected) return;
    this.connected = false;
    this.reader = null;
    this.writer = null;
    this.port = null;
    this.onStatus(false);
  }
}
