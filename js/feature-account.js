/*
  Shopping Kart - account (login via auth.example.invalid) e sincronizzazione
  cloud, vista in Impostazioni. La logica di autenticazione vive in
  js/auth.js, quella di sincronizzazione in js/sync.js: questo file e'
  solo lo stato/i metodi esposti alla UI (stesso pattern delle altre
  feature-*.js).
*/

(function () {
  "use strict";

  function formatDateTime(ts) {
    var d = new Date(ts);
    return (
      DataModel.pad2(d.getDate()) +
      " " +
      DataModel.MESI_ABBR[d.getMonth()] +
      " " +
      d.getFullYear() +
      ", " +
      DataModel.pad2(d.getHours()) +
      ":" +
      DataModel.pad2(d.getMinutes())
    );
  }

  window.FeatureAccount = {
    data: function () {
      return {
        // valore iniziale "al meglio": consumeCallbackToken() non e'
        // ancora stato chiamato quando data() viene valutato (gira prima
        // di created()), quindi app.js lo ricorregge subito in created()
        loggedIn: Auth.isLoggedIn(),
        authUser: null,
        lastSyncedModified: DataModel.loadSyncMeta().lastSyncedModified,
        syncConflict: null
      };
    },

    computed: {
      lastSyncLabel: function () {
        return this.lastSyncedModified
          ? formatDateTime(this.lastSyncedModified)
          : "Mai";
      }
    },

    methods: {
      login: function () {
        Auth.startLogin();
      },

      logout: function () {
        Auth.logout();
        this.loggedIn = false;
        this.authUser = null;
        this.showToast("Disconnesso");
      },

      syncNow: function () {
        this.showToast("Sincronizzazione in corso…");
        Sync.run(this, { silent: false });
      },

      resolveSyncConflict: function (choice) {
        Sync.resolveConflict(this, choice);
      },

      formatSyncTimestamp: function (ts) {
        return ts ? formatDateTime(ts) : "—";
      }
    }
  };
})();
