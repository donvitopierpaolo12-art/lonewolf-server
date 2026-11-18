const eventBus = require('../events/eventBus');

const HANDLERS = {
  core: new Map(),
  guard: new Map()
};

const ALLOWED = new Map([
  ['core', new Set(['integrity_request'])],
  ['guard', new Set(['threat_report', 'digest', 'integrity_result'])]
]);

const comms = [];

const anchor = { seq: 0, hash: '0'.repeat(64) };

function anchorRegistry(seq, hash) {
  if (seq >= anchor.seq) {
    anchor.seq = seq;
    anchor.hash = hash;
  }
}

function currentAnchor() {
  return { seq: anchor.seq, hash: anchor.hash };
}

function record(to, from, type, accepted) {
  comms.unshift({
    ts: new Date().toISOString(),
    from,
    to,
    type,
    accepted
  });
  if (comms.length > 100) comms.pop();
}

function send(from, to, type, payload = {}) {
  const recipients = HANDLERS[to];
  const allowedTypes = ALLOWED.get(from);

  if (!recipients || !allowedTypes) {
    record('nessuno', from, type, false);
    return { accepted: false, reason: 'mittente o destinatario non registrato' };
  }
  if (!allowedTypes.has(type)) {
    record(to, from, type, false);
    return { accepted: false, reason: `messaggio "${type}" non consentito per "${from}"` };
  }

  const handler = recipients.get(type);
  if (!handler) {
    record(to, from, type, false);
    return { accepted: false, reason: `nessun gestore attivo per "${type}"` };
  }

  record(to, from, type, true);
  eventBus.publish('agents', {
    scope: 'comm',
    from,
    to,
    type
  });

  try {
    handler(payload, from);
    return { accepted: true };
  } catch (err) {
    record(to, from, `${type}:error`, false);
    return { accepted: false, reason: err.message };
  }
}

function register(agent, type, handler) {
  if (!HANDLERS[agent]) throw new Error(`agente "${agent}" non registrato`);
  HANDLERS[agent].set(type, handler);
}

function unregisterAll(agent) {
  if (HANDLERS[agent]) HANDLERS[agent].clear();
}

function recent(n = 20) {
  return comms.slice(0, n);
}

function count() {
  return comms.length;
}

module.exports = { send, register, unregisterAll, recent, count, anchorRegistry, currentAnchor };
