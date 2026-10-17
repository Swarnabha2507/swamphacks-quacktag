// Talks to the phone terminal (website/terminal.html on the Pixel) through server.py's relay.
// Same interface as SerialLink, so the dashboard can use either:
//   const link = new TerminalLink();
//   link.onLine = (line) => { ... };          // TAG:<id>, BADTAG:<reason>, SIM:GOOD / SIM:BAD
//   link.onStatus = (connected) => { ... };   // the phone came online / went away
//   link.connect();                           // start listening (no prompt needed)
//   link.send('WAIT', { amount, name, place }); // tell the phone what to show

const TERMINAL_POLL_MS = 500;

class TerminalLink {
  constructor() {
    this.connected = false; // true while the phone terminal is checking in
    this.onLine = () => {};
    this.onStatus = () => {};
    this._since = -1;
    this._timer = null;
  }

  static supported() {
    return true;
  }

  async connect() {
    if (this._timer) return;
    this._timer = setInterval(() => this._poll(), TERMINAL_POLL_MS);
    await this._poll();
  }

  async reconnect() {
    await this.connect();
    return true;
  }

  async disconnect() {
    clearInterval(this._timer);
    this._timer = null;
    this._setConnected(false);
  }

  async send(cmd, details) {
    try {
      await fetch('/api/terminal/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cmd, details }),
      });
    } catch (err) {
      console.warn('Terminal command failed', err);
    }
  }

  async _poll() {
    try {
      const res = await fetch(`/api/terminal/events?since=${this._since}`, { cache: 'no-store' });
      const data = await res.json();
      this._since = data.next;
      this._setConnected(data.phoneOnline);
      for (const event of data.events) this.onLine(event.line);
    } catch {
      this._setConnected(false); // server stopped
    }
  }

  _setConnected(online) {
    if (online === this.connected) return;
    this.connected = online;
    this.onStatus(online);
  }
}
