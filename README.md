# KANID Kontaktformular-API

Kleines PHP-Projekt für IONOS Deploy Now. Nimmt das Kontaktformular
der statischen Website entgegen und schickt die Nachricht an `info@kanid.de`.

Die Website (`KANID-Website-v4`) bleibt ein Static-Projekt. Dieses Repo
ist das zweite, PHP-fähige Projekt — Deploy Now lässt dasselbe Repo
nicht zweimal anbinden.

## Endpunkte

| Pfad | Methode | Zweck |
|---|---|---|
| `/ping.php` | GET | Läuft PHP? Antwort ist JSON. |
| `/kontakt.php` | POST | Formular. Felder: `name`, `email`, `subject`, `message` |
| `/` | GET | Kurze Statusseite, noindex |

Ohne JavaScript leitet ein Erfolg nach `https://kanid.de/danke`.

## In Deploy Now anlegen

1. Neues Projekt → **PHP** (nicht Static).
2. Repository: `KANID-Kontaktformular-API` (Account KANIDv).
3. Kein Framework (nicht Laravel, nicht Symfony).
4. **Document Root / public directory:** `public`
5. **Kein Build-Befehl.** Es gibt nichts zu kompilieren.
6. PHP 8.3 oder 8.4.
7. Branch `main`.

Danach die zugewiesene URL notieren, zum Beispiel
`https://home-5021xxxxxxx.app-ionos.space`.

Prüfung:

```
https://DIE-URL/ping.php
```

Erwartet: JSON mit `"ok": true` und einer PHP-Version.

## Website verdrahten

In `KANID-Website-v4` die Datei `config/formular.json`:

```json
{
  "endpoint": "https://home-5021xxxxxxx.app-ionos.space"
}
```

Dann dort committen und auf Staging/Live ausrollen. Das Formular sendet
nach `{endpoint}/kontakt.php`.

## Mail

Ohne weitere Datei nutzt PHP `mail()`. Das reicht für den ersten Test,
landet bei Google-Workspace-Postfächern oft im Spam.

Zuverlässiger: `config.secret.example.php` nach `config.secret.php`
kopieren, App-Passwort für `info@kanid.de` eintragen. Die Datei liegt
ausserhalb von `public/` und nicht im Git. Auf IONOS entweder

- als persistente Datei im Deploy-Now-Projekt hinterlegen, oder
- per SFTP neben `config.php` legen (nicht ins Webverzeichnis).

## Erlaubte Absender

Nur diese Origins dürfen per `fetch` posten:

- `https://kanid.de`
- `https://www.kanid.de`
- jede `https://*.app-ionos.space` (Website-Staging)

Weitere Domains in `config.php` unter `erlaubte_origins` ergänzen.
