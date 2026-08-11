/*
  La Spesa - catalogo prodotti
  Usato dall'elenco prodotti in Impostazioni e dalla creazione "al volo"
  di un prodotto non trovato dentro l'editor ricetta (FeatureRicette).
*/

(function () {
  "use strict";

  window.FeatureProdotti = {
    data: function () {
      return {
        prodotti: [],
        newProdottoNome: "",
        newProdottoUnita: "pz",
        newProdottoCategoriaId: null
      };
    },

    methods: {
      // usato sia dal form "aggiungi prodotto" di Impostazioni sia dalla
      // creazione al volo dentro l'editor ricetta
      creaProdotto: function (nome, unita, categoriaId) {
        var trimmed = (nome || "").replace(/^\s+|\s+$/g, "");
        if (!trimmed) return null;
        var prodotto = {
          id: DataModel.uid("prod"),
          nome: trimmed,
          unita: unita || "pz",
          categoriaId: categoriaId || null,
          ultimoAcquisto: null
        };
        this.prodotti.push(prodotto);
        return prodotto;
      },

      addProdotto: function () {
        var p = this.creaProdotto(
          this.newProdottoNome,
          this.newProdottoUnita,
          this.newProdottoCategoriaId
        );
        if (!p) return;
        this.newProdottoNome = "";
        this.newProdottoUnita = "pz";
        this.newProdottoCategoriaId = null;
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
      // catalogo) cosi' da poterlo ritrovare nello storico della vista
      // Lista (FeatureLista.prodottiStorico), senza duplicare i dati in
      // un array separato
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
