# LONEWOLF SERVER

Pannello di controllo web dinamico, monitorato e protetto, con backend Express integrato e realmente funzionante.
Frontend e backend nello stesso progetto, accessibile da `http://localhost:3000`.

## Struttura

```
lonewolf-server/
├── server.js                        # Entry point: avvio HTTP, metriche, ripristino stato, shutdown controllato
├── package.json
├── tests/
│   ├── integration.test.js          # 47 verifiche: API, SSE, metriche, sicurezza
│   ├── agents.test.js               # 37 verifiche: agenti, protocollo, permessi, registro
│   ├── load_sse.test.js             # Carico SSE: 50 client + 300 richieste burst
│   ├── restart.test.js              # FASE 5: 22 verifiche su riavvio e ripristino dello stato
│   └── errors.test.js               # FASE 5: 33 verifiche su corruzione, manomissione, errori fatali
├── data/                            # Stato persistito (gitignored, permessi 0600): state.json + anchor.json
├── src/
│   ├── app.js                       # Configurazione Express (helmet, guardie, tracker, static, API)
│   ├── config.js                    # Porta, host, intervalli, soglie di sicurezza e agenti (env-overridable)
│   ├── agents/                      # FASE 4: agenti software interni
│   │   ├── index.js                 # Ciclo di vita (start/stop col server), snapshot, publisher SSE, restore
│   │   ├── protocol.js              # Protocollo controllato CORE <-> GUARD (messaggi whitelist, log, ancora)
│   │   ├── permissions.js           # Ruoli e permessi minimi dei due agenti
│   │   ├── core.js                  # LONEWOLF CORE: metriche, salute API, coerenza GUARD, contenimento
│   │   └── guard.js                 # LONEWOLF GUARD: analisi eventi, minacce, registro append-only con catena hash
│   ├── events/
│   │   └── eventBus.js              # Bus eventi centralizzato (seq monotoni, bootId, listener isolati)
│   ├── persist/                     # FASE 5: persistenza su disco (unico modulo con I/O su file)
│   │   └── stateStore.js            # state.json + anchor.json, scrittura atomica, checksum, classificazione
│   ├── metrics/
│   │   └── metrics.js               # Metriche REALI: CPU (os.cpus + cpuUsage), RAM, memoria Node, richieste
│   ├── security/
│   │   └── security.js              # Rate limiting, anomaly detection, blocchi IP, registro eventi
│   ├── sse/
│   │   ├── events.js                # Endpoint SSE /api/events (snapshot, heartbeat, cleanup)
│   │   └── clients.js               # Registro delle connessioni SSE attive + closeAll per shutdown
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
| GET    | `/api/agents`           | Stato di LONEWOLF CORE e GUARD, attività, comunicazioni            |
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

## LONEWOLF CORE & GUARD (Fase 4)

Due agenti software **indipendenti e deterministici**, integrati nel backend e avviati/arrestati insieme al server:

- **LONEWOLF CORE** — monitora lo stato operativo: analizza le metriche reali (CPU, heap, richieste), controlla la salute delle API (nuovi errori 5xx), riceve gli eventi interni, verifica periodicamente l'integrità del registro di GUARD e inoltra le richieste di contenimento.
- **LONEWOLF GUARD** — analizza TUTTI gli eventi di sicurezza (anche quelli non pubblicati sulla dashboard, via canale `security_observation`), calcola il livello di minaccia (NORMALE / ATTENZIONE / ALLERTA / CRITICO) con regole deterministiche, individua tentativi ripetuti dalla stessa sorgente e burst anomali, e segnala le minacce a CORE.

**Sicurezza e permessi ( verificati dai test )**:

1. GUARD non può modificare né cancellare i log: il suo registro è **append-only con catena SHA-256** (ogni voce contiene l'hash della precedente) e un'**ancora esterna** (seq/hash della testa) è custodita dal modulo del protocollo, fuori dal controllo di GUARD: qualsiasi modifica, rimozione, riordino o troncamento della testa rende il registro rilevabile come compromesso; lo stato è esposto in `/api/agents` (`registryAnchored`).
2. GUARD non ha alcun permesso di contenimento: può solo **segnalare** a CORE (`report_to_core`).
3. Solo CORE può inoltrare una richiesta di contenimento, e la decide **sempre il modulo di sicurezza esistente** con le sue soglie (`requestContainment` blocca solo se le regole già verificate sono soddisfatte); le decisioni sono registrate anche quando rifiutate.
4. Protocollo controllato: mittenti e tipi di messaggio in whitelist (`core→guard: integrity_request`; `guard→core: threat_report, digest, integrity_result`); ogni messaggio (accettato o rifiutato) è tracciato e visibile in dashboard.
5. Nessuno dei due agenti esegue comandi di sistema: operano solo su stato in memoria.
6. Nessuna IA simulata: le decisioni sono confronti deterministicì su soglie misurabili. Gli analizzatori sono funzioni pure `input → findings`, pronte per ospitare in futuro un modello AI locale senza toccare protocollo e permessi.

Recupero dalle interruzioni: i gestori eventi degli agenti sono isolati da try/catch (un errore non ferma l'agente: viene contato, registrato e l'analisi continua); arresto pulito in shutdown; la dashboard riceve gli aggiornamenti dei due agenti via SSE senza refresh manuale.

## Persistenza e recupero (Fase 5)

Ogni avvio del server pubblica un **bootId univoco**: la dashboard lo rileva via SSE e azzera il contatore dei duplicati solo quando cambia (niente dashboard bloccate dopo un riavvio).

Stato persistito in memoria persistente in `data/` (gitignored, permessi 0600):

- **`state.json`** — contatori di sicurezza, blocchi IP ancora validi (con le scadenze originali), registro eventi sicurezza, metriche cumulative, registro GUARD con catena SHA-256, livello di minaccia, contatori e log di CORE.
- **`anchor.json`** — l'ancora esterna del registro (seq/hash della testa) più il checksum del file di stato: ogni voce del registro GUARD sul disco è ancorata a un file separato che GUARD non può toccare.

**Scrittura atomica**: il file viene scritto su un temporaneo, poi `fsync` e `rename`: un'interruzione non può corrompere il file completo. Il salvataggio è debounced (ogni cambiamento di stato) e forzato a fine shutdown, prima di chiudere il processo.

**Caricamento e classificazione**, `data/state.json` viene verificato all'avvio con checksum SHA-256, validazione della catena hash e confronto con l'ancora, e classificato in:

| Verdetto    | Significato | Comportamento |
| ----------- | ----------- | ------------- |
| `fresh`     | nessun file (primo avvio o cartella vuota) | avvio pulito |
| `ok`        | checksum, catena e ancora congruenti | stato ripristinato interamente |
| `incomplete`| interruzione durante il salvataggio (tmp recuperabile, ancora mancante o disallineata ma compatibile) | stato recuperato, evento `persist_incomplete` |
| `corrupt`   | checksum o JSON non validi (corruzione accidentale) | file rinominato `state.json.corrupt-<ts>` e mai sovrascritto, avvio pulito, evento `persist_corrupt` |
| `tamper`    | catena invalida o ancora incoerente con la catena (possibile manomissione) | file rinominato `state.json.suspect-<ts>`, registro GUARD conservato in **sola lettura** (append rifiutati e contati), mai sovrascritto, evento `persist_tamper` |

Le tre condizioni (corruzione accidentale, salvataggio incompleto, possibile manomissione) sono distinte e non viene mai auto-classificata come manomissione un'interruzione di salvataggio. Un registro sospetto non viene mai auto-sovrascritto.

**Limitazione documentata**: il checksum è locale, quindi non protegge da un attaccante capace di riscrivere anche il checksum e l'ancora. La protezione effettiva è la combinazione catena hash + ancora esterna su file separato + verifica al caricamento; per un'ancora realmente esterna al server occorrerebbe un storage o un processo separato (fuori scope di questa fase).

**Ripristino selettivo**: i blocchi IP vengono riattivati solo se non scaduti, rispettando le scadenze originali (nessuna estensione); i contatori security/metrics si fondono al massimo; gli IP in modalità persistente restano raw solo nei file con permessi 0600: API, SSE e dashboard continuano a mostrare solo IP mascherati.

**Arresto controllato** su SIGINT/SIGTERM: (1) arresto agenti e publisher, (2) stop metriche, (3) chiusura di tutte le connessioni SSE, (4) salvataggio immediato dello stato, (5) chiusura del listener HTTP con timeout forzato. Un secondo segnale forza l'uscita immediata.

**Gestione errori**:

- Listener del bus isolati: un errore viene contato, loggato e ripubblicato come `bus_error` (visibile in dashboard) senza interrompere gli altri listener.
- `uncaughtException` / `unhandledRejection`: `[FATALE]` in log → salvataggio di quanto è saldo → shutdown controllato → exit 1. Il processo non continua a lavorare dopo una eccezione non gestita in stato potenzialmente incoerente.
- Errori secondari (persistenza I/O, dettach SSE, errori di un sotto-sistema): non bloccano il server; vengono loggati, contati e pubblicati come evento (`persist_error`, `bus_error`).
- `EADDRINUSE`: messaggio chiaro e exit 1 invece di uno stack trace grezzo.

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
| `GUARD_WINDOW_MS`      | `60000`  | Finestra di analisi minacce di GUARD     |
| `GUARD_REPEATED_THRESHOLD` | `5`  | Eventi ripetuti da una sorgente → finding ALLERTA |
| `GUARD_BURST_THRESHOLD`| `25`     | Eventi simultanei nella finestra → CRITICO |
| `GUARD_ALERT_THRESHOLD`| `15`     | Eventi nella finestra → ALLERTA          |
| `GUARD_CAUTION_THRESHOLD` | `5`   | Eventi nella finestra → ATTENZIONE       |
| `GUARD_DIGEST_MS`      | `15000`  | Frequenza digest periodico GUARD → CORE  |
| `CORE_CHECK_MS`        | `5000`   | Frequenza controllo salute API di CORE   |
| `CORE_CPU_THRESHOLD`   | `90`     | Soglia CPU sistema (%) per pressione risorse |
| `CORE_HEAP_THRESHOLD`  | `90`     | Soglia heap Node (%) per pressione risorse |
| `DATA_DIR`             | `<repo>/data` | Cartella dei file di persistenza (Fase 5) |
| `STATE_SAVE_MS`        | `10000`  | Debounce del salvataggio dello stato su disco |
| `SHUTDOWN_TIMEOUT_MS`  | `5000`   | Timeout forzato della chiusura controllata |

## Funzionalità

1. **Dashboard dinamica** — stato, uptime, richieste HTTP, CPU/RAM di sistema, memoria processo Node, statistiche API per endpoint, log di sistema, centro di controllo sicurezza.
2. **SSE `/api/events`** — aggiornamenti push in tempo reale, niente refresh manuale, riconnessione automatica (retry 3s), heartbeat, contatore client live.
3. **Sicurezza integrata** — centro di controllo con stato protezioni, richieste bloccate, tentativi sospetti, blocchi attivi, eventi rilevati e cronologia avvisi.
4. **Agenti LONEWOLF CORE & GUARD** — sezione dashboard dedicata con stato, attività corrente, ultimo controllo, ultimo evento, anomalie e comunicazioni, aggiornata via SSE.
5. **Zero dati finti** — ogni numero è una misura reale o un evento reale.
6. **Regressione Fasi 1-3 garantita** — API, 404, static, SSE, rate limiting e shutdown pulito sono coperti dai test.
7. **Persistenza e recupero (Fase 5)** — stato su disco con scrittura atomica e checksum, ripristino blocchi/contatori/registro all'avvio, classificazione fresh/ok/incomplete/corrupt/tamper, bootId per riconnettere la dashboard, arresto controllato senza perdita di dati.

## Test

```bash
npm test             # 47 verifiche: API, SSE, metriche, sicurezza (necessita server attivo)
npm run test:agents  # 37 verifiche: agenti, protocollo, permessi, registro
npm run test:restart # 22 verifiche: riavvii, ripristino stato, blocchi persistenti
npm run test:errors  # 33 verifiche: corruzione, salvataggio incompleto, manomissione, errori fatali
node tests/load_sse.test.js   # carico SSE: 50 client simultanei + burst 300 richieste
```

Le suite `test:restart` e `test:errors` avviano e arrestano i propri server con `DATA_DIR` temporanei dedicati; consigliato un `DATA_DIR` fresco anche per le altre suite, perché ora lo stato persiste tra i riavvii.

## Vincoli rispettati

Nessun database, nessun Docker, nessun servizio cloud. Dipendenze: `express` e `helmet` (richiesto esplicitamente).
Tutto funziona in locale.
