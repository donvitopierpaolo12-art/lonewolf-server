const config = {
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || '0.0.0.0',
  startedAt: new Date().toISOString(),
  metricsIntervalMs: Number(process.env.METRICS_INTERVAL_MS) || 2000,
  adminToken: process.env.ADMIN_TOKEN || null,
  security: {
    windowMs: Number(process.env.RATE_WINDOW_MS) || 60000,
    maxRequests: Number(process.env.RATE_LIMIT_MAX) || 120,
    blockDurationMs: Number(process.env.BLOCK_DURATION_MS) || 300000,
    suspiciousThreshold: Number(process.env.SUSPICIOUS_THRESHOLD) || 8,
    maxPayloadBytes: process.env.MAX_PAYLOAD_BYTES || '100kb'
  }
};

module.exports = config;
