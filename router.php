<?php
$uri = $_SERVER['REQUEST_URI'];

// Root o path vuoto → redirect a /public/index.html
if ($uri === '/' || $uri === '') {
    header('Location: /public/index.html', true, 301);
    exit;
}

// Serve il file richiesto normalmente se esiste
$file = __DIR__ . parse_url($uri, PHP_URL_PATH);
if (is_file($file)) {
    return false; // lascia gestire al server built-in
}

// Fallback: serve index.html per qualsiasi path non trovato (SPA behavior)
include __DIR__ . '/public/index.html';