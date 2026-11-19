<?php
declare(strict_types=1);

require dirname(__DIR__) . '/src/bootstrap.php';

$geheim = ladeGeheimnisse();
$method = $_SERVER['REQUEST_METHOD'] ?? '';
$lang = spracheBestimmen();

if ($method === 'OPTIONS') {
    corsHeaderSetzen($config);
    http_response_code(204);
    exit;
}

if ($method !== 'POST') {
    antwort($config, 405, ['ok' => false, 'error' => 'method', 'meldung' => kontaktText($lang, 'method')]);
}

if (!originErlaubt($config)) {
    antwort($config, 403, ['ok' => false, 'error' => 'origin', 'meldung' => kontaktText($lang, 'origin')]);
}

$honeypot = feld('bot-field', 80) . feld('_gotcha', 80);
if ($honeypot !== '') {
    antwort($config, 200, ['ok' => true, 'mail' => false]);
}

$gesetzt = feld('_gesetzt', 20);
$minSekunden = (int) $config['min_sekunden'];
if ($gesetzt !== '' && ctype_digit($gesetzt)) {
    $alter = time() - (int) $gesetzt;
    if ($alter >= 0 && $alter < $minSekunden) {
        antwort($config, 200, ['ok' => true, 'mail' => false]);
    }
}

if (rateLimitUeberschritten($config)) {
    antwort($config, 429, ['ok' => false, 'error' => 'rate', 'meldung' => kontaktText($lang, 'rate')]);
}

$name = feld('name', 120);
$email = feld('email', 180);
$betreff = feld('subject', 180);
$nachricht = nachrichtFeld(5000);

if ($name === '' || $email === '' || $betreff === '' || $nachricht === '') {
    antwort($config, 422, ['ok' => false, 'error' => 'validation', 'meldung' => kontaktText($lang, 'pflicht')]);
}

if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    antwort($config, 422, ['ok' => false, 'error' => 'validation', 'meldung' => kontaktText($lang, 'email')]);
}

$empfaenger = (string) $config['empfaenger'];
$absenderMail = (string) $config['absender_mail'];
$absenderName = (string) $config['absender_name'];
$mailBetreff = $config['betreff_prefix'] . ': ' . $betreff;

$koerper = implode("\n", [
    'Neue Nachricht über das Kontaktformular auf kanid.de',
    '',
    'Name:    ' . $name,
    'E-Mail:  ' . $email,
    'Betreff: ' . $betreff,
    'Zeit:    ' . gmdate('Y-m-d H:i:s') . ' UTC',
    'IP:      ' . clientIp(),
    'Sprache: ' . ($lang === 'en' ? 'Englisch' : 'Deutsch'),
    '',
    'Nachricht:',
    $nachricht,
    '',
]);

$headers = [
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    'From: ' . kopfzeile($absenderName) . ' <' . $absenderMail . '>',
    'Reply-To: ' . kopfzeile($name) . ' <' . $email . '>',
    'X-Mailer: KANID-Kontakt',
];

$gesendet = sendeMail($empfaenger, $mailBetreff, $koerper, $headers, $absenderMail, $geheim);

if (!$gesendet) {
    antwort($config, 500, [
        'ok' => false,
        'error' => 'mail',
        'meldung' => kontaktText($lang, 'mail'),
        'mail' => false,
        'php' => PHP_VERSION,
    ]);
}

if (!empty($config['bestaetigung'])) {
    $danke = $lang === 'en'
        ? implode("\n", [
            'Hello ' . $name . ',',
            '',
            'we have received your message and will get back to you as soon as possible.',
            '',
            'Subject: ' . $betreff,
            '',
            'KANID UG (haftungsbeschränkt)',
            'Heinrich-Hertz-Str. 11',
            '70794 Filderstadt',
            'info@kanid.de · +49 1520 7921611',
        ])
        : implode("\n", [
            'Guten Tag ' . $name . ',',
            '',
            'wir haben Ihre Nachricht erhalten und melden uns so schnell wie möglich.',
            '',
            'Betreff: ' . $betreff,
            '',
            'KANID UG (haftungsbeschränkt)',
            'Heinrich-Hertz-Str. 11',
            '70794 Filderstadt',
            'info@kanid.de · +49 1520 7921611',
        ]);
    $dankeHeaders = [
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: 8bit',
        'From: ' . kopfzeile('KANID') . ' <' . $absenderMail . '>',
        'X-Mailer: KANID-Kontakt',
    ];
    sendeMail($email, kontaktText($lang, 'betreff'), $danke, $dankeHeaders, $absenderMail, $geheim);
}

antwort($config, 200, ['ok' => true, 'mail' => true]);
