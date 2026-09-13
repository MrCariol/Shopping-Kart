/*
  Shopping Kart - assemblaggio app (SPA)

  Nessun mixin Vue: ogni "feature" e' un plain object JS (window.FeatureXxx)
  con data()/computed/methods, unito qui a mano tramite mergeUnique(), che
  lancia un errore leggibile in caso di collisione di chiave invece di
  lasciare che Vue sovrascriva in silenzio (comportamento reale dei mixin
  Vue 2, verificato prima di scegliere questo approccio).

  Persistenza (watch + DataModel.persist) e toast sono trasversali a tutte
  le viste: restano qui, non in una singola feature. Lo stesso watch di
  persistenza innesca anche la sync cloud automatica dopo ogni modifica
  (persistHandler -> Sync.scheduleAutoSync, vedi commento in testa a
  js/sync.js per il quadro completo dei tre inneschi).
*/

(function () {
  "use strict";

  ["DataModel", "Auth", "Sync", "FeatureLista", "FeatureCategorie", "FeatureProdotti", "FeatureRicette", "FeaturePiano", "FeatureAccount"].forEach(
    function (name) {
      if (!window[name]) {
        throw new Error(
          name +
            " non è stato caricato: verifica l'ordine dei tag <script> in index.html."
        );
      }
    }
  );

  function mergeUnique(target, source, label) {
    if (!source) return;
    Object.keys(source).forEach(function (key) {
      if (Object.prototype.hasOwnProperty.call(target, key)) {
        throw new Error(
          "Collisione sulla chiave '" +
            key +
            "' durante il merge di " +
            label +
            ": già definita altrove."
        );
      }
      target[key] = source[key];
    });
  }

  function buildRootData() {
    var data = {
      view: "lista", // 'lista' | 'piano' | 'categorie-lista' | 'categorie-ricette' | 'prodotti' | 'ricette' | 'impostazioni'
      appVersion: DataModel.APP_VERSION,
      units: DataModel.UNITS,
      pastiConfig: DataModel.PASTI,
      aggiornatoIl: 0,
      temaScuro: false,
      toastMessage: "",
      toastTimer: null
    };

    mergeUnique(data, FeatureLista.data(), "FeatureLista.data");
    mergeUnique(data, FeatureCategorie.data(), "FeatureCategorie.data");
    mergeUnique(data, FeatureProdotti.data(), "FeatureProdotti.data");
    mergeUnique(data, FeatureRicette.data(), "FeatureRicette.data");
    mergeUnique(data, FeaturePiano.data(), "FeaturePiano.data");
    mergeUnique(data, FeatureAccount.data(), "FeatureAccount.data");

    return data;
  }

  var rootComputed = {};
  mergeUnique(rootComputed, FeatureLista.computed, "FeatureLista.computed");
  mergeUnique(
    rootComputed,
    FeatureCategorie.computed,
    "FeatureCategorie.computed"
  );
  mergeUnique(
    rootComputed,
    FeatureProdotti.computed,
    "FeatureProdotti.computed"
  );
  mergeUnique(rootComputed, FeatureRicette.computed, "FeatureRicette.computed");
  mergeUnique(rootComputed, FeaturePiano.computed, "FeaturePiano.computed");
  mergeUnique(rootComputed, FeatureAccount.computed, "FeatureAccount.computed");

  var rootMethods = {
    // ---------- navigazione SPA ----------
    setView: function (view) {
      this.view = view;
    },

    // ---------- toast ----------
    showToast: function (msg) {
      var self = this;
      this.toastMessage = msg;
      if (this.toastTimer) clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(function () {
        self.toastMessage = "";
      }, 2200);
    },

    // ---------- persistenza ----------
    persistAll: function () {
      DataModel.persist(this);
    },

    // ---------- backup JSON (intero blob v2) ----------
    exportBackup: function () {
      var data = {
        lista: this.lista,
        categorie: this.categorie,
        sortMode: this.sortMode,
        prodotti: this.prodotti,
        ricette: this.ricette,
        categorieRicette: this.categorieRicette,
        piano: this.piano,
        esportatoIl: new Date().toISOString()
      };

      var blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json"
      });
      var url = URL.createObjectURL(blob);

      var d = new Date();
      var fname =
        "la-spesa-backup-" +
        d.getFullYear() +
        "-" +
        DataModel.pad2(d.getMonth() + 1) +
        "-" +
        DataModel.pad2(d.getDate()) +
        ".json";

      var a = document.createElement("a");
      a.href = url;
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 1000);

      this.showToast("Backup esportato");
    },

    triggerImport: function () {
      var input = this.$refs.importFileInput;
      if (input) input.click();
    },

    importBackup: function (event) {
      var self = this;
      var files = event.target.files;
      var file = files && files.length ? files[0] : null;
      if (!file) return;

      var reader = new FileReader();
      reader.onload = function (e) {
        try {
          var parsed = JSON.parse(e.target.result);
          if (
            !parsed ||
            !Array.isArray(parsed.lista) ||
            !Array.isArray(parsed.categorie)
          ) {
            throw new Error("formato non valido");
          }

          var ok = window.confirm(
            "Importare questo backup? Tutti i dati attuali (lista della spesa, " +
              "categorie, prodotti, ricette, piano alimentare) verranno sostituiti."
          );
          if (!ok) {
            event.target.value = "";
            return;
          }

          self.lista = parsed.lista;
          self.categorie = parsed.categorie;
          if (
            parsed.sortMode === "categoria" ||
            parsed.sortMode === "alpha-asc" ||
            parsed.sortMode === "alpha-desc"
          ) {
            self.sortMode = parsed.sortMode;
          }
          self.prodotti = Array.isArray(parsed.prodotti)
            ? parsed.prodotti
            : [];
          self.ricette = Array.isArray(parsed.ricette) ? parsed.ricette : [];
          self.categorieRicette = Array.isArray(parsed.categorieRicette)
            ? parsed.categorieRicette
            : DataModel.DEFAULT_CATEGORIE_RICETTE.slice();
          self.piano =
            parsed.piano && typeof parsed.piano === "object"
              ? parsed.piano
              : {};

          self.showToast("Backup importato");
        } catch (err) {
          window.alert("Il file selezionato non è un backup valido.");
        }
        event.target.value = "";
      };
      reader.readAsText(file);
    }
  };

  mergeUnique(rootMethods, FeatureLista.methods, "FeatureLista.methods");
  mergeUnique(
    rootMethods,
    FeatureCategorie.methods,
    "FeatureCategorie.methods"
  );
  mergeUnique(rootMethods, FeatureProdotti.methods, "FeatureProdotti.methods");
  mergeUnique(rootMethods, FeatureRicette.methods, "FeatureRicette.methods");
  mergeUnique(rootMethods, FeaturePiano.methods, "FeaturePiano.methods");
  mergeUnique(rootMethods, FeatureAccount.methods, "FeatureAccount.methods");

  // sync automatica dopo ogni modifica locale: la stessa istanza gia'
  // usata per salvare su localStorage (vedi commento in testa a
  // js/sync.js sui tre inneschi della sync automatica). scheduleAutoSync
  // fa gia' da sola niente se l'utente non e' loggato o il browser non ha
  // fetch, quindi nessun controllo extra qui.
  //
  // this._hydrating (vedi created() sotto): il caricamento iniziale da
  // DataModel.load() assegna lista/categorie/... con gli stessi identici
  // valori appena letti dallo storage - non e' una modifica dell'utente,
  // e' solo idratazione dei dati reattivi. Senza questa guardia, il watch
  // (che non distingue le due cose) richiamerebbe qui persistAll(), che
  // ritimbrerebbe subito aggiornatoIl ad "adesso" sovrascrivendo il vero
  // valore caricato (assegnato subito dopo in created()) - falsando cosi'
  // il confronto L/S della sync ad ogni singola apertura dell'app, oltre a
  // far partire una sync automatica ridondante 2s dopo quella gia' avviata
  // da created().
  function persistHandler() {
    if (this._hydrating) return;
    this.persistAll();
    Sync.scheduleAutoSync(this);
  }

  // secondo/terzo innesco (il primo e' persistHandler sopra): ricontrolla
  // il server, in silenzio, quando l'app torna in primo piano e a
  // intervalli regolari mentre resta visibile - cosi' le modifiche fatte
  // da un altro dispositivo arrivano senza dover toccare "Sincronizza
  // ora". Stesso pattern (visibilitychange + focus) gia' usato per il
  // controllo aggiornamenti del Service Worker, in fondo a index.html.
  var SYNC_POLL_INTERVAL_MS = 30000;

  function registerAutoSyncTriggers(vueApp) {
    function syncIfVisible() {
      if (vueApp.loggedIn && document.visibilityState === "visible") {
        Sync.run(vueApp, { silent: true });
      }
    }

    document.addEventListener("visibilitychange", syncIfVisible);
    window.addEventListener("focus", syncIfVisible);
    setInterval(syncIfVisible, SYNC_POLL_INTERVAL_MS);
  }

  var rootWatch = {
    lista: { handler: persistHandler, deep: true },
    categorie: { handler: persistHandler, deep: true },
    sortMode: persistHandler,
    prodotti: { handler: persistHandler, deep: true },
    ricette: { handler: persistHandler, deep: true },
    categorieRicette: { handler: persistHandler, deep: true },
    piano: { handler: persistHandler, deep: true },

    // preferenza dispositivo: chiave dedicata, non nel blob v2
    temaScuro: function (isDark) {
      document.documentElement.classList.toggle("theme-dark", isDark);
      DataModel.persistTema(isDark);
    }
  };

  new Vue({
    el: "#app",
    data: buildRootData,
    computed: rootComputed,
    methods: rootMethods,
    watch: rootWatch,

    created: function () {
      // va per primo: se l'URL contiene "#token=..." (ritorno dal login
      // sull'hub di autenticazione configurato) lo consuma e ripulisce
      // subito l'URL
      Auth.consumeCallbackToken();
      // data() di FeatureAccount ha gia' provato a leggere lo stato di
      // login, ma prima che consumeCallbackToken() girasse: ricontrolla
      this.loggedIn = Auth.isLoggedIn();

      // vedi commento su persistHandler/this._hydrating sopra: nessuna
      // delle assegnazioni qui sotto deve essere trattata come una
      // modifica dell'utente. Proprieta' non reattiva (non dichiarata in
      // data()), apposta: e' solo un flag interno, non serve renderla
      // osservabile da Vue.
      this._hydrating = true;

      var state = DataModel.load();
      this.lista = state.lista;
      this.categorie = state.categorie;
      this.sortMode = state.sortMode;
      this.prodotti = state.prodotti;
      this.ricette = state.ricette;
      this.categorieRicette = state.categorieRicette;
      this.piano = state.piano;
      this.aggiornatoIl = state.aggiornatoIl;

      this.temaScuro = DataModel.loadTema();
      document.documentElement.classList.toggle("theme-dark", this.temaScuro);

      if (this.loggedIn) {
        Sync.run(this, { silent: true });
      }
      registerAutoSyncTriggers(this);

      // si azzera dopo il giro di watch innescato dalle assegnazioni qui
      // sopra (che gira comunque in un microtask successivo), non subito:
      // vedi commento su persistHandler
      this.$nextTick(function () {
        this._hydrating = false;
      }.bind(this));
    }
  });
})();
