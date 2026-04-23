<?php
function db(): PDO {
    static $pdo = null;
    if ($pdo !== null) return $pdo;
    $host = getenv('MYSQLHOST')     ?: 'localhost';
    $user = getenv('MYSQLUSER')     ?: 'root';
    $pass = getenv('MYSQLPASSWORD') ?: '';
    $db   = getenv('MYSQLDATABASE') ?: 'railway';
    $port = getenv('MYSQLPORT')     ?: '3306';
    try {
        $pdo = new PDO("mysql:host=$host;port=$port;dbname=$db;charset=utf8mb4", $user, $pass);
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        return $pdo;
    } catch (Exception $e) {
        die(json_encode(['error' => 'Connessione DB fallita']));
    }
}

function getUserMonthlyStats($telegram_id) {
    $stats = ['energy_kwh'=>'0.00','spent_eur'=>'0.00','recharged_eur'=>'0.00','debug_msg'=>'OK'];
    $pdo   = db();
    $month = date('Y-m');
    $errs  = [];
    try {
        $s = $pdo->prepare("SELECT SUM(w.amount) as total FROM wallet_recharges w JOIN users u ON (w.user_id=u.id OR w.user_id=u.telegram_id) WHERE u.telegram_id=? AND w.status='CONFIRMED' AND DATE_FORMAT(w.created_at,'%Y-%m')=?");
        $s->execute([$telegram_id,$month]);
        $r = $s->fetch(PDO::FETCH_ASSOC);
        if ($r&&$r['total']) $stats['recharged_eur']=number_format((float)$r['total'],2,'.','' );
    } catch(Exception $e) { $errs[]='Wallet: '.$e->getMessage(); }
    try {
        $s = $pdo->prepare("SELECT SUM(t.kwh) as tot_kwh,SUM(t.importo_eur) as tot_eur FROM transactions t JOIN users u ON (t.user_id=u.id OR t.user_id=u.telegram_id) WHERE u.telegram_id=? AND t.status='CONFIRMED' AND DATE_FORMAT(t.created_at,'%Y-%m')=?");
        $s->execute([$telegram_id,$month]);
        $r = $s->fetch(PDO::FETCH_ASSOC);
        if ($r) {
            if ($r['tot_kwh']) $stats['energy_kwh']=number_format((float)$r['tot_kwh'],2,'.','' );
            if ($r['tot_eur']) $stats['spent_eur'] =number_format((float)$r['tot_eur'], 2,'.','' );
        }
    } catch(Exception $e) { $errs[]='Transactions: '.$e->getMessage(); }
    if ($errs) $stats['debug_msg']=implode(' | ',$errs);
    return $stats;
}
?>