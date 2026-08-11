/*
  La Spesa - vista "Lista della spesa"
  Legge/scrive anche `categorie` (corsie), di proprieta' di FeatureCategorie,
  e chiama `showToast`, di proprieta' di app.js.
*/

(function () {
  "use strict";

  window.FeatureLista = {
    data: function () {
      return {
        lista: [],
        sortMode: "categoria", // 'categoria' | 'alpha-asc' | 'alpha-desc'
        newItemNome: "",
        newItemQuantita: 1,
        newItemUnita: "pz",
        storicoAperto: false
      };
    },

    computed: {
      sortedFlatItems: function () {
        var items = this.lista.slice();
        var dir = this.sortMode === "alpha-desc" ? -1 : 1;
        items.sort(function (a, b) {
          return dir * DataModel.compareNomi(a.nome, b.nome);
        });
        return items;
      },

      groupedByCategory: function () {
        var self = this;
        var groups = [];

        var senza = this.lista.filter(function (it) {
          return !it.categoriaId;
        });
        senza.sort(function (a, b) {
          return DataModel.compareNomi(a.nome, b.nome);
        });
        groups.push({
          id: null,
          nome: this.senzaCategoriaLabel,
          locked: true,
          items: senza
        });

        this.categorie.forEach(function (cat) {
          var items = self.lista.filter(function (it) {
            return it.categoriaId === cat.id;
          });
          items.sort(function (a, b) {
            return DataModel.compareNomi(a.nome, b.nome);
          });
          groups.push({
            id: cat.id,
            nome: cat.nome,
            locked: false,
            items: items
          });
        });

        return groups;
      },

      visibleGroups: function () {
        // nasconde le sezioni vuote nella vista per categoria
        return this.groupedByCategory.filter(function (g) {
          return g.items.length > 0;
        });
      },

      totalCount: function () {
        return this.lista.length;
      },

      doneCount: function () {
        return this.lista.filter(function (i) {
          return i.acquistato;
        }).length;
      },

      // "storico" = prodotti del catalogo gia' acquistati almeno una volta
      // (campo ultimoAcquisto valorizzato), i piu' recenti per primi. Non
      // e' un array separato: e' una vista filtrata/ordinata su `prodotti`
      // (di proprieta' di FeatureProdotti), che non ha mai quantita' -
      // coerente col fatto che lo storico non ne ha bisogno.
      prodottiStorico: function () {
        return this.prodotti
          .filter(function (p) {
            return !!p.ultimoAcquisto;
          })
          .slice()
          .sort(function (a, b) {
            return new Date(b.ultimoAcquisto) - new Date(a.ultimoAcquisto);
          });
      }
    },

    methods: {
      addItem: function () {
        var nome = this.newItemNome.replace(/^\s+|\s+$/g, "");
        if (!nome) return;

        var qty = parseFloat(this.newItemQuantita);
        if (!qty || qty <= 0) qty = 1;

        this.lista.push({
          id: DataModel.uid("item"),
          nome: nome,
          quantita: qty,
          unita: this.newItemUnita || "pz",
          categoriaId: null,
          acquistato: false,
          dataAggiunta: new Date().toISOString()
        });

        this.newItemNome = "";
        this.newItemQuantita = 1;
        this.showToast("Aggiunto: " + nome);

        this.$nextTick(function () {
          var input = document.getElementById("new-item-input");
          if (input) input.focus();
        });
      },

      removeItem: function (item) {
        var ok = window.confirm(
          'Eliminare "' + item.nome + '" dalla lista?'
        );
        if (!ok) return;
        if (item.acquistato) this.archiviaAcquisto(item);
        var idx = this.lista.indexOf(item);
        if (idx !== -1) this.lista.splice(idx, 1);
      },

      // sposta in blocco tutti gli articoli gia' presi nello storico
      // prodotti, invece di doverli eliminare uno a uno dalla card espansa
      svuotaAcquistati: function () {
        var self = this;
        var acquistati = this.lista.filter(function (it) {
          return it.acquistato;
        });
        if (acquistati.length === 0) return;

        var ok = window.confirm(
          "Spostare " +
            acquistati.length +
            ' articolo/i già preso/i nello storico prodotti?'
        );
        if (!ok) return;

        acquistati.forEach(function (it) {
          self.archiviaAcquisto(it);
          var idx = self.lista.indexOf(it);
          if (idx !== -1) self.lista.splice(idx, 1);
        });

        this.showToast("Storico aggiornato");
      },

      riaggiungiDaStorico: function (prodotto) {
        this.lista.push({
          id: DataModel.uid("item"),
          nome: prodotto.nome,
          quantita: 1,
          unita: prodotto.unita,
          categoriaId: prodotto.categoriaId,
          acquistato: false,
          dataAggiunta: new Date().toISOString()
        });
        this.showToast("Aggiunto: " + prodotto.nome);
      }
    }
  };
})();
