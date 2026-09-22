/*
  Shopping Kart - vista/stato degli impegni di Google Calendar

  Stesso pattern delle altre feature-*.js: un plain object con data/computed/
  methods, unito all'istanza root in js/app.js. Il "come si parla col
  backend" sta in js/calendar.js, il backend in api/calendar.php.

  Gli impegni sono di SOLA LETTURA: si vedono accanto ai giorni del Piano
  (vista Piano e vista Oggi) per capire a colpo d'occhio quali giorni sono
  gia' occupati, e da li' si possono copiare in una cella pasto scegliendo il
  pasto. La copia crea una normale voce di tipo nota (aggiungiNotaACella in
  js/feature-piano.js): da quel momento e' un dato dell'app come tutti gli
  altri (entra in backup e sync, resta anche se poi l'evento sparisce da
  Google, e viceversa modificarla non tocca il calendario).

  Il caricamento degli eventi e' innescato da js/app.js (avvio, cambio vista,
  cambio settimana, ritorno in primo piano): qui c'e' solo
  aggiornaEventiVistaCorrente(), che decide la finestra di date in base alla
  vista attiva ed evita di ripetere la stessa richiesta troppo spesso.
*/

(function () {
  "use strict";

  // finestra gia' richiesta di recente: evita di ribattere sul backend ad
  // ogni singolo cambio di vista (api/calendar.php ha comunque una sua cache
  // da 10 minuti, questo risparmia il giro di rete)
  var ultimaRichiesta = { chiave: "", quando: 0 };
  var RICHIESTA_MIN_INTERVALLO_MS = 60000;
  var inVolo = false;

  function testoNotaDaEvento(evento) {
    if (!evento) return "";
    var titolo = evento.titolo || "";
    return evento.oraInizio ? evento.oraInizio + " " + titolo : titolo;
  }

  window.FeatureCalendario = {
    data: function () {
      var cache = DataModel.loadCalendarCache();
      return {
        // indirizzo iCal, editabile in Impostazioni
        calendarUrl: Calendar.getUrl(),
        // mappa dataKey -> array di eventi, idratata dalla copia locale cosi'
        // gli impegni gia' scaricati si vedono subito (anche offline) senza
        // aspettare la risposta del backend
        calendarEventi: cache.eventiPerData,
        calendarAggiornatoIl: cache.aggiornatoIl,
        calendarLoading: false,
        calendarError: "",
        // {date, evento} mentre il modale "copia impegno" e' aperto
        copiaEventoContext: null
      };
    },

    computed: {
      calendarioAttivo: function () {
        return !!this.calendarUrl;
      },

      // niente fetch su Edge 14 (come per la sync cloud): li' si puo'
      // comunque salvare l'indirizzo, ma gli eventi non arrivano
      calendarioSupportato: function () {
        return !!window.fetch;
      }
    },

    methods: {
      // ---------- configurazione (Impostazioni) ----------
      salvaCalendarUrl: function () {
        var pulito = Calendar.normalizeIcsUrl(this.calendarUrl);
        if (!pulito) {
          this.rimuoviCalendario();
          return;
        }
        if (!Calendar.isIcsUrlValido(pulito)) {
          this.calendarError =
            "Indirizzo non valido: serve l'indirizzo segreto in formato iCal " +
            "(finisce con /basic.ics)";
          return;
        }
        Calendar.setUrl(pulito);
        this.calendarUrl = Calendar.getUrl();
        this.calendarError = "";
        ultimaRichiesta = { chiave: "", quando: 0 };
        this.showToast("Calendario collegato");
        this.aggiornaEventiVistaCorrente(true);
      },

      rimuoviCalendario: function () {
        Calendar.clearUrl();
        this.calendarUrl = "";
        this.calendarEventi = {};
        this.calendarAggiornatoIl = null;
        this.calendarError = "";
        ultimaRichiesta = { chiave: "", quando: 0 };
        this.showToast("Calendario scollegato");
      },

      // ---------- lettura ----------
      eventiPerGiorno: function (date) {
        var eventi = this.calendarEventi[DataModel.isoDateKey(date)];
        return eventi || [];
      },

      calendarAggiornatoLabel: function () {
        if (!this.calendarAggiornatoIl) return "Mai";
        return this.formatSyncTimestamp(this.calendarAggiornatoIl);
      },

      // ---------- caricamento ----------
      // forza=true salta il controllo "richiesta gia' fatta di recente"
      // (usato dopo aver collegato un calendario o da un refresh esplicito)
      aggiornaEventiVistaCorrente: function (forza) {
        if (!Calendar.isDisponibile()) return;

        var da = null;
        var a = null;
        if (this.view === "piano") {
          da = this.weekDates[0];
          a = this.weekDates[this.weekDates.length - 1];
        } else if (this.view === "oggi") {
          da = this.oggiData;
          a = this.domaniData;
        } else {
          return; // nelle altre viste gli impegni non si vedono
        }

        this.caricaEventiRange(da, a, forza);
      },

      caricaEventiRange: function (daDate, aDate, forza) {
        var self = this;
        if (!Calendar.isDisponibile()) return;

        var chiave = DataModel.isoDateKey(daDate) + "/" + DataModel.isoDateKey(aDate);
        var adesso = Date.now();
        if (
          !forza &&
          chiave === ultimaRichiesta.chiave &&
          adesso - ultimaRichiesta.quando < RICHIESTA_MIN_INTERVALLO_MS
        ) {
          return;
        }
        if (inVolo) return;

        inVolo = true;
        ultimaRichiesta = { chiave: chiave, quando: adesso };
        this.calendarLoading = true;

        Calendar.fetchRange(daDate, aDate)
          .then(function (risultato) {
            // le chiavi nuove vanno aggiunte con $set (stesso limite di
            // reattivita' di Vue 2 gia' noto per "piano"): qui si riassegna
            // l'intera mappa, che e' equivalente e piu' semplice
            var unione = {};
            Object.keys(self.calendarEventi).forEach(function (dataKey) {
              unione[dataKey] = self.calendarEventi[dataKey];
            });
            var daKey = DataModel.isoDateKey(daDate);
            var aKey = DataModel.isoDateKey(aDate);
            // dentro la finestra appena richiesta comanda la risposta del
            // server, anche quando e' vuota (un impegno cancellato su Google
            // deve sparire anche qui)
            Object.keys(unione).forEach(function (dataKey) {
              if (dataKey >= daKey && dataKey <= aKey) delete unione[dataKey];
            });
            Object.keys(risultato.eventiPerData).forEach(function (dataKey) {
              unione[dataKey] = risultato.eventiPerData[dataKey];
            });

            self.calendarEventi = unione;
            self.calendarAggiornatoIl = risultato.aggiornatoIl || Date.now();
            self.calendarError = "";
          })
          .catch(function (err) {
            // si tengono comunque gli eventi gia' in cache: meglio impegni
            // vecchi che una vista vuota
            self.calendarError = err && err.message ? err.message : "Errore";
            ultimaRichiesta = { chiave: "", quando: 0 };
          })
          .then(function () {
            inVolo = false;
            self.calendarLoading = false;
          });
      },

      ricaricaCalendario: function () {
        this.aggiornaEventiVistaCorrente(true);
      },

      // ---------- copia di un impegno nel piano ----------
      apriCopiaEvento: function (date, evento) {
        this.copiaEventoContext = { date: date, evento: evento };
      },

      chiudiCopiaEvento: function () {
        this.copiaEventoContext = null;
      },

      anteprimaNotaEvento: function (evento) {
        return testoNotaDaEvento(evento);
      },

      confermaCopiaEventoInPasto: function (mealKey) {
        if (!this.copiaEventoContext) return;
        // riusa la stessa strada di una nota scritta a mano: da qui in poi
        // e' una voce del piano come le altre
        this.aggiungiNotaACella(
          this.copiaEventoContext.date,
          mealKey,
          testoNotaDaEvento(this.copiaEventoContext.evento)
        );
        this.chiudiCopiaEvento();
      }
    }
  };
})();
