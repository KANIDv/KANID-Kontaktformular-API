<?php
// Keine Geheimnisse. SMTP kommt in config.secret.php neben dieser Datei
// oder nach /kunden/homepages/.../kanid-formular.secret.php (oberhalb des Webroots).

return [
    'empfaenger' => 'info@kanid.de',
    'absender_name' => 'KANID Kontaktformular',
    'absender_mail' => 'info@kanid.de',
    'betreff_prefix' => 'Kontaktanfrage',
    'bestaetigung' => true,
    'danke_url' => 'https://kanid.de/danke',
    'min_sekunden' => 2,
    'max_anfragen' => 5,
    'fenster_sekunden' => 600,
    'erlaubte_origins' => [
        'https://kanid.de',
        'https://www.kanid.de',
    ],
    // IONOS-Staging der Website, z. B. https://home-5021021214.app-ionos.space
    'erlaubte_origin_suffixe' => [
        '.app-ionos.space',
    ],
];
