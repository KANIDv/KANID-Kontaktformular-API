<?php
declare(strict_types=1);

$config = require dirname(__DIR__) . '/config.php';

function ladeGeheimnisse(): array
{
    $kandidaten = [
        dirname(__DIR__) . '/config.secret.php',
        dirname($_SERVER['DOCUMENT_ROOT'] ?? dirname(__DIR__)) . '/kanid-formular.secret.php',
    ];
    foreach ($kandidaten as $pfad) {
        if (is_readable($pfad)) {
            $daten = require $pfad;
            return is_array($daten) ? $daten : [];
        }
    }
    return [];
}

function originAusRequest(): string
{
    return trim((string) ($_SERVER['HTTP_ORIGIN'] ?? ''));
}

function originErlaubt(array $config): bool
{
    $origin = originAusRequest();
    if ($origin === '') {
        return true;
    }

    $erlaubt = $config['erlaubte_origins'] ?? [];
    if (in_array($origin, $erlaubt, true)) {
        return true;
    }

    $teile = parse_url($origin);
    $host = is_array($teile) ? (string) ($teile['host'] ?? '') : '';
    $scheme = is_array($teile) ? (string) ($teile['scheme'] ?? '') : '';
    if ($scheme !== 'https' || $host === '') {
        return false;
    }

    foreach ($config['erlaubte_origin_suffixe'] ?? [] as $suffix) {
        if ($suffix !== '' && str_ends_with($host, $suffix)) {
            return true;
        }
    }

    return false;
}

function corsHeaderSetzen(array $config): void
{
    $origin = originAusRequest();
    if ($origin !== '' && originErlaubt($config)) {
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Vary: Origin');
        header('Access-Control-Allow-Methods: POST, OPTIONS');
        header('Access-Control-Allow-Headers: Accept, Content-Type');
        header('Access-Control-Max-Age: 600');
    }
}

function willJson(): bool
{
    $accept = $_SERVER['HTTP_ACCEPT'] ?? '';
    return str_contains($accept, 'application/json');
}

function pfadIstEnglisch(string $url): bool
{
    $teile = parse_url($url);
    if (!is_array($teile)) {
        return false;
    }
    $pfad = (string) ($teile['path'] ?? '');
    return $pfad === '/en' || str_starts_with($pfad, '/en/');
}

// Feld lang gewinnt. Sonst Referer, dann Origin, sonst de.
function spracheBestimmen(): string
{
    $roh = strtolower(feld('lang', 12));
    if ($roh === 'de' || $roh === 'en') {
        return $roh;
    }
    if (pfadIstEnglisch((string) ($_SERVER['HTTP_REFERER'] ?? ''))) {
        return 'en';
    }
    if (pfadIstEnglisch(originAusRequest())) {
        return 'en';
    }
    return 'de';
}

function kontaktText(string $lang, string $key): string
{
    $de = [
        'method' => 'Nur POST ist erlaubt.',
        'origin' => 'Ungültige Herkunft.',
        'rate' => 'Zu viele Nachrichten. Bitte in ein paar Minuten erneut versuchen.',
        'pflicht' => 'Bitte füllen Sie alle Pflichtfelder aus.',
        'email' => 'Bitte geben Sie eine gültige E-Mail-Adresse ein.',
        'mail' => 'Die Nachricht konnte nicht versendet werden. Bitte schreiben Sie direkt an info@kanid.de.',
        'betreff' => 'Ihre Anfrage an KANID',
        'fallback' => 'Die Nachricht konnte nicht gesendet werden.',
    ];
    $en = [
        'method' => 'Only POST is allowed.',
        'origin' => 'Invalid origin.',
        'rate' => 'Too many messages. Please try again in a few minutes.',
        'pflicht' => 'Please fill in all required fields.',
        'email' => 'Please enter a valid email address.',
        'mail' => 'The message could not be sent. Please write directly to info@kanid.de.',
        'betreff' => 'Your inquiry to KANID',
        'fallback' => 'The message could not be sent.',
    ];
    $map = $lang === 'en' ? $en : $de;
    return $map[$key];
}

// Nur https auf kanid.de / www.kanid.de. Sonst leer — kein offener Redirect.
function dankeUrlErlaubt(string $wert): string
{
    $wert = trim($wert);
    if ($wert === '' || strlen($wert) > 500) {
        return '';
    }
    if (preg_match('/[\x00-\x20\\\\]/', $wert)) {
        return '';
    }
    $teile = parse_url($wert);
    if (!is_array($teile)) {
        return '';
    }
    $scheme = strtolower((string) ($teile['scheme'] ?? ''));
    $host = strtolower((string) ($teile['host'] ?? ''));
    if ($scheme !== 'https' || ($host !== 'kanid.de' && $host !== 'www.kanid.de')) {
        return '';
    }
    if (isset($teile['user']) || isset($teile['pass'])) {
        return '';
    }
    if (isset($teile['port']) && (int) $teile['port'] !== 443) {
        return '';
    }
    $pfad = (string) ($teile['path'] ?? '/');
    if ($pfad === '' || $pfad[0] !== '/') {
        return '';
    }
    $ziel = 'https://' . $host . $pfad;
    if (isset($teile['query']) && $teile['query'] !== '') {
        $ziel .= '?' . $teile['query'];
    }
    if (isset($teile['fragment']) && $teile['fragment'] !== '') {
        $ziel .= '#' . $teile['fragment'];
    }
    return $ziel;
}

function dankeZiel(array $config, string $lang): string
{
    $ausFeld = dankeUrlErlaubt(feld('danke_url', 500));
    if ($ausFeld !== '') {
        return $ausFeld;
    }
    if ($lang === 'en') {
        return 'https://kanid.de/en/thank-you/';
    }
    return (string) $config['danke_url'];
}

function antwort(array $config, int $status, array $payload): never
{
    $lang = spracheBestimmen();
    corsHeaderSetzen($config);
    http_response_code($status);
    header('Cache-Control: no-store');
    header('X-Robots-Tag: noindex, nofollow');

    if (willJson()) {
        header('Content-Type: application/json; charset=UTF-8');
        echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }

    header('Content-Type: text/html; charset=UTF-8');
    if (!empty($payload['ok'])) {
        header('Location: ' . dankeZiel($config, $lang), true, 303);
        exit;
    }

    $fallback = kontaktText($lang, 'fallback');
    $text = htmlspecialchars((string) ($payload['meldung'] ?? $fallback), ENT_QUOTES, 'UTF-8');
    $basis = (string) ($config['erlaubte_origins'][0] ?? 'https://kanid.de');
    if ($lang === 'en') {
        $zurueck = htmlspecialchars($basis . '/en/contact/', ENT_QUOTES, 'UTF-8');
        echo '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Error</title></head><body>';
        echo '<p>' . $text . '</p><p><a href="' . $zurueck . '">Back to the form</a></p></body></html>';
        exit;
    }

    $zurueck = htmlspecialchars($basis . '/#kontakt', ENT_QUOTES, 'UTF-8');
    echo '<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><title>Fehler</title></head><body>';
    echo '<p>' . $text . '</p><p><a href="' . $zurueck . '">Zurück zum Formular</a></p></body></html>';
    exit;
}

function feld(string $name, int $max): string
{
    $wert = $_POST[$name] ?? '';
    if (!is_string($wert)) {
        return '';
    }
    $wert = trim(str_replace(["\r", "\n", "\0"], ' ', $wert));
    if (function_exists('mb_substr')) {
        return mb_substr($wert, 0, $max, 'UTF-8');
    }
    return substr($wert, 0, $max);
}

function nachrichtFeld(int $max): string
{
    $wert = $_POST['message'] ?? '';
    if (!is_string($wert)) {
        return '';
    }
    $wert = str_replace("\0", '', $wert);
    $wert = str_replace(["\r\n", "\r"], "\n", $wert);
    $wert = trim($wert);
    if (function_exists('mb_substr')) {
        return mb_substr($wert, 0, $max, 'UTF-8');
    }
    return substr($wert, 0, $max);
}

function kopfzeile(string $text): string
{
    return '=?UTF-8?B?' . base64_encode($text) . '?=';
}

function clientIp(): string
{
    $ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
    return filter_var($ip, FILTER_VALIDATE_IP) ? $ip : '0.0.0.0';
}

function rateLimitUeberschritten(array $config): bool
{
    $max = (int) $config['max_anfragen'];
    $fenster = (int) $config['fenster_sekunden'];
    $datei = sys_get_temp_dir() . '/kanid-kontakt-' . hash('sha256', clientIp());
    $jetzt = time();
    $zeiten = [];

    if (is_readable($datei)) {
        $roh = file_get_contents($datei);
        $gelesen = is_string($roh) ? json_decode($roh, true) : [];
        if (is_array($gelesen)) {
            foreach ($gelesen as $zeitpunkt) {
                if (is_int($zeitpunkt) && $zeitpunkt > $jetzt - $fenster) {
                    $zeiten[] = $zeitpunkt;
                }
            }
        }
    }

    if (count($zeiten) >= $max) {
        return true;
    }

    $zeiten[] = $jetzt;
    @file_put_contents($datei, json_encode($zeiten), LOCK_EX);
    return false;
}

function sendeMail(
    string $an,
    string $betreff,
    string $koerper,
    array $headers,
    string $absender,
    array $geheim
): bool {
    if (!empty($geheim['smtp_host']) && !empty($geheim['smtp_user']) && !empty($geheim['smtp_pass'])) {
        return sendeSmtp($an, $betreff, $koerper, $headers, $geheim);
    }

    $kopf = implode("\r\n", $headers);
    $encoded = kopfzeile($betreff);
    $ok = @mail($an, $encoded, $koerper, $kopf, '-f' . $absender);
    if ($ok) {
        return true;
    }
    return (bool) @mail($an, $encoded, $koerper, $kopf);
}

function sendeSmtp(string $an, string $betreff, string $koerper, array $headers, array $geheim): bool
{
    $host = (string) $geheim['smtp_host'];
    $port = (int) ($geheim['smtp_port'] ?? 587);
    $user = (string) $geheim['smtp_user'];
    $pass = (string) $geheim['smtp_pass'];
    $timeout = 20;

    $remote = ($port === 465 ? 'ssl://' : 'tcp://') . $host . ':' . $port;
    $fp = @stream_socket_client($remote, $errno, $errstr, $timeout, STREAM_CLIENT_CONNECT);
    if (!$fp) {
        return false;
    }
    stream_set_timeout($fp, $timeout);

    $lesen = static function () use ($fp): string {
        $zeilen = '';
        while (($zeile = fgets($fp, 515)) !== false) {
            $zeilen .= $zeile;
            if (isset($zeile[3]) && $zeile[3] === ' ') {
                break;
            }
        }
        return $zeilen;
    };
    $befehl = static function (string $cmd) use ($fp, $lesen): string {
        fwrite($fp, $cmd . "\r\n");
        return $lesen();
    };

    $begruessung = $lesen();
    if (!str_starts_with($begruessung, '220')) {
        fclose($fp);
        return false;
    }

    $ehlo = $befehl('EHLO kanid.de');
    if ($port !== 465 && (str_contains($ehlo, 'STARTTLS') || str_contains($ehlo, 'starttls'))) {
        $tls = $befehl('STARTTLS');
        if (!str_starts_with($tls, '220')) {
            fclose($fp);
            return false;
        }
        if (!@stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
            fclose($fp);
            return false;
        }
        $befehl('EHLO kanid.de');
    }

    $befehl('AUTH LOGIN');
    $befehl(base64_encode($user));
    $auth = $befehl(base64_encode($pass));
    if (!str_starts_with($auth, '235')) {
        fclose($fp);
        return false;
    }

    if (!str_starts_with($befehl('MAIL FROM:<' . $user . '>'), '250')) {
        fclose($fp);
        return false;
    }
    if (!str_starts_with($befehl('RCPT TO:<' . $an . '>'), '250')) {
        fclose($fp);
        return false;
    }
    if (!str_starts_with($befehl('DATA'), '354')) {
        fclose($fp);
        return false;
    }

    $daten = 'Subject: ' . kopfzeile($betreff) . "\r\n";
    $daten .= implode("\r\n", $headers) . "\r\n\r\n";
    $daten .= str_replace("\n", "\r\n", str_replace("\r\n", "\n", $koerper));
    $daten .= "\r\n.";
    $ok = str_starts_with($befehl($daten), '250');
    $befehl('QUIT');
    fclose($fp);
    return $ok;
}
