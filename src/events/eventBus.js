const EventEmitter = require('events');

class EventBus extends EventEmitter {
  constructor() {
    super();
    this.seq = 0;
    this.setMaxListeners(200);
  }

  publish(type, data = {}) {
    this.seq += 1;
    const event = {
      seq: this.seq,
      type,
      ts: new Date().toISOString(),
      data
    };
    this.emit('event', event);
    return event;
  }

  subscribe(listener) {
    this.on('event', listener);
    return () => this.off('event', listener);
  }
}

module.exports = new EventBus();
