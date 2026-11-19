(() => {
  'use strict';

  const REFRESH_INTERVAL = 5000;
  const SECURITY_LABELS = {
    rate_limit_block: 'Rate limit superato',
    security_block: 'Sorgente bloccata',
    blocked_request: 'Richiesta bloccata',
    suspicious: 'Tentativo sospetto',
    anomaly: 'Anomalia',
    path_traversal: 'Path traversal',
    xss: 'XSS',
    sql_injection: 'SQL injection',
    control_chars: 'Caratteri di controllo',
    critical: 'Critico'
  };

  const el = {
    indicator: document.getElementById('indicator'),
    indicatorText: document.getElementById('indicator-text'),
    sseState: document.getElementById('sse-state'),
    sseStateText: document.getElementById('sse-state-text'),
    statusValue: document.getElementById('status-value'),
    serverName: document.getElementById('server-name'),
    uptimeValue: document.getElementById('uptime-value'),
    requestsValue: document.getElementById('requests-value'),
    requestsByStatus: document.getElementById('requests-by-status'),
    sseValue: document.getElementById('sse-value'),
    cpuValue: document.getElementById('cpu-value'),
    cpuBar: document.getElementById('cpu-bar'),
    loadAvg: document.getElementById('load-avg'),
    ramValue: document.getElementById('ram-value'),
    ramBar: document.getElementById('ram-bar'),
    ramDetail: document.getElementById('ram-detail'),
    rssValue: document.getElementById('rss-value'),
    heapBar: document.getElementById('heap-bar'),
    heapDetail: document.getElementById('heap-detail'),
    procCpu: document.getElementById('proc-cpu'),
    timeValue: document.getElementById('time-value'),
    dateValue: document.getElementById('date-value'),
    apiStatsBody: document.getElementById('api-stats-body'),
    log: document.getElementById('log'),
    refreshBtn: document.getElementById('refresh-btn'),
    portLabel: document.getElementById('port-label'),
    protections: document.getElementById('protections'),
    secBlockedRequests: document.getElementById('sec-blocked-requests'),
    secSuspicious: document.getElementById('sec-suspicious'),
    secBlocks: document.getElementById('sec-blocks'),
    secActive: document.getElementById('sec-active'),
    blockedSources: document.getElementById('blocked-sources'),
    securityEvents: document.getElementById('security-events'),
    securityAlerts: document.getElementById('security-alerts'),
    coreIndicator: document.getElementById('core-indicator'),
    coreStatus: document.getElementById('core-status'),
    coreActivity: document.getElementById('core-activity'),
    coreLastCheck: document.getElementById('core-lastcheck'),
    coreLastEvent: document.getElementById('core-lastevent'),
    coreIterations: document.getElementById('core-iterations'),
    coreUsage: document.getElementById('core-usage'),
    coreGuardLevel: document.getElementById('core-guard-level'),
    coreGuardIntegrity: document.getElementById('core-guard-integrity'),
    coreFindings: document.getElementById('core-findings'),
    guardIndicator: document.getElementById('guard-indicator'),
    guardStatus: document.getElementById('guard-status'),
    guardLevel: document.getElementById('guard-level'),
    guardActivity: document.getElementById('guard-activity'),
    guardLastCheck: document.getElementById('guard-lastcheck'),
    guardLastEvent: document.getElementById('guard-lastevent'),
    guardAnalyzed: document.getElementById('guard-analyzed'),
    guardIntegrity: document.getElementById('guard-integrity'),
    guardFindings: document.getElementById('guard-findings'),
    agentComms: document.getElementById('agent-comms')
  };

  el.portLabel.textContent = window.location.port || '3000';

  let lastSeq = 0;
  let knownBoot = null;
  let eventSource = null;
  let fallbackTimer = null;

  const nowClock = () => new Date().toLocaleTimeString('it-IT');

  function addLog(message, type, list) {
    const target = list || el.log;
    const li = document.createElement('li');
    li.className = type === 'err' ? 'err' : 'ok';
    const time = document.createElement('span');
    time.textContent = `[${nowClock()}] `;
    li.appendChild(time);
    li.appendChild(document.createTextNode(message));
    target.prepend(li);
    while (target.children.length > 30) {
      target.removeChild(target.lastChild);
    }
  }

  function setOnline(isOnline) {
    el.indicator.classList.toggle('online', isOnline);
    el.indicator.classList.toggle('offline', !isOnline);
    el.indicatorText.textContent = isOnline ? 'ONLINE' : 'OFFLINE';
    el.statusValue.textContent = isOnline ? 'ONLINE' : 'OFFLINE';
    el.statusValue.classList.toggle('online', isOnline);
    el.statusValue.classList.toggle('offline', !isOnline);
  }

  function setSseState(connected) {
    el.sseState.classList.toggle('connected', connected);
    el.sseStateText.textContent = connected ? 'CONNESSO' : 'DISCONNESSO';
  }

  function fmtBytes(bytes) {
    if (!Number.isFinite(bytes)) return '--';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`;
  }

  function setMeter(bar, percent) {
    bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  }

  function applyMetrics(m) {
    setOnline(true);
    el.serverName.textContent = m.server;
    el.uptimeValue.textContent = m.uptime.human;
    el.requestsValue.textContent = m.requests.total.toLocaleString('it-IT');
    const statusParts = Object.entries(m.requests.byStatus)
      .map(([code, count]) => `${code}: ${count}`)
      .join(' · ');
    el.requestsByStatus.textContent = statusParts || 'Totale ricevute dal server';
    el.sseValue.textContent = m.sseClients;

    el.cpuValue.textContent = `${m.system.cpuPercent.toFixed(1)}%`;
    setMeter(el.cpuBar, m.system.cpuPercent);
    el.loadAvg.textContent = m.system.loadAvg.join(' / ');

    el.ramValue.textContent = `${m.system.ramPercent.toFixed(1)}%`;
    setMeter(el.ramBar, m.system.ramPercent);
    el.ramDetail.textContent = `${fmtBytes(m.system.ramUsedBytes)} / ${fmtBytes(m.system.ramTotalBytes)}`;

    el.rssValue.textContent = fmtBytes(m.process.rssBytes);
    setMeter(el.heapBar, m.process.heapPercent);
    el.heapDetail.textContent = `${fmtBytes(m.process.heapUsedBytes)} / ${fmtBytes(m.process.heapTotalBytes)}`;
    el.procCpu.textContent = `${m.process.cpuPercent.toFixed(1)}%`;

    if (Array.isArray(m.api) && m.api.length > 0) {
      el.apiStatsBody.innerHTML = '';
      m.api.forEach((row) => {
        const tr = document.createElement('tr');
        const cells = [
          row.endpoint,
          row.calls.toLocaleString('it-IT'),
          `${row.avgMs} ms`,
          String(row.errors)
        ];
        cells.forEach((text, i) => {
          const td = document.createElement('td');
          td.textContent = text;
          if (i === 0) {
            td.className = 'mono';
          } else if (i === 3 && row.errors > 0) {
            td.className = 'err-text';
          }
          tr.appendChild(td);
        });
        el.apiStatsBody.appendChild(tr);
      });
    }
  }

  function applySecurity(s) {
    el.protections.innerHTML = '';
    const labels = {
      helmet: 'Helmet',
      rateLimit: 'Rate limiting',
      inputValidation: 'Validazione input',
      anomalyDetection: 'Anomaly detection',
      ipBlocking: 'Blocco IP',
      adminToken: 'API admin'
    };
    Object.entries(s.protections).forEach(([key, active]) => {
      const badge = document.createElement('span');
      badge.className = `badge ${active ? 'badge-on' : 'badge-off'}`;
      badge.textContent = labels[key] || key;
      el.protections.appendChild(badge);
    });

    el.secBlockedRequests.textContent = s.counters.blockedRequests.toLocaleString('it-IT');
    el.secSuspicious.textContent = s.counters.suspiciousAttempts.toLocaleString('it-IT');
    el.secBlocks.textContent = s.counters.blocksIssued.toLocaleString('it-IT');
    el.secActive.textContent = s.counters.activeBlocks.toLocaleString('it-IT');

    el.blockedSources.innerHTML = '';
    if (s.blockedSources.length === 0) {
      addLog('Nessuna sorgente bloccata', 'ok', el.blockedSources);
    } else {
      s.blockedSources.forEach((src) => {
        addLog(`${src.source} · fino alle ${new Date(src.until).toLocaleTimeString('it-IT')} · ${src.reason}`, 'err', el.blockedSources);
      });
    }

    el.securityEvents.innerHTML = '';
    if (s.events.length === 0) {
      addLog('Nessun evento di sicurezza', 'ok', el.securityEvents);
    } else {
      s.events.forEach((ev) => {
        const label = SECURITY_LABELS[ev.type] || ev.type;
        addLog(`${label} · ${ev.source} · ${ev.detail}`, 'err', el.securityEvents);
      });
    }
  }

  function setAgentState(indicator, statusEl, online) {
    indicator.classList.toggle('online', online);
    indicator.classList.toggle('offline', !online);
    statusEl.textContent = online ? 'ONLINE' : 'OFFLINE';
  }

  function applyFindings(list, items, emptyText) {
    list.innerHTML = '';
    if (!items || items.length === 0) {
      addLog(emptyText, 'ok', list);
      return;
    }
    items.forEach((f) => {
      const time = new Date(f.ts).toLocaleTimeString('it-IT');
      addLog(`${time} · [${f.level}] ${f.rule} · ${f.detail}`, f.level === 'NORMALE' ? 'ok' : 'err', list);
    });
  }

  function applyAgents(data) {
    if (!data) return;

    const coreEl = data.core;
    setAgentState(el.coreIndicator, el.coreStatus, coreEl.status === 'ONLINE');
    el.coreActivity.textContent = coreEl.currentActivity || '--';
    el.coreLastCheck.textContent = coreEl.lastCheckAt ? new Date(coreEl.lastCheckAt).toLocaleTimeString('it-IT') : '--';
    el.coreLastEvent.textContent = coreEl.lastEvent
      ? `${coreEl.lastEvent.busType} ${new Date(coreEl.lastEvent.ts).toLocaleTimeString('it-IT')}`
      : '--';
    el.coreIterations.textContent = (coreEl.iterations || 0).toLocaleString('it-IT');
    if (coreEl.resources) {
      el.coreUsage.textContent = `${coreEl.resources.cpuPercent}% (soglia ${coreEl.resources.cpuThreshold}%) · heap ${coreEl.resources.heapPercent}%`;
    }
    if (coreEl.guardLink) {
      el.coreGuardLevel.textContent = coreEl.guardLink.threatLevel;
      el.coreGuardIntegrity.textContent = coreEl.guardLink.integrity;
    }
    applyFindings(el.coreFindings, coreEl.findings, 'Nessuna anomalia rilevata');

    const guardEl = data.guard;
    setAgentState(el.guardIndicator, el.guardStatus, guardEl.status === 'ONLINE');
    el.guardLevel.textContent = guardEl.threatLevel;
    el.guardLevel.className = `threat-tag level-${guardEl.threatLevel}`;
    el.guardActivity.textContent = guardEl.currentActivity || '--';
    el.guardLastCheck.textContent = guardEl.lastCheckAt ? new Date(guardEl.lastCheckAt).toLocaleTimeString('it-IT') : '--';
    el.guardLastEvent.textContent = guardEl.lastEvent
      ? `${guardEl.lastEvent.type} · ${guardEl.lastEvent.source || ''} · ${new Date(guardEl.lastEvent.ts).toLocaleTimeString('it-IT')}`
      : '--';
    el.guardAnalyzed.textContent = (guardEl.eventsAnalyzed || 0).toLocaleString('it-IT');
    el.guardIntegrity.textContent = `${guardEl.integrity || '--'} · ancora: ${data.registryAnchored === false ? 'ANOMALA' : data.registryAnchored === true ? 'ok' : '--'}`;

    const guardItems = [];
    (guardEl.repeatedSources || []).forEach((rs) => {
      guardItems.push({ ts: guardEl.lastCheckAt || new Date().toISOString(), level: 'ALLERTA', rule: 'tentativi ripetuti', detail: `${rs.source} · ${rs.count} eventi` });
    });
    (guardEl.findings || []).forEach((f) => guardItems.push(f));
    applyFindings(el.guardFindings, guardItems.length > 0 ? guardItems : [], 'Nessuna regola violata');

    el.agentComms.innerHTML = '';
    if (!data.comms || data.comms.length === 0) {
      addLog('Nessuna comunicazione', 'ok', el.agentComms);
    } else {
      data.comms.slice(0, 15).forEach((c) => {
        const time = new Date(c.ts).toLocaleTimeString('it-IT');
        addLog(`${time} · ${c.from.toUpperCase()} → ${c.to.toUpperCase()} · ${c.type} · ${c.accepted ? 'consegnato' : 'RIFIUTATO'}`, c.accepted ? 'ok' : 'err', el.agentComms);
      });
    }
  }

  function pushAlert(text) {
    addLog(text, 'err', el.securityAlerts);
  }

  function handleEvent(event) {
    if (!event || typeof event.seq !== 'number') return;
    if (event.boot && knownBoot && event.boot !== knownBoot) lastSeq = 0;
    if (event.boot) knownBoot = event.boot;
    if (event.seq <= lastSeq) return;
    lastSeq = event.seq;

    switch (event.type) {
      case 'bus_error':
        pushAlert(`Errore interno bus: ${event.data && event.data.message ? event.data.message : 'sconosciuto'}`);
        break;
      case 'snapshot':
        applyMetrics(event.data.metrics);
        applySecurity(event.data.security);
        if (event.data.agents) applyAgents(event.data.agents);
        setSseState(true);
        addLog('Snapshot iniziale ricevuto via SSE');
        break;
      case 'agents':
        refreshAgents();
        break;
      case 'metrics':
        applyMetrics(event.data);
        break;
      case 'security':
        pushAlert(`[${new Date(event.ts).toLocaleTimeString('it-IT')}] ${event.data.type} · ${event.data.source} · ${event.data.detail}`);
        refreshSecurity();
        break;
      case 'sse_connect':
      case 'sse_disconnect':
        el.sseValue.textContent = event.data.sseClients;
        break;
      default:
        break;
    }
  }

  function connectEvents() {
    if (typeof EventSource === 'undefined') {
      startFallbackPolling();
      return;
    }

    eventSource = new EventSource('/api/events');

    eventSource.onopen = () => {
      setSseState(true);
      el.sseValue.textContent = '--';
      addLog('Connessione SSE stabilita con /api/events');
    };

    eventSource.onmessage = (msg) => {
      try {
        handleEvent(JSON.parse(msg.data));
      } catch (err) {
        addLog(`Evento SSE non valido: ${err.message}`, 'err');
      }
    };

    ['snapshot', 'metrics', 'security', 'sse_connect', 'sse_disconnect'].forEach((type) => {
      eventSource.addEventListener(type, (msg) => {
        try {
          handleEvent(JSON.parse(msg.data));
        } catch (err) {
          addLog(`Evento SSE non valido: ${err.message}`, 'err');
        }
      });
    });

    eventSource.onerror = () => {
      setSseState(false);
      setOnline(false);
      addLog('Connessione SSE interrotta — riconnessione automatica…', 'err');
    };
  }

  function startFallbackPolling() {
    if (fallbackTimer) return;
    addLog('EventSource non supportato: attivo polling di fallback ogni 5s', 'err');
    fallbackTimer = setInterval(async () => {
      await refreshAll(false);
    }, REFRESH_INTERVAL);
  }

  async function fetchJson(endpoint) {
    const res = await fetch(endpoint, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${endpoint} -> HTTP ${res.status}`);
    return res.json();
  }

  let lastAgentsRefresh = 0;

  async function refreshAgents() {
    const now = Date.now();
    if (now - lastAgentsRefresh < 1500) return;
    lastAgentsRefresh = now;
    try {
      const data = await fetchJson('/api/agents');
      if (data.success) applyAgents(data);
    } catch (err) {
      addLog(`Errore /api/agents: ${err.message}`, 'err');
    }
  }

  async function refreshSecurity() {
    try {
      const data = await fetchJson('/api/security');
      if (data.success) applySecurity(data);
    } catch (err) {
      addLog(`Errore /api/security: ${err.message}`, 'err');
    }
  }

  async function updateTime() {
    try {
      const data = await fetchJson('/api/time');
      if (!data.success) throw new Error('Risposta non valida');
      el.timeValue.textContent = data.time;
      el.dateValue.textContent = `${data.date} · /api/time`;
    } catch (err) {
      addLog(`Errore /api/time: ${err.message}`, 'err');
    }
  }

  async function refreshAll(verbose) {
    try {
      const [metricsData, securityData, agentsData] = await Promise.all([
        fetchJson('/api/metrics'),
        fetchJson('/api/security'),
        fetchJson('/api/agents')
      ]);
      if (metricsData.success) applyMetrics(metricsData);
      if (securityData.success) applySecurity(securityData);
      if (agentsData.success) applyAgents(agentsData);
      if (verbose) addLog('Test manuale API completato: /api/metrics + /api/security + /api/agents');
    } catch (err) {
      setOnline(false);
      addLog(`Errore aggiornamento: ${err.message}`, 'err');
    }
  }

  el.refreshBtn.addEventListener('click', () => {
    addLog('Test manuale API avviato...');
    refreshAll(true);
  });

  window.addEventListener('offline', () => {
    setOnline(false);
    addLog('Connessione di rete persa', 'err');
  });

  window.addEventListener('online', () => {
    addLog('Connessione di rete ripristinata');
    refreshAll(false);
  });

  updateTime();
  refreshAll(false);
  setInterval(updateTime, REFRESH_INTERVAL);
  connectEvents();
})();
