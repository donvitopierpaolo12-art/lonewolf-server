const os = require('os');
const config = require('../config');
const eventBus = require('../events/eventBus');
const { uptime } = require('../utils/runtime');
const sseClients = require('../sse/clients');

const startedAtMs = Date.parse(config.startedAt);

const routes = new Map();
const statusCodes = new Map();
let totalRequests = 0;

let lastCpuSnapshot = os.cpus();
let lastProcCpu = process.cpuUsage();
let lastSampleAt = Date.now();
let current = null;
let timer = null;

function round(value, decimals = 1) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function cpuSamples() {
  const now = Date.now();
  const cpus = os.cpus();

  let idle = 0;
  let total = 0;
  cpus.forEach((cpu, i) => {
    const prev = lastCpuSnapshot[i] ? lastCpuSnapshot[i].times : cpu.times;
    idle += cpu.times.idle - prev.idle;
    total += (cpu.times.user - prev.user)
      + (cpu.times.nice - prev.nice)
      + (cpu.times.sys - prev.sys)
      + (cpu.times.irq - prev.irq)
      + (cpu.times.idle - prev.idle);
  });
  lastCpuSnapshot = cpus;

  const procDelta = process.cpuUsage(lastProcCpu);
  lastProcCpu = process.cpuUsage();

  const elapsedMs = Math.max(1, now - lastSampleAt);
  lastSampleAt = now;

  const systemPercent = total > 0 ? (1 - idle / total) * 100 : 0;
  const processPercent = ((procDelta.user + procDelta.system) / 1000 / elapsedMs) * 100;

  return { systemPercent, processPercent };
}

function trackRequest(route, method, statusCode, durationMs) {
  totalRequests += 1;
  statusCodes.set(statusCode, (statusCodes.get(statusCode) || 0) + 1);

  const key = `${method} ${route}`;
  const entry = routes.get(key) || { count: 0, totalMs: 0, errors: 0 };
  entry.count += 1;
  entry.totalMs += durationMs;
  if (statusCode >= 500) entry.errors += 1;
  routes.set(key, entry);
}

function apiStats() {
  return Array.from(routes.entries())
    .map(([endpoint, entry]) => ({
      endpoint,
      calls: entry.count,
      avgMs: round(entry.totalMs / entry.count),
      errors: entry.errors
    }))
    .sort((a, b) => b.calls - a.calls)
    .slice(0, 15);
}

function sample() {
  const { systemPercent, processPercent } = cpuSamples();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const mem = process.memoryUsage();

  current = {
    server: 'LONEWOLF SERVER',
    ts: new Date().toISOString(),
    uptime: uptime(startedAtMs),
    requests: {
      total: totalRequests,
      byStatus: Object.fromEntries([...statusCodes.entries()].sort((a, b) => a[0] - b[0]))
    },
    api: apiStats(),
    system: {
      cpuPercent: round(systemPercent),
      ramPercent: round(((totalMem - freeMem) / totalMem) * 100),
      ramUsedBytes: totalMem - freeMem,
      ramTotalBytes: totalMem,
      loadAvg: os.loadavg().map((v) => round(v, 2))
    },
    process: {
      rssBytes: mem.rss,
      heapUsedBytes: mem.heapUsed,
      heapTotalBytes: mem.heapTotal,
      heapPercent: round((mem.heapUsed / mem.heapTotal) * 100),
      cpuPercent: round(processPercent)
    },
    sseClients: sseClients.count()
  };

  return current;
}

function current_() {
  return current || sample();
}

function start() {
  if (timer) return;
  sample();
  timer = setInterval(() => {
    const snapshot = sample();
    eventBus.publish('metrics', snapshot);
  }, config.metricsIntervalMs);
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { start, stop, sample, current: current_, trackRequest };
