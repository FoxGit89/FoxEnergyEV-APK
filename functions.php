<?php
function db(): PDO {
    static $pdo = null;
    if ($pdo !== null) return $pdo;
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
 * Calcola i totali del Mese Corrente leggendo dalle VERE tabelle in produzione.
 */
function getUserMonthlyStats($telegram_id) {
    $stats = [
        'energy_kwh' => '0.00',
        'spent_eur' => '0.00',
        'recharged_eur' => '0.00',
        'debug_msg' => 'Tutto OK'
    ];
    
    $pdo = db();
    $current_month = date('Y-m'); // Es. "2026-03"
    $errori = [];

    // =========================================================
    // 1. Somma Ricariche Wallet (Tabella: wallet_recharges)
    // =========================================================
    try {
        // Uso una JOIN corazzata nel caso la FK punti all'ID interno invece che al telegram_id
        $stmt1 = $pdo->prepare("
            SELECT SUM(w.amount) as total 
            FROM wallet_recharges w
            JOIN users u ON (w.user_id = u.id OR w.user_id = u.telegram_id)
            WHERE u.telegram_id = ? 
            AND w.status = 'CONFIRMED' 
            AND DATE_FORMAT(w.created_at, '%Y-%m') = ?
        ");
        $stmt1->execute([$telegram_id, $current_month]);
        $res1 = $stmt1->fetch(PDO::FETCH_ASSOC);
        
        if ($res1 && $res1['total']) {
            $stats['recharged_eur'] = number_format((float)$res1['total'], 2, '.', '');
        }
    } catch (Exception $e) {
        $errori[] = "Errore Wallet: " . $e->getMessage();
    }

    // =========================================================
    // 2. Somma Consumi ed Euro (Tabella REALE: transactions)
    // =========================================================
    try {
        // Leggiamo dalle colonne corrette: kwh e importo_eur
        $stmt2 = $pdo->prepare("
            SELECT 
                SUM(t.kwh) as tot_kwh, 
                SUM(t.importo_eur) as tot_eur 
            FROM transactions t
            JOIN users u ON (t.user_id = u.id OR t.user_id = u.telegram_id)
            WHERE u.telegram_id = ? 
            AND t.status = 'CONFIRMED' 
            AND DATE_FORMAT(t.created_at, '%Y-%m') = ?
        ");
        
        $stmt2->execute([$telegram_id, $current_month]);
        $res2 = $stmt2->fetch(PDO::FETCH_ASSOC);
        
        if ($res2) {
            if ($res2['tot_kwh']) $stats['energy_kwh'] = number_format((float)$res2['tot_kwh'], 2, '.', '');
            if ($res2['tot_eur']) $stats['spent_eur'] = number_format((float)$res2['tot_eur'], 2, '.', '');
        }
    } catch (Exception $e) {
        $errori[] = "Errore Transactions: " . $e->getMessage();
    }

    if (!empty($errori)) {
        $stats['debug_msg'] = implode(" | ", $errori);
    }

    return $stats;
}
?>