const crypto = require('crypto');
const config = require('../config');
const eventBus = require('../events/eventBus');
const protocol = require('./protocol');
const { ROLES } = require('./permissions');

const LEVELS = ['NORMALE', 'ATTENZIONE', 'ALLERTA', 'CRITICO'];

const status = {
  role: ROLES.guard,
  sessionId: null,
  status: 'OFFLINE',
  startedAt: null,
  lastCheckAt: null,
  currentActivity: 'in attesa di avvio',
  lastEvent: null,
  eventsAnalyzed: 0,
  errors: 0,
  threatLevel: 'NORMALE',
  integrity: 'mai verificata'
};

const registry = [];
let prevHash = '0'.repeat(64);

let recentEvents = [];
let repeatedSources = new Map();
let findings = [];
let unsubscribe = null;
let digestTimer = null;

function appendLog(type, detail) {
  const now = Date.now();
  const seq = 1 + (registry[0] ? registry[0].seq : 0);
  const entry = {
    seq,
    ts: new Date().toISOString(),
    type,
    detail,
    prevHash
  };
  entry.hash = crypto.createHash('sha256')
    .update(`${entry.seq}|${entry.ts}|${entry.type}|${entry.detail}|${entry.prevHash}`)
    .digest('hex');
  registry.unshift(entry);
  prevHash = entry.hash;
  protocol.anchorRegistry(entry.seq, entry.hash);
  if (registry.length > 200) registry.pop();
}

function verify() {
  let hash = '0'.repeat(64);
  for (let i = registry.length - 1; i >= 0; i--) {
    const entry = registry[i];
    const expected = crypto.createHash('sha256')
      .update(`${entry.seq}|${entry.ts}|${entry.type}|${entry.detail}|${entry.prevHash}`)
      .digest('hex');
    if (entry.hash !== expected || entry.prevHash !== hash) return false;
    hash = entry.hash;
  }
  return true;
}

function setActivity(activity) {
  status.currentActivity = activity;
  status.lastCheckAt = new Date().toISOString();
}

function finding(level, rule, detail) {
  const f = { ts: new Date().toISOString(), level, rule, detail };
  findings.unshift(f);
  if (findings.length > 20) findings.pop();
  appendLog(`finding:${rule}`, detail);
  return f;
}

function onSecurityEvent(event) {
  try {
    status.eventsAnalyzed += 1;
    status.lastEvent = {
      ts: event.ts,
      busType: event.type,
      type: event.data.type,
      source: event.data.source,
      detail: event.data.detail
    };

    recentEvents.unshift({ ts: event.ts, type: event.data.type, source: event.data.source });
    if (recentEvents.length > 200) recentEvents.pop();

    const cutoff = Date.now() - config.agents.guardWindowMs;
    recentEvents = recentEvents.filter((e) => new Date(e.ts).getTime() >= cutoff || e.type === 'security_block');

    const windowEvents = recentEvents.filter((e) => new Date(e.ts).getTime() >= cutoff);

    if (event.data.source) {
      const c = (repeatedSources.get(event.data.source) || 0) + 1;
      repeatedSources.set(event.data.source, c);
      if (c === config.agents.repeatedThreshold) {
        finding('ALLERTA', 'tentativi_ripetuti', `${c} eventi di sicurezza ripetuti da ${event.data.source}`);
      }
    }

    if (windowEvents.length >= config.agents.burstThreshold) {
      finding('CRITICO', 'burst_anomalo', `${windowEvents.length} eventi di sicurezza in ${config.agents.guardWindowMs / 1000}s`);
    }

    setActivity(`analisi eventi di sicurezza (${status.eventsAnalyzed} totali)`);

    const previous = status.threatLevel;
    const next = computeThreatLevel(windowEvents);
    if (next !== previous) {
      status.threatLevel = next;
      appendLog('threat_level', `livello minaccia: ${previous} -> ${next}`);
      eventBus.publish('agents', { scope: 'guard_threat', level: next });
      if (next === 'CRITICO' && event.data.source) {
        protocol.send('guard', 'core', 'threat_report', {
          level: next,
          source: event.data.source,
          windowEvents: windowEvents.length,
          rule: 'livello_critico',
          ts: event.ts
        });
        finding('CRITICO', 'segnalazione_minaccia', `inviato threat_report per ${event.data.source}`);
      }
    }
  } catch (err) {
    status.errors += 1;
    appendLog('errore_interno', err.message);
  }
}

function computeThreatLevel(windowEvents) {
  const blocks = recentEvents.filter((e) => e.type === 'security_block').length;
  if (blocks > 0 || windowEvents.length >= config.agents.burstThreshold) return 'CRITICO';
  if (windowEvents.length >= config.agents.alertThreshold) return 'ALLERTA';
  if (windowEvents.length >= config.agents.cautionThreshold) return 'ATTENZIONE';
  return 'NORMALE';
}

function onIntegrityRequest() {
  setActivity('verifica integrità registro richiesta da CORE');
  const valid = verify();
  status.integrity = valid ? 'verificata' : 'COMPROMESSA';
  appendLog('integrity_check', valid ? 'catena hash verificata, registro integro' : 'catena hash NON valida');
  protocol.send('guard', 'core', 'integrity_result', {
    valid,
    registrySize: registry.length,
    lastSeq: registry[0] ? registry[0].seq : 0
  });
}

function onDigestTick() {
  const cutoff = Date.now() - config.agents.guardWindowMs;
  const windowEvents = recentEvents.filter((e) => new Date(e.ts).getTime() >= cutoff);
  setActivity(`digest periodico: ${windowEvents.length} eventi nella finestra`);
  if (windowEvents.length > 0 || status.threatLevel !== 'NORMALE') {
    protocol.send('guard', 'core', 'digest', {
      threatLevel: status.threatLevel,
      windowEvents: windowEvents.length,
      repeatedSources: [...repeatedSources.entries()].filter(([, c]) => c >= 2).slice(0, 5)
    });
  }
}

function start(sessionId) {
  status.sessionId = sessionId;
  status.status = 'ONLINE';
  status.startedAt = new Date().toISOString();
  status.threatLevel = 'NORMALE';
  status.integrity = 'mai verificata';
  appendLog('avvio', `LONEWOLF GUARD avviato (sessione ${sessionId})`);
  setActivity('in ascolto degli eventi di sicurezza');

  unsubscribe = eventBus.subscribe((event) => {
    if (event.type === 'security' || event.type === 'security_observation') onSecurityEvent(event);
  });

  protocol.register('guard', 'integrity_request', onIntegrityRequest);

  digestTimer = setInterval(onDigestTick, config.agents.digestIntervalMs);
  eventBus.publish('agents', { scope: 'status', agent: 'guard', status: 'ONLINE' });
}

function stop() {
  if (unsubscribe) unsubscribe();
  if (digestTimer) clearInterval(digestTimer);
  unsubscribe = null;
  digestTimer = null;
  protocol.unregisterAll('guard');
  status.status = 'OFFLINE';
  status.currentActivity = 'arrestato';
  appendLog('arresto', 'LONEWOLF GUARD arrestato');
  eventBus.publish('agents', { scope: 'status', agent: 'guard', status: 'OFFLINE' });
}

function snapshot() {
  const cutoff = Date.now() - config.agents.guardWindowMs;
  const windowEvents = recentEvents.filter((e) => new Date(e.ts).getTime() >= cutoff);
  return {
    key: 'guard',
    name: status.role.name,
    role: status.role.description,
    engine: 'regole deterministiche (AI locale estendibile)',
    permissions: status.role.permissions,
    status: status.status,
    sessionId: status.sessionId,
    startedAt: status.startedAt,
    lastCheckAt: status.lastCheckAt,
    currentActivity: status.currentActivity,
    lastEvent: status.lastEvent,
    eventsAnalyzed: status.eventsAnalyzed,
    errors: status.errors,
    threatLevel: status.threatLevel,
    windowEvents: windowEvents.length,
    repeatedSources: [...repeatedSources.entries()]
      .filter(([, c]) => c >= 2)
      .map(([source, c]) => ({ source, count: c }))
      .slice(0, 10),
    findings: findings.slice(0, 10),
    integrity: status.integrity,
    registrySize: registry.length,
    logTail: registry.slice(0, 10)
  };
}

function registryTail(n = 20) {
  return registry.slice(0, n);
}

module.exports = { start, stop, snapshot, verify, registryTail, appendLog, status };
