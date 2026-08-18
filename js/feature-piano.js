/*
  Shopping Kart - vista "Piano alimentare"
  Settimana Lun-Dom, navigazione a offset, celle pasto, copia/incolla,
  generazione della lista della spesa dalla pianificazione.

  `piano` e' una mappa sparsa per data ISO locale (YYYY-MM-DD): solo i
  giorni con almeno un pasto pianificato hanno una entry. Le chiavi nuove
  vanno SEMPRE aggiunte con this.$set (limite di reattivita' di Vue 2 sugli
  oggetti semplici), le proprieta' gia' esistenti (colazione/pranzo/cena)
  si possono invece riassegnare/mutare direttamente.
*/

(function () {
  "use strict";

  // Trascinamento ricette nel Piano: il gesto (soglia di movimento,
  // pressione prolungata prima di attivarsi su touch, auto-scroll,
  // differenziazione scroll-vs-drag) e' gestito da SortableJS
  // (js/sortable.min.js, self-hosted, MIT - github.com/SortableJS/Sortable),
  // istanziata per ogni cella pasto in js/components.js (componente
  // meal-cell). E' una libreria matura pensata apposta per questo: una
  // implementazione a mano coi soli eventi DOM (provata in precedenza) si
  // e' rivelata inaffidabile su device touch reali (il browser puo'
  // decidere di scrollare la pagina prima che il JS intervenga, in base al
  // solo CSS "touch-action" - una gara persa in partenza senza una libreria
  // che gestisca la cosa a basso livello).
  function rilevaDragDropSupportato() {
    return !!window.Sortable;
  }

  window.FeaturePiano = {
    data: function () {
      return {
        piano: {},
        weekOffset: 0,
        clipboard: null, // null | {type:'day'|'week', data}

        showAddRecipeModal: false,
        addRecipeModalContext: null, // {date, mealKey}
        pendingCellTarget: null, // {data, mealKey} - creazione ricetta da cella

        showGeneraListaModal: false,
        generaListaSelezione: {}, // dateKey -> {colazione,pranzo,cena}: bool

        dragDropSupportato: rilevaDragDropSupportato()
      };
    },

    computed: {
      weekMonday: function () {
        var base = DataModel.getMonday(new Date());
        return DataModel.addDays(base, this.weekOffset * 7);
      },

      weekDates: function () {
        var self = this;
        var days = [];
        for (var i = 0; i < 7; i++) {
          days.push(DataModel.addDays(self.weekMonday, i));
        }
        return days;
      },

      weekRangeLabel: function () {
        return DataModel.formatDateRange(this.weekMonday);
      },

      todayKey: function () {
        return DataModel.isoDateKey(new Date());
      },

      // vista "Oggi": stesso pattern di staleness accettata di todayKey
      // (se l'app resta aperta a cavallo di mezzanotte non si aggiorna da
      // sola finche' qualche altra reattivita' non forza un re-render)
      oggiData: function () {
        return new Date();
      }
    },

    methods: {
      // ---------- lettura/scrittura piano ----------
      mealsForDate: function (date) {
        var entry = this.piano[DataModel.isoDateKey(date)];
        return entry || { colazione: [], pranzo: [], cena: [] };
      },

      ensureDateEntry: function (date) {
        var key = DataModel.isoDateKey(date);
        if (!this.piano[key]) {
          this.$set(this.piano, key, { colazione: [], pranzo: [], cena: [] });
        }
        return this.piano[key];
      },

      isToday: function (date) {
        return DataModel.isoDateKey(date) === this.todayKey;
      },

      pastoLabel: function (mealKey) {
        var found = null;
        DataModel.PASTI.forEach(function (p) {
          if (p.key === mealKey) found = p;
        });
        return found ? found.label : mealKey;
      },

      giornoLabel: function (date) {
        var idx = (date.getDay() + 6) % 7;
        return (
          DataModel.GIORNI_SETTIMANA[idx] +
          " " +
          date.getDate() +
          " " +
          DataModel.MESI_ABBR[date.getMonth()]
        );
      },

      // ---------- navigazione settimana ----------
      prevWeek: function () {
        this.weekOffset -= 1;
      },
      nextWeek: function () {
        this.weekOffset += 1;
      },
      vaiOggi: function () {
        this.weekOffset = 0;
      },

      // ---------- aggiunta/rimozione ricetta da una cella ----------
      apriAggiungiRicettaCella: function (date, mealKey) {
        this.addRecipeModalContext = { date: date, mealKey: mealKey };
        this.showAddRecipeModal = true;
      },

      chiudiAggiungiRicettaCella: function () {
        this.showAddRecipeModal = false;
        this.addRecipeModalContext = null;
      },

      selezionaRicettaPerCella: function (ricetta) {
        this.assegnaRicettaACella(
          this.addRecipeModalContext.date,
          this.addRecipeModalContext.mealKey,
          ricetta.id
        );
        this.chiudiAggiungiRicettaCella();
      },

      creaRicettaPerCella: function (nomeIniziale) {
        this.pendingCellTarget = {
          data: this.addRecipeModalContext.date,
          mealKey: this.addRecipeModalContext.mealKey
        };
        this.showAddRecipeModal = false;
        this.addRecipeModalContext = null;
        this.apriEditorRicettaNuova(nomeIniziale);
      },

      // niente controllo di unicita': la stessa ricetta puo' comparire piu'
      // volte nella stessa cella (es. doppia porzione), vedi
      // duplicaRicettaInCella piu' sotto
      assegnaRicettaACella: function (date, mealKey, ricettaId) {
        var entry = this.ensureDateEntry(date);
        entry[mealKey].push(ricettaId);
        this.showToast("Ricetta aggiunta al piano");
      },

      rimuoviRicettaDaCella: function (date, mealKey, ricettaId) {
        var entry = this.piano[DataModel.isoDateKey(date)];
        if (!entry) return;
        var pos = entry[mealKey].indexOf(ricettaId);
        if (pos !== -1) entry[mealKey].splice(pos, 1);
      },

      // duplica una ricetta gia' pianificata nella STESSA cella: aggiunge
      // un altro riferimento alla STESSA ricetta (niente nuova entita' nel
      // catalogo) cosi' una modifica alla ricetta si riflette su entrambe
      // le voci pianificate
      duplicaRicettaInCella: function (date, mealKey, ricettaId) {
        var originale = this.ricettaById(ricettaId);
        if (!originale) return;
        this.assegnaRicettaACella(date, mealKey, ricettaId);
        this.showToast("Ricetta duplicata: " + originale.nome);
      },

      // ---------- drag & drop (solo se dragDropSupportato) ----------
      // Chiamato da SortableJS (vedi js/components.js, meal-cell, "onEnd")
      // quando una ricetta viene rilasciata su una cella diversa da quella
      // di partenza. Riceve le chiavi (data ISO + pasto) direttamente dagli
      // attributi data-piano-date/data-piano-meal sul DOM, niente Date da
      // ricostruire.
      spostaRicettaPianoTraCelle: function (fromDateKey, fromMealKey, toDateKey, toMealKey, ricettaId) {
        var origineEntry = this.piano[fromDateKey];
        if (origineEntry) {
          var pos = origineEntry[fromMealKey].indexOf(ricettaId);
          if (pos !== -1) origineEntry[fromMealKey].splice(pos, 1);
        }

        if (!this.piano[toDateKey]) {
          this.$set(this.piano, toDateKey, { colazione: [], pranzo: [], cena: [] });
        }
        var destEntry = this.piano[toDateKey];
        destEntry[toMealKey].push(ricettaId);
      },

      // ---------- copia/incolla ----------
      copiaGiorno: function (date) {
        var entry = this.mealsForDate(date);
        this.clipboard = {
          type: "day",
          data: JSON.parse(JSON.stringify(entry))
        };
        this.showToast("Giorno copiato negli appunti");
      },

      incollaGiorno: function (date) {
        if (!this.clipboard || this.clipboard.type !== "day") return;
        var entry = this.ensureDateEntry(date);
        var hasContent =
          entry.colazione.length || entry.pranzo.length || entry.cena.length;
        if (hasContent) {
          var ok = window.confirm(
            "Il giorno selezionato ha già un piano: sovrascriverlo con quello copiato?"
          );
          if (!ok) return;
        }
        var data = this.clipboard.data;
        entry.colazione = data.colazione.slice();
        entry.pranzo = data.pranzo.slice();
        entry.cena = data.cena.slice();
        this.showToast("Piano incollato");
      },

      copiaSettimana: function () {
        var self = this;
        var days = this.weekDates.map(function (d) {
          var entry = self.mealsForDate(d);
          return {
            colazione: entry.colazione.slice(),
            pranzo: entry.pranzo.slice(),
            cena: entry.cena.slice()
          };
        });
        this.clipboard = { type: "week", data: days };
        this.showToast("Settimana copiata negli appunti");
      },

      incollaSettimana: function () {
        if (!this.clipboard || this.clipboard.type !== "week") return;
        var self = this;
        var hasContent = this.weekDates.some(function (d) {
          var entry = self.mealsForDate(d);
          return (
            entry.colazione.length || entry.pranzo.length || entry.cena.length
          );
        });
        if (hasContent) {
          var ok = window.confirm(
            "La settimana visualizzata ha già un piano: sovrascriverla con quella copiata?"
          );
          if (!ok) return;
        }
        this.weekDates.forEach(function (d, idx) {
          var entry = self.ensureDateEntry(d);
          var source = self.clipboard.data[idx];
          entry.colazione = source.colazione.slice();
          entry.pranzo = source.pranzo.slice();
          entry.cena = source.cena.slice();
        });
        this.showToast("Settimana incollata");
      },

      // ---------- genera lista della spesa dalla pianificazione ----------
      apriGeneraLista: function () {
        var sel = {};
        this.weekDates.forEach(function (d) {
          sel[DataModel.isoDateKey(d)] = {
            colazione: false,
            pranzo: false,
            cena: false
          };
        });
        this.generaListaSelezione = sel;
        this.showGeneraListaModal = true;
      },

      chiudiGeneraLista: function () {
        this.showGeneraListaModal = false;
      },

      selezioneGiorno: function (date) {
        return this.generaListaSelezione[DataModel.isoDateKey(date)];
      },

      toggleSelezioneGiorno: function (date) {
        var giorno = this.selezioneGiorno(date);
        var tutto = giorno.colazione && giorno.pranzo && giorno.cena;
        var nuovo = !tutto;
        giorno.colazione = nuovo;
        giorno.pranzo = nuovo;
        giorno.cena = nuovo;
      },

      toggleSelezionePasto: function (mealKey) {
        var self = this;
        var tutti = true;
        Object.keys(this.generaListaSelezione).forEach(function (dateKey) {
          if (!self.generaListaSelezione[dateKey][mealKey]) tutti = false;
        });
        var nuovo = !tutti;
        Object.keys(this.generaListaSelezione).forEach(function (dateKey) {
          self.generaListaSelezione[dateKey][mealKey] = nuovo;
        });
      },

      selezionaTuttaSettimana: function (valore) {
        var self = this;
        Object.keys(this.generaListaSelezione).forEach(function (dateKey) {
          DataModel.PASTI.forEach(function (pasto) {
            self.generaListaSelezione[dateKey][pasto.key] = valore;
          });
        });
      },

      confermaGeneraLista: function () {
        var self = this;
        var totali = {}; // prodottoId -> quantita sommata

        Object.keys(this.generaListaSelezione).forEach(function (dateKey) {
          var selGiorno = self.generaListaSelezione[dateKey];
          var entry = self.piano[dateKey];
          if (!entry) return;
          DataModel.PASTI.forEach(function (pasto) {
            if (!selGiorno[pasto.key]) return;
            entry[pasto.key].forEach(function (ricettaId) {
              var ricetta = null;
              self.ricette.forEach(function (r) {
                if (r.id === ricettaId) ricetta = r;
              });
              if (!ricetta) return;
              ricetta.ingredienti.forEach(function (ing) {
                totali[ing.prodottoId] =
                  (totali[ing.prodottoId] || 0) + ing.quantita;
              });
            });
          });
        });

        var prodottiIds = Object.keys(totali);
        if (prodottiIds.length === 0) {
          this.showToast("Nessun ingrediente nella selezione");
          this.showGeneraListaModal = false;
          return;
        }

        var aggiunti = 0;
        var aggiornati = 0;

        prodottiIds.forEach(function (prodottoId) {
          var prodotto = self.prodottoById(prodottoId);
          if (!prodotto) return; // prodotto eliminato nel frattempo: salta

          var quantitaTotale = Math.round(totali[prodottoId] * 100) / 100;
          var nomeNorm = prodotto.nome
            .replace(/^\s+|\s+$/g, "")
            .toLowerCase();

          var esistente = null;
          self.lista.forEach(function (it) {
            if (
              !esistente &&
              !it.acquistato &&
              it.unita === prodotto.unita &&
              it.nome.replace(/^\s+|\s+$/g, "").toLowerCase() === nomeNorm
            ) {
              esistente = it;
            }
          });

          if (esistente) {
            esistente.quantita =
              Math.round((esistente.quantita + quantitaTotale) * 100) / 100;
            aggiornati++;
          } else {
            self.lista.push({
              id: DataModel.uid("item"),
              nome: prodotto.nome,
              quantita: quantitaTotale,
              unita: prodotto.unita,
              categoriaId: prodotto.categoriaId,
              acquistato: false,
              dataAggiunta: new Date().toISOString()
            });
            aggiunti++;
          }
        });

        this.showGeneraListaModal = false;
        this.showToast(
          "Lista aggiornata: " +
            aggiunti +
            " nuovi, " +
            aggiornati +
            " aggiornati"
        );
      }
    }
  };
})();
