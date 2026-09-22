/*
  Impegni da Google Calendar (vedi js/calendar.js, js/feature-calendario.js).
  Il download vero passa da api/calendar.php (PHP, non disponibile nel server
  statico usato per i test) e da un calendario Google reale: qui si stubano le
  risposte con cy.intercept, cosi' si testa quello che e' davvero di Shopping
  Kart (validazione dell'indirizzo, comparsa degli impegni nel Piano e in
  Oggi, copia di un impegno come nota del piano) senza dipendere da servizi
  esterni.

  Le date degli impegni finti sono calcolate a partire da "oggi": la vista
  Piano mostra la settimana corrente, quindi un ICS con date fisse renderebbe
  il test valido solo per una settimana.
*/

const URL_ICS =
  "https://calendar.google.com/calendar/ical/mario%40example.com/private-abc123/basic.ics";

function chiaveData(offsetGiorni) {
  const d = new Date();
  d.setDate(d.getDate() + (offsetGiorni || 0));
  const pad = (n) => (n < 10 ? "0" + n : String(n));
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

function eventoFinto(dataKey, titolo, oraInizio) {
  return {
    id: titolo + "-" + dataKey,
    titolo: titolo,
    dataKey: dataKey,
    tuttoIlGiorno: !oraInizio,
    oraInizio: oraInizio || "",
    oraFine: "",
    luogo: ""
  };
}

function mockCalendario(eventi) {
  return cy
    .intercept("POST", "**/api/calendar.php", {
      statusCode: 200,
      body: { success: true, aggiornatoIl: Date.now(), eventi: eventi }
    })
    .as("calendarCall");
}

describe("Impegni da Google Calendar", () => {
  it("senza calendario configurato non chiama il backend e il Piano resta come prima", () => {
    cy.intercept("POST", "**/api/calendar.php").as("calendarCall");
    cy.visitApp();
    cy.goToView("piano");

    cy.get(".piano-evento").should("not.exist");
    cy.get("@calendarCall.all").should("have.length", 0);
  });

  it("un indirizzo che non è l'iCal segreto di Google viene rifiutato e non salvato", () => {
    cy.visitApp();
    cy.goToView("impostazioni");

    cy.get("#calendar-url-input")
      .type("https://calendar.google.com/calendar/u/0/r")
      .blur();

    cy.contains("Indirizzo non valido").should("be.visible");
    cy.window().then((win) => {
      expect(win.localStorage.getItem("shopping-kart-calendar-url-v1")).to.equal(
        null
      );
    });
  });

  it("salvare l'indirizzo iCal scarica gli impegni della settimana mostrata", () => {
    mockCalendario([eventoFinto(chiaveData(0), "Dentista", "09:00")]);

    cy.visitApp();
    cy.goToView("impostazioni");
    cy.get("#calendar-url-input").type(URL_ICS).blur();

    cy.wait("@calendarCall").its("request.body.icsUrl").should("equal", URL_ICS);
    cy.window().then((win) => {
      expect(win.localStorage.getItem("shopping-kart-calendar-url-v1")).to.equal(
        URL_ICS
      );
    });
  });

  it("gli impegni compaiono nel giorno giusto del Piano e nella vista Oggi", () => {
    mockCalendario([
      eventoFinto(chiaveData(0), "Dentista", "09:00"),
      eventoFinto(chiaveData(1), "Ferie")
    ]);

    cy.visitApp({ seed: { "shopping-kart-calendar-url-v1": URL_ICS } });
    cy.goToView("piano");
    cy.wait("@calendarCall");

    cy.contains(".piano-evento", "09:00 Dentista").should("be.visible");
    cy.contains(".piano-evento", "Ferie").should("be.visible");

    cy.goToView("oggi");
    cy.contains(".piano-evento", "09:00 Dentista").should("be.visible");
  });

  it("copiare un impegno lo aggiunge come nota nel pasto scelto e lo salva", () => {
    mockCalendario([eventoFinto(chiaveData(0), "Dentista", "09:00")]);

    cy.visitApp({ seed: { "shopping-kart-calendar-url-v1": URL_ICS } });
    cy.goToView("piano");
    cy.wait("@calendarCall");

    cy.contains(".piano-evento", "09:00 Dentista")
      .find("button")
      .click();

    cy.contains(".modal-title", "Copia nel piano").should("be.visible");
    cy.contains(".modal-body button", "Pranzo").click();

    cy.get(".modal").should("not.exist");
    cy.window().then((win) => {
      const dati = JSON.parse(
        win.localStorage.getItem("shopping-kart-data-v2")
      );
      const giorno = dati.piano[chiaveData(0)];
      expect(giorno.pranzo).to.have.length(1);
      expect(giorno.pranzo[0].tipo).to.equal("nota");
      expect(giorno.pranzo[0].testo).to.equal("09:00 Dentista");
    });
  });

  it("se il backend risponde con un errore il Piano resta utilizzabile e l'errore è visibile", () => {
    cy.intercept("POST", "**/api/calendar.php", {
      statusCode: 502,
      body: { success: false, error: "Impossibile contattare Google Calendar" }
    }).as("calendarCall");

    cy.visitApp({ seed: { "shopping-kart-calendar-url-v1": URL_ICS } });
    cy.goToView("piano");
    cy.wait("@calendarCall");

    cy.contains("Impossibile contattare Google Calendar").should("be.visible");
    cy.get(".piano-evento").should("not.exist");
    // le celle pasto continuano a funzionare
    cy.contains("Colazione").should("be.visible");
  });
});
