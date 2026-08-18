/*
  Shopping Kart - componenti Vue riutilizzabili
  (templates definiti come <script type="text/x-template"> in index.html)
*/

(function () {
  "use strict";

  // ---------- autocomplete con creazione al volo ----------
  // Riusato per cercare/creare ricette (piano) e prodotti (editor ricetta).
  Vue.component("autocomplete-input", {
    template: "#autocomplete-input-template",
    props: {
      items: { type: Array, required: true },
      placeholder: { type: String, default: "" }
    },
    data: function () {
      return { query: "", open: false };
    },
    computed: {
      normalizedQuery: function () {
        return this.query.replace(/^\s+|\s+$/g, "").toLowerCase();
      },
      suggestions: function () {
        var q = this.normalizedQuery;
        var list = this.items;
        if (q) {
          list = list.filter(function (it) {
            return it.nome.toLowerCase().indexOf(q) !== -1;
          });
        }
        return list.slice(0, 8);
      },
      exactMatch: function () {
        var q = this.normalizedQuery;
        if (!q) return null;
        var found = null;
        this.items.forEach(function (it) {
          if (!found && it.nome.replace(/^\s+|\s+$/g, "").toLowerCase() === q) {
            found = it;
          }
        });
        return found;
      },
      showCreateOption: function () {
        return !!this.normalizedQuery && !this.exactMatch;
      }
    },
    methods: {
      selectItem: function (item) {
        this.$emit("select", item);
        this.query = "";
        this.open = false;
      },
      createNew: function () {
        var text = this.query.replace(/^\s+|\s+$/g, "");
        if (!text) return;
        this.$emit("create", text);
        this.query = "";
        this.open = false;
      },
      onEnter: function () {
        if (this.exactMatch) {
          this.selectItem(this.exactMatch);
        } else if (this.normalizedQuery) {
          this.createNew();
        }
      },
      focusInput: function () {
        var input = this.$el.querySelector("input");
        if (input) input.focus();
      }
    }
  });

  // ---------- riga articolo (vista Lista della spesa) ----------
  Vue.component("item-row", {
    template: "#item-row-template",
    props: {
      item: { type: Object, required: true },
      units: { type: Array, required: true },
      categories: { type: Array, required: true }
    },
    data: function () {
      return { expanded: false };
    },
    methods: {
      toggleDone: function () {
        this.item.acquistato = !this.item.acquistato;
      },
      toggleExpand: function () {
        this.expanded = !this.expanded;
      },
      remove: function () {
        this.$emit("remove", this.item);
      }
    }
  });

  // ---------- riga prodotto (accordion Prodotti, vista Lista) ----------
  // Stesso pattern di item-row (click sul nome per espandere/modificare),
  // ma senza quantita' (i prodotti non ne hanno) e con un bottone "+" al
  // posto della checkbox, per aggiungere il prodotto alla lista.
  Vue.component("prodotto-row", {
    template: "#prodotto-row-template",
    props: {
      prodotto: { type: Object, required: true },
      units: { type: Array, required: true },
      categories: { type: Array, required: true }
    },
    data: function () {
      return { expanded: false };
    },
    methods: {
      toggleExpand: function () {
        this.expanded = !this.expanded;
      },
      add: function () {
        this.$emit("add", this.prodotto);
      },
      remove: function () {
        this.$emit("remove", this.prodotto);
      }
    }
  });

  // ---------- cella pasto (badge ricette + aggiungi) ----------
  // Riusata sia da day-row (vista Piano settimanale, 3 colonne strette)
  // sia dalla vista Oggi (3 sezioni impilate a piena larghezza): il layout
  // (colonna vs sezione intera) e' deciso dal genitore, questo componente
  // si occupa solo del contenuto della cella.
  Vue.component("meal-cell", {
    template: "#meal-cell-template",
    props: {
      pasto: { type: Object, required: true },
      // ogni voce e' {id, tipo:'ricetta', ricettaId} oppure
      // {id, tipo:'nota', testo} - vedi commento in js/feature-piano.js
      voci: { type: Array, required: true },
      ricette: { type: Array, required: true },
      dragDropSupportato: { type: Boolean, default: false },
      // data ISO (YYYY-MM-DD) della cella: serve solo per identificarla nel
      // DOM (attributi data-piano-date/data-piano-meal sul contenitore
      // $refs.lista, vedi template) - SortableJS li legge in "onEnd" per
      // sapere da dove a dove e' stata spostata una voce.
      dateKey: { type: String, default: "" },
      // per decidere se mostrare il bottone "incolla sezione" (visibile se
      // negli appunti c'e' copiato un pasto, qualunque sia la sezione o il
      // giorno di origine)
      clipboard: { type: Object, default: null }
    },
    data: function () {
      // stato di editing inline del testo nota: al piu' una nota alla
      // volta in modifica per singola cella
      return { editingNoteId: null, editingNoteText: "" };
    },
    computed: {
      canPastePasto: function () {
        return !!this.clipboard && this.clipboard.type === "pasto";
      }
    },
    methods: {
      nomeRicetta: function (ricettaId) {
        var found = null;
        this.ricette.forEach(function (r) {
          if (r.id === ricettaId) found = r;
        });
        return found ? found.nome : "(ricetta eliminata)";
      },
      iniziaModificaNota: function (voce) {
        this.editingNoteId = voce.id;
        this.editingNoteText = voce.testo;
        this.$nextTick(function () {
          var input = this.$refs.notaInput;
          if (input) {
            if (Array.isArray(input)) input = input[0];
            input.focus();
            input.select();
          }
        }.bind(this));
      },
      confermaModificaNota: function (voce) {
        if (this.editingNoteId !== voce.id) return;
        var testo = this.editingNoteText.replace(/^\s+|\s+$/g, "");
        this.editingNoteId = null;
        if (testo && testo !== voce.testo) {
          this.$emit("edit-nota", { itemId: voce.id, testo: testo });
        }
      },
      annullaModificaNota: function () {
        this.editingNoteId = null;
      }
    },

    // Trascinamento ricette (Piano alimentare): un'istanza SortableJS per
    // ogni cella pasto, tutte nello stesso "group" cosi' si può trascinare
    // una ricetta da una cella all'altra (stesso giorno o giorno diverso).
    // SortableJS gestisce lui il gesto (soglia di movimento, pressione
    // prolungata su touch, auto-scroll, differenziazione scroll-vs-drag):
    // e' una libreria matura specificamente per questo, molto più
    // affidabile di una gestione a mano di pointerdown/move/up sui
    // touch device reali (vedi commento in js/feature-piano.js).
    mounted: function () {
      if (!this.dragDropSupportato || !window.Sortable) return;
      var vm = this.$root;
      try {
        this._sortable = new Sortable(this.$refs.lista, {
          group: "piano-ricette",
          draggable: ".piano-draggable",
          // solo i due bottoncini icona (duplica/rimuovi) restano fuori dal
          // trascinamento: il bottone col nome ricetta (modifica) partecipa
          // anche lui, cosi' tutto il badge e' "afferrabile" (altrimenti,
          // su badge stretti, restava solo un bordo sottile da prendere) -
          // un tap breve senza spostamento resta comunque un click normale.
          filter: ".piano-badge-action",
          preventOnFilter: false,
          animation: 150,
          forceFallback: true,
          fallbackTolerance: 3,
          delay: 150,
          delayOnTouchOnly: true,
          touchStartThreshold: 5,
          ghostClass: "piano-sortable-ghost",
          chosenClass: "piano-sortable-chosen",
          onEnd: function (evt) {
            var item = evt.item;
            var from = evt.from;

            // Sortable ha gia' spostato "item" nel DOM: lo si riporta alla
            // posizione originale, cosi' e' Vue (non Sortable) a decidere
            // il DOM finale in base ai dati aggiornati sotto.
            if (evt.oldIndex < from.children.length) {
              from.insertBefore(item, from.children[evt.oldIndex]);
            } else {
              from.appendChild(item);
            }

            var voceId = item.getAttribute("data-voce-id");
            var fromDateKey = from.getAttribute("data-piano-date");
            var fromMealKey = from.getAttribute("data-piano-meal");
            var toDateKey = evt.to.getAttribute("data-piano-date");
            var toMealKey = evt.to.getAttribute("data-piano-meal");

            if (fromDateKey === toDateKey && fromMealKey === toMealKey) return;

            vm.spostaVoceTraCelle(
              fromDateKey,
              fromMealKey,
              toDateKey,
              toMealKey,
              voceId
            );
          }
        });
      } catch (e) {
        // motore senza supporto sufficiente (es. Edge molto vecchio):
        // niente trascinamento, il resto della cella funziona comunque
        this._sortable = null;
      }
    },

    beforeDestroy: function () {
      if (this._sortable) {
        this._sortable.destroy();
        this._sortable = null;
      }
    }
  });

  // ---------- riga giorno (vista Piano alimentare) ----------
  Vue.component("day-row", {
    template: "#day-row-template",
    props: {
      date: { type: Date, required: true },
      meals: { type: Object, required: true },
      ricette: { type: Array, required: true },
      isToday: { type: Boolean, default: false },
      clipboard: { type: Object, default: null },
      dragDropSupportato: { type: Boolean, default: false }
    },
    data: function () {
      return { pasti: DataModel.PASTI };
    },
    computed: {
      giornoNome: function () {
        var idx = (this.date.getDay() + 6) % 7;
        return DataModel.GIORNI_SETTIMANA[idx];
      },
      giornoData: function () {
        return this.date.getDate() + " " + DataModel.MESI_ABBR[this.date.getMonth()];
      },
      canPasteDay: function () {
        return !!this.clipboard && this.clipboard.type === "day";
      },
      dateKeyStr: function () {
        return DataModel.isoDateKey(this.date);
      }
    }
  });
})();
