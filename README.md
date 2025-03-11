# KANID UG Kontaktformular API für Netlify

Dieses Repository enthält die Serverless-API für das Kontaktformular der KANID UG Website mit [Resend](https://resend.com).

## Funktionen

- Nimmt Formularübermittlungen entgegen
- Validiert die Eingabedaten (Name, E-Mail, Nachricht)
- Sendet E-Mails über die Resend-API
- Kann auf Netlify bereitgestellt werden

## Voraussetzungen

- [Node.js](https://nodejs.org/) (Version 18 oder höher)
- [Netlify-Konto](https://app.netlify.com/signup) (kostenlose Option verfügbar)
- [Resend-Konto](https://resend.com) mit API-Schlüssel
- Verifizierte Domain bei Resend

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

## Integration mit Ihrer Website

Aktualisieren Sie Ihre HTML-Datei, um auf die Netlify-API-Funktion zu verweisen:

```javascript
// API-Anfrage senden
const response = await fetch('https://ihre-netlify-url.netlify.app/api/kontakt', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
    },
    body: JSON.stringify(formData)
});
```

## Sicherheitshinweise

- Speichern Sie Ihren API-Schlüssel niemals im Code (nutzen Sie Umgebungsvariablen)
- Aktivieren Sie bei Bedarf eine eingeschränkte CORS-Politik in der Netlify-Funktion
- Überwachen Sie die Logs in der Netlify-Oberfläche, um Probleme zu erkennen

## Fehlersuche

- **404-Fehler**: Prüfen Sie, ob die Weiterleitungsregeln korrekt sind
- **CORS-Fehler**: Stellen Sie sicher, dass Ihre Website-Domain in den CORS-Headern erlaubt ist
- **Resend-Fehler**: Prüfen Sie die Domain-Verifizierung und API-Schlüsselgültigkeit

## Lizenz

Dieses Projekt ist urheberrechtlich geschützt und exklusiv für die Verwendung durch die KANID UG bestimmt.