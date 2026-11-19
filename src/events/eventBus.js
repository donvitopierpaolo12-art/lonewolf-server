const EventEmitter = require('events');
const crypto = require('crypto');

class EventBus extends EventEmitter {
  constructor() {
    super();
    this.seq = 0;
    this.bootId = crypto.randomUUID();
    this.listenerErrors = 0;
    this.setMaxListeners(200);
  }

  publish(type, data = {}) {
    this.seq += 1;
    const event = {
      seq: this.seq,
      boot: this.bootId,
      type,
      ts: new Date().toISOString(),
      data
    };
    const listeners = [...this.listeners('event')];
    let firstError = null;
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (err) {
        this.listenerErrors += 1;
        if (!firstError) firstError = err;
        console.error(`[BUS] errore listener su "${type}": ${err && err.message ? err.message : err}`);
      }
    }
    if (firstError) {
      const message = String(firstError && firstError.message ? firstError.message : firstError);
      const source = type;
      setImmediate(() => {
        this.publish('bus_error', { source, message });
      });
    }
    return event;
  }

  subscribe(listener) {
    this.on('event', listener);
    return () => this.off('event', listener);
  }
}

module.exports = new EventBus();
