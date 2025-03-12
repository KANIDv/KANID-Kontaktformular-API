// Netlify-Serverless-Funktion für das Kontaktformular mit Resend
const { Resend } = require('resend');

// Handler für Netlify-Funktionen
exports.handler = async function(event, context) {
  // Nur POST-Anfragen zulassen
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ 
        error: 'Methode nicht erlaubt',
        message: 'Diese API unterstützt nur POST-Anfragen'
      })
    };
  }

  // CORS-Header für Cross-Origin-Anfragen
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  // OPTIONS-Anfragen für CORS präflights direkt beantworten
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  try {
    // Anfragedaten als JSON parsen
    const formData = JSON.parse(event.body);
    const name = formData.name;
    const email = formData.email;
    const subject = formData.subject || `Kontaktanfrage von ${name}`;
    const message = formData.message;
    
    // Validierung der Eingabefelder
    if (!name || !email || !message) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'Fehlende Daten',
          message: 'Bitte füllen Sie alle Pflichtfelder aus (Name, E-Mail, Nachricht)'
        })
      };
    }

    // E-Mail-Format validieren (einfache Überprüfung)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'Ungültige E-Mail',
          message: 'Bitte geben Sie eine gültige E-Mail-Adresse ein'
        })
      };
    }

    // Resend API-Schlüssel aus Umgebungsvariablen laden
    const resendApiKey = process.env.RESEND_API_KEY;
    if (!resendApiKey) {
      console.error('RESEND_API_KEY nicht konfiguriert');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ 
          error: 'Server-Konfigurationsfehler',
          message: 'Die E-Mail-Funktion ist nicht korrekt konfiguriert. Bitte kontaktieren Sie den Administrator.'
        })
      };
    }
    
    const resend = new Resend(resendApiKey);
    
    // E-Mail-Inhalt für Besitzer formatieren
    const htmlContent = `
      <h2>Neue Kontaktanfrage über das Formular</h2>
      <p><strong>Name:</strong> ${name}</p>
      <p><strong>E-Mail:</strong> ${email}</p>
      <p><strong>Betreff:</strong> ${subject}</p>
      <p><strong>Nachricht:</strong></p>
      <p>${message.replace(/\n/g, '<br>')}</p>
      <hr>
      <p><small>Diese Nachricht wurde über das Kontaktformular auf kanid.de gesendet.</small></p>
    `;
    
    // Bestätigungs-E-Mail Inhalt für Absender
    const confirmationHtml = `
      <h2>Vielen Dank für Ihre Anfrage an KANID UG</h2>
      <p>Hallo ${name},</p>
      <p>wir haben Ihre Anfrage mit folgendem Inhalt erhalten:</p>
      <hr>
      <p><strong>Betreff:</strong> ${subject}</p>
      <p><strong>Nachricht:</strong></p>
      <p>${message.replace(/\n/g, '<br>')}</p>
      <hr>
      <p>Wir werden uns so schnell wie möglich bei Ihnen melden.</p>
      <p>Mit freundlichen Grüßen,<br>Ihr KANID UG Team</p>
      <p>
        <small>
          KANID UG (haftungsbeschränkt)<br>
          Holderäckerstraße 3<br>
          70839 Gerlingen<br>
          Tel: +49 1520 7921611<br>
          E-Mail: info@kanid.de<br>
          Web: <a href="https://www.kanid.de">www.kanid.de</a>
        </small>
      </p>
    `;
    
    // E-Mails parallel senden (an info@kanid.de und den Absender)
    const [adminEmailResult, confirmationEmailResult] = await Promise.all([
      // E-Mail an Seitenbetreiber
      resend.emails.send({
        from: 'kontaktformular@kanid.de', // Diese Domain muss bei Resend verifiziert sein
        to: 'info@kanid.de',              // Empfänger-E-Mail
        reply_to: email,                  // Antworten gehen an den Absender
        subject: subject,
        html: htmlContent
      }),
      
      // Bestätigungs-E-Mail an Absender
      resend.emails.send({
        from: 'info@kanid.de',           // Diese Domain muss bei Resend verifiziert sein 
        to: email,                       // E-Mail des Absenders
        subject: `Ihre Anfrage an KANID UG: ${subject}`,
        html: confirmationHtml
      })
    ]);
    
    // Prüfen, ob beide E-Mails erfolgreich waren
    if (!adminEmailResult.id || !confirmationEmailResult.id) {
      throw new Error('E-Mail konnte nicht gesendet werden');
    }
    
    // Erfolgreiche Antwort zurückgeben
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        success: true, 
        message: 'Ihre Nachricht wurde erfolgreich gesendet',
        id: adminEmailResult.id
      })
    };
    
  } catch (error) {
    console.error('Fehler beim Senden der E-Mail:', error);
    
    // Fehlermeldung zurückgeben
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Serverfehler',
        message: 'Beim Senden Ihrer Nachricht ist ein Fehler aufgetreten. Bitte versuchen Sie es später erneut.'
      })
    };
  }
};