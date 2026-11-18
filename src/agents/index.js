const eventBus = require('../events/eventBus');
const protocol = require('./protocol');
const core = require('./core');
const guard = require('./guard');

let running = false;
let sessionSeq = 0;
let lastPush = 0;
let pushTimer = null;
let unsubscribe = null;

function start() {
  if (running) return;
  running = true;
  sessionSeq += 1;
  const sessionId = `S-${String(sessionSeq).padStart(4, '0')}-${Date.now().toString(36)}`;

  guard.start(sessionId);
  core.start(sessionId);
  console.log(`[AGENTI] LONEWOLF CORE & GUARD ONLINE (sessione ${sessionId})`);

  unsubscribe = eventBus.subscribe((event) => {
    if (event.type !== 'agents') return;
    if (event.data.scope === 'status' || event.data.scope === 'guard_threat') {
      pushState(true);
    }
  });

  eventBus.publish('agents', { scope: 'lifecycle', state: 'started', sessionId });
}

function stop() {
  if (!running) return;
  running = false;
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  core.stop();
  guard.stop();
  eventBus.publish('agents', { scope: 'lifecycle', state: 'stopped' });
}

function pushState(immediate = false) {
  const now = Date.now();
  if (!immediate && now - lastPush < 2500) return;
  lastPush = now;
  eventBus.publish('agents', {
    scope: 'snapshot',
    core: { status: core.status.status, activity: core.status.currentActivity },
    guard: { status: guard.status.status, activity: guard.status.currentActivity, threatLevel: guard.status.threatLevel }
  });
}

function startPublisher() {
  if (pushTimer) return;
  pushTimer = setInterval(() => pushState(false), 3000);
}

function stopPublisher() {
  if (pushTimer) {
    clearInterval(pushTimer);
    pushTimer = null;
  }
}

function snapshot() {
  const head = guard.registryTail(1)[0];
  const anchor = protocol.currentAnchor();
  return {
    running,
    registryAnchored: Boolean(head && anchor.seq > 0 && head.seq === anchor.seq && head.hash === anchor.hash),
    core: core.snapshot(),
    guard: guard.snapshot(),
    comms: protocol.recent(20),
    commsTotal: protocol.count()
  };
}

module.exports = { start, stop, snapshot, startPublisher, stopPublisher, pushState };
