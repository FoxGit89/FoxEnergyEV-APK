<?php
function db() {
    $host = getenv('MYSQLHOST') ?: 'localhost';
    $user = getenv('MYSQLUSER') ?: 'root';
    $pass = getenv('MYSQLPASSWORD') ?: '';
    $db   = getenv('MYSQLDATABASE') ?: 'railway';
    $port = getenv('MYSQLPORT') ?: '3306';

    try {
        return new PDO("mysql:host=$host;port=$port;dbname=$db;charset=utf8mb4", $user, $pass);
    } catch (Exception $e) {
        die(json_encode(['error' => 'Connessione DB fallita']));
    }
}
?>
