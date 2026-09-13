/*
  Account e sincronizzazione cloud (vedi js/auth.js, js/sync.js). Login vero
  e proprio passa per un hub esterno il cui dominio e' un campo libero
  compilato dall'utente (fuori dal controllo di questa app) e la sync parla
  con api/sync.php (PHP, non disponibile nel server statico usato per i
  test): qui si stubano le risposte di rete con cy.intercept e si simula lo
  stato "loggato" seminando direttamente token/dominio in localStorage, cosi'
  si testa la logica di Shopping Kart (i 3 timestamp L/R/S dell'algoritmo di
  sync, i toast, il modale di conflitto) senza dipendere da servizi esterni
  reali.
*/

function mockSync(handlers) {
  return cy
    .intercept("POST", "**/api/sync.php", (req) => {
      const handler = handlers[req.body && req.body.action];
      if (handler) {
        req.reply(handler(req));
      } else {
        req.reply({ statusCode: 200, body: { success: true, exists: false } });
      }
    })
    .as("syncCall");
}

const utenteFinto = { name: "Mario Rossi", email: "mario@example.com" };
const datiServerVuoti = {
  lista: [],
  categorie: [],
  sortMode: "categoria",
  prodotti: [],
  ricette: [],
  categorieRicette: [],
  piano: {}
};

describe("Account e sincronizzazione cloud", () => {
  it("da sloggato, senza dominio configurato, il bottone di accesso è disabilitato e non parte alcuna sincronizzazione", () => {
    cy.intercept("POST", "**/api/sync.php").as("syncCall");
    cy.visitApp();
    cy.goToView("impostazioni");
    cy.contains("button", "Accedi").should("be.disabled");
    cy.get("@syncCall.all").should("have.length", 0);
  });

  it("compilare il campo dominio abilita il bottone di accesso e lo salva in localStorage", () => {
    cy.visitApp();
    cy.goToView("impostazioni");

    cy.get("#auth-hub-domain-input").type("esempio.it").blur();
    cy.contains("button", "Accedi").should("not.be.disabled");
    cy.window().then((win) => {
      expect(win.localStorage.getItem("shopping-kart-auth-hub-domain-v1")).to.equal("esempio.it");
    });
  });

  it("incollare un URL completo nel campo dominio salva solo l'host", () => {
    cy.visitApp();
    cy.goToView("impostazioni");

    cy.get("#auth-hub-domain-input").type("https://esempio.it/login").blur();
    cy.window().then((win) => {
      expect(win.localStorage.getItem("shopping-kart-auth-hub-domain-v1")).to.equal("esempio.it");
    });
  });

  it("da loggato, al primo caricamento adotta silenziosamente i dati del server se il dispositivo è vuoto", () => {
    mockSync({
      pull: () => ({
        statusCode: 200,
        body: {
          success: true,
          exists: true,
          lastModified: 1700000500000,
          data: {
            ...datiServerVuoti,
            lista: [
              {
                id: "item-server-1",
                nome: "Pane integrale",
                quantita: 1,
                unita: "kg",
                categoriaId: null,
                acquistato: false,
                dataAggiunta: "2026-01-01T00:00:00.000Z"
              }
            ]
          },
          user: utenteFinto
        }
      })
    });

    cy.visitApp({
      seed: {
        "shopping-kart-auth-token-v1": "fake-token",
        "shopping-kart-auth-hub-domain-v1": "esempio.it"
      }
    });
    cy.wait("@syncCall").its("request.body.authDomain").should("equal", "esempio.it");

    cy.goToView("impostazioni");
    cy.contains("Connesso come Mario Rossi").should("be.visible");
    cy.contains("mario@example.com").should("be.visible");
    cy.contains("Dominio di sincronizzazione:").should("contain.text", "esempio.it");

    cy.goToView("lista");
    cy.listRow("Pane integrale").should("exist");
  });

  it("'Sincronizza ora' quando i dati sono già allineati mostra solo un toast di conferma", () => {
    mockSync({
      pull: () => ({
        statusCode: 200,
        body: {
          success: true,
          exists: true,
          lastModified: 1700000500000,
          data: datiServerVuoti,
          user: utenteFinto
        }
      })
    });

    cy.visitApp({ seed: { "shopping-kart-auth-token-v1": "fake-token" } });
    cy.wait("@syncCall");

    cy.goToView("impostazioni");
    cy.contains("button", "Sincronizza ora").click();
    cy.wait("@syncCall");
    cy.contains(".toast-fixed", "Dati già sincronizzati").should("be.visible");
  });

  it("in caso di conflitto (modifiche indipendenti su entrambi i lati) permette di adottare la versione del server", () => {
    mockSync({
      pull: () => ({
        statusCode: 200,
        body: {
          success: true,
          exists: true,
          lastModified: 1700000900000,
          data: {
            ...datiServerVuoti,
            lista: [
              {
                id: "item-remote",
                nome: "Uova dal server",
                quantita: 6,
                unita: "",
                categoriaId: null,
                acquistato: false,
                dataAggiunta: "2026-01-01T00:00:00.000Z"
              }
            ]
          },
          user: utenteFinto
        }
      })
    });

    cy.seedStatoBase({ seed: { "shopping-kart-auth-token-v1": "fake-token" } });
    cy.wait("@syncCall");

    cy.get(".modal-title").should("contain.text", "Dati diversi tra dispositivo e server");
    cy.contains("button", "Usa i dati dal server").click();
    cy.contains(".toast-fixed", "Dati aggiornati dal server").should("be.visible");

    cy.goToView("lista");
    cy.listRow("Uova dal server").should("exist");
  });

  it("in caso di conflitto permette di mantenere la versione locale e la invia al server", () => {
    mockSync({
      pull: () => ({
        statusCode: 200,
        body: {
          success: true,
          exists: true,
          lastModified: 1700000900000,
          data: datiServerVuoti,
          user: utenteFinto
        }
      }),
      push: () => ({
        statusCode: 200,
        body: { success: true, lastModified: 1700001000000, user: utenteFinto }
      })
    });

    cy.seedStatoBase({ seed: { "shopping-kart-auth-token-v1": "fake-token" } });
    cy.wait("@syncCall");

    cy.contains("button", "Mantieni i dati di questo dispositivo").click();
    cy.wait("@syncCall");
    cy.contains(".toast-fixed", "Dati sincronizzati").should("be.visible");

    cy.goToView("ricette");
    cy.contains("li.list-group-item", "Pollo al forno").should("exist");
  });

  it("una sessione scaduta (401) cancella il token e lo comunica quando la sync è esplicita", () => {
    // NOTA: handleSyncError (js/sync.js) su 401 chiama Auth.logout() ma non
    // resetta vueApp.loggedIn (lo fa solo FeatureAccount.methods.logout,
    // usato dal bottone "Esci") - la sezione Account resta quindi sulla UI
    // "connesso" con authUser=null ("Connesso come …") finche' l'app non
    // viene ricaricata. Il test verifica il comportamento REALE (token
    // rimosso + toast), non quello che ci si aspetterebbe idealmente.
    let manuale = false;
    cy.intercept("POST", "**/api/sync.php", (req) => {
      if (req.body.action === "pull" && !manuale) {
        req.reply({
          statusCode: 200,
          body: {
            success: true,
            exists: true,
            lastModified: 1700000500000,
            data: datiServerVuoti,
            user: utenteFinto
          }
        });
      } else {
        req.reply({ statusCode: 401, body: { success: false, error: "unauthorized" } });
      }
    }).as("syncCall");

    cy.visitApp({ seed: { "shopping-kart-auth-token-v1": "fake-token" } });
    cy.wait("@syncCall");

    cy.goToView("impostazioni");
    cy.then(() => {
      manuale = true;
    });
    cy.contains("button", "Sincronizza ora").click();
    cy.wait("@syncCall");

    cy.contains(".toast-fixed", "Sessione scaduta: accedi di nuovo").should("be.visible");
    cy.window().then((win) => {
      expect(win.localStorage.getItem("shopping-kart-auth-token-v1")).to.be.null;
    });

    // il token e' sparito da storage: una ri-visita dell'app (equivalente
    // a un reload) mostra correttamente lo stato sloggato
    cy.visitApp();
    cy.goToView("impostazioni");
    cy.contains("button", "Accedi").should("be.visible");
  });

  it("'Esci' disconnette subito, senza bisogno di rete", () => {
    mockSync({
      pull: () => ({
        statusCode: 200,
        body: {
          success: true,
          exists: true,
          lastModified: 1700000500000,
          data: datiServerVuoti,
          user: utenteFinto
        }
      })
    });

    cy.visitApp({ seed: { "shopping-kart-auth-token-v1": "fake-token" } });
    cy.wait("@syncCall");
    cy.goToView("impostazioni");

    cy.contains("button", "Esci").click();
    cy.contains(".toast-fixed", "Disconnesso").should("be.visible");
    cy.contains("button", "Accedi").should("be.visible");
    cy.window().then((win) => {
      expect(win.localStorage.getItem("shopping-kart-auth-token-v1")).to.be.null;
    });
  });
});
