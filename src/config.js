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
  },
  agents: {
    coreCheckIntervalMs: Number(process.env.CORE_CHECK_MS) || 5000,
    cpuThreshold: Number(process.env.CORE_CPU_THRESHOLD) || 90,
    heapThreshold: Number(process.env.CORE_HEAP_THRESHOLD) || 90,
    guardWindowMs: Number(process.env.GUARD_WINDOW_MS) || 60000,
    repeatedThreshold: Number(process.env.GUARD_REPEATED_THRESHOLD) || 5,
    burstThreshold: Number(process.env.GUARD_BURST_THRESHOLD) || 25,
    cautionThreshold: Number(process.env.GUARD_CAUTION_THRESHOLD) || 5,
    alertThreshold: Number(process.env.GUARD_ALERT_THRESHOLD) || 15,
    digestIntervalMs: Number(process.env.GUARD_DIGEST_MS) || 15000
  }
};

module.exports = config;
