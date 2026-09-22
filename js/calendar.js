/*
  Shopping Kart - impegni da Google Calendar (sola lettura)

  L'utente incolla in Impostazioni l'"indirizzo segreto in formato iCal" del
  proprio calendario Google. Il download NON puo' avvenire qui nel browser
  (calendar.google.com non manda header CORS): lo fa api/calendar.php, che
  restituisce gli eventi gia' normalizzati in JSON. Vedi il commento in testa
  a quel file per i limiti del parser ICS e per il vincolo anti-SSRF
  sull'URL accettato.

  Nessuna dipendenza da Vue, come js/sync.js: qui c'e' solo il "come si
  parla col backend", lo stato reattivo sta in js/feature-calendario.js.

  Gli eventi scaricati vengono tenuti anche in localStorage (chiave dedicata,
  vedi js/data-model.js) cosi' restano visibili a connessione assente o
  mentre una nuova richiesta e' ancora in volo. Non sono dati dell'utente:
  non entrano nel blob v2, ne' nel backup, ne' nella sync cloud - l'unica
  cosa che passa nel piano (e quindi in backup/sync) e' la nota che l'utente
  decide esplicitamente di copiare in una cella pasto.
*/

(function () {
  "use strict";

  // stesso vincolo di api/calendar.php, ripetuto qui solo per dare un
  // messaggio d'errore immediato quando si incolla l'indirizzo sbagliato
  // (es. l'URL "pubblico" HTML del calendario invece dell'ICS)
  var PATTERN_ICS =
    /^https:\/\/calendar\.google\.com\/calendar\/ical\/[^/]+\/[^/]+\/basic\.ics$/;

  function normalizeIcsUrl(input) {
    var trimmed = (input || "").replace(/^\s+|\s+$/g, "");
    // Google offre lo stesso indirizzo anche in forma webcal://
    trimmed = trimmed.replace(/^webcal:\/\//i, "https://");
    return trimmed;
  }

  function isIcsUrlValido(url) {
    return PATTERN_ICS.test(normalizeIcsUrl(url));
  }

  function getUrl() {
    return DataModel.loadCalendarUrl();
  }

  function setUrl(url) {
    DataModel.persistCalendarUrl(normalizeIcsUrl(url));
  }

  function clearUrl() {
    DataModel.persistCalendarUrl("");
    DataModel.clearCalendarCache();
  }

  // il calendario e' utilizzabile solo se c'e' un URL configurato e il
  // browser sa fare fetch (Edge 14/Lumia non lo sa: li' la funzione resta
  // semplicemente spenta, come la sync cloud)
  function isDisponibile() {
    return !!window.fetch && !!getUrl();
  }

  // fuso orario del dispositivo, dove il browser sa dirlo (Intl non esiste
  // su Edge 14): se non lo sa, api/calendar.php ripiega su quello dichiarato
  // dal calendario stesso
  function fusoOrarioLocale() {
    try {
      if (window.Intl && Intl.DateTimeFormat) {
        var opts = Intl.DateTimeFormat().resolvedOptions();
        if (opts && opts.timeZone) return opts.timeZone;
      }
    } catch (e) {
      // ignorato: il backend ha il suo fallback
    }
    return "";
  }

  // Scarica gli eventi tra due date (Date locali, estremi inclusi).
  // Risolve con {eventiPerData, aggiornatoIl}; rifiuta con un Error il cui
  // "message" e' gia' il testo da mostrare all'utente.
  function fetchRange(fromDate, toDate) {
    var url = getUrl();
    if (!url) return Promise.reject(new Error("Nessun calendario configurato"));
    if (!window.fetch) return Promise.reject(new Error("Browser senza supporto"));

    var body = {
      icsUrl: url,
      from: DataModel.isoDateKey(fromDate),
      to: DataModel.isoDateKey(toDate),
      tz: fusoOrarioLocale()
    };

    return fetch("api/calendar.php", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    })
      .then(function (res) {
        return res.json().then(function (json) {
          if (!res.ok || !json || !json.success) {
            throw new Error(
              (json && json.error) || "Impossibile leggere il calendario"
            );
          }
          return json;
        });
      })
      .then(function (json) {
        var eventiPerData = raggruppaPerData(json.eventi);
        aggiornaCache(eventiPerData, json.aggiornatoIl, body.from, body.to);
        return {
          eventiPerData: eventiPerData,
          aggiornatoIl: json.aggiornatoIl
        };
      });
  }

  // il backend manda una lista piatta gia' ordinata, con una riga per ogni
  // giorno coperto: qui si raggruppa per data, che e' come la usano le viste
  function raggruppaPerData(eventi) {
    var out = {};
    if (!eventi || !eventi.length) return out;
    eventi.forEach(function (ev) {
      if (!ev || !ev.dataKey) return;
      if (!out[ev.dataKey]) out[ev.dataKey] = [];
      out[ev.dataKey].push(ev);
    });
    return out;
  }

  // La cache tiene SOLO le date dell'ultima finestra richiesta piu' quelle
  // gia' presenti fuori da essa: dentro la finestra il server e' la verita'
  // (un giorno senza eventi deve poter tornare vuoto, altrimenti un impegno
  // cancellato su Google resterebbe visibile per sempre).
  function aggiornaCache(eventiPerData, aggiornatoIl, fromKey, toKey) {
    var cache = DataModel.loadCalendarCache();
    var unione = {};

    Object.keys(cache.eventiPerData).forEach(function (dataKey) {
      if (dataKey < fromKey || dataKey > toKey) {
        unione[dataKey] = cache.eventiPerData[dataKey];
      }
    });
    Object.keys(eventiPerData).forEach(function (dataKey) {
      unione[dataKey] = eventiPerData[dataKey];
    });

    DataModel.persistCalendarCache({
      aggiornatoIl: aggiornatoIl || Date.now(),
      eventiPerData: unione
    });
  }

  function cacheLocale() {
    return DataModel.loadCalendarCache();
  }

  window.Calendar = {
    normalizeIcsUrl: normalizeIcsUrl,
    isIcsUrlValido: isIcsUrlValido,
    getUrl: getUrl,
    setUrl: setUrl,
    clearUrl: clearUrl,
    isDisponibile: isDisponibile,
    fetchRange: fetchRange,
    cacheLocale: cacheLocale
  };
})();
