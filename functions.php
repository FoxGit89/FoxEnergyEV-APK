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
 * Estrae lo storico unificato delle Ricariche e delle Prenotazioni di un utente.
 */
function getUserHistory($telegram_id) {
    $history = [];
    $pdo = db();

    // =========================================================
    // 1. ESTRAZIONE RICARICHE WALLET (Tabella: wallet_recharges)
    // =========================================================
    try {
        // Usiamo 'user_id' come da schema
        $stmt_recharges = $pdo->prepare("SELECT amount, created_at, status, method_key FROM wallet_recharges WHERE user_id = ? AND status = 'CONFIRMED' ORDER BY created_at DESC LIMIT 10");
        $stmt_recharges->execute([$telegram_id]);
        $recharges = $stmt_recharges->fetchAll(PDO::FETCH_ASSOC);

        foreach ($recharges as $r) {
            $history[] = [
                'tipo' => 'RICARICA',
                'val' => number_format((float)$r['amount'], 2),
                'data' => $r['created_at'],
                'status' => $r['status'],
                'info' => 'Ricarica ' . ($r['method_key'] ?? 'Wallet'),
                'icon' => '➕'
            ];
        }
    } catch (Exception $e) {
        // Errore silenzioso, passiamo oltre
    }

    // =========================================================
    // 2. ESTRAZIONE PRENOTAZIONI / CONSUMI (Tabella: bookings)
    // =========================================================
    try {
        // Usiamo 'user_id' e filtriamo per status conclusi. 
        // Poiché non c'è un 'cost' nella tabella, usiamo service_name e slot.
        $stmt_trans = $pdo->prepare("SELECT service_name, slot, created_at, status FROM bookings WHERE user_id = ? AND status IN ('completed', 'finished') ORDER BY created_at DESC LIMIT 10");
        $stmt_trans->execute([$telegram_id]);
        $transactions = $stmt_trans->fetchAll(PDO::FETCH_ASSOC);

        foreach ($transactions as $t) {
            $history[] = [
                'tipo' => 'CONSUMO',
                'val' => '--', // Nessun costo monetario loggato in bookings
                'kwh' => $t['service_name'] ?? 'Colonnina', // Mostriamo l'operatore al posto dei kWh
                'data' => $t['created_at'],
                'status' => strtoupper($t['status']),
                'info' => 'Slot: ' . ($t['slot'] ?? 'N/D'),
                'icon' => '➖'
            ];
        }
    } catch (Exception $e) {
        // Errore silenzioso, passiamo oltre
    }

    // =========================================================
    // ORDINAMENTO E MERGE FINALE
    // =========================================================
    // Ordina per data decrescente (dal più recente al più vecchio)
    usort($history, function($a, $b) {
        return strtotime($b['data']) - strtotime($a['data']);
    });

    return array_slice($history, 0, 15);
}
?>
