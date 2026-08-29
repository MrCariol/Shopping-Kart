// Service Worker: rende l'app usabile completamente offline (progressive
// enhancement, nessuna dipendenza per il funzionamento base — vedi README).
// Non supportato da Edge 14/EdgeHTML (Lumia 735): l'app continua a
// funzionare li' come prima, tramite il classico cache busting via query
// string gestito da index.html/.htaccess.
//
// Aggiornamenti: la CACHE_NAME cambia ad ogni release (stessa stringa
// "?v=" usata altrove nel progetto — vedi README, sezione aggiornamenti).
// skipWaiting()/clients.claim() fanno si' che il nuovo Service Worker
// prenda il controllo subito, senza aspettare la chiusura di tutte le
// schede; index.html ricarica la pagina una volta sola quando cio'
// avviene, cosi' l'utente vede la versione nuova senza dover fare nulla.

var CACHE_VERSION = '20260828c';
var CACHE_NAME = 'shopping-kart-' + CACHE_VERSION;

var ASSETS = [
  './',
  './index.html',
  './manifest.json?v=' + CACHE_VERSION,
  './browserconfig.xml?v=' + CACHE_VERSION,
  './css/bootstrap.min.css?v=' + CACHE_VERSION,
  './css/custom.css?v=' + CACHE_VERSION,
  './js/vue.min.js?v=' + CACHE_VERSION,
  './js/sortable.min.js?v=' + CACHE_VERSION,
  './js/icons.js?v=' + CACHE_VERSION,
  './js/data-model.js?v=' + CACHE_VERSION,
  './js/components.js?v=' + CACHE_VERSION,
  './js/feature-lista.js?v=' + CACHE_VERSION,
  './js/feature-categorie.js?v=' + CACHE_VERSION,
  './js/feature-prodotti.js?v=' + CACHE_VERSION,
  './js/feature-ricette.js?v=' + CACHE_VERSION,
  './js/feature-piano.js?v=' + CACHE_VERSION,
  './js/auth.js?v=' + CACHE_VERSION,
  './js/sync.js?v=' + CACHE_VERSION,
  './js/feature-account.js?v=' + CACHE_VERSION,
  './js/app.js?v=' + CACHE_VERSION,
  './icons/icon-192.png?v=' + CACHE_VERSION,
  './icons/icon-512.png?v=' + CACHE_VERSION,
  './icons/icon-512-maskable.png?v=' + CACHE_VERSION,
  './icons/icon-150.png?v=' + CACHE_VERSION
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) { return cache.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (key) { return key !== CACHE_NAME; })
            .map(function (key) { return caches.delete(key); })
        );
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;

  // Documento HTML: prova sempre la rete per primo (versione piu' fresca
  // possibile quando c'e' connessione), cade sulla cache se offline O se
  // il server risponde con un errore (es. 500): non va MAI messa in cache
  // una risposta non "ok", altrimenti un errore temporaneo del server
  // resterebbe incollato in cache anche dopo che il server e' tornato a
  // funzionare (successo gia' capitato: vedi commit che introduce questo
  // controllo).
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(function (response) {
          if (!response.ok) throw new Error('risposta non ok: ' + response.status);
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(request, copy); });
          return response;
        })
        .catch(function () {
          return caches.match(request).then(function (cached) {
            return cached || caches.match('./index.html');
          });
        })
    );
    return;
  }

  // Asset statici (gia' invalidati ad ogni release dal loro "?v=..."):
  // cache-first, con aggiornamento della cache quando serve andare in rete
  // - solo se la risposta e' "ok" (stesso motivo di sopra).
  event.respondWith(
    caches.match(request).then(function (cached) {
      if (cached) return cached;
      return fetch(request).then(function (response) {
        if (response.ok) {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(request, copy); });
        }
        return response;
      });
    })
  );
});
