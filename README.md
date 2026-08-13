# Shopping Kart

Web app per lista della spesa **e piano alimentare settimanale**: nessuna build, nessun server necessario oltre a un hosting statico. Pensata per funzionare sia su un **Nokia Lumia 735** (Windows 10 Mobile, Edge 14 / EdgeHTML 14) sia su browser moderni (Android, iOS, desktop).

L'app è una Single Page Application (nessun reload di pagina tra una vista e l'altra), con navigazione a icone (senza etichette testuali) ancorata **fissa in fondo allo schermo** (più comoda da raggiungere col pollice su mobile) su 5 destinazioni principali: **Lista della spesa** (che include anche il catalogo prodotti, in un accordion in fondo alla pagina), **Piano alimentare** (settimanale, con ricette e generazione automatica della lista), **Oggi** (il piano del solo giorno corrente, a tutta larghezza), **Ricette** e **Impostazioni** (solo tema scuro + backup). Le due schermate di gestione categorie (corsie della lista/prodotti, e categorie ricetta) non sono nel menu principale: si aprono con un bottone dedicato rispettivamente dentro Lista e dentro Ricette, per non affollare la navigazione. Ogni vista ha un titolo `<h1>` (visivamente piccolo, stile `.h5`) per orientarsi facilmente ora che il menu non ha più etichette testuali.

## Come funziona

- Tutti i dati (lista, categorie, prodotti, ricette, piano alimentare) vivono in **localStorage** del browser. Non c'è nessun server/database.
- **Offline completo**: un Service Worker (`sw.js`) mette in cache l'intero app shell (HTML, CSS, JS, manifest, icone) al primo caricamento, cosi' l'app si apre e funziona anche a connessione assente, riavviata o riaperta dopo giorni. E' **progressive enhancement**: la registrazione (in fondo a `index.html`) e' dietro un `if ('serviceWorker' in navigator)`, quindi su Edge 14/EdgeHTML (Lumia 735, che non lo supporta) non succede nulla e l'app continua a funzionare come prima tramite il classico cache busting via query string.
- **Vue 2.7** viene caricato da `js/vue.min.js`, self-hosted (niente CDN, per non dipendere dalla connessione del Lumia). Stesso discorso per `js/sortable.min.js` ([SortableJS](https://github.com/SortableJS/Sortable), trascinamento ricette nel Piano, vedi sotto). Nessuna build step: i template sono scritti direttamente in `index.html` (approccio "Options API + template inline", compatibile con browser molto datati). Un'unica istanza Vue root gestisce tutte e tre le viste tramite uno stato `view`; la logica e' divisa in piu' file JS per concern (vedi struttura file sotto), assemblati a mano in `js/app.js` (nessun mixin Vue: ogni feature e' un plain object unito con un merge esplicito che segnala eventuali collisioni di nomi, per evitare gli override silenziosi dei mixin).
- **Bootstrap 4.6.2** (self-hosted, `css/bootstrap.min.css`) copre praticamente tutto lo stile dell'interfaccia, incluse le 3 colonne colorate Colazione/Pranzo/Cena del piano (classi `alert-warning`/`alert-success`/`alert-info` riusate cosi' come sono). Non è stata usata alcuna build/SCSS: essendo il file precompilato, non è possibile personalizzare la palette dei colori senza ricompilare — quindi l'app usa i colori "di serie" di Bootstrap. `css/custom.css` contiene le poche regole che Bootstrap 4 non offre (testo barrato, spaziatura sotto la lista, posizionamento del toast, dropdown dell'autocomplete, swatch colore delle categorie ricetta) — tutto il resto dell'interfaccia usa esclusivamente classi Bootstrap.
- **Tema scuro**: interruttore in Impostazioni, applica la classe `theme-dark` su `<html>`. Bootstrap 4.6 non ha un tema scuro nativo (arrivato solo in Bootstrap 5.3): è un blocco di override manuale in fondo a `css/custom.css`. La preferenza è salvata in una chiave localStorage dedicata (`shopping-kart-tema-v1`), separata dal blob dati v2 perché è una preferenza del dispositivo, non un dato da includere nel backup/export.
- **Catalogo prodotti nella vista Lista**: un accordion (fatto in casa con `v-if`, non `<details>` nativo — non supportato da EdgeHTML 14) in fondo alla vista Lista mostra i prodotti del catalogo non ancora presenti nella lista attiva (nome/unità/categoria editabili al click sul nome, elimina, bottone "+" per aggiungerli alla lista con un tap). Nessun form per crearne uno manualmente: il catalogo si popola da solo (creazione al volo dentro l'editor ricetta, o archiviazione automatica quando un articolo preso viene eliminato dalla lista) — la barra di aggiunta articolo, sempre visibile, basta per iniziare. Il campo `prodotti[].ultimoAcquisto` traccia l'ultimo acquisto (aggiornato alla stessa archiviazione, singola o in blocco con "Svuota presi").
- Niente jQuery/Popper: i componenti "dinamici" di Bootstrap (modali, dropdown autocomplete) sono realizzati con le sole classi CSS di Bootstrap, mostrate/nascoste da Vue (`v-if`), senza il plugin JS di Bootstrap — una dipendenza in meno da caricare sul Lumia.
- Il backup è **manuale**: dalla vista "Impostazioni" si può esportare un file `.json` (lista, categorie, prodotti, ricette, piano) e reimportarlo su un altro dispositivo/browser.
- Le icone sono **Material Design Icons** di [Pictogrammers](https://pictogrammers.com/library/mdi/) (licenza Apache-2.0), incollate come SVG inline in `js/icons.js` (component `mdi-icon`). Nessun font/CDN esterno da scaricare: sono poche decine di byte per icona, renderizzate con `currentColor` così ereditano il colore del testo circostante.
- **Ordinamento**: ricette, categorie ricetta e prodotti sono sempre mostrati in ordine alfabetico (computed dedicati tipo `ricetteOrdinate`/`categorieRicetteOrdinate`/`prodottiOrdinati` in ciascun `feature-*.js`), con la categoria ricetta "Altro" sempre in fondo. Le **categorie corsia** (`categorie`, condivise da lista e prodotti) sono l'unica eccezione: restano nell'ordine custom impostato con i pulsanti "sposta su/giù" nella vista Categorie, perché rappresentano un percorso fisico nel supermercato — alfabetizzarle lo romperebbe. Per lo stesso motivo le categorie ricetta hanno perso i pulsanti di riordino manuale: non avendo un ordine "fisico" di riferimento, l'alfabetico è sufficiente.
- **Unità di misura**: l'elenco (`kg`, `g`, `l`, `ml`, `conf`) non include più "pz" — un prodotto contato "a pezzi" ha semplicemente unità vuota (`""`). Nella vista Lista, quantità e unità stanno insieme in un unico badge (es. "2 kg") subito accanto al nome dell'articolo; sul lato destro della riga resta solo il bottone per toglierlo dalla lista. Nell'accordion Prodotti, che non ha quantità, l'unità compare invece direttamente dopo il nome (es. "Farina kg").
- **Cella pasto condivisa (`meal-cell`)**: il contenuto di una cella Colazione/Pranzo/Cena (badge ricette + bottone aggiungi) è un componente Vue a sé (`js/components.js`), riusato sia da `day-row` nella vista Piano (3 colonne strette per riga-giorno) sia dalla vista Oggi (3 sezioni impilate a piena larghezza) — stesso comportamento, solo il layout del genitore cambia.
- **Trascinamento ricette nel Piano**: si può spostare una ricetta pianificata trascinandola su un'altra cella (stesso giorno o giorno diverso), sia nella vista Piano sia in Oggi. Usa [SortableJS](https://github.com/SortableJS/Sortable) (self-hosted, `js/sortable.min.js`, licenza MIT, nessuna dipendenza), non l'API nativa HTML5 Drag and Drop (che su Chrome/Android non risponde al tocco) né un'implementazione a mano con i soli eventi DOM (provata in un primo momento: inaffidabile su device touch reali, perché il browser può decidere di far scorrere la pagina prima che il JS riesca a intervenire, in base al solo CSS `touch-action`). Un'istanza per cella pasto (`js/components.js`, componente `meal-cell`, hook `mounted`/`beforeDestroy`), tutte nello stesso `group` cosi si trascina anche tra celle/giorni diversi; su touch il trascinamento si attiva solo dopo una breve pressione (`delayOnTouchOnly`), cosi' un semplice scroll non parte per errore. In `onEnd` lo spostamento fatto da Sortable nel DOM viene subito annullato (torna a Vue decidere il DOM finale in base ai dati) e i dati (`piano`) vengono aggiornati tramite `spostaRicettaPianoTraCelle` (`js/feature-piano.js`). Attivo se `window.Sortable` è caricato; altrimenti (caricamento fallito, o motore troppo vecchio: l'istanziazione è avvolta in un try/catch) resta disattivato di default, il resto della cella funziona comunque.
- **Duplica ricetta**: bottone dedicato su ogni ricetta già pianificata (icona "copia", riusata da quella di copia-giorno) che clona la ricetta (nuovo id, nome con suffisso "(copia)", stessi ingredienti/categorie) e la aggiunge subito nella stessa cella, senza chiedere altro.

## Aggiornare l'app senza che il telefono tenga in cache la vecchia versione

I browser mobile (Edge sul Lumia compreso) tengono la cache molto a lungo. Il metodo usato qui è il classico **cache busting via query string di versione**, rinforzato dal Service Worker sui browser che lo supportano:

1. Ogni file locale (`css/bootstrap.min.css`, `css/custom.css`, `js/vue.min.js`, tutti i `js/*.js` dell'app, `manifest.json`, le icone) viene richiamato con `?v=20260813c` in fondo all'URL, sia in `index.html` sia dentro `manifest.json`/`browserconfig.xml`.
2. **Prima di ogni pubblicazione**: cerca `20260813c` in tutti i file del progetto — **incluso `sw.js`** (costante `CACHE_VERSION` in cima al file) — e sostituiscilo ovunque con un nuovo valore (es. la data del giorno + una lettera, `20260901a`). Cambiando l'URL, il telefono è costretto a scaricare una copia nuova del file anche se il nome resta identico; cambiando `CACHE_VERSION`, il Service Worker apre una cache nuova, scarica l'app shell aggiornata e butta via quella vecchia.
3. Il file `index.html` stesso ha in testa dei meta tag `Cache-Control`/`Pragma`/`Expires` per scoraggiare la cache del documento HTML, e `.htaccess` imposta le stesse regole a livello di header HTTP vero e proprio (il meccanismo che conta davvero): HTML/manifest/config/`sw.js` **mai in cache**, mentre CSS/JS/PNG possono restare in cache a lungo proprio perché la versione cambia nell'URL quando serve.
4. Sui browser con Service Worker: `sw.js` non viene mai servito dalla cache (vedi punto 3), quindi ogni apertura/ripresa dell'app lo ricontrolla (`registration.update()` su `visibilitychange`/`focus`, oltre al controllo automatico del browser). Appena una versione nuova ha finito di scaricare l'app shell, prende subito il controllo (`skipWaiting` + `clients.claim` in `sw.js`) e `index.html` ricarica la pagina una volta sola: l'utente vede la versione nuova senza dover fare nulla, senza restare bloccato su una versione vecchia in cache.

Con un editor di testo, un "cerca e sostituisci" di `20260813c` su tutto il progetto (compreso `sw.js`) prima di ogni caricamento su Altervista è sufficiente.

## Deploy

Basta caricare l'intera cartella `shopping-kart/` così com'è su hosting statico (es. Altervista), mantenendo la struttura:

```
shopping-kart/
├── index.html
├── manifest.json
├── browserconfig.xml
├── sw.js
├── .htaccess
├── README.md
├── css/
│   ├── bootstrap.min.css
│   └── custom.css
├── js/
│   ├── vue.min.js
│   ├── sortable.min.js   (SortableJS, trascinamento ricette nel Piano)
│   ├── icons.js          (MDI_PATHS + componente mdi-icon)
│   ├── data-model.js      (storage v2, migrazione, utility date/uid)
│   ├── components.js      (autocomplete-input, item-row, prodotto-row, meal-cell, day-row)
│   ├── feature-lista.js   (vista Lista della spesa)
│   ├── feature-categorie.js (categorie corsie + categorie ricetta)
│   ├── feature-prodotti.js  (catalogo prodotti)
│   ├── feature-ricette.js   (editor ricetta, catalogo ricette)
│   ├── feature-piano.js     (piano alimentare, copia/incolla, genera lista)
│   └── app.js             (assemblaggio SPA, root Vue, persistenza, backup)
└── icons/
    ├── icon-150.png
    ├── icon-192.png
    ├── icon-512.png
    └── icon-512-maskable.png
```

Tutti i percorsi (CSS, JS, manifest, icone) sono **relativi**, quindi funzionano indipendentemente dal fatto che l'app sia servita da `https://ciccioneissima.altervista.org/shopping-kart/` o da un altro dominio/percorso in futuro.

## Vincoli di compatibilità con Edge 14 (Lumia 735) rispettati nel codice

- **Niente Service Worker come dipendenza** per il funzionamento base (non supportato da Edge 14): `sw.js` è registrato solo come progressive enhancement, dietro feature detection — la sua assenza/mancato supporto non rompe nulla.
- **Bootstrap 4.6**, non 5: Bootstrap 5 ha abbandonato il supporto a Internet Explorer/EdgeHTML e usa `.form-check`/`.form-select` con presupposti moderni; Bootstrap 4 è testato esplicitamente su Edge legacy e non richiede CSS Custom Properties, usate invece pesantemente da Bootstrap 5.
- **Niente CSS Grid**, non supportato prima di EdgeHTML 16 — Bootstrap 4 usa Flexbox per il suo sistema a colonne, quindi va bene così com'è.
- **Font di sistema** (quello di default di Bootstrap 4, una pila `-apple-system`/`Segoe UI`/`Roboto`), nessun webfont scaricato da Google Fonts o simili.
- **Vue 2** (non Vue 3, che richiede `Proxy`, assente in EdgeHTML 14).
- JavaScript scritto evitando sintassi troppo recente: niente spread operator, niente optional chaining/nullish coalescing.

## Modello dati (in localStorage, chiave `shopping-kart-data-v2`)

```json
{
  "lista": [
    {
      "id": "item-xxxxx",
      "nome": "Latte",
      "quantita": 2,
      "unita": "l",
      "categoriaId": null,
      "acquistato": false,
      "dataAggiunta": "2026-07-28T10:00:00.000Z"
    }
  ],
  "categorie": [
    { "id": "cat-01", "nome": "Frutta e verdura" }
  ],
  "sortMode": "categoria",
  "prodotti": [
    { "id": "prod-xxxxx", "nome": "Petto di pollo", "unita": "kg", "categoriaId": "cat-04", "ultimoAcquisto": null }
  ],
  "categorieRicette": [
    { "id": "catr-01", "nome": "Proteine", "colore": "#28a745" }
  ],
  "ricette": [
    {
      "id": "ric-xxxxx",
      "nome": "Pollo al forno",
      "categorieIds": ["catr-01"],
      "ingredienti": [{ "prodottoId": "prod-xxxxx", "quantita": 0.5 }]
    }
  ],
  "piano": {
    "2026-08-10": { "colazione": [], "pranzo": ["ric-xxxxx"], "cena": [] }
  }
}
```

- `categoriaId: null` (su `lista` e `prodotti`) significa "Senza categoria" (categoria speciale, fissa, sempre mostrata per prima e non modificabile/eliminabile). Le categorie `categorie` sono **condivise** tra gli articoli della lista della spesa e il catalogo prodotti: rappresentano le corsie del supermercato.
- `categorieRicette` sono invece tag nutrizionali colorati (default: Proteine/Carboidrati/Fibre/Altro), indipendenti dalle categorie corsia, usati per classificare le `ricette`.
- `piano` è una mappa sparsa per data ISO locale (`YYYY-MM-DD`, calcolata da componenti locali del `Date`, mai da `toISOString()` per evitare shift di fuso orario vicino alla mezzanotte): compaiono solo i giorni con almeno un pasto pianificato.
- **Migrazione automatica**: al primo caricamento dopo l'aggiornamento, se esiste ancora la vecchia chiave `shopping-kart-data-v1` (solo `lista`/`categorie`/`sortMode`) e non esiste `shopping-kart-data-v2`, i dati vengono importati automaticamente e salvati nel nuovo formato. La chiave v1 non viene mai cancellata (resta come rete di sicurezza).
- `prodotti[].ultimoAcquisto` (ISO date o `null`) non è pensato per essere modificato a mano: viene aggiornato automaticamente quando un articolo preso viene eliminato dalla lista della spesa (singolarmente o con "Svuota presi"), ed è quello che alimenta l'accordion "storico" in fondo alla vista Lista.
- La preferenza del tema (chiaro/scuro) **non** vive in questo blob: è nella chiave separata `shopping-kart-tema-v1` (`"dark"` o `"light"`), volutamente fuori dal backup/export perché è una preferenza del dispositivo, non un dato dell'utente.

## Roadmap (non ancora implementato)

- Statistiche sugli acquisti (rimandate a una seconda fase, come deciso).
- Più liste della spesa contemporanee (per ora una sola lista attiva).
