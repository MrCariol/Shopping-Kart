/*
  La Spesa - gestione categorie
  - `categorie` (corsie supermercato): condivise dagli item di `lista` e
    dai `prodotti` (di proprieta' di FeatureProdotti, letti qui in cascata)
  - `categorieRicette` (tag nutrizionali colorati): usate da `ricette`
*/

(function () {
  "use strict";

  window.FeatureCategorie = {
    data: function () {
      return {
        categorie: [],
        categorieRicette: [],

        senzaCategoriaLabel: "Senza categoria",
        newCategoryNome: "",

        newCategoriaRicettaNome: "",
        newCategoriaRicettaColore: DataModel.SWATCH_COLORS[0],
        swatchColors: DataModel.SWATCH_COLORS
      };
    },

    methods: {
      categoriaRicettaById: function (id) {
        var found = null;
        this.categorieRicette.forEach(function (c) {
          if (c.id === id) found = c;
        });
        return found;
      },

      // ---------- categorie corsie (lista della spesa / prodotti) ----------
      addCategory: function () {
        var nome = this.newCategoryNome.replace(/^\s+|\s+$/g, "");
        if (!nome) return;
        this.categorie.push({ id: DataModel.uid("cat"), nome: nome });
        this.newCategoryNome = "";
      },

      moveCategoryUp: function (index) {
        if (index <= 0) return;
        var arr = this.categorie;
        var tmp = arr[index - 1];
        arr.splice(index - 1, 1, arr[index]);
        arr.splice(index, 1, tmp);
      },

      moveCategoryDown: function (index) {
        if (index >= this.categorie.length - 1) return;
        var arr = this.categorie;
        var tmp = arr[index + 1];
        arr.splice(index + 1, 1, arr[index]);
        arr.splice(index, 1, tmp);
      },

      deleteCategory: function (cat) {
        var listCount = this.lista.filter(function (it) {
          return it.categoriaId === cat.id;
        }).length;
        var prodCount = this.prodotti.filter(function (p) {
          return p.categoriaId === cat.id;
        }).length;
        var count = listCount + prodCount;

        var msg =
          count > 0
            ? 'Eliminare la categoria "' +
              cat.nome +
              '"? ' +
              count +
              ' elemento/i (lista della spesa e prodotti) passeranno a "Senza categoria".'
            : 'Eliminare la categoria "' + cat.nome + '"?';

        if (!window.confirm(msg)) return;

        this.lista.forEach(function (it) {
          if (it.categoriaId === cat.id) it.categoriaId = null;
        });
        this.prodotti.forEach(function (p) {
          if (p.categoriaId === cat.id) p.categoriaId = null;
        });

        var idx = this.categorie.indexOf(cat);
        if (idx !== -1) this.categorie.splice(idx, 1);
      },

      // ---------- categorie ricetta (tag nutrizionali colorati) ----------
      addCategoriaRicetta: function () {
        var nome = this.newCategoriaRicettaNome.replace(/^\s+|\s+$/g, "");
        if (!nome) return;
        this.categorieRicette.push({
          id: DataModel.uid("catr"),
          nome: nome,
          colore: this.newCategoriaRicettaColore || DataModel.SWATCH_COLORS[0]
        });
        this.newCategoriaRicettaNome = "";
        this.newCategoriaRicettaColore = DataModel.SWATCH_COLORS[0];
      },

      moveCategoriaRicettaUp: function (index) {
        if (index <= 0) return;
        var arr = this.categorieRicette;
        var tmp = arr[index - 1];
        arr.splice(index - 1, 1, arr[index]);
        arr.splice(index, 1, tmp);
      },

      moveCategoriaRicettaDown: function (index) {
        if (index >= this.categorieRicette.length - 1) return;
        var arr = this.categorieRicette;
        var tmp = arr[index + 1];
        arr.splice(index + 1, 1, arr[index]);
        arr.splice(index, 1, tmp);
      },

      deleteCategoriaRicetta: function (cat) {
        var count = this.ricette.filter(function (r) {
          return r.categorieIds.indexOf(cat.id) !== -1;
        }).length;

        var msg =
          count > 0
            ? 'Eliminare la categoria ricetta "' +
              cat.nome +
              '"? Verrà rimossa da ' +
              count +
              " ricetta/e."
            : 'Eliminare la categoria ricetta "' + cat.nome + '"?';

        if (!window.confirm(msg)) return;

        var idx = this.categorieRicette.indexOf(cat);
        if (idx !== -1) this.categorieRicette.splice(idx, 1);

        // ricette rimaste senza nessuna categoria: fallback sulla prima
        // categoria ricetta ancora disponibile (se esiste)
        var remaining = this.categorieRicette;
        this.ricette.forEach(function (r) {
          var pos = r.categorieIds.indexOf(cat.id);
          if (pos !== -1) r.categorieIds.splice(pos, 1);
          if (r.categorieIds.length === 0 && remaining.length > 0) {
            r.categorieIds.push(remaining[0].id);
          }
        });
      }
    }
  };
})();
