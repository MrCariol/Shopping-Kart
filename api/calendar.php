<?php
/**
 * api/calendar.php
 *
 * Proxy di sola lettura verso l'URL segreto in formato iCal di un calendario
 * Google, usato dalla vista Piano/Oggi per mostrare gli impegni accanto ai
 * pasti pianificati (vedi js/calendar.js e js/feature-calendario.js).
 *
 * Perche' un proxy e non una fetch diretta dal browser: calendar.google.com
 * non manda header CORS, quindi l'ICS non e' leggibile da JavaScript. Il
 * download avviene qui lato server, che restituisce gli eventi gia'
 * normalizzati in JSON (niente parser ICS da far girare sul Lumia).
 *
 * Nessun token di accesso: questo endpoint non tocca i dati dell'utente, la
 * "chiave" e' l'URL segreto stesso (che il client conserva in localStorage e
 * invia ad ogni richiesta, come fa con authDomain in api/sync.php).
 *
 * Sicurezza (anti-SSRF): l'URL arriva dal client, quindi senza vincoli questo
 * file sarebbe un proxy aperto verso qualsiasi indirizzo raggiungibile
 * dall'hosting (inclusa la sua rete interna). Per questo si accetta SOLO
 * https://calendar.google.com/calendar/ical/<id>/<chiave>/basic.ics, e anche
 * gli eventuali redirect vengono rivalidati con lo stesso criterio.
 *
 * Richieste accettate: solo POST, corpo JSON.
 *   { "icsUrl": "https://calendar.google.com/calendar/ical/.../basic.ics",
 *     "from": "2026-09-21", "to": "2026-09-27", "tz": "Europe/Rome" }
 * Risposta:
 *   { "success": true, "aggiornatoIl": <epoch ms>, "eventi": [
 *       { "id", "titolo", "dataKey", "tuttoIlGiorno", "oraInizio", "oraFine", "luogo" } ] }
 *
 * Limiti noti del parser ICS (volutamente un sottoinsieme di RFC 5545, scritto
 * a mano per restare senza dipendenze):
 * - ricorrenze: FREQ DAILY/WEEKLY/MONTHLY/YEARLY con INTERVAL, COUNT, UNTIL,
 *   BYDAY (anche con prefisso ordinale nel caso MONTHLY, es. "3WE"),
 *   BYMONTHDAY singolo, piu' EXDATE e le singole occorrenze modificate o
 *   cancellate via RECURRENCE-ID;
 * - NON supportati: BYSETPOS, BYMONTH, BYWEEKNO, BYYEARDAY, liste multiple di
 *   BYMONTHDAY, WKST diverso da lunedi'. Le regole non supportate vengono
 *   ignorate (l'evento resta comunque visibile alle date generate dal resto
 *   della regola), mai interpretate a caso.
 */

header('Content-Type: application/json; charset=utf-8');

function respond($statusCode, $payload) {
    http_response_code($statusCode);
    echo json_encode($payload);
    exit;
}

// ---------- costanti di servizio ----------
$MAX_BODY_BYTES = 8 * 1024;          // la richiesta e' solo url + date
$MAX_ICS_BYTES = 2 * 1024 * 1024;    // calendario scaricato
$MAX_GIORNI_FINESTRA = 62;           // ~2 mesi per chiamata
$MAX_EVENTI_RISPOSTA = 500;
$CACHE_TTL_SECONDI = 600;            // 10 minuti
$MAX_REDIRECT = 3;
$MAX_OCCORRENZE_ITERAZIONI = 10000;  // paracadute sull'espansione ricorrenze
$TZ_FALLBACK = 'Europe/Rome';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond(405, array('success' => false, 'error' => 'Metodo non consentito'));
}

$rawBody = file_get_contents('php://input');
if ($rawBody === false || strlen($rawBody) === 0) {
    respond(400, array('success' => false, 'error' => 'Richiesta vuota'));
}
if (strlen($rawBody) > $MAX_BODY_BYTES) {
    respond(413, array('success' => false, 'error' => 'Richiesta troppo grande'));
}

$input = json_decode($rawBody, true);
if (!is_array($input)) {
    respond(400, array('success' => false, 'error' => 'JSON non valido'));
}

// ---------- validazione dell'URL del calendario (vedi nota anti-SSRF) ----------
function urlCalendarioConsentito($url) {
    $parti = parse_url($url);
    if (!is_array($parti)) {
        return false;
    }
    if (!isset($parti['scheme']) || strtolower($parti['scheme']) !== 'https') {
        return false;
    }
    if (!isset($parti['host']) || strtolower($parti['host']) !== 'calendar.google.com') {
        return false;
    }
    if (isset($parti['port']) && (int) $parti['port'] !== 443) {
        return false;
    }
    if (isset($parti['user']) || isset($parti['pass'])) {
        return false;
    }
    if (!isset($parti['path'])) {
        return false;
    }
    // .../calendar/ical/<id calendario>/<chiave segreta o "public">/basic.ics
    return preg_match('#^/calendar/ical/[^/]+/[^/]+/basic\.ics$#', $parti['path']) === 1;
}

$icsUrl = isset($input['icsUrl']) ? trim((string) $input['icsUrl']) : '';
if ($icsUrl === '' || !urlCalendarioConsentito($icsUrl)) {
    respond(400, array(
        'success' => false,
        'error' => 'Indirizzo iCal non valido: serve l\'indirizzo segreto in formato iCal di Google Calendar'
    ));
}

// ---------- validazione della finestra di date ----------
$from = isset($input['from']) ? trim((string) $input['from']) : '';
$to = isset($input['to']) ? trim((string) $input['to']) : '';
$patternData = '/^\d{4}-\d{2}-\d{2}$/';
if (!preg_match($patternData, $from) || !preg_match($patternData, $to)) {
    respond(400, array('success' => false, 'error' => 'Intervallo di date mancante o non valido'));
}

// ---------- fuso orario di destinazione ----------
// Il client manda il proprio (Intl, dove disponibile); l'ICS puo' dichiarare
// il suo con X-WR-TIMEZONE; in ultima istanza si usa il fallback.
function timezoneValida($nome) {
    if (!is_string($nome) || $nome === '') {
        return null;
    }
    try {
        return new DateTimeZone($nome);
    } catch (Exception $e) {
        return null;
    }
}

$tzRichiesta = timezoneValida(isset($input['tz']) ? trim((string) $input['tz']) : '');

// ---------- download dell'ICS (con cache su file) ----------
function scaricaUrl($url, $timeout) {
    $risultato = array('status' => 0, 'body' => '', 'location' => '');

    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, false); // i redirect li rivalidiamo a mano
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 5);
        curl_setopt($ch, CURLOPT_TIMEOUT, $timeout);
        curl_setopt($ch, CURLOPT_HTTPHEADER, array('Accept: text/calendar'));
        curl_setopt($ch, CURLOPT_HEADER, true);
        $raw = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $headerSize = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
        curl_close($ch);

        if ($raw === false) {
            return $risultato;
        }
        $headers = substr($raw, 0, $headerSize);
        $risultato['status'] = $status;
        $risultato['body'] = substr($raw, $headerSize);
        if (preg_match('/^Location:\s*(.+)$/mi', $headers, $m)) {
            $risultato['location'] = trim($m[1]);
        }
        return $risultato;
    }

    $context = stream_context_create(array(
        'http' => array(
            'method' => 'GET',
            'header' => "Accept: text/calendar\r\n",
            'timeout' => $timeout,
            'follow_location' => 0,
            'ignore_errors' => true
        )
    ));
    $body = @file_get_contents($url, false, $context);
    if ($body === false) {
        return $risultato;
    }
    $risultato['body'] = $body;
    if (isset($http_response_header) && is_array($http_response_header)) {
        foreach ($http_response_header as $riga) {
            if (preg_match('/^HTTP\/\S+\s+(\d{3})/', $riga, $m)) {
                $risultato['status'] = (int) $m[1];
            } elseif (stripos($riga, 'Location:') === 0) {
                $risultato['location'] = trim(substr($riga, 9));
            }
        }
    }
    return $risultato;
}

function percorsoCache($url) {
    return __DIR__ . '/data/cal-' . sha1($url) . '.ics';
}

// Restituisce array('ics' => string|null, 'aggiornatoIl' => epoch ms|null,
// 'errore' => string|null). In caso di errore di rete si ripiega sulla copia
// in cache, anche scaduta: meglio impegni vecchi di un'ora che nessun impegno.
function leggiIcs($url, $ttl, $maxBytes, $maxRedirect) {
    $cacheFile = percorsoCache($url);
    $cacheTs = @filemtime($cacheFile);

    if ($cacheTs !== false && (time() - $cacheTs) < $ttl) {
        $contenuto = @file_get_contents($cacheFile);
        if ($contenuto !== false && $contenuto !== '') {
            return array('ics' => $contenuto, 'aggiornatoIl' => $cacheTs * 1000, 'errore' => null);
        }
    }

    $urlCorrente = $url;
    $risposta = null;
    for ($i = 0; $i <= $maxRedirect; $i++) {
        $risposta = scaricaUrl($urlCorrente, 8);
        if ($risposta['status'] >= 300 && $risposta['status'] < 400 && $risposta['location'] !== '') {
            $prossimo = $risposta['location'];
            // stesso criterio dell'URL iniziale: un redirect non deve poter
            // portare il download su un host arbitrario (vedi nota anti-SSRF)
            if (!urlCalendarioConsentito($prossimo)) {
                $risposta = null;
                break;
            }
            $urlCorrente = $prossimo;
            continue;
        }
        break;
    }

    if ($risposta && $risposta['status'] === 200 && strlen($risposta['body']) > 0) {
        if (strlen($risposta['body']) > $maxBytes) {
            return array('ics' => null, 'aggiornatoIl' => null, 'errore' => 'Calendario troppo grande');
        }
        $dataDir = dirname($cacheFile);
        if (!is_dir($dataDir)) {
            @mkdir($dataDir, 0755, true);
        }
        @file_put_contents($cacheFile, $risposta['body'], LOCK_EX);
        return array('ics' => $risposta['body'], 'aggiornatoIl' => time() * 1000, 'errore' => null);
    }

    // rete KO o risposta inattesa: si riprova con la cache scaduta
    if ($cacheTs !== false) {
        $contenuto = @file_get_contents($cacheFile);
        if ($contenuto !== false && $contenuto !== '') {
            return array('ics' => $contenuto, 'aggiornatoIl' => $cacheTs * 1000, 'errore' => null);
        }
    }

    $status = $risposta ? $risposta['status'] : 0;
    if ($status === 404) {
        return array('ics' => null, 'aggiornatoIl' => null, 'errore' => 'Calendario non trovato: controlla l\'indirizzo iCal');
    }
    return array('ics' => null, 'aggiornatoIl' => null, 'errore' => 'Impossibile contattare Google Calendar');
}

// ---------- parsing ICS ----------
// "Unfolding" RFC 5545: una riga logica puo' essere spezzata su piu' righe
// fisiche, le continuazioni iniziano con uno spazio o una tabulazione.
function icsRighe($raw) {
    $raw = str_replace(array("\r\n", "\r"), "\n", $raw);
    $raw = preg_replace("/\n[ \t]/", '', $raw);
    return explode("\n", $raw);
}

// "NOME;PARAM=valore;PARAM2="con:due punti":VALORE" -> nome/parametri/valore.
// I due punti dentro un parametro tra virgolette non separano il valore.
function icsParseRiga($riga) {
    $inQuote = false;
    $posDuePunti = -1;
    $len = strlen($riga);
    for ($i = 0; $i < $len; $i++) {
        $c = $riga[$i];
        if ($c === '"') {
            $inQuote = !$inQuote;
        } elseif ($c === ':' && !$inQuote) {
            $posDuePunti = $i;
            break;
        }
    }
    if ($posDuePunti === -1) {
        return null;
    }

    $testa = substr($riga, 0, $posDuePunti);
    $valore = substr($riga, $posDuePunti + 1);

    $pezzi = array();
    $corrente = '';
    $inQuote = false;
    $len = strlen($testa);
    for ($i = 0; $i < $len; $i++) {
        $c = $testa[$i];
        if ($c === '"') {
            $inQuote = !$inQuote;
            continue;
        }
        if ($c === ';' && !$inQuote) {
            $pezzi[] = $corrente;
            $corrente = '';
            continue;
        }
        $corrente .= $c;
    }
    $pezzi[] = $corrente;

    $nome = strtoupper(array_shift($pezzi));
    $params = array();
    foreach ($pezzi as $p) {
        $eq = strpos($p, '=');
        if ($eq === false) {
            continue;
        }
        $params[strtoupper(substr($p, 0, $eq))] = substr($p, $eq + 1);
    }

    return array('nome' => $nome, 'params' => $params, 'valore' => $valore);
}

function icsUnescapeTesto($valore) {
    $valore = str_replace(array('\\n', '\\N'), "\n", $valore);
    $valore = str_replace(array('\\,', '\\;'), array(',', ';'), $valore);
    $valore = str_replace('\\\\', '\\', $valore);
    return trim($valore);
}

// Restituisce array('dt' => DateTime, 'allDay' => bool) oppure null.
// Le date "tutto il giorno" (VALUE=DATE) non hanno fuso: vengono costruite
// direttamente nel fuso di visualizzazione, cosi' restano sul giorno giusto.
function icsParseData($valore, $params, DateTimeZone $tzCal, DateTimeZone $tzOut) {
    $valore = trim($valore);
    $isDate = (isset($params['VALUE']) && strtoupper($params['VALUE']) === 'DATE')
        || preg_match('/^\d{8}$/', $valore);

    try {
        if ($isDate) {
            if (!preg_match('/^(\d{4})(\d{2})(\d{2})$/', $valore, $m)) {
                return null;
            }
            $dt = new DateTime($m[1] . '-' . $m[2] . '-' . $m[3] . ' 00:00:00', $tzOut);
            return array('dt' => $dt, 'allDay' => true);
        }

        if (!preg_match('/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/', $valore, $m)) {
            return null;
        }
        $testo = $m[1] . '-' . $m[2] . '-' . $m[3] . ' ' . $m[4] . ':' . $m[5] . ':' . $m[6];

        if (isset($m[7]) && $m[7] === 'Z') {
            $tz = new DateTimeZone('UTC');
        } elseif (isset($params['TZID'])) {
            $tzParam = timezoneValida($params['TZID']);
            $tz = $tzParam ? $tzParam : $tzCal;
        } else {
            // orario "fluttuante": si assume il fuso del calendario
            $tz = $tzCal;
        }

        return array('dt' => new DateTime($testo, $tz), 'allDay' => false);
    } catch (Exception $e) {
        return null;
    }
}

function icsParseRRule($valore) {
    $regola = array();
    foreach (explode(';', $valore) as $pezzo) {
        $eq = strpos($pezzo, '=');
        if ($eq === false) {
            continue;
        }
        $regola[strtoupper(substr($pezzo, 0, $eq))] = strtoupper(substr($pezzo, $eq + 1));
    }
    return $regola;
}

// chiave di confronto di una occorrenza (usata da EXDATE e RECURRENCE-ID):
// per gli eventi "tutto il giorno" conta solo la data, per gli altri
// l'istante assoluto
function chiaveOccorrenza(DateTime $dt, $allDay) {
    return $allDay ? $dt->format('Ymd') : (string) $dt->getTimestamp();
}

$GIORNI_ICS = array('MO' => 1, 'TU' => 2, 'WE' => 3, 'TH' => 4, 'FR' => 5, 'SA' => 6, 'SU' => 7);

// Espande un evento ricorrente nelle occorrenze che cadono nella finestra
// richiesta. Ritorna un array di DateTime (inizio di ogni occorrenza).
function espandiOccorrenze($regola, DateTime $inizio, DateTime $winStart, DateTime $winEnd, $durataSecondi, $maxIterazioni) {
    global $GIORNI_ICS;

    $freq = isset($regola['FREQ']) ? $regola['FREQ'] : '';
    if ($freq !== 'DAILY' && $freq !== 'WEEKLY' && $freq !== 'MONTHLY' && $freq !== 'YEARLY') {
        return array($inizio);
    }

    $interval = isset($regola['INTERVAL']) ? max(1, (int) $regola['INTERVAL']) : 1;
    $count = isset($regola['COUNT']) ? (int) $regola['COUNT'] : null;

    $until = null;
    if (isset($regola['UNTIL'])) {
        $parsata = icsParseData($regola['UNTIL'], array(), $inizio->getTimezone(), $inizio->getTimezone());
        if ($parsata) {
            $until = $parsata['dt'];
        }
    }

    // BYDAY: lista di giorni (WEEKLY) o di un giorno con eventuale ordinale
    // (MONTHLY, es. "3WE" = terzo mercoledi', "-1FR" = ultimo venerdi')
    $byDay = array();
    if (isset($regola['BYDAY']) && $regola['BYDAY'] !== '') {
        foreach (explode(',', $regola['BYDAY']) as $voce) {
            if (preg_match('/^(-?\d)?(MO|TU|WE|TH|FR|SA|SU)$/', trim($voce), $m)) {
                $byDay[] = array(
                    'ordinale' => ($m[1] === '' ? 0 : (int) $m[1]),
                    'giorno' => $m[2]
                );
            }
        }
    }
    $byMonthDay = null;
    if (isset($regola['BYMONTHDAY']) && preg_match('/^-?\d+$/', $regola['BYMONTHDAY'])) {
        $byMonthDay = (int) $regola['BYMONTHDAY'];
    }

    $occorrenze = array();
    $generate = 0;
    $iterazioni = 0;
    $tz = $inizio->getTimezone();
    $ora = $inizio->format('H:i:s');

    // cursore sul "periodo" (giorno/settimana/mese/anno), non sulla singola
    // occorrenza: per WEEKLY con piu' BYDAY un periodo ne produce diverse
    $cursore = clone $inizio;
    if ($freq === 'WEEKLY' && count($byDay) > 0) {
        // parte dal lunedi' della settimana di DTSTART
        $giornoSettimana = (int) $inizio->format('N');
        $cursore->modify('-' . ($giornoSettimana - 1) . ' days');
    }

    while ($iterazioni < $maxIterazioni) {
        $iterazioni++;

        $candidati = array();
        if ($freq === 'DAILY') {
            $candidati[] = clone $cursore;
        } elseif ($freq === 'WEEKLY') {
            if (count($byDay) === 0) {
                $candidati[] = clone $cursore;
            } else {
                foreach ($byDay as $bd) {
                    $giorno = clone $cursore;
                    $giorno->modify('+' . ($GIORNI_ICS[$bd['giorno']] - 1) . ' days');
                    $giorno = new DateTime($giorno->format('Y-m-d') . ' ' . $ora, $tz);
                    $candidati[] = $giorno;
                }
            }
        } elseif ($freq === 'MONTHLY') {
            $annoMese = $cursore->format('Y-m');
            if (count($byDay) > 0 && $byDay[0]['ordinale'] !== 0) {
                $bd = $byDay[0];
                $giorno = occorrenzaOrdinaleNelMese($annoMese, $bd['giorno'], $bd['ordinale'], $ora, $tz);
                if ($giorno) {
                    $candidati[] = $giorno;
                }
            } else {
                $numeroGiorno = $byMonthDay !== null ? $byMonthDay : (int) $inizio->format('j');
                $giorno = giornoDelMese($annoMese, $numeroGiorno, $ora, $tz);
                if ($giorno) {
                    $candidati[] = $giorno;
                }
            }
        } else { // YEARLY
            $giorno = giornoDelMese(
                $cursore->format('Y') . '-' . $inizio->format('m'),
                (int) $inizio->format('j'),
                $ora,
                $tz
            );
            if ($giorno) {
                $candidati[] = $giorno;
            }
        }

        $oltreFinestra = true;
        foreach ($candidati as $candidato) {
            if ($candidato->getTimestamp() < $inizio->getTimestamp()) {
                continue; // occorrenze "prima" di DTSTART (settimana iniziale)
            }
            if ($until && $candidato->getTimestamp() > $until->getTimestamp()) {
                continue;
            }
            if ($count !== null && $generate >= $count) {
                continue;
            }
            $generate++;

            $fine = $candidato->getTimestamp() + $durataSecondi;
            if ($fine >= $winStart->getTimestamp() && $candidato->getTimestamp() <= $winEnd->getTimestamp()) {
                $occorrenze[] = clone $candidato;
            }
            if ($candidato->getTimestamp() <= $winEnd->getTimestamp()) {
                $oltreFinestra = false;
            }
        }

        if ($count !== null && $generate >= $count) {
            break;
        }
        if ($oltreFinestra && count($candidati) > 0) {
            break; // tutti i candidati del periodo sono gia' oltre la finestra
        }
        if ($until && $cursore->getTimestamp() > $until->getTimestamp()) {
            break;
        }

        if ($freq === 'DAILY') {
            $cursore->modify('+' . $interval . ' days');
        } elseif ($freq === 'WEEKLY') {
            $cursore->modify('+' . ($interval * 7) . ' days');
        } elseif ($freq === 'MONTHLY') {
            // primo del mese come cursore: evita lo scivolamento di "+1 month"
            // partendo dal 31 (che in PHP diventerebbe il 3 marzo)
            $cursore = new DateTime($cursore->format('Y-m') . '-01 00:00:00', $tz);
            $cursore->modify('+' . $interval . ' months');
        } else {
            $cursore = new DateTime($cursore->format('Y') . '-01-01 00:00:00', $tz);
            $cursore->modify('+' . $interval . ' years');
        }
    }

    return $occorrenze;
}

// "2026-09" + giorno 31 -> null se quel mese non ha il 31 (l'occorrenza
// semplicemente non esiste, come prescrive RFC 5545); numeri negativi
// contano dalla fine del mese (-1 = ultimo giorno)
function giornoDelMese($annoMese, $numeroGiorno, $ora, DateTimeZone $tz) {
    $pezzi = explode('-', $annoMese);
    if (count($pezzi) !== 2) {
        return null;
    }
    $giorniNelMese = (int) date('t', mktime(0, 0, 0, (int) $pezzi[1], 1, (int) $pezzi[0]));
    if ($numeroGiorno < 0) {
        $numeroGiorno = $giorniNelMese + 1 + $numeroGiorno;
    }
    if ($numeroGiorno < 1 || $numeroGiorno > $giorniNelMese) {
        return null;
    }
    try {
        return new DateTime(
            $pezzi[0] . '-' . $pezzi[1] . '-' . str_pad((string) $numeroGiorno, 2, '0', STR_PAD_LEFT) . ' ' . $ora,
            $tz
        );
    } catch (Exception $e) {
        return null;
    }
}

// "3WE" nel mese indicato -> il terzo mercoledi'; ordinale negativo conta
// dalla fine ("-1FR" = ultimo venerdi')
function occorrenzaOrdinaleNelMese($annoMese, $giornoIcs, $ordinale, $ora, DateTimeZone $tz) {
    global $GIORNI_ICS;
    if (!isset($GIORNI_ICS[$giornoIcs])) {
        return null;
    }
    $pezzi = explode('-', $annoMese);
    if (count($pezzi) !== 2) {
        return null;
    }
    $giorniNelMese = (int) date('t', mktime(0, 0, 0, (int) $pezzi[1], 1, (int) $pezzi[0]));
    $target = $GIORNI_ICS[$giornoIcs];

    $trovati = array();
    for ($g = 1; $g <= $giorniNelMese; $g++) {
        $data = new DateTime(
            $pezzi[0] . '-' . $pezzi[1] . '-' . str_pad((string) $g, 2, '0', STR_PAD_LEFT) . ' ' . $ora,
            $tz
        );
        if ((int) $data->format('N') === $target) {
            $trovati[] = $data;
        }
    }
    if (count($trovati) === 0) {
        return null;
    }
    $indice = $ordinale > 0 ? $ordinale - 1 : count($trovati) + $ordinale;
    return isset($trovati[$indice]) ? $trovati[$indice] : null;
}

// ---------- estrazione degli eventi dall'ICS ----------
function estraiEventi($ics, DateTimeZone $tzOut, $tzOutEsplicita, $from, $to, $maxEventi, $maxIterazioni) {
    $righe = icsRighe($ics);

    // fuso del calendario: X-WR-TIMEZONE se presente, altrimenti quello di
    // visualizzazione. Se il client non ha saputo dire il proprio fuso
    // (Edge 14: niente Intl), quello dichiarato nell'ICS e' il candidato
    // migliore anche per la visualizzazione.
    $tzCal = $tzOut;
    foreach ($righe as $riga) {
        if (stripos($riga, 'X-WR-TIMEZONE:') === 0) {
            $tzDichiarata = timezoneValida(trim(substr($riga, 14)));
            if ($tzDichiarata) {
                $tzCal = $tzDichiarata;
                if (!$tzOutEsplicita) {
                    $tzOut = $tzDichiarata;
                }
            }
            break;
        }
    }

    $winStart = new DateTime($from . ' 00:00:00', $tzOut);
    $winEnd = new DateTime($to . ' 23:59:59', $tzOut);

    // primo giro: raccolta dei VEVENT grezzi
    $grezzi = array();
    $corrente = null;
    foreach ($righe as $riga) {
        if ($riga === '') {
            continue;
        }
        if (strtoupper(trim($riga)) === 'BEGIN:VEVENT') {
            $corrente = array('props' => array(), 'exdate' => array());
            continue;
        }
        if (strtoupper(trim($riga)) === 'END:VEVENT') {
            if ($corrente !== null) {
                $grezzi[] = $corrente;
            }
            $corrente = null;
            continue;
        }
        if ($corrente === null) {
            continue;
        }
        $prop = icsParseRiga($riga);
        if (!$prop) {
            continue;
        }
        if ($prop['nome'] === 'EXDATE') {
            $corrente['exdate'][] = $prop;
        } else {
            $corrente['props'][$prop['nome']] = $prop;
        }
    }

    // secondo giro: separazione tra eventi "madre" e singole occorrenze
    // modificate/cancellate (RECURRENCE-ID)
    $madri = array();
    $override = array(); // uid -> chiaveOccorrenza -> evento (o false se cancellata)
    foreach ($grezzi as $ev) {
        $uid = isset($ev['props']['UID']) ? $ev['props']['UID']['valore'] : '';
        if (!isset($ev['props']['DTSTART'])) {
            continue;
        }
        if (isset($ev['props']['RECURRENCE-ID'])) {
            $rid = icsParseData(
                $ev['props']['RECURRENCE-ID']['valore'],
                $ev['props']['RECURRENCE-ID']['params'],
                $tzCal,
                $tzOut
            );
            if (!$rid) {
                continue;
            }
            $chiave = chiaveOccorrenza($rid['dt'], $rid['allDay']);
            if (!isset($override[$uid])) {
                $override[$uid] = array();
            }
            $cancellata = isset($ev['props']['STATUS'])
                && strtoupper(trim($ev['props']['STATUS']['valore'])) === 'CANCELLED';
            $override[$uid][$chiave] = $cancellata ? false : $ev;
        } else {
            $madri[] = $ev;
        }
    }

    $eventi = array();

    foreach ($madri as $ev) {
        if (isset($ev['props']['STATUS'])
            && strtoupper(trim($ev['props']['STATUS']['valore'])) === 'CANCELLED') {
            continue;
        }

        $uid = isset($ev['props']['UID']) ? $ev['props']['UID']['valore'] : '';
        $inizioInfo = icsParseData(
            $ev['props']['DTSTART']['valore'],
            $ev['props']['DTSTART']['params'],
            $tzCal,
            $tzOut
        );
        if (!$inizioInfo) {
            continue;
        }
        $allDay = $inizioInfo['allDay'];
        $inizio = $inizioInfo['dt'];

        $durata = $allDay ? 86400 : 3600; // default RFC: 1 giorno / 1 ora
        if (isset($ev['props']['DTEND'])) {
            $fineInfo = icsParseData(
                $ev['props']['DTEND']['valore'],
                $ev['props']['DTEND']['params'],
                $tzCal,
                $tzOut
            );
            if ($fineInfo) {
                $delta = $fineInfo['dt']->getTimestamp() - $inizio->getTimestamp();
                if ($delta > 0) {
                    $durata = $delta;
                }
            }
        }

        // date escluse dalla ricorrenza
        $escluse = array();
        foreach ($ev['exdate'] as $prop) {
            foreach (explode(',', $prop['valore']) as $valore) {
                $ex = icsParseData($valore, $prop['params'], $tzCal, $tzOut);
                if ($ex) {
                    $escluse[chiaveOccorrenza($ex['dt'], $allDay)] = true;
                }
            }
        }

        if (isset($ev['props']['RRULE'])) {
            $occorrenze = espandiOccorrenze(
                icsParseRRule($ev['props']['RRULE']['valore']),
                $inizio,
                $winStart,
                $winEnd,
                $durata,
                $maxIterazioni
            );
        } else {
            $occorrenze = array($inizio);
        }

        foreach ($occorrenze as $occorrenza) {
            $chiave = chiaveOccorrenza($occorrenza, $allDay);
            if (isset($escluse[$chiave])) {
                continue;
            }

            $eventoOccorrenza = $ev;
            $inizioOcc = $occorrenza;
            $durataOcc = $durata;
            $allDayOcc = $allDay;

            if (isset($override[$uid]) && array_key_exists($chiave, $override[$uid])) {
                $sostituto = $override[$uid][$chiave];
                if ($sostituto === false) {
                    continue; // occorrenza cancellata
                }
                $eventoOccorrenza = $sostituto;
                $nuovoInizio = icsParseData(
                    $sostituto['props']['DTSTART']['valore'],
                    $sostituto['props']['DTSTART']['params'],
                    $tzCal,
                    $tzOut
                );
                if ($nuovoInizio) {
                    $inizioOcc = $nuovoInizio['dt'];
                    $allDayOcc = $nuovoInizio['allDay'];
                    if (isset($sostituto['props']['DTEND'])) {
                        $nuovaFine = icsParseData(
                            $sostituto['props']['DTEND']['valore'],
                            $sostituto['props']['DTEND']['params'],
                            $tzCal,
                            $tzOut
                        );
                        if ($nuovaFine) {
                            $delta = $nuovaFine['dt']->getTimestamp() - $inizioOcc->getTimestamp();
                            if ($delta > 0) {
                                $durataOcc = $delta;
                            }
                        }
                    }
                }
            }

            aggiungiRigheEvento(
                $eventi,
                $eventoOccorrenza,
                $inizioOcc,
                $durataOcc,
                $allDayOcc,
                $uid,
                $tzOut,
                $winStart,
                $winEnd
            );

            if (count($eventi) >= $maxEventi) {
                break 2;
            }
        }
    }

    // ordinamento: per giorno, prima gli eventi di tutto il giorno, poi per ora
    usort($eventi, function ($a, $b) {
        if ($a['dataKey'] !== $b['dataKey']) {
            return strcmp($a['dataKey'], $b['dataKey']);
        }
        if ($a['tuttoIlGiorno'] !== $b['tuttoIlGiorno']) {
            return $a['tuttoIlGiorno'] ? -1 : 1;
        }
        return strcmp($a['oraInizio'], $b['oraInizio']);
    });

    return $eventi;
}

// Una occorrenza puo' coprire piu' giorni: viene emessa una riga per ogni
// giorno coperto che cade dentro la finestra richiesta, cosi' il client deve
// solo raggruppare per "dataKey".
function aggiungiRigheEvento(&$eventi, $ev, DateTime $inizio, $durataSecondi, $allDay, $uid, DateTimeZone $tzOut, DateTime $winStart, DateTime $winEnd) {
    $titolo = isset($ev['props']['SUMMARY'])
        ? icsUnescapeTesto($ev['props']['SUMMARY']['valore'])
        : '(senza titolo)';
    if ($titolo === '') {
        $titolo = '(senza titolo)';
    }
    $luogo = isset($ev['props']['LOCATION'])
        ? icsUnescapeTesto($ev['props']['LOCATION']['valore'])
        : '';

    $inizioOut = clone $inizio;
    $inizioOut->setTimezone($tzOut);
    $fineOut = new DateTime('@' . ($inizio->getTimestamp() + $durataSecondi));
    $fineOut->setTimezone($tzOut);

    // per "tutto il giorno" DTEND e' esclusivo (RFC 5545): l'ultimo giorno
    // coperto e' quello prima della fine. Stesso ragionamento per un evento
    // con orario che finisce esattamente a mezzanotte.
    $ultimo = clone $fineOut;
    if ($allDay || $fineOut->format('H:i:s') === '00:00:00') {
        $ultimo->modify('-1 day');
    }
    if ($ultimo->format('Y-m-d') < $inizioOut->format('Y-m-d')) {
        $ultimo = clone $inizioOut;
    }

    $giorno = new DateTime($inizioOut->format('Y-m-d') . ' 00:00:00', $tzOut);
    $ultimoGiorno = new DateTime($ultimo->format('Y-m-d') . ' 00:00:00', $tzOut);
    $indiceGiorno = 0;

    while ($giorno->getTimestamp() <= $ultimoGiorno->getTimestamp() && $indiceGiorno < 366) {
        $dataKey = $giorno->format('Y-m-d');
        if ($dataKey >= $winStart->format('Y-m-d') && $dataKey <= $winEnd->format('Y-m-d')) {
            $primoGiorno = ($dataKey === $inizioOut->format('Y-m-d'));
            $ultimoGiornoEvento = ($dataKey === $ultimo->format('Y-m-d'));
            $eventi[] = array(
                'id' => $uid . '-' . $inizioOut->format('YmdHis') . '-' . $dataKey,
                'titolo' => $titolo,
                'dataKey' => $dataKey,
                'tuttoIlGiorno' => $allDay ? true : false,
                'oraInizio' => ($allDay || !$primoGiorno) ? '' : $inizioOut->format('H:i'),
                'oraFine' => ($allDay || !$ultimoGiornoEvento) ? '' : $fineOut->format('H:i'),
                'luogo' => $luogo
            );
        }
        $giorno->modify('+1 day');
        $indiceGiorno++;
    }
}

// ---------- esecuzione ----------
try {
    $inizioFinestra = new DateTime($from . ' 00:00:00', new DateTimeZone('UTC'));
    $fineFinestra = new DateTime($to . ' 00:00:00', new DateTimeZone('UTC'));
} catch (Exception $e) {
    respond(400, array('success' => false, 'error' => 'Intervallo di date non valido'));
}
if ($fineFinestra < $inizioFinestra) {
    respond(400, array('success' => false, 'error' => 'Intervallo di date non valido'));
}
$giorniFinestra = (int) floor(($fineFinestra->getTimestamp() - $inizioFinestra->getTimestamp()) / 86400) + 1;
if ($giorniFinestra > $MAX_GIORNI_FINESTRA) {
    respond(400, array('success' => false, 'error' => 'Intervallo di date troppo ampio'));
}

$risultatoIcs = leggiIcs($icsUrl, $CACHE_TTL_SECONDI, $MAX_ICS_BYTES, $MAX_REDIRECT);
if ($risultatoIcs['ics'] === null) {
    respond(502, array('success' => false, 'error' => $risultatoIcs['errore']));
}

// nessun fuso utilizzabile dal client: si parte dal fallback, ma se l'ICS ne
// dichiara uno (X-WR-TIMEZONE) vince quello, vedi estraiEventi
$tzOut = $tzRichiesta ? $tzRichiesta : new DateTimeZone($TZ_FALLBACK);

$eventi = estraiEventi(
    $risultatoIcs['ics'],
    $tzOut,
    $tzRichiesta ? true : false,
    $from,
    $to,
    $MAX_EVENTI_RISPOSTA,
    $MAX_OCCORRENZE_ITERAZIONI
);

respond(200, array(
    'success' => true,
    'aggiornatoIl' => $risultatoIcs['aggiornatoIl'],
    'eventi' => $eventi
));
