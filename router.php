<?php
// router.php

$path = parse_url($_SERVER["REQUEST_URI"], PHP_URL_PATH);

// Normalize path to prevent directory traversal
$path = '/' . ltrim($path, '/');
if (strpos($path, '..') !== false) {
    http_response_code(403);
    echo "403 Forbidden";
    exit;
}

// Check if the path exists in the root directory (e.g. app_api.php, functions.php)
$rootPath = realpath(__DIR__ . $path);
if ($rootPath && is_file($rootPath) && dirname($rootPath) === __DIR__) {
    // Only allow specific root PHP files to be executed directly
    if (pathinfo($rootPath, PATHINFO_EXTENSION) === 'php') {
        return false;
    }
}

if ($path === '/' || $path === '') {
    $path = '/index.html';
}

// Check if the path exists in the public directory
$publicDir = realpath(__DIR__ . '/public');
$publicPath = realpath($publicDir . $path);

// Ensure the resolved path is actually inside the public directory
if ($publicPath && is_file($publicPath) && strpos($publicPath, $publicDir) === 0) {
    // Basic mime types mapping for static files
    $ext = pathinfo($publicPath, PATHINFO_EXTENSION);
    $mimeTypes = [
        'html' => 'text/html',
        'css'  => 'text/css',
        'js'   => 'application/javascript',
        'json' => 'application/json',
        'png'  => 'image/png',
        'jpg'  => 'image/jpeg',
        'svg'  => 'image/svg+xml',
        'ico'  => 'image/x-icon',
        'txt'  => 'text/plain',
        'xml'  => 'application/xml',
        'webmanifest' => 'application/manifest+json'
    ];

    if (isset($mimeTypes[$ext])) {
        header('Content-Type: ' . $mimeTypes[$ext]);
    } else {
        header('Content-Type: application/octet-stream');
    }

    readfile($publicPath);
    return true;
}

// 404 Not Found
http_response_code(404);
echo "404 Not Found";
return true;
