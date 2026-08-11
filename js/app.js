/*
  La Spesa - assemblaggio app (SPA)

  Nessun mixin Vue: ogni "feature" e' un plain object JS (window.FeatureXxx)
  con data()/computed/methods, unito qui a mano tramite mergeUnique(), che
  lancia un errore leggibile in caso di collisione di chiave invece di
  lasciare che Vue sovrascriva in silenzio (comportamento reale dei mixin
  Vue 2, verificato prima di scegliere questo approccio).

  Persistenza (watch + DataModel.persist) e toast sono trasversali a tutte
  le viste: restano qui, non in una singola feature.
*/

(function () {
  "use strict";

  ["DataModel", "FeatureLista", "FeatureCategorie", "FeatureProdotti", "FeatureRicette", "FeaturePiano"].forEach(
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
      units: DataModel.UNITS,
      pastiConfig: DataModel.PASTI,
      temaScuro: false,
      toastMessage: "",
      toastTimer: null
    };

    mergeUnique(data, FeatureLista.data(), "FeatureLista.data");
    mergeUnique(data, FeatureCategorie.data(), "FeatureCategorie.data");
    mergeUnique(data, FeatureProdotti.data(), "FeatureProdotti.data");
    mergeUnique(data, FeatureRicette.data(), "FeatureRicette.data");
    mergeUnique(data, FeaturePiano.data(), "FeaturePiano.data");

    return data;
  }

  var rootComputed = {};
  mergeUnique(rootComputed, FeatureLista.computed, "FeatureLista.computed");
  mergeUnique(rootComputed, FeaturePiano.computed, "FeaturePiano.computed");

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

  function persistHandler() {
    this.persistAll();
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
      var state = DataModel.load();
      this.lista = state.lista;
      this.categorie = state.categorie;
      this.sortMode = state.sortMode;
      this.prodotti = state.prodotti;
      this.ricette = state.ricette;
      this.categorieRicette = state.categorieRicette;
      this.piano = state.piano;

      this.temaScuro = DataModel.loadTema();
      document.documentElement.classList.toggle("theme-dark", this.temaScuro);
    }
  });
})();
