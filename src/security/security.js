const config = require('../config');
const eventBus = require('../events/eventBus');

const counters = {
  blockedRequests: 0,
  suspiciousAttempts: 0,
  anomaliesDetected: 0,
  blocksIssued: 0
};

const log = [];
const hits = new Map();
const suspicious = new Map();
const blocked = new Map();
const lastLoggedAt = new Map();

const ANOMALY_PATTERNS = [
  { name: 'path_traversal', regex: /(?:^|[?&=/])\.\.(?:\/|\\|%2f|%5c)/i },
  { name: 'xss', regex: /<script|javascript:|onerror\s*=/i },
  { name: 'sql_injection', regex: /('|%27)\s*(or|union|select)\s|union\s+select|;\s*drop\s+table/i },
  { name: 'control_chars', regex: /[\x00-\x08\x0b\x0c\x0e-\x1f]/ }
];

let cleanupTimer = null;

function normalizeIp(ip) {
  const value = String(ip || '').replace('::ffff:', '');
  if (value === '::1') return '127.0.0.1';
  return value || 'sconosciuta';
}

function maskIp(ip) {
  const normalized = normalizeIp(ip);
  const parts = normalized.split('.');
  if (parts.length === 4 && parts.every((p) => /^\d+$/.test(p))) {
    return `${parts[0]}.${parts[1]}.${parts[2]}.xxx`;
  }
  return normalized.length > 10 ? `${normalized.slice(0, 10)}…` : normalized;
}

function recordEvent(type, ip, detail) {
  const key = `${type}:${normalizeIp(ip)}`;
  const now = Date.now();
  const lastAt = lastLoggedAt.get(key) || 0;
  const throttled = now - lastAt < 500;
  lastLoggedAt.set(key, now);
  if (throttled) return;

  log.unshift({ ts: new Date().toISOString(), type, source: maskIp(ip), detail });
  if (log.length > 100) log.pop();

  eventBus.publish('security', {
    type,
    source: maskIp(ip),
    detail,
    counters: countSnapshot(),
    activeBlocks: blocked.size
  });
}

function block(ip, reason, now) {
  blocked.set(normalizeIp(ip), {
    until: now + config.security.blockDurationMs,
    reason,
    at: now
  });
  counters.blocksIssued += 1;
  recordEvent('security_block', ip, `${reason} · blocco temporaneo ${config.security.blockDurationMs / 1000}s`);
}

function registerSuspicious(ip, detail) {
  const normalized = normalizeIp(ip);
  const now = Date.now();
  counters.suspiciousAttempts += 1;

  const entry = suspicious.get(normalized);
  const inWindow = entry && now - entry.windowStart < config.security.windowMs;
  const count = inWindow ? entry.count + 1 : 1;
  suspicious.set(normalized, {
    count,
    windowStart: inWindow ? entry.windowStart : now
  });

  recordEvent('suspicious', ip, detail);

  if (count >= config.security.suspiciousThreshold && !blocked.get(normalized)) {
    block(ip, `Attività sospetta ripetuta (${count} tentativi)`, now);
  }
}

function guard(req, res, next) {
  const ip = normalizeIp(req.ip);
  const now = Date.now();

  const adminEscape = req.path === '/api/security/unblock';

  const activeBlock = !adminEscape ? blocked.get(ip) : null;
  if (activeBlock) {
    if (activeBlock.until <= now) {
      blocked.delete(ip);
      recordEvent('block_expired', ip, 'Blocco scaduto, sorgente riabilitata');
    } else {
      counters.blockedRequests += 1;
      recordEvent('blocked_request', ip, `Richiesta rifiutata · motivo: ${activeBlock.reason}`);
      return res.status(429).json({
        success: false,
        error: 'Too Many Requests',
        retryAfterMs: activeBlock.until - now
      });
    }
  }

  const target = `${req.method} ${req.originalUrl}`;
  let decoded = target;
  try {
    decoded = `${req.method} ${decodeURIComponent(req.originalUrl)}`;
  } catch (err) {
    decoded = target;
  }
  const anomaly = ANOMALY_PATTERNS.find((p) => p.regex.test(target) || p.regex.test(decoded));
  if (anomaly) {
    counters.anomaliesDetected += 1;
    registerSuspicious(ip, `Pattern anomalo rilevato: ${anomaly.name}`);
    return res.status(400).json({
      success: false,
      error: 'Richiesta bloccata: pattern anomalo rilevato'
    });
  }

  if (!adminEscape) {
    const window = hits.get(ip);
    if (!window || now - window.windowStart >= config.security.windowMs) {
      hits.set(ip, { count: 1, windowStart: now });
    } else {
      window.count += 1;
      if (window.count > config.security.maxRequests) {
        block(ip, `Rate limit: oltre ${config.security.maxRequests} richieste in ${config.security.windowMs / 1000}s`, now);
        counters.blockedRequests += 1;
        recordEvent('blocked_request', ip, 'Richiesta rifiutata: superato il rate limit');
        return res.status(429).json({
          success: false,
          error: 'Too Many Requests',
          retryAfterMs: blocked.get(ip).until - now
        });
      }
    }
  }

  next();
}

function noteNotFound(req) {
  registerSuspicious(req.ip, `404 su ${req.method} ${req.originalUrl}`);
}

function noteInvalidPayload(req) {
  counters.anomaliesDetected += 1;
  registerSuspicious(req.ip, 'Payload non valido o JSON malformato');
}

function countSnapshot() {
  return {
    ...counters,
    activeBlocks: blocked.size
  };
}

function snapshot() {
  const now = Date.now();
  for (const [ip, entry] of blocked) {
    if (entry.until <= now) {
      blocked.delete(ip);
      recordEvent('block_expired', ip, 'Blocco scaduto, sorgente riabilitata');
    }
  }

  return {
    protections: {
      helmet: true,
      rateLimit: true,
      inputValidation: true,
      anomalyDetection: true,
      ipBlocking: true,
      adminToken: Boolean(config.adminToken)
    },
    limits: {
      windowSec: config.security.windowMs / 1000,
      maxRequests: config.security.maxRequests,
      blockDurationSec: config.security.blockDurationMs / 1000,
      suspiciousThreshold: config.security.suspiciousThreshold
    },
    counters: countSnapshot(),
    blockedSources: Array.from(blocked.entries()).map(([ip, entry]) => ({
      source: maskIp(ip),
      reason: entry.reason,
      until: new Date(entry.until).toISOString()
    })),
    events: log.slice(0, 20)
  };
}

function unblock(ipInput) {
  const normalized = normalizeIp(ipInput);
  const removed = blocked.delete(normalized);
  hits.delete(normalized);
  suspicious.delete(normalized);
  if (removed) {
    recordEvent('manual_unblock', normalized, 'Sblocco manuale eseguito da amministratore');
  }
  return removed;
}

function startCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of blocked) {
      if (entry.until <= now) {
        blocked.delete(ip);
        recordEvent('block_expired', ip, 'Blocco scaduto, sorgente riabilitata');
      }
    }
    for (const [ip, entry] of hits) {
      if (now - entry.windowStart >= config.security.windowMs) hits.delete(ip);
    }
    for (const [ip, entry] of suspicious) {
      if (now - entry.windowStart >= config.security.windowMs) suspicious.delete(ip);
    }
    for (const [key, at] of lastLoggedAt) {
      if (now - at >= config.security.windowMs) lastLoggedAt.delete(key);
    }
  }, 30000);
  if (cleanupTimer.unref) cleanupTimer.unref();
}

module.exports = { guard, noteNotFound, noteInvalidPayload, snapshot, unblock, startCleanup };
