// Talks to the QuackTag Arduino over USB using the Web Serial API (Chrome / Edge).
// Usage:
//   const link = new SerialLink();
//   link.onLine = (line) => { ... };          // every line the Arduino prints
//   link.onStatus = (connected) => { ... };   // connection changes
//   await link.connect();                     // must be called from a click
//   link.send('OK');
//
// Closing a Web Serial port only works once nothing is using its streams, so
// disconnect() shuts things down in order: stop reading → wait for the read pipe
// to let go → close the writer → wait for the write pipe → close the port.
// Skipping a step leaves the port open, and the next connect() then fails with
// "The port is already open".

const BAUD_RATE = 115200;

class SerialLink {
  constructor() {
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.connected = false;
    this.autoReconnect = true; // reopen the reader by itself when it's plugged back in
    this.onLine = () => {};
    this.onStatus = () => {};

    this._busy = false;      // true while opening or closing, so clicks can't overlap
    this._readDone = null;   // settles when the port → decoder pipe has stopped
    this._writeDone = null;  // settles when the encoder → port pipe has stopped

    if (SerialLink.supported()) {
      // Cable pulled out: the browser closes the port; clean up our side too.
      navigator.serial.addEventListener('disconnect', (e) => {
        if (e.target === this.port) this._shutdown();
      });
      // A port this page was allowed to use before was plugged back in.
      navigator.serial.addEventListener('connect', (e) => {
        if (this.autoReconnect && !this.connected && !this._busy) this._open(e.target).catch(() => {});
      });
    }
  }

  static supported() {
    return 'serial' in navigator;
  }

  // Ask the user to pick a port. Needs a user gesture (button click).
  async connect() {
    if (this.connected || this._busy) return;
    const port = await navigator.serial.requestPort();
    await this._open(port);
  }

  // Reconnect to a port the user already allowed earlier (no prompt needed).
  async reconnect() {
    if (!SerialLink.supported() || this.connected || this._busy) return false;
    for (const port of await navigator.serial.getPorts()) {
      try {
        await this._open(port);
        return true;
      } catch {
        // Busy (e.g. Serial Monitor has it) or unplugged: try the next one.
      }
    }
    return false;
  }

  async send(text) {
    if (!this.connected || !this.writer) return;
    try {
      await this.writer.write(text + '\n');
    } catch (err) {
      console.warn('Serial write failed', err);
    }
  }

  async disconnect() {
    await this._shutdown();
  }

  async _open(port) {
    if (this.connected || this._busy) return;
    this._busy = true;
    try {
      await port.open({ baudRate: BAUD_RATE });

      const encoder = new TextEncoderStream();
      this._writeDone = encoder.readable.pipeTo(port.writable).catch(() => {});
      this.writer = encoder.writable.getWriter();

      const decoder = new TextDecoderStream();
      this._readDone = port.readable.pipeTo(decoder.writable).catch(() => {});
      this.reader = decoder.readable.getReader();

      this.port = port;
      this.connected = true;
    } finally {
      this._busy = false;
    }
    this.onStatus(true);
    this._readLoop(this.reader);
  }

  async _readLoop(reader) {
    let buffer = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
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
      if (this.connected) console.warn('Serial read stopped', err);
    }
    // Reading stopped without disconnect() (e.g. the board reset or the cable came
    // out): close everything properly so Connect works again.
    if (this.reader === reader) this._shutdown();
  }

  async _shutdown() {
    if (this._busy || !this.port) return;
    this._busy = true;
    const { port, reader, writer } = this;
    const wasConnected = this.connected;
    this.connected = false;
    try {
      try { await reader?.cancel(); } catch {}
      await this._readDone;
      try { await writer?.close(); } catch {}
      await this._writeDone;
      try { await port.close(); } catch {} // already closed if the cable was pulled
    } finally {
      this.port = null;
      this.reader = null;
      this.writer = null;
      this._readDone = null;
      this._writeDone = null;
      this._busy = false;
    }
    if (wasConnected) this.onStatus(false);
  }
}
