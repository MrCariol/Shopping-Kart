/*
  Shopping Kart - catalogo prodotti
  Il catalogo si popola da solo: creazione "al volo" di un prodotto non
  trovato dentro l'editor ricetta (FeatureRicette), oppure archiviazione
  automatica quando un articolo preso viene eliminato dalla lista
  (archiviaAcquisto, chiamata da FeatureLista). Nessun form dedicato per
  crearne uno manualmente: la barra di aggiunta articolo della vista Lista
  e' gia' sufficiente per iniziare.
*/

(function () {
  "use strict";

  window.FeatureProdotti = {
    data: function () {
      return {
        prodotti: []
      };
    },

    computed: {
      prodottiOrdinati: function () {
        return this.prodotti.slice().sort(function (a, b) {
          return DataModel.compareNomi(a.nome, b.nome);
        });
      }
    },

    methods: {
      // usato dalla creazione al volo di un prodotto dentro l'editor ricetta
      creaProdotto: function (nome, unita, categoriaId) {
        var trimmed = (nome || "").replace(/^\s+|\s+$/g, "");
        if (!trimmed) return null;
        var prodotto = {
          id: DataModel.uid("prod"),
          nome: trimmed,
          unita: unita || "",
          categoriaId: categoriaId || null,
          ultimoAcquisto: null
        };
        this.prodotti.push(prodotto);
        return prodotto;
      },

      deleteProdotto: function (prodotto) {
        var self = this;
        var ricetteCoinvolte = this.ricette.filter(function (r) {
          var found = false;
          r.ingredienti.forEach(function (ing) {
            if (ing.prodottoId === prodotto.id) found = true;
          });
          return found;
        });

        var msg;
        if (ricetteCoinvolte.length > 0) {
          var nomi = ricetteCoinvolte
            .map(function (r) {
              return r.nome;
            })
            .join(", ");
          msg =
            'Il prodotto "' +
            prodotto.nome +
            '" è usato in ' +
            ricetteCoinvolte.length +
            " ricetta/e (" +
            nomi +
            '). Eliminandolo verrà rimosso come ingrediente da quelle ricette ' +
            "(le ricette rimaste senza ingredienti verranno eliminate a loro volta). Continuare?";
        } else {
          msg = 'Eliminare il prodotto "' + prodotto.nome + '"?';
        }

        if (!window.confirm(msg)) return;

        var idx = this.prodotti.indexOf(prodotto);
        if (idx !== -1) this.prodotti.splice(idx, 1);

        var ricetteDaEliminare = [];
        this.ricette.forEach(function (r) {
          for (var i = r.ingredienti.length - 1; i >= 0; i--) {
            if (r.ingredienti[i].prodottoId === prodotto.id) {
              r.ingredienti.splice(i, 1);
            }
          }
          if (r.ingredienti.length === 0) {
            ricetteDaEliminare.push(r);
          }
        });

        ricetteDaEliminare.forEach(function (r) {
          self.eliminaRicettaSilenziosa(r);
        });

        if (ricetteDaEliminare.length > 0) {
          this.showToast(
            "Prodotto eliminato (" +
              ricetteDaEliminare.length +
              " ricetta/e rimossa/e perché rimaste senza ingredienti)"
          );
        }
      },

      // registra un articolo della lista come "gia' acquistato": aggiorna
      // il prodotto corrispondente (o lo crea, se non esiste ancora nel
      // catalogo), tenendo traccia di quando e' stato comprato l'ultima
      // volta (ultimoAcquisto) - usato altrove solo a scopo informativo,
      // il catalogo prodotti resta unico indipendentemente da questo campo
      archiviaAcquisto: function (item) {
        var nomeNorm = item.nome.replace(/^\s+|\s+$/g, "").toLowerCase();
        var esistente = null;
        this.prodotti.forEach(function (p) {
          if (
            !esistente &&
            p.unita === item.unita &&
            p.nome.replace(/^\s+|\s+$/g, "").toLowerCase() === nomeNorm
          ) {
            esistente = p;
          }
        });

        var ora = new Date().toISOString();
        if (esistente) {
          esistente.ultimoAcquisto = ora;
        } else {
          this.prodotti.push({
            id: DataModel.uid("prod"),
            nome: item.nome,
            unita: item.unita,
            categoriaId: item.categoriaId,
            ultimoAcquisto: ora
          });
        }
      }
    }
  };
})();
