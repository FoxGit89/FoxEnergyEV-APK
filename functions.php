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
 * Calcola i totali del Mese Corrente per Energia, Consumi e Ricariche Wallet
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
        $stmt1 = $pdo->prepare("SELECT SUM(amount) as total FROM wallet_recharges WHERE user_id = ? AND status = 'CONFIRMED' AND DATE_FORMAT(created_at, '%Y-%m') = ?");
        $stmt1->execute([$telegram_id, $current_month]);
        $res1 = $stmt1->fetch(PDO::FETCH_ASSOC);
        
        if ($res1 && $res1['total']) {
            $stats['recharged_eur'] = number_format((float)$res1['total'], 2, '.', '');
        }
    } catch (Exception $e) {
        $errori[] = "Errore Wallet: " . $e->getMessage();
    }

    // =========================================================
    // 2. Somma Consumi e Spesa (Tabella: transactions)
    // =========================================================
    try {
        // ⚠️ NOTA: Assumo che in 'transactions' le colonne si chiamino 'kwh_consumed', 'cost' e 'created_at'.
        // Se hai usato nomi diversi (es. 'importo', 'kwh', 'end_time'), aggiornali qui sotto!
        $stmt2 = $pdo->prepare("
            SELECT 
                SUM(kwh_consumed) as tot_kwh, 
                SUM(cost) as tot_eur 
            FROM transactions 
            WHERE user_id = ? 
            AND status IN ('completed', 'closed', 'finished') 
            AND DATE_FORMAT(created_at, '%Y-%m') = ?
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

    // Se c'è stato un problema di nomi di colonne, lo vedremo nella console di Flutter!
    if (!empty($errori)) {
        $stats['debug_msg'] = implode(" | ", $errori);
    }

    return $stats;
}
?>
