/*
  Shopping Kart - autenticazione tramite un hub esterno, il cui dominio e'
  scelto liberamente dall'utente in Impostazioni (campo "Dominio di
  sincronizzazione", vedi js/feature-account.js e index.html) invece di
  essere fisso nel codice: chiunque ospiti un hub compatibile con questo
  stesso protocollo puo' usarlo, non solo un'istanza predefinita.

  Flusso (redirect-based, nessun popup, nessuna chiamata diretta di login):
  1. startLogin() manda il browser su <dominio>/login?client=...
  2. l'hub fa login (o SSO silenzioso se gia' loggato li') e redirige a
     questa stessa app con "#token=..." nel fragment dell'URL
  3. consumeCallbackToken(), chiamata al created() dell'app, legge il
     token dal fragment, lo salva e ripulisce subito l'URL (il token non
     deve restare in cronologia/referrer)

  La validita' del token non viene mai controllata qui: e' js/sync.js,
  parlando con il backend di Shopping Kart, a scoprire se e' scaduto
  (risposta 401) e in quel caso a richiamare logout(). Lo stesso dominio
  viene inoltrato dal backend (api/sync.php) per validare il token contro
  l'hub scelto, vedi commento li' per il compromesso di sicurezza che
  questo comporta.
*/

(function () {
  "use strict";

  var CLIENT_NAME = "shopping-kart";

  // accetta sia "dominio.tld" che un URL completo incollato per errore
  // ("https://dominio.tld/qualcosa"): tiene solo l'host, cosi' il resto
  // del codice puo' sempre assumere un dominio nudo
  function normalizeHubDomain(input) {
    var trimmed = (input || "").trim();
    if (!trimmed) return "";
    trimmed = trimmed.replace(/^https?:\/\//i, "");
    trimmed = trimmed.split("/")[0];
    return trimmed;
  }

  function getHubDomain() {
    return DataModel.loadAuthHubDomain();
  }

  function setHubDomain(domain) {
    DataModel.persistAuthHubDomain(normalizeHubDomain(domain));
  }

  function startLogin() {
    var domain = getHubDomain();
    if (!domain) return;
    window.location.href =
      "https://" + domain + "/login?client=" + encodeURIComponent(CLIENT_NAME);
  }

  function consumeCallbackToken() {
    var hash = window.location.hash || "";
    if (hash.indexOf("token=") === -1) return;

    // niente URLSearchParams (non su Edge 14/Lumia): match manuale, il
    // token e' l'unico valore che l'hub mette nel fragment
    var match = hash.match(/[#&]token=([^&]+)/);
    var token = match ? decodeURIComponent(match[1]) : null;
    if (token) {
      DataModel.persistAuthToken(token);
    }

    // ripulisce l'hash dall'URL senza ricaricare la pagina, cosi' il
    // token non resta visibile ne' in cronologia
    var cleanUrl =
      window.location.pathname + window.location.search;
    window.history.replaceState(null, "", cleanUrl);
  }

  function getToken() {
    return DataModel.loadAuthToken();
  }

  function isLoggedIn() {
    return !!getToken();
  }

  function logout() {
    DataModel.clearAuthToken();
  }

  window.Auth = {
    startLogin: startLogin,
    consumeCallbackToken: consumeCallbackToken,
    getToken: getToken,
    isLoggedIn: isLoggedIn,
    logout: logout,
    getHubDomain: getHubDomain,
    setHubDomain: setHubDomain
  };
})();
