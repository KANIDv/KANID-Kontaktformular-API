<?php
declare(strict_types=1);

header('Content-Type: text/html; charset=UTF-8');
header('X-Robots-Tag: noindex, nofollow');
header('Cache-Control: no-store');
?>
<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>KANID Formular-API</title>
  <style>
    body { font-family: ui-monospace, Consolas, monospace; margin: 2rem; color: #111; }
    code { background: #f3f3f3; padding: 0.1em 0.35em; }
  </style>
</head>
<body>
  <p>KANID Formular-API · PHP <?= htmlspecialchars(PHP_VERSION, ENT_QUOTES, 'UTF-8') ?></p>
  <p>Sonde: <a href="/ping.php"><code>/ping.php</code></a></p>
  <p>Kontakt: <code>POST /kontakt.php</code></p>
</body>
</html>
