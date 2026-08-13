<?php
declare(strict_types=1);

require dirname(__DIR__) . '/src/bootstrap.php';

header('Cache-Control: no-store');
header('X-Robots-Tag: noindex, nofollow');
header('Content-Type: application/json; charset=UTF-8');
corsHeaderSetzen($config);

echo json_encode([
    'ok' => true,
    'php' => PHP_VERSION,
    'sapi' => PHP_SAPI,
    'mail' => function_exists('mail'),
    'time' => gmdate('c'),
], JSON_UNESCAPED_SLASHES);
