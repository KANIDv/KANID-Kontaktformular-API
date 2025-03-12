# KANID UG Kontaktformular API für Netlify

Dieses Repository enthält die Serverless-API für das Kontaktformular der KANID UG Website mit [Resend](https://resend.com).

## Funktionen

- Nimmt Formularübermittlungen entgegen
- Validiert die Eingabedaten (Name, E-Mail, Nachricht)
- Sendet E-Mails über die Resend-API:
  - Eine Benachrichtigung an info@kanid.de
  - Eine Bestätigungs-E-Mail an den Absender des Formulars
- Kann auf Netlify bereitgestellt werden

## Voraussetzungen

- [Node.js](https://nodejs.org/) (Version 18 oder höher)
- [Netlify-Konto](https://app.netlify.com/signup) (kostenlose Option verfügbar)
- [Resend-Konto](https://resend.com) mit API-Schlüssel
- Verifizierte Domains bei Resend (kanid.de und subdomains)

## Einrichtung & Bereitstellung

### 1. Repository klonen & Abhängigkeiten installieren

```bash
git clone https://github.com/KANIDv/KANID-Kontaktformular-API.git
cd KANID-Kontaktformular-API
npm install
```

### 2. Lokalen Entwicklungsserver starten

```bash
npm run dev
```

### 3. Bei Netlify bereitstellen

**Option A: Über die Netlify-Website**

1. Auf [Netlify](https://app.netlify.com) anmelden
2. "New site from Git" auswählen
3. GitHub/GitLab/Bitbucket verbinden und das Repository auswählen
4. Umgebungsvariablen unter "Site settings" > "Environment variables" hinzufügen:
   - `RESEND_API_KEY`: Ihr Resend API-Schlüssel

**Option B: Über die Kommandozeile**

1. Netlify CLI installieren (falls noch nicht installiert)
   ```
   npm install netlify-cli -g
   ```

2. Anmelden und bereitstellen
   ```
   netlify login
   npm run deploy
   ```

3. Umgebungsvariablen einrichten
   ```
   netlify env:set RESEND_API_KEY "Ihr-API-Schlüssel"
   ```

## Domain-Konfiguration bei Resend

Für das Kontaktformular müssen folgende Domains bei Resend verifiziert sein:
- `kontaktformular@kanid.de` (für den Versand an den Administrator)
- `info@kanid.de` (für den Versand der Bestätigungs-E-Mail)

Anleitung:
1. Im Resend Dashboard einloggen
2. Unter "Domains" > "Add Domain" Ihre Domain hinzufügen
3. Den Anweisungen zur Domain-Verifizierung folgen (DNS-Einträge setzen)
4. Warten, bis die Domains verifiziert sind (kann einige Stunden dauern)

## Integration mit Ihrer Website

Aktualisieren Sie Ihre HTML-Datei, um auf die Netlify-API-Funktion zu verweisen:

```javascript
// API-Anfrage senden
const response = await fetch('https://kanid-kontaktformular.netlify.app/api/kontakt', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
    },
    body: JSON.stringify(formData)
});
```

## Sicherheitshinweise

- Speichern Sie Ihren API-Schlüssel niemals direkt im Code (immer Umgebungsvariablen verwenden)
- Aktivieren Sie bei Bedarf eine eingeschränkte CORS-Politik in der Netlify-Funktion
- Überwachen Sie die Logs in der Netlify-Oberfläche, um Probleme zu erkennen
- Achten Sie darauf, dass Ihre Domains bei Resend verifiziert sind

## Fehlerbehebung

- **404-Fehler**: Prüfen Sie, ob die Weiterleitungsregeln in `netlify.toml` korrekt sind
- **CORS-Fehler**: Stellen Sie sicher, dass Ihre Website-Domain in den CORS-Headern erlaubt ist
- **Resend-Fehler**: 
  - Prüfen Sie die Domain-Verifizierung bei Resend
  - Stellen Sie sicher, dass der API-Schlüssel als Umgebungsvariable gesetzt ist
  - Prüfen Sie die Netlify-Logs auf Fehlermeldungen

## Lizenz

Dieses Projekt ist urheberrechtlich geschützt und exklusiv für die Verwendung durch die KANID UG bestimmt.