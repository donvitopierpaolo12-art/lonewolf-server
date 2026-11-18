# LONEWOLF SERVER

Pannello di controllo web dinamico, monitorato e protetto, con backend Express integrato e realmente funzionante.
Frontend e backend nello stesso progetto, accessibile da `http://localhost:3000`.

## Struttura

```
lonewolf-server/
├── server.js                        # Entry point: avvio HTTP, metriche, shutdown pulito
├── package.json
├── tests/
│   └── integration.test.js          # 47 verifiche: API, SSE, metriche, sicurezza
├── src/
│   ├── app.js                       # Configurazione Express (helmet, guardie, tracker, static, API)
│   ├── config.js                    # Porta, host, intervalli, soglie di sicurezza (env-overridable)
│   ├── events/
│   │   └── eventBus.js              # Bus eventi centralizzato (seq monotoni, publish/subscribe)
│   ├── metrics/
│   │   └── metrics.js               # Metriche REALI: CPU (os.cpus + cpuUsage), RAM, memoria Node, richieste
│   ├── security/
│   │   └── security.js              # Rate limiting, anomaly detection, blocchi IP, registro eventi
│   ├── sse/
│   │   ├── events.js                # Endpoint SSE /api/events (snapshot, heartbeat, cleanup)
│   │   └── clients.js               # Registro delle connessioni SSE attive
│   ├── routes/
│   │   └── api.js                   # /api/status /api/time /api/metrics /api/security /api/events
│   ├── middleware/
│   │   ├── requestTracker.js        # Conteggio e latenze per endpoint (dati reali)
│   │   └── errors.js                # 404 JSON/HTML, payload malformati, errori 500
│   └── utils/
│       └── runtime.js               # Calcolo uptime formattato
└── public/
    ├── index.html                   # Dashboard dinamica + centro di controllo sicurezza
    ├── 404.html                     # Pagina errore 404
    ├── css/style.css                # Tema scuro responsive
    └── js/dashboard.js              # EventSource SSE, anti-duplicati, fallback polling
```

## Requisiti

- Node.js 18 o superiore (testato con Node 22)

## Installazione e avvio

```bash
npm install
npm start
```

Apri **http://localhost:3000**. Sviluppo con riavvio automatico: `npm run dev`.

## Test di integrazione

```bash
# terminale 1 — avvio completo con endpoint admin abilitato
ADMIN_TOKEN='scegli-un-token' PORT=3000 npm start

# terminale 2 — suite di verifica (attenzione: il burst di test attiva il rate limiting)
ADMIN_TOKEN='scegli-un-token' npm test
```

Il test deve puntare allo stesso server: se cambi PORT, imposta anche `BASE` in `tests/integration.test.js`.
Copre: tutte le API, il flusso SSE (snapshot, tick periodici, nessun duplicato), la disconnessione,
le richieste anomale (XSS, path traversal, SQL injection, JSON malformato), il rate limiting con 429,
il blocco temporaneo, l'endpoint admin protetto e la regressione delle funzionalità della Fase 1.

## API REST

| Metodo | Endpoint                | Descrizione                                                        |
| ------ | ----------------------- | ------------------------------------------------------------------ |
| GET    | `/api/status`           | Stato, uptime e timestamp                                          |
| GET    | `/api/time`             | Data e ora correnti (ISO, it-IT, unix)                             |
| GET    | `/api/metrics`          | Metriche reali: richieste, CPU, RAM, memoria Node, statistiche API |
| GET    | `/api/security`         | Stato protezioni, contatori, sorgenti bloccate, eventi             |
| GET    | `/api/events`           | Flusso Server-Sent Events (snapshot + aggiornamenti live)          |
| POST   | `/api/security/unblock` | Sblocco manuale IP — richiede header `x-lonewolf-admin: $ADMIN_TOKEN` |

Tipi di evento SSE: `snapshot`, `metrics` (ogni 2s), `security` (istantaneo), `sse_connect`/`sse_disconnect`.
Ogni evento ha un `seq` crescente: sia backend che frontend scartano i duplicati.

## Sicurezza

- **Helmet**: CSP, nosniff e altri header di sicurezza; `x-powered-by` rimosso.
- **Rate limiting**: 120 richieste/minuto per IP (finestra scorrevole in memoria). Over soglia → blocco 5 minuti → 429.
- **Anomaly detection**: path traversal, XSS, SQL injection, caratteri di controllo → 400 + evento.
- **404 ripetuti e payload malformati**: soglia configurabile di tentativi sospetti → blocco temporaneo.
- **Input validati**: limite payload 100KB, JSON malformato → 400 + evento; input `ip` validato sull'endpoint admin.
- **Registro separato**: eventi di sicurezza con timestamp, tipo e sorgente; mai mescolati col log di sistema.
- **Blocco temporaneo reversibile**: `POST /api/security/unblock` con header `x-lonewolf-admin: $ADMIN_TOKEN`.
- **Escape hatch**: l'endpoint admin è raggiungibile anche mentre la sorgente è bloccata (protetto da token).
- **Privacy**: gli IP sono mascherati (`127.0.0.xxx`) in tutte le risposte pubbliche e nella dashboard.

Tutti i valori mostrati derivano da misurazioni reali (`os.cpus()`, `process.cpuUsage()`, `process.memoryUsage()`,
`os.totalmem/os.freemem`, conteggi middleware) o da eventi realmente accaduti: nessun dato simulato.

## Configurazione opzionale (environment)

| Variabile              | Default  | Descrizione                              |
| ---------------------- | -------- | ---------------------------------------- |
| `PORT`                 | `3000`   | Porta HTTP                               |
| `METRICS_INTERVAL_MS`  | `2000`   | Intervallo di campionamento metriche     |
| `RATE_WINDOW_MS`       | `60000`  | Finestra rate limiting                   |
| `RATE_LIMIT_MAX`       | `120`    | Massimo richieste per finestra per IP    |
| `BLOCK_DURATION_MS`    | `300000` | Durata del blocco temporaneo             |
| `SUSPICIOUS_THRESHOLD` | `8`      | Tentativi sospetti prima del blocco      |
| `ADMIN_TOKEN`          | *(nessuno)* | Abilita l'endpoint di sblocco admin   |

## Funzionalità

1. **Dashboard dinamica** — stato, uptime, richieste HTTP, CPU/RAM di sistema, memoria processo Node, statistiche API per endpoint, log di sistema, centro di controllo sicurezza.
2. **SSE `/api/events`** — aggiornamenti push in tempo reale, niente refresh manuale, riconnessione automatica (retry 3s), heartbeat, contatore client live.
3. **Sicurezza integrata** — centro di controllo con stato protezioni, richieste bloccate, tentativi sospetti, blocchi attivi, eventi rilevati e cronologia avvisi.
4. **Zero dati finti** — ogni numero è una misura reale o un evento reale.
5. **Regressione Fase 1 garantita** — `/api/status`, `/api/time`, 404 JSON/HTML e chiusura pulita sono coperti dai test.

## Vincoli rispettati

Nessun database, nessun Docker, nessun servizio cloud. Dipendenze: `express` e `helmet` (richiesto esplicitamente).
Tutto funziona in locale.
