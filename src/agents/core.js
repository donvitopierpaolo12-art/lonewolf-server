const config = require('../config');
const eventBus = require('../events/eventBus');
const metrics = require('../metrics/metrics');
const security = require('../security/security');
const protocol = require('./protocol');
const guard = require('./guard');
const { ROLES } = require('./permissions');

const status = {
  role: ROLES.core,
  sessionId: null,
  status: 'OFFLINE',
  startedAt: null,
  lastCheckAt: null,
  currentActivity: 'in attesa di avvio',
  lastEvent: null,
  iterations: 0,
  errors: 0,
  containmentRequests: 0
};

let findings = [];
let hotspotLog = [];
let checkTimer = null;
let tick = 0;
let hotEndpoints = new Map();
let unresolvedPressure = false;
let lastGuardLevel = null;

function setActivity(activity) {
  status.currentActivity = activity;
  status.lastCheckAt = new Date().toISOString();
}

function finding(level, rule, detail) {
  const f = { ts: new Date().toISOString(), level, rule, detail };
  findings.unshift(f);
  if (findings.length > 20) findings.pop();
  return f;
}

function logHotspot(detail) {
  hotspotLog.unshift({ ts: new Date().toISOString(), detail });
  if (hotspotLog.length > 20) hotspotLog.pop();
}

function onMetricsEvent(event) {
  try {
    tick += 1;
    status.iterations += 1;
    status.lastEvent = {
      ts: event.ts,
      busType: 'metrics',
      summary: `richieste=${event.data.requests.total} cpu=${event.data.system.cpuPercent}% rss=${Math.round(event.data.process.rssBytes / 1048576)}MB`
    };

    const m = event.data;
    const cpuHot = m.system.cpuPercent >= config.agents.cpuThreshold;
    const heapHot = m.process.heapPercent >= config.agents.heapThreshold;

    if (cpuHot || heapHot) {
      if (!unresolvedPressure) {
        unresolvedPressure = true;
        const detail = cpuHot
          ? `CPU sistema ${m.system.cpuPercent}% >= soglia ${config.agents.cpuThreshold}%`
          : `Heap Node ${m.process.heapPercent}% >= soglia ${config.agents.heapThreshold}%`;
        finding('ATTENZIONE', 'risorse_sotto_pressione', detail);
        logHotspot(detail);
      }
      setActivity('pressione risorse: monitoraggio ravvicinato');
    } else if (unresolvedPressure) {
      unresolvedPressure = false;
      finding('NORMALE', 'risorse_ripristinate', `cpu=${m.system.cpuPercent}% heap=${m.process.heapPercent}%`);
    }

    if (tick % 3 === 0) {
      setActivity(`analisi periodica n.${tick}: richieste=${m.requests.total} · liv. minaccia GUARD=${guard.status.threatLevel}`);
    }

    if (tick % 5 === 0) {
      const answer = protocol.send('core', 'guard', 'integrity_request', { tick });
      if (answer.accepted) {
        setActivity('richiesta verifica integrità registro GUARD inviata');
      } else {
        status.errors += answer.reason ? 1 : 0;
        logHotspot(`integrity_request rifiutata dal protocollo: ${answer.reason}`);
      }
    }
  } catch (err) {
    status.errors += 1;
    logHotspot(`errore analisi metriche: ${err.message}`);
  }
}

function onGuardThreat(event) {
  try {
    lastGuardLevel = event.data.level;
    setActivity(`ricevuto report da GUARD: minaccia ${event.data.level}`);
  } catch (err) {
    status.errors += 1;
  }
}

function onThreatReport(payload, from) {
  if (payload.level === 'CRITICO' && payload.source) {
    status.containmentRequests += 1;
    const decision = security.requestContainment(payload.source, 'LONEWOLF CORE');
    finding('CRITICO', 'contenimento', `${from} segnala minaccia CRITICA da ${payload.source} → security: ${decision.decision}`);
    logHotspot(`containment: ${payload.source} → ${decision.decision}`);
  } else {
    finding(payload.level === 'ALLERTA' ? 'ALLERTA' : 'ATTENZIONE', 'report_guard', `${from}: ${payload.rule || payload.level} · ${payload.windowEvents || 0} eventi nella finestra`);
  }
  setActivity(`gestione threat_report da ${from}`);
}

function onIntegrityResult(payload, from) {
  const outcome = payload.valid
    ? `registro GUARD integro (${payload.registrySize} voci)`
    : 'INTERGRITÀ REGISTRO GUARD COMPROMESSA';
  finding(payload.valid ? 'NORMALE' : 'CRITICO', 'integrità_guard', outcome);
  logHotspot(`integrity_result da ${from}: ${outcome}`);
}

function apiHealthCheck() {
  const api = metrics.current().api;
  api.forEach((row) => {
    const errKey = `${row.endpoint}#err`;
    const previous = hotEndpoints.get(errKey) || 0;
    if (row.errors > previous) {
      finding('ALLERTA', 'errori_api_5xx', `${row.endpoint}: ${row.errors} errori 5xx rilevati`);
      logHotspot(`5xx su ${row.endpoint}: ${row.errors}`);
    }
    hotEndpoints.set(errKey, row.errors);
  });
}

function start(sessionId) {
  status.sessionId = sessionId;
  status.status = 'ONLINE';
  status.startedAt = new Date().toISOString();
  setActivity('in avvio: collegamento a metriche e GUARD');

  protocol.register('core', 'threat_report', onThreatReport);
  protocol.register('core', 'integrity_result', onIntegrityResult);
  protocol.register('core', 'digest', (payload) => {
    lastGuardLevel = payload.threatLevel;
  });

  const unsubMetrics = eventBus.subscribe((event) => {
    if (event.type === 'metrics') onMetricsEvent(event);
    if (event.type === 'agents' && event.data.scope === 'guard_threat') onGuardThreat(event);
  });

  checkTimer = setInterval(() => {
    try {
      apiHealthCheck();
    } catch (err) {
      status.errors += 1;
      logHotspot(`errore controllo API: ${err.message}`);
    }
  }, config.agents.coreCheckIntervalMs);

  coreState.unsubscribe = unsubMetrics;

  setActivity('monitoraggio attivo: metriche, salute API e coerenza GUARD');
  protocol.send('core', 'guard', 'integrity_request', { tick: 0, phase: 'avvio' });
  eventBus.publish('agents', { scope: 'status', agent: 'core', status: 'ONLINE' });
}

function stop() {
  if (coreState.unsubscribe) coreState.unsubscribe();
  if (checkTimer) clearInterval(checkTimer);
  checkTimer = null;
  coreState.unsubscribe = null;
  protocol.unregisterAll('core');
  status.status = 'OFFLINE';
  status.currentActivity = 'arrestato';
  setActivity('arrestato');
  eventBus.publish('agents', { scope: 'status', agent: 'core', status: 'OFFLINE' });
}

const coreState = { unsubscribe: null };

function snapshot() {
  const m = metrics.current();
  return {
    key: 'core',
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
    iterations: status.iterations,
    errors: status.errors,
    containmentRequests: status.containmentRequests,
    guardLink: {
      threatLevel: guard.status.threatLevel,
      integrity: guard.status.integrity,
      lastSeenLevel: lastGuardLevel || 'nessuna comunicazione'
    },
    resources: {
      cpuPercent: m.system.cpuPercent,
      heapPercent: m.process.heapPercent,
      cpuThreshold: config.agents.cpuThreshold,
      heapThreshold: config.agents.heapThreshold
    },
    findings: findings.slice(0, 10),
    hotspotLog
  };
}

module.exports = { start, stop, snapshot, status };
