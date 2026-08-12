/*
  La Spesa - catalogo ricette ed editor ricetta (modale)

  Una ricetta nuova viene creata come bozza NON ancora presente in
  `ricette`: "Annulla" la scarta semplicemente. Una ricetta esistente
  viene invece aperta per riferimento diretto (stesso oggetto dell'array,
  stesso approccio gia' usato altrove nell'app - es. item-row - dove le
  modifiche si applicano subito, senza un vero "annulla").
*/

(function () {
  "use strict";

  window.FeatureRicette = {
    data: function () {
      return {
        ricette: [],

        showRecipeEditor: false,
        ricettaDraft: null,
        ricettaDraftIsNew: false,
        ricettaDraftErrore: "",

        // creazione al volo di un prodotto dentro una riga ingrediente
        ingredienteInCreazione: null, // indice della riga, o null
        nuovoProdottoNomeInline: "",
        nuovoProdottoUnitaInline: "",
        nuovoProdottoCategoriaInline: null
      };
    },

    computed: {
      ricetteOrdinate: function () {
        return this.ricette.slice().sort(function (a, b) {
          return DataModel.compareNomi(a.nome, b.nome);
        });
      }
    },

    methods: {
      prodottoById: function (id) {
        var found = null;
        this.prodotti.forEach(function (p) {
          if (p.id === id) found = p;
        });
        return found;
      },

      ricettaById: function (id) {
        var found = null;
        this.ricette.forEach(function (r) {
          if (r.id === id) found = r;
        });
        return found;
      },

      // ---------- apertura/chiusura editor ----------
      apriEditorRicettaNuova: function (nomeIniziale) {
        this.ricettaDraft = {
          id: DataModel.uid("ric"),
          nome: nomeIniziale || "",
          categorieIds: [],
          ingredienti: []
        };
        this.ricettaDraftIsNew = true;
        this.ricettaDraftErrore = "";
        this.ingredienteInCreazione = null;
        this.showRecipeEditor = true;
      },

      apriEditorRicettaDaId: function (id) {
        var ricetta = this.ricettaById(id);
        if (!ricetta) return;
        this.apriEditorRicettaEsistente(ricetta);
      },

      apriEditorRicettaEsistente: function (ricetta) {
        this.ricettaDraft = ricetta;
        this.ricettaDraftIsNew = false;
        this.ricettaDraftErrore = "";
        this.ingredienteInCreazione = null;
        this.showRecipeEditor = true;
      },

      chiudiEditorRicetta: function () {
        this.showRecipeEditor = false;
        this.ricettaDraft = null;
        this.ingredienteInCreazione = null;
        this.pendingCellTarget = null;
      },

      // ---------- ingredienti bozza ----------
      aggiungiIngredienteDraft: function () {
        this.ricettaDraft.ingredienti.push({ prodottoId: null, quantita: 1 });
      },

      rimuoviIngredienteDraft: function (index) {
        this.ricettaDraft.ingredienti.splice(index, 1);
        if (this.ingredienteInCreazione === index) {
          this.ingredienteInCreazione = null;
        }
      },

      selezionaProdottoIngrediente: function (index, prodotto) {
        this.ricettaDraft.ingredienti[index].prodottoId = prodotto.id;
        this.ingredienteInCreazione = null;
      },

      cambiaProdottoIngrediente: function (index) {
        this.ricettaDraft.ingredienti[index].prodottoId = null;
      },

      avviaCreazioneProdottoInline: function (index, nomeIniziale) {
        this.ingredienteInCreazione = index;
        this.nuovoProdottoNomeInline = nomeIniziale || "";
        this.nuovoProdottoUnitaInline = "";
        this.nuovoProdottoCategoriaInline = null;
      },

      annullaCreazioneProdottoInline: function () {
        this.ingredienteInCreazione = null;
      },

      confermaNuovoProdottoInline: function (index) {
        var p = this.creaProdotto(
          this.nuovoProdottoNomeInline,
          this.nuovoProdottoUnitaInline,
          this.nuovoProdottoCategoriaInline
        );
        if (!p) return;
        this.ricettaDraft.ingredienti[index].prodottoId = p.id;
        this.ingredienteInCreazione = null;
      },

      // ---------- categorie bozza ----------
      toggleCategoriaRicettaDraft: function (catId) {
        var idx = this.ricettaDraft.categorieIds.indexOf(catId);
        if (idx !== -1) {
          this.ricettaDraft.categorieIds.splice(idx, 1);
        } else {
          this.ricettaDraft.categorieIds.push(catId);
        }
      },

      // ---------- salvataggio/validazione ----------
      validaRicettaDraft: function () {
        var d = this.ricettaDraft;
        if (!d.nome.replace(/^\s+|\s+$/g, "")) {
          return "Inserisci un nome per la ricetta.";
        }
        if (d.categorieIds.length === 0) {
          return "Seleziona almeno una categoria.";
        }
        if (d.ingredienti.length === 0) {
          return "Aggiungi almeno un ingrediente.";
        }
        var invalido = false;
        d.ingredienti.forEach(function (ing) {
          if (!ing.prodottoId || !ing.quantita || ing.quantita <= 0) {
            invalido = true;
          }
        });
        if (invalido) {
          return "Ogni ingrediente deve avere un prodotto e una quantità maggiore di zero.";
        }
        return "";
      },

      salvaRicetta: function () {
        var errore = this.validaRicettaDraft();
        if (errore) {
          this.ricettaDraftErrore = errore;
          return;
        }

        this.ricettaDraft.nome = this.ricettaDraft.nome.replace(
          /^\s+|\s+$/g,
          ""
        );

        if (this.ricettaDraftIsNew) {
          this.ricette.push(this.ricettaDraft);
        }

        if (this.pendingCellTarget) {
          this.assegnaRicettaACella(
            this.pendingCellTarget.data,
            this.pendingCellTarget.mealKey,
            this.ricettaDraft.id
          );
          this.pendingCellTarget = null;
        }

        this.showToast("Ricetta salvata: " + this.ricettaDraft.nome);
        this.showRecipeEditor = false;
        this.ricettaDraft = null;
      },

      // ---------- eliminazione ----------
      deleteRicetta: function (ricetta) {
        var ok = window.confirm(
          'Eliminare la ricetta "' +
            ricetta.nome +
            '"? Verrà rimossa anche da tutte le celle del piano alimentare in cui è usata.'
        );
        if (!ok) return;
        this.eliminaRicettaSilenziosa(ricetta);
        this.showToast("Ricetta eliminata");
      },

      // nessuna conferma: usata sia da deleteRicetta (dopo conferma) sia
      // a cascata da FeatureProdotti.deleteProdotto (confermata a monte)
      eliminaRicettaSilenziosa: function (ricetta) {
        var idx = this.ricette.indexOf(ricetta);
        if (idx !== -1) this.ricette.splice(idx, 1);

        var piano = this.piano;
        Object.keys(piano).forEach(function (dataKey) {
          DataModel.PASTI.forEach(function (pasto) {
            var arr = piano[dataKey][pasto.key];
            var pos = arr.indexOf(ricetta.id);
            if (pos !== -1) arr.splice(pos, 1);
          });
        });
      }
    }
  };
})();
