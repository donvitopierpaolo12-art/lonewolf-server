const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const metrics = require('../metrics/metrics');
const security = require('../security/security');
const sse = require('../sse/events');
const { uptime } = require('../utils/runtime');

const router = express.Router();

const startedAtMs = Date.parse(config.startedAt);

router.get('/status', (req, res) => {
  res.json({
    success: true,
    server: 'LONEWOLF SERVER',
    status: 'online',
    uptime: uptime(startedAtMs),
    timestamp: new Date().toISOString()
  });
});

router.get('/time', (req, res) => {
  const now = new Date();
  res.json({
    success: true,
    iso: now.toISOString(),
    date: now.toLocaleDateString('it-IT'),
    time: now.toLocaleTimeString('it-IT'),
    unix: now.getTime()
  });
});

router.get('/metrics', (req, res) => {
  res.json({
    success: true,
    ...metrics.sample(),
    security: security.snapshot()
  });
});

router.get('/security', (req, res) => {
  res.json({
    success: true,
    ...security.snapshot()
  });
});

router.get('/events', sse.handler);

router.post('/security/unblock', (req, res) => {
  if (!config.adminToken) {
    return res.status(403).json({
      success: false,
      error: 'Endpoint amministratore non abilitato (ADMIN_TOKEN non configurato)'
    });
  }

  const provided = req.get('x-lonewolf-admin') || '';
  const expected = config.adminToken || '';
  const safeEqual = (a, b) => {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) {
      crypto.timingSafeEqual(bufA, bufA);
      return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
  };
  if (!safeEqual(provided, expected)) {
    security.noteInvalidPayload(req);
    return res.status(401).json({
      success: false,
      error: 'Token amministratore mancante o non valido'
    });
  }

  const ip = typeof req.body.ip === 'string' ? req.body.ip.trim() : '';
  const isValidIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) && ip.length <= 45;
  if (!isValidIp) {
    return res.status(400).json({
      success: false,
      error: 'Campo "ip" mancante o non valido'
    });
  }

  const removed = security.unblock(ip);
  res.json({
    success: true,
    unblocked: removed,
    ip,
    activeBlocks: security.snapshot().counters.activeBlocks
  });
});

module.exports = router;
