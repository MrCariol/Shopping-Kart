/*
  Shopping Kart - account (login verso un hub di autenticazione esterno,
  il cui dominio si sceglie qui in Impostazioni) e sincronizzazione cloud.
  La logica di autenticazione vive in js/auth.js, quella di
  sincronizzazione in js/sync.js: questo file e' solo lo stato/i metodi
  esposti alla UI (stesso pattern delle altre feature-*.js).
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
        // campo libero in Impostazioni: dominio dell'hub di autenticazione/
        // sincronizzazione da usare per il login (vedi js/auth.js). Editabile
        // anche da loggati, per correggerlo senza dover prima uscire.
        authHubDomain: Auth.getHubDomain(),
        lastSyncedModified: DataModel.loadSyncMeta().lastSyncedModified,
        syncConflict: null,
        // true mentre una chiamata di sync (automatica o manuale) e' in
        // volo: fa ruotare l'icona di sync in navbar/Impostazioni (vedi
        // index.html) al posto del vecchio toast "Sincronizzazione in
        // corso...", che con la sync ora automatica ad ogni modifica
        // sarebbe comparso troppo spesso
        syncing: false
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
      salvaDominioSync: function () {
        Auth.setHubDomain(this.authHubDomain);
        this.authHubDomain = Auth.getHubDomain();
        this.showToast("Dominio salvato");
      },

      login: function () {
        if (!this.authHubDomain) return;
        this.salvaDominioSync();
        Auth.startLogin();
      },

      logout: function () {
        Auth.logout();
        this.loggedIn = false;
        this.authUser = null;
        this.showToast("Disconnesso");
      },

      syncNow: function () {
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
