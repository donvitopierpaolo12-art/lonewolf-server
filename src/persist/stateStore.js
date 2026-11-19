const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const eventBus = require('../events/eventBus');
const protocol = require('../agents/protocol');

const statePath = path.join(config.persist.dir, 'state.json');
const anchorPath = path.join(config.persist.dir, 'anchor.json');
const FORMAT = 1;

const collectors = new Map();
const validators = new Map();

let dirReady = false;
let lastSavedAt = null;
let saveErrors = 0;
let lastVerdict = 'mai eseguito';
let saveTimer = null;
let unsubscribe = null;

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function registerCollector(name, fn) {
  collectors.set(name, fn);
}

function registerValidator(name, fn) {
  validators.set(name, fn);
}

function ensureDir() {
  if (dirReady) return true;
  try {
    fs.mkdirSync(config.persist.dir, { recursive: true, mode: 0o700 });
    dirReady = true;
    return true;
  } catch (err) {
    return false;
  }
}

function readJson(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    return { missing: err.code === 'ENOENT', raw: null, parseError: null };
  }
  try {
    return { missing: false, raw: JSON.parse(raw), parseError: null };
  } catch (err) {
    return { missing: false, raw: null, parseError: err.message };
  }
}

function checksumValid(candidate) {
  return Boolean(
    candidate &&
    typeof candidate.checksum === 'string' &&
    typeof candidate.payload === 'string' &&
    sha256(candidate.payload) === candidate.checksum
  );
}

function writeAtomic(file, content) {
  const tmp = `${file}.tmp`;
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.writeSync(fd, content);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

function findAnchorInChain(anchor, registry) {
  if (!Array.isArray(registry)) return false;
  return registry.some((entry) => entry && entry.seq === anchor.seq && entry.hash === anchor.hash);
}

function load() {
  const result = { verdict: 'fresh', data: null, findings: [] };
  if (!ensureDir()) {
    lastVerdict = 'degradato: filesystem non disponibile';
    result.verdict = 'degradato';
    result.findings.push({
      type: 'persist_error',
      detail: `DATA_DIR inutilizzabile (${config.persist.dir}): il server funziona senza persistenza`
    });
    return result;
  }

  const main = readJson(statePath);
  let source = statePath;
  let candidate = null;
  let verdict = 'fresh';
  let tamperFinding = null;

  if (main.missing) {
    const tmp = readJson(`${statePath}.tmp`);
    if (!tmp.missing && checksumValid(tmp.raw)) {
      source = `${statePath}.tmp`;
      candidate = tmp.raw;
      verdict = 'incomplete';
    } else {
      if (!tmp.missing) {
        lastVerdict = 'fresh (tmp non recuperabile)';
        result.findings.push({ type: 'persist_incomplete', detail: "file temporaneo non valido scartato: nessun dato ripristinato" });
      }
      lastVerdict = result.verdict = 'fresh';
      return result;
    }
  } else if (!main.parseError && checksumValid(main.raw)) {
    candidate = main.raw;
  } else {
    const tmp = readJson(`${statePath}.tmp`);
    if (!tmp.missing && checksumValid(tmp.raw)) {
      source = `${statePath}.tmp`;
      candidate = tmp.raw;
      verdict = 'incomplete';
    } else {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      try {
        fs.renameSync(statePath, `${statePath}.corrupt-${stamp}`);
        result.findings.push({ type: 'persist_corrupt', detail: `stato non leggibile o checksum errato: copia conservata in state.json.corrupt-${stamp}` });
      } catch (err) {
        result.findings.push({ type: 'persist_error', detail: `stato corrotto e non rinominabile: ${err.message}` });
      }
      result.verdict = 'corrupt';
      lastVerdict = 'corrupt';
      return result;
    }
  }

  const payload = candidate && typeof candidate.payload === 'string' ? JSON.parse(candidate.payload) : null;
  const fileChecksum = candidate.checksum;
  const state = payload && typeof payload === 'object' ? payload : null;

  if (!state) {
    result.verdict = 'corrupt';
    lastVerdict = 'corrupt';
    result.findings.push({ type: 'persist_corrupt', detail: 'payload dello stato assente o non valido' });
    return result;
  }

  const data = {};
  let sliceInvalid = false;
  for (const [name, validator] of validators) {
    const slice = state[name];
    if (slice && validator(slice)) {
      data[name] = slice;
    } else if (slice) {
      sliceInvalid = true;
      result.findings.push({ type: 'persist_sospetto', detail: `sezione "${name}" incongruente con il checksum registrato` });
    }
  }
  if (sliceInvalid) {
    verdict = 'tamper';
    result.findings.push({ type: 'persist_tamper', detail: 'sezione del registro incongruente con lo stato salvato: possibile manomissione' });
  }

  if (verdict === 'incomplete' && !result.findings.some((f) => f.type === 'persist_incomplete')) {
    result.findings.push({
      type: 'persist_incomplete',
      detail: `stato recuperato dal file ${path.basename(source)}: arresto avvenuto durante il salvataggio`
    });
  }

  if (data.guard && Array.isArray(data.guard.registry) && data.guard.registry.length > 0) {
    if (verdict === 'fresh') {
      const anchor = readJson(anchorPath).raw;
      if (!anchor) {
        verdict = 'incomplete';
        result.findings.push({ type: 'persist_incomplete', detail: 'ancora esterna assente: possibile interruzione del salvataggio' });
      } else if (anchor.stateChecksum !== fileChecksum) {
        if (findAnchorInChain(anchor, data.guard.registry)) {
          verdict = 'incomplete';
          result.findings.push({ type: 'persist_incomplete', detail: 'ancora esterna precedente al salvataggio dell\u2019ultimo stato: arresto avvenuto durante la scrittura' });
        } else {
          verdict = 'tamper';
          tamperFinding = { type: 'persist_tamper', detail: 'l\u2019ancora esterna non compare nella catena del registro e non corrisponde a nessuno stato salvato' };
          result.findings.push(tamperFinding);
        }
      } else {
        const head = data.guard.registry[0];
        if (anchor.seq === head.seq && anchor.hash === head.hash) {
          verdict = 'ok';
        } else if (findAnchorInChain(anchor, data.guard.registry)) {
          verdict = 'incomplete';
          result.findings.push({ type: 'persist_incomplete', detail: 'ancora esterna non allineata alla testa della catena' });
        } else {
          verdict = 'tamper';
          tamperFinding = { type: 'persist_tamper', detail: 'ancora esterna valida per questo stato ma il vertice registrato non \u00e8 pi\u00f9 presente nella catena: rimozioni sospette' };
          result.findings.push(tamperFinding);
        }
      }
    } else if (verdict === 'incomplete') {
      result.findings.push({ type: 'persist_incomplete', detail: `stato recuperato dal file temporaneo (${path.basename(source)}): arresto avvenuto durante il salvataggio` });
    }
  }

  if (verdict === 'tamper') {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    try {
      fs.renameSync(source === statePath ? statePath : `${statePath}.tmp`, `${statePath}.suspect-${stamp}`);
      (tamperFinding || result.findings[result.findings.length - 1]).detail += ` · copia di prova conservata in state.json.suspect-${stamp}`;
    } catch (err) {
      (tamperFinding || result.findings[result.findings.length - 1]).detail += ` · copia di prova non rinominabile: ${err.message}`;
    }
  }

  result.verdict = verdict;
  result.data = data;
  lastVerdict = verdict;
  return result;
}

function buildState() {
  const slices = {};
  for (const [name, fn] of collectors) {
    try {
      slices[name] = fn() || null;
    } catch (err) {
      saveErrors += 1;
      console.error(`[PERSIST] errore raccogliendo "${name}": ${err.message}`);
      slices[name] = null;
    }
  }
  const payload = JSON.stringify({
    format: FORMAT,
    savedAt: new Date().toISOString(),
    bootId: eventBus.bootId,
    ...slices
  });
  return { payload, checksum: sha256(payload) };
}

function save() {
  if (!ensureDir()) return false;
  const { payload, checksum } = buildState();
  const anchor = { ...protocol.currentAnchor(), stateChecksum: checksum, savedAt: new Date().toISOString() };
  try {
    writeAtomic(statePath, JSON.stringify({ checksum, payload }));
    writeAtomic(anchorPath, JSON.stringify(anchor));
    lastSavedAt = new Date().toISOString();
    return true;
  } catch (err) {
    saveErrors += 1;
    console.error(`[PERSIST] errore di scrittura: ${err.message}`);
    return false;
  }
}

function saveSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    save();
  }, config.persist.saveMs);
  if (saveTimer.unref) saveTimer.unref();
}

function saveNow() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  return save();
}

function start() {
  if (unsubscribe) return;
  if (!ensureDir()) return;
  unsubscribe = eventBus.subscribe(() => saveSoon());
}

function stop() {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
}

function stat() {
  return {
    lastSavedAt,
    lastVerdict,
    saveErrors,
    collectors: [...collectors.keys()],
    validators: [...validators.keys()]
  };
}

module.exports = { load, save, saveSoon, saveNow, start, stop, registerCollector, registerValidator, stat };
