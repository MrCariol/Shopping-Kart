/*
  Shopping Kart - autenticazione tramite l'hub centralizzato auth.example.invalid

  Flusso (redirect-based, nessun popup, nessuna chiamata diretta di login):
  1. startLogin() manda il browser su auth.example.invalid/login?client=...
  2. l'hub fa login (o SSO silenzioso se gia' loggato li') e redirige a
     questa stessa app con "#token=..." nel fragment dell'URL
  3. consumeCallbackToken(), chiamata al created() dell'app, legge il
     token dal fragment, lo salva e ripulisce subito l'URL (il token non
     deve restare in cronologia/referrer)

  La validita' del token non viene mai controllata qui: e' js/sync.js,
  parlando con il backend di Shopping Kart, a scoprire se e' scaduto
  (risposta 401) e in quel caso a richiamare logout().
*/

(function () {
  "use strict";

  var AUTH_HUB_URL = "https://auth.example.invalid";
  var CLIENT_NAME = "shopping-kart";

  function startLogin() {
    window.location.href =
      AUTH_HUB_URL + "/login?client=" + encodeURIComponent(CLIENT_NAME);
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
    logout: logout
  };
})();
