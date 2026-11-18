# LONEWOLF SERVER

Pannello di controllo web con server backend integrato e realmente funzionante.
Frontend e backend nello stesso progetto, accessibile da `http://localhost:3000`.

## Struttura

```
lonewolf-server/
├── server.js                    # Entry point: avvia il server HTTP
├── package.json
├── src/
│   ├── app.js                   # Configurazione Express (static + API + errori)
│   ├── config.js                # Porta, host, timestamp di avvio
│   ├── routes/
│   │   └── api.js               # Endpoints /api/status e /api/time
│   ├── middleware/
│   │   └── errors.js            # Gestione 404 ed errori (JSON per API, pagina per HTML)
│   └── utils/
│       └── runtime.js           # Calcolo uptime formattato
└── public/                      # Frontend servito da Express
    ├── index.html               # Dashboard principale
    ├── 404.html                 # Pagina errore 404
    ├── css/style.css            # Tema scuro responsive
    └── js/dashboard.js          # Collegamento reale al backend + auto-aggiornamento
```

## Requisiti

- Node.js 18 o superiore (testato con Node 22)

## Installazione

```bash
cd lonewolf-server
npm install
```

## Avvio

```bash
npm start
```

Apri il browser su **http://localhost:3000**.

Per lo sviluppo con riavvio automatico al salvataggio dei file:

```bash
npm run dev
```

## API REST

| Metodo | Endpoint      | Descrizione                                              |
| ------ | ------------- | -------------------------------------------------------- |
| GET    | `/api/status` | Stato del server, uptime e timestamp                     |
| GET    | `/api/time`   | Data e ora correnti (ISO, locale it-IT, unix)            |

Esempio:

```bash
curl http://localhost:3000/api/status
curl http://localhost:3000/api/time
```

Risposta di `/api/status`:

```json
{
  "success": true,
  "server": "LONEWOLF SERVER",
  "status": "online",
  "uptime": { "seconds": 12, "human": "00:00:12" },
  "timestamp": "2025-01-01T12:00:00.000Z"
}
```

## Funzionalità

1. **Dashboard moderna** — tema scuro stile pannello di controllo, responsive (desktop, tablet, mobile).
2. **Server Express integrato** — un solo processo serve frontend e API.
3. **Avvio con `npm start`** — porta 3000 (personalizzabile con `PORT=8080 npm start`).
4. **`GET /api/status`** — stato, uptime e timestamp del server.
5. **`GET /api/time`** — data e ora correnti in più formati.
6. **Dashboard realmente collegata** — i dati mostrati arrivano da `fetch` verso il backend.
7. **Aggiornamento automatico** — sincronizzazione ogni 5 secondi, più evento manuale.
8. **Gestione errori e 404** — risposta JSON per percorsi API inesistenti, pagina 404 dedicata per il resto; chiusura pulita con Ctrl+C.
9. **Indicatore ONLINE/OFFLINE** — badge nel header e valore nello stato; passa a OFFLINE se il backend non risponde.
10. **Design scuro professionale** — radar/accenti ciano, scanlines, log di sistema live.

## Verifica funzionamento

1. Avvia con `npm start` e apri `http://localhost:3000`: l'indicatore deve passare a **ONLINE**.
2. Verifica che uptime e orario si aggiornino da soli ogni 5 secondi.
3. Testa le API con i comandi `curl` indicati sopra.
4. Apri un percorso inesistente, ad esempio `http://localhost:3000/api/inesistente` (risposta JSON 404) o `http://localhost:3000/xyz` (pagina 404).
5. Ferma il server con Ctrl+C: l'indicatore in dashboard passa a **OFFLINE** al prossimo aggiornamento.

## Vincoli rispettati

Nessun database, nessun Docker, nessun servizio cloud, nessuna libreria oltre a Express. Tutto funziona in locale.
