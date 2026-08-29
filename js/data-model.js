/*
  Shopping Kart - modello dati e persistenza (localStorage)

  Note di compatibilita volutamente rispettate in questo file:
  - niente spread operator {...obj} / [...arr]  (ES2018, non supportato da Edge 14)
  - niente optional chaining (?.) o nullish coalescing (??) (ES2020)
  - niente Array.prototype.includes/flat (per prudenza, uso indexOf)
  - date costruite/lette sempre da componenti locali (getFullYear/getMonth/
    getDate), MAI da toISOString() (che e' in UTC e puo' spostare il giorno
    vicino alla mezzanotte in fusi diversi da UTC+0)
*/

(function () {
  "use strict";

  var STORAGE_KEY_V2 = "shopping-kart-data-v2";
  var STORAGE_KEY_V1 = "shopping-kart-data-v1";
  // preferenza di visualizzazione del dispositivo, non un dato utente:
  // volutamente fuori dal blob v2 (non fa parte del backup/export)
  var STORAGE_KEY_TEMA = "shopping-kart-tema-v1";
  // stato di sincronizzazione: dispositivo-specifico (qual e' l'ultimo
  // "lastModified" del server che QUESTO dispositivo ha gia' visto/scritto),
  // volutamente fuori dal blob v2 per lo stesso motivo del tema
  var STORAGE_KEY_SYNC_META = "shopping-kart-sync-meta-v1";
  // token di accesso all'hub auth.example.invalid, fuori dal blob v2 (non ha
  // senso includerlo in un backup/export)
  var STORAGE_KEY_AUTH_TOKEN = "shopping-kart-auth-token-v1";

  // stesso valore del cache busting "?v=..." (vedi README, sezione
  // aggiornamenti): un solo numero di versione per tutta l'app, mostrato
  // in fondo a Impostazioni. Da aggiornare insieme agli altri file prima
  // di ogni pubblicazione.
  var APP_VERSION = "20260828b";

  var UNITS = ["", "kg", "g", "l", "ml", "conf"];

  // palette a swatch per le categorie ricetta - riusa gli stessi hex dei
  // contestuali Bootstrap 4 gia' presenti nell'app (badge/alert), per
  // coerenza visiva
  var SWATCH_COLORS = [
    "#28a745", // verde (success)
    "#ffc107", // giallo (warning)
    "#17a2b8", // azzurro (info)
    "#6c757d", // grigio (secondary)
    "#dc3545", // rosso (danger)
    "#fd7e14", // arancione
    "#6f42c1", // viola
    "#20c997" // verde acqua (teal)
  ];

  var DEFAULT_CATEGORIE = [
    { id: "cat-01", nome: "Frutta e verdura" },
    { id: "cat-02", nome: "Pane e prodotti da forno" },
    { id: "cat-03", nome: "Latticini e uova" },
    { id: "cat-04", nome: "Carne e pesce" },
    { id: "cat-05", nome: "Salumi e formaggi freschi" },
    { id: "cat-06", nome: "Surgelati" },
    { id: "cat-07", nome: "Pasta, riso e cereali" },
    { id: "cat-08", nome: "Scatolame e conserve" },
    { id: "cat-09", nome: "Condimenti e sughi" },
    { id: "cat-10", nome: "Snack e dolci" },
    { id: "cat-11", nome: "Bevande" },
    { id: "cat-12", nome: "Colazione" },
    { id: "cat-13", nome: "Igiene personale" },
    { id: "cat-14", nome: "Pulizia casa" }
  ];

  var DEFAULT_CATEGORIE_RICETTE = [
    { id: "catr-01", nome: "Proteine", colore: SWATCH_COLORS[0] },
    { id: "catr-02", nome: "Carboidrati", colore: SWATCH_COLORS[1] },
    { id: "catr-03", nome: "Fibre", colore: SWATCH_COLORS[2] },
    { id: "catr-04", nome: "Altro", colore: SWATCH_COLORS[3] }
  ];

  // le 3 colonne pasto della vista Piano: chiave dati, etichetta, classe
  // Bootstrap per lo sfondo pastello (riuso alert-* invece di nuovo CSS)
  var PASTI = [
    { key: "colazione", label: "Colazione", bgClass: "alert-warning" },
    { key: "pranzo", label: "Pranzo", bgClass: "alert-success" },
    { key: "cena", label: "Cena", bgClass: "alert-info" }
  ];

  var GIORNI_SETTIMANA = [
    "Lunedì",
    "Martedì",
    "Mercoledì",
    "Giovedì",
    "Venerdì",
    "Sabato",
    "Domenica"
  ];

  var MESI_ABBR = [
    "gen",
    "feb",
    "mar",
    "apr",
    "mag",
    "giu",
    "lug",
    "ago",
    "set",
    "ott",
    "nov",
    "dic"
  ];

  function uid(prefix) {
    return (
      (prefix || "id") +
      "-" +
      Date.now().toString(36) +
      "-" +
      Math.random().toString(36).slice(2, 8)
    );
  }

  // confronto alfabetico sicuro anche su motori che non supportano
  // i parametri estesi di localeCompare
  function compareNomi(a, b) {
    var an = (a || "").toString();
    var bn = (b || "").toString();
    try {
      return an.localeCompare(bn, "it", { sensitivity: "base" });
    } catch (e) {
      an = an.toLowerCase();
      bn = bn.toLowerCase();
      if (an < bn) return -1;
      if (an > bn) return 1;
      return 0;
    }
  }

  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }

  // ---------- date/settimana ----------
  function isoDateKey(date) {
    return (
      date.getFullYear() +
      "-" +
      pad2(date.getMonth() + 1) +
      "-" +
      pad2(date.getDate())
    );
  }

  function getMonday(date) {
    var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    var diff = (d.getDay() + 6) % 7; // normalizza getDay()===0 (Domenica)
    d.setDate(d.getDate() - diff);
    return d;
  }

  function addDays(date, n) {
    // costruttore con overflow: JS normalizza da solo mese/anno
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
  }

  function formatDateRange(monday) {
    var sunday = addDays(monday, 6);
    var sameMonth = monday.getMonth() === sunday.getMonth();
    var sameYear = monday.getFullYear() === sunday.getFullYear();

    var startStr;
    if (!sameYear) {
      startStr =
        monday.getDate() +
        " " +
        MESI_ABBR[monday.getMonth()] +
        " " +
        monday.getFullYear();
    } else if (!sameMonth) {
      startStr = monday.getDate() + " " + MESI_ABBR[monday.getMonth()];
    } else {
      startStr = String(monday.getDate());
    }

    var endStr =
      sunday.getDate() +
      " " +
      MESI_ABBR[sunday.getMonth()] +
      " " +
      sunday.getFullYear();

    return startStr + " – " + endStr;
  }

  // ---------- persistenza locale ----------
  function readJSON(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      // storage pieno o non disponibile: si ignora silenziosamente,
      // l'app continua a funzionare in memoria per la sessione corrente
    }
  }

  function defaultState() {
    return {
      lista: [],
      categorie: DEFAULT_CATEGORIE.map(function (c) {
        return { id: c.id, nome: c.nome };
      }),
      sortMode: "categoria",
      prodotti: [],
      ricette: [],
      categorieRicette: DEFAULT_CATEGORIE_RICETTE.map(function (c) {
        return { id: c.id, nome: c.nome, colore: c.colore };
      }),
      piano: {},
      // data dell'ultima modifica locale (epoch ms), usata dalla sync
      // cloud per capire quale tra locale/server e' piu' recente. 0
      // significa "mai modificato/mai salvato" (stato di default).
      aggiornatoIl: 0
    };
  }

  // ---------- piano: retrocompatibilita' voci celle pasto ----------
  // Fino alla v20260816d ogni cella pasto (colazione/pranzo/cena) era un
  // array di soli ricettaId (stringhe). Da qui in poi e' un array di
  // "voci" oggetto ({id, tipo:'ricetta', ricettaId, nota} oppure
  // {id, tipo:'nota', testo}), per poter affiancare alle ricette delle
  // semplici note libere. "nota" su una voce-ricetta (introdotta dopo, da
  // qui la seconda normalizzazione qui sotto) e' invece un'annotazione
  // breve sulla singola istanza pianificata (es. "x2"), NON sulla ricetta
  // in se': la stessa ricetta pianificata piu' volte puo' avere note
  // diverse (o nessuna) in ciascuna cella. Questa funzione converte al
  // volo le vecchie stringhe in voci-ricetta e garantisce che ogni
  // voce-ricetta abbia sempre il campo "nota" (anche vuoto), cosi' i piani
  // gia' salvati restano validi e "nota" resta sempre reattiva in Vue
  // (assegnata da subito, niente $set da fare altrove).
  function migraVociPasto(mealArray) {
    if (!Array.isArray(mealArray)) return [];
    return mealArray.map(function (voce) {
      if (typeof voce === "string") {
        return { id: uid("voce"), tipo: "ricetta", ricettaId: voce, nota: "" };
      }
      if (voce.tipo === "ricetta" && typeof voce.nota !== "string") {
        voce.nota = "";
      }
      return voce;
    });
  }

  function migraPiano(piano) {
    var out = {};
    if (!piano || typeof piano !== "object") return out;
    Object.keys(piano).forEach(function (dateKey) {
      var entry = piano[dateKey] || {};
      out[dateKey] = {
        colazione: migraVociPasto(entry.colazione),
        pranzo: migraVociPasto(entry.pranzo),
        cena: migraVociPasto(entry.cena)
      };
    });
    return out;
  }

  function normalizeSortMode(value, fallback) {
    return value === "categoria" ||
      value === "alpha-asc" ||
      value === "alpha-desc"
      ? value
      : fallback;
  }

  function normalizeState(parsed) {
    var state = defaultState();
    if (!parsed || typeof parsed !== "object") return state;

    if (Array.isArray(parsed.lista)) state.lista = parsed.lista;
    if (Array.isArray(parsed.categorie)) state.categorie = parsed.categorie;
    state.sortMode = normalizeSortMode(parsed.sortMode, state.sortMode);
    if (Array.isArray(parsed.prodotti)) state.prodotti = parsed.prodotti;
    if (Array.isArray(parsed.ricette)) state.ricette = parsed.ricette;
    if (Array.isArray(parsed.categorieRicette))
      state.categorieRicette = parsed.categorieRicette;
    if (parsed.piano && typeof parsed.piano === "object")
      state.piano = migraPiano(parsed.piano);
    if (typeof parsed.aggiornatoIl === "number")
      state.aggiornatoIl = parsed.aggiornatoIl;

    return state;
  }

  function load() {
    var rawV2 = readJSON(STORAGE_KEY_V2);
    if (rawV2) {
      return normalizeState(rawV2);
    }

    // migrazione da v1 (solo lista/categorie/sortMode esistevano):
    // la chiave v1 NON viene cancellata, resta come rete di sicurezza
    var rawV1 = readJSON(STORAGE_KEY_V1);
    var state = defaultState();
    if (rawV1) {
      if (Array.isArray(rawV1.lista)) state.lista = rawV1.lista;
      if (Array.isArray(rawV1.categorie)) state.categorie = rawV1.categorie;
      state.sortMode = normalizeSortMode(rawV1.sortMode, state.sortMode);
    }

    writeJSON(STORAGE_KEY_V2, state);
    return state;
  }

  function persist(payload, timestamp) {
    // timbro "ultima modifica locale" ad ogni salvataggio: e' quello che
    // la sync cloud usa per capire se questo dispositivo ha dati piu'
    // recenti di quelli sul server (vedi js/sync.js). Aggiornato anche
    // sull'oggetto passato, cosi' resta coerente in memoria oltre che
    // su storage. "timestamp" e' opzionale: usato solo da js/sync.js
    // (adoptRemote) per riallineare aggiornatoIl al lastModified del
    // server invece che ad "adesso", vedi commento li'.
    payload.aggiornatoIl =
      typeof timestamp === "number" ? timestamp : Date.now();
    writeJSON(STORAGE_KEY_V2, {
      lista: payload.lista,
      categorie: payload.categorie,
      sortMode: payload.sortMode,
      prodotti: payload.prodotti,
      ricette: payload.ricette,
      categorieRicette: payload.categorieRicette,
      piano: payload.piano,
      aggiornatoIl: payload.aggiornatoIl
    });
  }

  // ---------- preferenza tema (chiave dedicata, fuori dal blob v2) ----------
  function loadTema() {
    try {
      return localStorage.getItem(STORAGE_KEY_TEMA) === "dark";
    } catch (e) {
      return false;
    }
  }

  function persistTema(isDark) {
    try {
      localStorage.setItem(STORAGE_KEY_TEMA, isDark ? "dark" : "light");
    } catch (e) {
      // ignorato silenziosamente, come per il resto della persistenza
    }
  }

  // ---------- stato di sincronizzazione (chiave dedicata, fuori dal blob v2) ----------
  function loadSyncMeta() {
    var parsed = readJSON(STORAGE_KEY_SYNC_META);
    return {
      lastSyncedModified:
        parsed && typeof parsed.lastSyncedModified === "number"
          ? parsed.lastSyncedModified
          : null
    };
  }

  function persistSyncMeta(meta) {
    writeJSON(STORAGE_KEY_SYNC_META, {
      lastSyncedModified: meta.lastSyncedModified
    });
  }

  // ---------- token di accesso auth.example.invalid (chiave dedicata) ----------
  function loadAuthToken() {
    try {
      return localStorage.getItem(STORAGE_KEY_AUTH_TOKEN);
    } catch (e) {
      return null;
    }
  }

  function persistAuthToken(token) {
    try {
      localStorage.setItem(STORAGE_KEY_AUTH_TOKEN, token);
    } catch (e) {
      // ignorato silenziosamente, come per il resto della persistenza
    }
  }

  function clearAuthToken() {
    try {
      localStorage.removeItem(STORAGE_KEY_AUTH_TOKEN);
    } catch (e) {
      // ignorato silenziosamente
    }
  }

  window.DataModel = {
    STORAGE_KEY_V2: STORAGE_KEY_V2,
    STORAGE_KEY_V1: STORAGE_KEY_V1,
    APP_VERSION: APP_VERSION,
    UNITS: UNITS,
    SWATCH_COLORS: SWATCH_COLORS,
    DEFAULT_CATEGORIE: DEFAULT_CATEGORIE,
    DEFAULT_CATEGORIE_RICETTE: DEFAULT_CATEGORIE_RICETTE,
    PASTI: PASTI,
    GIORNI_SETTIMANA: GIORNI_SETTIMANA,
    MESI_ABBR: MESI_ABBR,
    uid: uid,
    compareNomi: compareNomi,
    pad2: pad2,
    isoDateKey: isoDateKey,
    getMonday: getMonday,
    addDays: addDays,
    formatDateRange: formatDateRange,
    load: load,
    persist: persist,
    loadTema: loadTema,
    persistTema: persistTema,
    loadSyncMeta: loadSyncMeta,
    persistSyncMeta: persistSyncMeta,
    loadAuthToken: loadAuthToken,
    persistAuthToken: persistAuthToken,
    clearAuthToken: clearAuthToken
  };
})();
