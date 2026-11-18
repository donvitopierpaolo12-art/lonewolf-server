(() => {
  'use strict';

  const API_BASE = window.location.origin;
  const REFRESH_INTERVAL = 5000;

  const el = {
    indicator: document.getElementById('indicator'),
    indicatorText: document.getElementById('indicator-text'),
    statusValue: document.getElementById('status-value'),
    serverName: document.getElementById('server-name'),
    uptimeValue: document.getElementById('uptime-value'),
    dateValue: document.getElementById('date-value'),
    timeValue: document.getElementById('time-value'),
    apiTimeLabel: document.getElementById('api-time-label'),
    log: document.getElementById('log'),
    refreshBtn: document.getElementById('refresh-btn'),
    portLabel: document.getElementById('port-label')
  };

  el.portLabel.textContent = window.location.port || '3000';

  const pad = (n) => String(n).padStart(2, '0');
  const nowClock = () => new Date().toLocaleTimeString('it-IT');

  function addLog(message, type) {
    const li = document.createElement('li');
    li.className = type === 'err' ? 'err' : 'ok';
    const time = document.createElement('span');
    time.textContent = `[${nowClock()}] `;
    li.appendChild(time);
    li.appendChild(document.createTextNode(message));
    el.log.prepend(li);
    while (el.log.children.length > 30) {
      el.log.removeChild(el.log.lastChild);
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

  async function fetchJson(endpoint) {
    const res = await fetch(`${API_BASE}${endpoint}`, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(`${endpoint} -> HTTP ${res.status}`);
    }
    return res.json();
  }

  async function updateStatus() {
    try {
      const data = await fetchJson('/api/status');
      if (!data.success) throw new Error('Risposta API non valida');

      setOnline(true);
      el.serverName.textContent = data.server;
      el.uptimeValue.textContent = data.uptime.human;
      addLog(`Stato sincronizzato · uptime ${data.uptime.human}`);
    } catch (err) {
      setOnline(false);
      el.serverName.textContent = 'non raggiungibile';
      addLog(`Errore /api/status: ${err.message}`, 'err');
    }
  }

  async function updateTime() {
    try {
      const data = await fetchJson('/api/time');
      if (!data.success) throw new Error('Risposta API non valida');

      el.dateValue.textContent = data.date;
      el.timeValue.textContent = data.time;
      el.apiTimeLabel.textContent = `API · ${new Date(data.unix).toLocaleString('it-IT')}`;
    } catch (err) {
      addLog(`Errore /api/time: ${err.message}`, 'err');
    }
  }

  async function refresh() {
    await Promise.all([updateStatus(), updateTime()]);
  }

  el.refreshBtn.addEventListener('click', () => {
    addLog('Test manuale API avviato...');
    refresh();
  });

  window.addEventListener('online', refresh);
  window.addEventListener('offline', () => {
    setOnline(false);
    addLog('Connessione di rete persa', 'err');
  });

  refresh();
  setInterval(refresh, REFRESH_INTERVAL);
})();
