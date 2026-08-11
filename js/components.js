/*
  La Spesa - componenti Vue riutilizzabili
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

  // ---------- riga giorno (vista Piano alimentare) ----------
  Vue.component("day-row", {
    template: "#day-row-template",
    props: {
      date: { type: Date, required: true },
      meals: { type: Object, required: true },
      ricette: { type: Array, required: true },
      isToday: { type: Boolean, default: false },
      clipboard: { type: Object, default: null }
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
      }
    },
    methods: {
      nomeRicetta: function (ricettaId) {
        var found = null;
        this.ricette.forEach(function (r) {
          if (r.id === ricettaId) found = r;
        });
        return found ? found.nome : "(ricetta eliminata)";
      }
    }
  });
})();
