/*
  Shopping Kart - sincronizzazione cloud dei dati (via backend proprio,
  api/sync.php - NON auth.example.invalid, che gestisce solo l'identita').

  Algoritmo a 3 timestamp:
    L = aggiornatoIl locale (quando questo dispositivo ha modificato per
        ultimo i propri dati)
    R = lastModified restituito dal server
    S = lastSyncedModified: l'ultimo valore di R che QUESTO dispositivo
        ha gia' visto/confermato (salvato in DataModel.loadSyncMeta())

  - R === S: il server non e' cambiato da quando questo dispositivo ha
    sincronizzato l'ultima volta -> se L > S, questo dispositivo ha
    modifiche non ancora inviate -> push silenzioso.
  - R !== S: qualcun altro ha scritto sul server nel frattempo -> se
    L === S (questo dispositivo non ha modifiche proprie) si adotta il
    server silenziosamente; altrimenti sono cambiati entrambi in modo
    indipendente -> conflitto, decide l'utente.

  Nessuna dipendenza da Vue: le funzioni ricevono l'istanza root come
  parametro e leggono/scrivono i suoi campi reattivi direttamente.

  Sync automatica (niente piu' bottone "Sincronizza ora" come unico modo
  per aggiornare): tre inneschi, nessuno dei quali richiede un'azione
  esplicita dell'utente oltre a usare l'app normalmente.
  - scheduleAutoSync(): richiamata dal watch di persistenza in js/app.js
    dopo OGNI modifica locale (lista/ricette/piano/...), con un debounce
    di AUTO_SYNC_DEBOUNCE_MS cosi' una raffica di modifiche ravvicinate
    (es. editing di una ricetta con piu' ingredienti) produce una sola
    chiamata di rete invece di una per campo.
  - visibilitychange/focus (registrati in js/app.js, stesso pattern gia'
    usato per il controllo aggiornamenti del Service Worker) -> ricontrolla
    il server quando l'utente torna sull'app, cosi' le modifiche fatte nel
    frattempo da un altro dispositivo arrivano subito.
  - un giro periodico (SYNC_POLL_INTERVAL_MS, in js/app.js) mentre l'app
    resta aperta e visibile, per il caso in cui un altro dispositivo scriva
    mentre questo resta in primo piano senza altre interazioni.
  Tutti e tre passano per run(), sempre con {silent:true}: l'utente non
  vede toast per queste sync di sottofondo, solo l'icona che ruota
  (vueApp.syncing, vedi beginSync/endSync sotto) mentre una chiamata e' in
  volo. "Sincronizza ora" resta disponibile per un tentativo esplicito
  (silent:false -> mostra il risultato in un toast).

  vueApp.syncing e un'eventuale richiesta arrivata mentre e' gia' true
  (pendingSync) evitano di accavallare piu' fetch quando i tre inneschi
  scattano vicini nel tempo: la richiesta in coda parte non appena quella
  in corso finisce, e "vince" la non-silenziosa se una delle due lo era
  (cosi' un click su "Sincronizza ora" arrivato durante una sync di
  sfondo ottiene comunque il suo toast di risultato).
*/

(function () {
  "use strict";

  var pendingSync = null; // null oppure {silent: bool}

  function beginSync(vueApp) {
    vueApp.syncing = true;
  }

  function endSync(vueApp) {
    vueApp.syncing = false;
    if (pendingSync) {
      var retry = pendingSync;
      pendingSync = null;
      run(vueApp, retry);
    }
  }

  var autoSyncTimer = null;
  var AUTO_SYNC_DEBOUNCE_MS = 2000;

  function scheduleAutoSync(vueApp) {
    if (!window.fetch || !Auth.isLoggedIn()) return;
    if (autoSyncTimer) clearTimeout(autoSyncTimer);
    autoSyncTimer = setTimeout(function () {
      autoSyncTimer = null;
      run(vueApp, { silent: true });
    }, AUTO_SYNC_DEBOUNCE_MS);
  }

  function callBackend(action, extra) {
    var token = Auth.getToken();
    if (!token) return Promise.reject(new Error("not-logged-in"));

    var body = { action: action };
    if (extra) {
      Object.keys(extra).forEach(function (k) {
        body[k] = extra[k];
      });
    }

    return fetch("api/sync.php", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }).then(function (res) {
      if (res.status === 401) {
        var unauthorizedErr = new Error("unauthorized");
        unauthorizedErr.unauthorized = true;
        throw unauthorizedErr;
      }
      return res.json().then(function (json) {
        if (!res.ok || !json || !json.success) {
          throw new Error((json && json.error) || "sync-error");
        }
        return json;
      });
    });
  }

  function isLocalEmpty(vueApp) {
    return (
      vueApp.lista.length === 0 &&
      vueApp.ricette.length === 0 &&
      vueApp.prodotti.length === 0 &&
      Object.keys(vueApp.piano).length === 0
    );
  }

  function summarize(state, timestamp) {
    return {
      aggiornatoIl: timestamp,
      lista: (state.lista || []).length,
      ricette: (state.ricette || []).length,
      prodotti: (state.prodotti || []).length,
      categorie: (state.categorie || []).length,
      pianoGiorni: Object.keys(state.piano || {}).length
    };
  }

  function setLastSynced(vueApp, timestamp) {
    var meta = DataModel.loadSyncMeta();
    meta.lastSyncedModified = timestamp;
    DataModel.persistSyncMeta(meta);
    vueApp.lastSyncedModified = timestamp;
  }

  function pushLocal(vueApp, options) {
    options = options || {};
    var payload = {
      lista: vueApp.lista,
      categorie: vueApp.categorie,
      sortMode: vueApp.sortMode,
      prodotti: vueApp.prodotti,
      ricette: vueApp.ricette,
      categorieRicette: vueApp.categorieRicette,
      piano: vueApp.piano
    };

    return callBackend("push", {
      data: payload,
      lastModified: vueApp.aggiornatoIl
    })
      .then(function (resp) {
        setLastSynced(vueApp, resp.lastModified);
        if (resp.user) vueApp.authUser = resp.user;
        if (!options.silent) vueApp.showToast("Dati sincronizzati");
      })
      .catch(function (err) {
        handleSyncError(vueApp, err, options.silent);
      });
  }

  // sostituisce lo stato locale con quello del server: usata sia
  // dall'adozione silenziosa sia dalla risoluzione manuale di un
  // conflitto con scelta "server"
  function adoptRemote(vueApp, data, remoteLastModified) {
    vueApp.lista = data.lista || [];
    vueApp.categorie = data.categorie || vueApp.categorie;
    vueApp.sortMode = data.sortMode || vueApp.sortMode;
    vueApp.prodotti = data.prodotti || [];
    vueApp.ricette = data.ricette || [];
    vueApp.categorieRicette = data.categorieRicette || vueApp.categorieRicette;
    vueApp.piano = data.piano || {};

    // si passa remoteLastModified come timestamp esplicito (invece di
    // lasciare che persist() stampi "adesso") cosi' L finisce allineato a
    // S = R impostato subito sotto: sono, da questo momento, la stessa
    // sincronizzazione. Il watch di persistenza (js/app.js) reagira'
    // comunque a queste stesse assegnazioni e richiamera' persistAll() ->
    // persist() SENZA timestamp esplicito, ritimbrando aggiornatoIl ad
    // "adesso" - per questo lo si corregge di nuovo dopo quel giro (vedi
    // $nextTick sotto): altrimenti L ("adesso") risulterebbe sempre piu'
    // recente di S (=R) e la sync automatica (js/app.js) rispedirebbe al
    // server, ad ogni giro, dati identici a quelli appena scaricati.
    DataModel.persist(vueApp, remoteLastModified);
    setLastSynced(vueApp, remoteLastModified);

    vueApp.$nextTick(function () {
      DataModel.persist(vueApp, remoteLastModified);
    });
  }

  function showConflict(vueApp, L, R, remoteData) {
    vueApp.syncConflict = {
      local: summarize(vueApp, L),
      remote: summarize(remoteData, R),
      remoteData: remoteData
    };
  }

  function handleSyncError(vueApp, err, silent) {
    if (err && err.unauthorized) {
      Auth.logout();
      vueApp.authUser = null;
      if (!silent) vueApp.showToast("Sessione scaduta: accedi di nuovo");
      return;
    }
    if (!silent) vueApp.showToast("Sincronizzazione non riuscita");
  }

  function run(vueApp, options) {
    options = options || {};
    var silent = !!options.silent;

    // progressive enhancement: niente fetch (Edge14/Lumia) = niente sync,
    // il resto dell'app funziona comunque
    if (!window.fetch) return;
    if (!Auth.isLoggedIn()) return;

    // una sync e' gia' in volo: si accoda questa richiesta invece di
    // accavallare una seconda fetch (vedi commento in testa al file)
    if (vueApp.syncing) {
      if (!pendingSync || !silent) pendingSync = { silent: silent };
      return;
    }
    beginSync(vueApp);

    callBackend("pull")
      .then(function (resp) {
        vueApp.authUser = resp.user || null;

        if (!resp.exists) {
          return pushLocal(vueApp, { silent: silent });
        }

        var meta = DataModel.loadSyncMeta();
        var S = meta.lastSyncedModified;
        var L = vueApp.aggiornatoIl || 0;
        var R = resp.lastModified;

        if (S === null) {
          if (isLocalEmpty(vueApp)) {
            adoptRemote(vueApp, resp.data, R);
            if (!silent) vueApp.showToast("Dati aggiornati dal server");
          } else {
            showConflict(vueApp, L, R, resp.data);
          }
          return;
        }

        if (R === S) {
          if (L > S) {
            return pushLocal(vueApp, { silent: silent });
          }
          if (!silent) vueApp.showToast("Dati già sincronizzati");
          return;
        }

        // R !== S: il server e' cambiato da quando questo dispositivo ha
        // sincronizzato l'ultima volta
        if (L === S || L === R) {
          adoptRemote(vueApp, resp.data, R);
          if (!silent) vueApp.showToast("Dati aggiornati dal server");
          return;
        }

        showConflict(vueApp, L, R, resp.data);
      })
      .catch(function (err) {
        handleSyncError(vueApp, err, silent);
      })
      .then(function () {
        endSync(vueApp);
      });
  }

  function resolveConflict(vueApp, choice) {
    var conflict = vueApp.syncConflict;
    if (!conflict) return;

    if (choice === "locale") {
      vueApp.syncConflict = null;
      beginSync(vueApp);
      pushLocal(vueApp, { silent: false }).then(function () {
        endSync(vueApp);
      });
      return;
    }

    if (choice === "server") {
      adoptRemote(vueApp, conflict.remoteData, conflict.remote.aggiornatoIl);
      vueApp.syncConflict = null;
      vueApp.showToast("Dati aggiornati dal server");
    }
  }

  window.Sync = {
    run: run,
    scheduleAutoSync: scheduleAutoSync,
    resolveConflict: resolveConflict
  };
})();
