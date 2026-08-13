<?php
// Kopie als config.secret.php ablegen — liegt neben config.php,
// ausserhalb von public/, und gehoert nicht ins Repository.
// Fehlt die Datei, versendet PHP ueber mail().

return [
    'smtp_host' => 'smtp.gmail.com',
    'smtp_port' => 587,
    'smtp_user' => 'info@kanid.de',
    'smtp_pass' => 'APP-PASSWORT-HIER',
];
