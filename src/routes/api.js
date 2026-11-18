const express = require('express');
const config = require('../config');
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

module.exports = router;
