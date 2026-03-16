<?php
function db() {
    $host = getenv('MYSQLHOST') ?: 'localhost';
    $user = getenv('MYSQLUSER') ?: 'root';
    $pass = getenv('MYSQLPASSWORD') ?: '';
    $db   = getenv('MYSQLDATABASE') ?: 'railway';
    $port = getenv('MYSQLPORT') ?: '3306';

    try {
        $pdo = new PDO("mysql:host=$host;port=$port;dbname=$db;charset=utf8mb4", $user, $pass);
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        return $pdo;
    } catch (Exception $e) {
        die(json_encode(['error' => 'Connessione DB fallita']));
    }
}

/**
 * Estrae lo storico unificato delle Ricariche e dei Consumi di un utente.
 */
function getUserHistory($telegram_id) {
    $history = [];
    $pdo = db();

    try {
        // 1. Estrazione Ricariche (Wallet)
        // Assumo che la tabella si chiami 'wallet_recharges' e abbia le colonne: amount, created_at, status
        $stmt_recharges = $pdo->prepare("SELECT amount, created_at, status FROM wallet_recharges WHERE telegram_id = ? ORDER BY created_at DESC LIMIT 10");
        $stmt_recharges->execute([$telegram_id]);
        $recharges = $stmt_recharges->fetchAll(PDO::FETCH_ASSOC);

        foreach ($recharges as $r) {
            $history[] = [
                'tipo' => 'RICARICA',
                'val' => number_format((float)$r['amount'], 2),
                'data' => $r['created_at'],
                'status' => $r['status'] ?? 'Completata',
                'info' => 'Ricarica Wallet',
                'icon' => '➕'
            ];
        }
    } catch (Exception $e) {
        // Ignora se la tabella non esiste
    }

    try {
        // 2. Estrazione Consumi (Transazioni/Ricariche veicolo)
        // Assumo che la tabella si chiami 'transactions' o 'bookings' e abbia le colonne: cost, kwh_consumed, end_time, status
        $stmt_trans = $pdo->prepare("SELECT cost, kwh_consumed, end_time, status FROM transactions WHERE telegram_id = ? AND status IN ('completed', 'closed') ORDER BY end_time DESC LIMIT 10");
        $stmt_trans->execute([$telegram_id]);
        $transactions = $stmt_trans->fetchAll(PDO::FETCH_ASSOC);

        foreach ($transactions as $t) {
            $history[] = [
                'tipo' => 'CONSUMO',
                'val' => number_format((float)$t['cost'], 2),
                'kwh' => $t['kwh_consumed'] ?? '0.0',
                'data' => $t['end_time'],
                'status' => $t['status'],
                'info' => 'Ricarica Veicolo',
                'icon' => '➖'
            ];
        }
    } catch (Exception $e) {
        // Ignora se la tabella non esiste
    }

    // Ordina tutto per data dal più recente al più vecchio
    usort($history, function($a, $b) {
        return strtotime($b['data']) - strtotime($a['data']);
    });

    // Ritorna solo gli ultimi 15 movimenti per non appesantire l'App
    return array_slice($history, 0, 15);
}
?>
