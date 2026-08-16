<?php
/**
 * api/sync.php
 *
 * Endpoint di sincronizzazione cloud dei dati di Shopping Kart. Gestisce
 * SOLO i dati dell'app (un blob JSON per utente): l'identita' e' sempre
 * verificata parlando con l'hub auth.example.invalid, mai fidandosi di un
 * uuid passato dal client.
 *
 * Ogni richiesta porta un bearer token (header Authorization) ottenuto
 * dal login su auth.example.invalid. Questo endpoint lo valida chiamando
 * https://auth.example.invalid/api/user lato server (mai il browser): niente
 * problemi di CORS, e l'identita' dell'utente non e' mai decisa dal
 * client, solo dall'hub.
 *
 * Richieste accettate: solo POST, corpo JSON.
 *   { "action": "pull" }
 *   { "action": "push", "data": {...}, "lastModified": 1234567890 }
 */

header('Content-Type: application/json; charset=utf-8');

function respond($statusCode, $payload) {
    http_response_code($statusCode);
    echo json_encode($payload);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond(405, array('success' => false, 'error' => 'Metodo non consentito'));
}

$maxBytes = 2 * 1024 * 1024; // 2 MB, ampiamente sufficiente per un backup di Shopping Kart

$rawBody = file_get_contents('php://input');
if ($rawBody === false || strlen($rawBody) === 0) {
    respond(400, array('success' => false, 'error' => 'Richiesta vuota'));
}
if (strlen($rawBody) > $maxBytes) {
    respond(413, array('success' => false, 'error' => 'Richiesta troppo grande'));
}

$input = json_decode($rawBody, true);
if (!is_array($input)) {
    respond(400, array('success' => false, 'error' => 'JSON non valido'));
}

$action = isset($input['action']) ? $input['action'] : '';
if ($action !== 'pull' && $action !== 'push') {
    respond(400, array('success' => false, 'error' => 'Azione non riconosciuta'));
}

// ---------- estrazione del bearer token ----------
// Su hosting condiviso con PHP via CGI/FastCGI l'header Authorization
// spesso non arriva in $_SERVER senza un aiuto in .htaccess (vedi
// api/.htaccess) - per questo si controllano piu' fonti possibili.
function estraiAuthorizationHeader() {
    if (function_exists('getallheaders')) {
        $headers = getallheaders();
        if ($headers !== false) {
            foreach ($headers as $name => $value) {
                if (strcasecmp($name, 'Authorization') === 0) {
                    return $value;
                }
            }
        }
    }
    if (!empty($_SERVER['HTTP_AUTHORIZATION'])) {
        return $_SERVER['HTTP_AUTHORIZATION'];
    }
    if (!empty($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
        return $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
    }
    return null;
}

$authHeader = estraiAuthorizationHeader();
if (!$authHeader || stripos($authHeader, 'Bearer ') !== 0) {
    respond(401, array('success' => false, 'error' => 'Token mancante'));
}
$token = trim(substr($authHeader, 7));
if ($token === '') {
    respond(401, array('success' => false, 'error' => 'Token mancante'));
}

// ---------- validazione del token contro l'hub auth.example.invalid ----------
// Chiamata server-to-server: mai eseguita dal browser, quindi nessun
// problema di CORS a prescindere dal dominio da cui gira Shopping Kart.
// Restituisce l'array utente {id, name, email} oppure null se il token
// non e' valido/scaduto o l'hub non risponde correttamente.
function validaTokenSuHub($token) {
    $url = 'https://auth.example.invalid/api/user';
    $headers = array(
        'Authorization: Bearer ' . $token,
        'Accept: application/json'
    );

    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 5);
        curl_setopt($ch, CURLOPT_TIMEOUT, 5);
        $body = curl_exec($ch);
        $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
    } else {
        $context = stream_context_create(array(
            'http' => array(
                'method' => 'GET',
                'header' => implode("\r\n", $headers),
                'timeout' => 5,
                'ignore_errors' => true
            )
        ));
        $body = @file_get_contents($url, false, $context);
        $status = 0;
        if (isset($http_response_header[0]) && preg_match('/\s(\d{3})\s/', $http_response_header[0], $m)) {
            $status = (int) $m[1];
        }
    }

    if ($body === false || $status !== 200) {
        return null;
    }

    $user = json_decode($body, true);
    if (!is_array($user) || empty($user['id']) || !preg_match('/^[0-9a-f-]{36}$/i', $user['id'])) {
        return null;
    }

    return array(
        'id' => $user['id'],
        'name' => isset($user['name']) ? $user['name'] : '',
        'email' => isset($user['email']) ? $user['email'] : ''
    );
}

$user = validaTokenSuHub($token);
if (!$user) {
    respond(401, array('success' => false, 'error' => 'Sessione non valida, accedi di nuovo'));
}

$dataDir = __DIR__ . '/data';
$filePath = $dataDir . '/' . $user['id'] . '.json';

if ($action === 'pull') {

    if (!file_exists($filePath)) {
        respond(200, array('success' => true, 'exists' => false, 'user' => $user));
    }

    $content = file_get_contents($filePath);
    $stored = json_decode($content, true);
    if (!is_array($stored)) {
        respond(500, array('success' => false, 'error' => 'Backup salvato non leggibile'));
    }

    respond(200, array(
        'success' => true,
        'exists' => true,
        'lastModified' => isset($stored['lastModified']) ? $stored['lastModified'] : null,
        'data' => isset($stored['data']) ? $stored['data'] : null,
        'user' => $user
    ));

} else { // push

    if (!isset($input['data']) || !is_array($input['data'])) {
        respond(400, array('success' => false, 'error' => 'Dati mancanti'));
    }

    $lastModified = isset($input['lastModified']) ? $input['lastModified'] : (int) round(microtime(true) * 1000);

    $toStore = array(
        'lastModified' => $lastModified,
        'data' => $input['data']
    );

    $json = json_encode($toStore);
    if ($json === false) {
        respond(400, array('success' => false, 'error' => 'Impossibile serializzare i dati'));
    }
    if (strlen($json) > $maxBytes) {
        respond(413, array('success' => false, 'error' => 'Backup troppo grande'));
    }

    if (!is_dir($dataDir)) {
        @mkdir($dataDir, 0755, true);
    }

    $written = @file_put_contents($filePath, $json, LOCK_EX);
    if ($written === false) {
        respond(500, array('success' => false, 'error' => 'Impossibile salvare sul server'));
    }

    respond(200, array('success' => true, 'lastModified' => $lastModified, 'user' => $user));
}
