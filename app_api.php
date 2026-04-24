<?php
error_reporting(0);
ini_set('display_errors', 0);
require_once 'functions.php';

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

$action = $_GET['action'] ?? '';

// Legge parametri da body JSON (POST) o query string (GET)
function getParam(string $key, string $default = ''): string {
    static $body = null;
    if ($body === null) {
        $raw  = file_get_contents('php://input');
        $body = ($raw && $raw !== '') ? (json_decode($raw, true) ?? []) : [];
    }
    return isset($body[$key]) ? (string)$body[$key] : (isset($_GET[$key]) ? (string)$_GET[$key] : $default);
}

// ── RATE LIMITING ──────────────────────────────────────────
function ensureRLTable(): void {
    static $done = false; if ($done) return;
    try { db()->exec("CREATE TABLE IF NOT EXISTS login_attempts(id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, ip VARCHAR(45) NOT NULL, attempted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_ip_time(ip, attempted_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"); $done = true; } catch(Exception $e) {}
}
function checkRL(string $ip): array {
    ensureRLTable();
    $since = date('Y-m-d H:i:s', time() - 900);
    $s = db()->prepare("SELECT COUNT(*) FROM login_attempts WHERE ip=? AND attempted_at>?"); $s->execute([$ip, $since]); $n = (int)$s->fetchColumn();
    if ($n >= 5) { $o = db()->prepare("SELECT attempted_at FROM login_attempts WHERE ip=? AND attempted_at>? ORDER BY attempted_at ASC LIMIT 1"); $o->execute([$ip, $since]); $t = $o->fetchColumn(); return ['blocked' => true, 'wait_minutes' => max(1, (int)ceil((strtotime($t) + 900 - time()) / 60))]; }
    return ['blocked' => false, 'remaining' => 5 - $n];
}
function recordRL(string $ip): void { ensureRLTable(); try { db()->prepare("INSERT INTO login_attempts(ip) VALUES(?)")->execute([$ip]); } catch(Exception $e) {} }
function clearRL(string $ip):  void { ensureRLTable(); try { db()->prepare("DELETE FROM login_attempts WHERE ip=?")->execute([$ip]); } catch(Exception $e) {} }
function clientIp(): string {
    foreach (['HTTP_CF_CONNECTING_IP','HTTP_X_FORWARDED_FOR','REMOTE_ADDR'] as $k) if (!empty($_SERVER[$k])) return trim(explode(',', $_SERVER[$k])[0]);
    return '0.0.0.0';
}

// ── TABELLA SESSIONI ───────────────────────────────────────
function ensureSessionTable(): void {
    static $done = false; if ($done) return;
    try { db()->exec("CREATE TABLE IF NOT EXISTS active_sessions(id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, user_id VARCHAR(64) NOT NULL, slots TEXT, started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, ended_at DATETIME DEFAULT NULL, status ENUM('active','ended','expired') NOT NULL DEFAULT 'active', INDEX idx_user(user_id, status)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"); $done = true; } catch(Exception $e) {}
}

// =========================================================
// 1. LOGIN — solo POST, con rate limiting
// =========================================================
if ($action === 'login') {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['success' => false, 'error' => 'Metodo non consentito.']); exit; }
    $ip    = clientIp();
    $input = ltrim(trim(getParam('username')), '@');
    $card  = getParam('card_number');
    if (!$input || !$card) { echo json_encode(['success' => false, 'error' => 'Compila tutti i campi.']); exit; }
    $rl = checkRL($ip);
    if ($rl['blocked']) { echo json_encode(['success' => false, 'error' => "Troppi tentativi. Riprova tra {$rl['wait_minutes']} minuti.", 'rate_limited' => true]); exit; }

    $s = db()->prepare("SELECT telegram_id, first_name FROM users WHERE (username=? OR telegram_id=?) AND card_number=?");
    $s->execute([$input, $input, $card]);
    $u = $s->fetch(PDO::FETCH_ASSOC);

    if ($u) {
        try { $l = db()->prepare("SELECT app_access FROM users WHERE telegram_id=?"); $l->execute([$u['telegram_id']]); $a = $l->fetchColumn(); if ($a !== false && (int)$a === 0) { echo json_encode(['success' => false, 'error' => 'Licenza revocata.']); exit; } } catch(Exception $e) {}
        clearRL($ip);
        echo json_encode(['success' => true, 'telegram_id' => $u['telegram_id'], 'first_name' => $u['first_name']]);
    } else {
        recordRL($ip);
        $r2 = checkRL($ip); $rem = !$r2['blocked'] ? ($r2['remaining'] ?? 0) : 0;
        $extra = ($rem > 0 && $rem <= 2) ? " ({$rem} " . ($rem === 1 ? 'tentativo rimasto' : 'tentativi rimasti') . ")" : '';
        echo json_encode(['success' => false, 'error' => "Credenziali errate.{$extra}"]);
    }
    exit;
}

// =========================================================
// 1.5 KILL-SWITCH
// =========================================================
if ($action === 'check_license') {
    $uid = $_GET['user_id'] ?? '';
    try { $s = db()->prepare("SELECT app_access FROM users WHERE telegram_id=?"); $s->execute([$uid]); $r = $s->fetch(PDO::FETCH_ASSOC); $ok = isset($r['app_access']) ? (int)$r['app_access'] : 1; echo json_encode(['access' => $ok === 1]); } catch(Exception $e) { echo json_encode(['access' => true]); }
    exit;
}

// =========================================================
// 2. BARRIERA
// =========================================================
$user_id = $_GET['user_id'] ?? '';
if (empty($user_id)) { echo json_encode(['error' => 'User ID mancante.']); exit; }

try {
    $s = db()->prepare("SELECT * FROM users WHERE telegram_id=?"); $s->execute([$user_id]); $user = $s->fetch(PDO::FETCH_ASSOC);
    if (!$user) { echo json_encode(['error' => 'Utente non autorizzato.']); exit; }

    // ── DASHBOARD ──────────────────────────────────────────
    if ($action === 'get_dashboard') {
        try {
            $stats = getUserMonthlyStats($user_id);
            echo json_encode(['saldo' => $user['saldo_kwh'] ?? 0, 'karma' => $user['trust_score'] ?? 0, 'is_premium' => $user['is_premium'] ?? 0, 'monthly_stats' => $stats]);
        } catch(\Throwable $e) { echo json_encode(['error' => 'CRASH PHP: ' . $e->getMessage()]); }
        exit;
    }

    // ── SLOTS — fix FIND_IN_SET: parametri bindati, niente db()->quote() ──
    if ($action === 'get_slots') {
        $u_tg    = (string)$user['telegram_id'];
        $u_name  = (string)($user['username'] ?? '');
        $u_score = (int)($user['trust_score'] ?? 100);
        $u_prem  = (int)($user['is_premium'] ?? 0);
        $s = db()->prepare("SELECT id, slot_label, json_file_id FROM rfid_slots WHERE status IN('active','suspended') AND((min_trust_score<=0 AND(allowed_users IS NULL OR allowed_users=''))OR(min_trust_score>0 AND ?>=min_trust_score AND ?=1)OR FIND_IN_SET(?,allowed_users)>0 OR FIND_IN_SET(?,allowed_users)>0) ORDER BY slot_label ASC");
        $s->execute([$u_score, $u_prem, $u_tg, $u_name]);
        echo json_encode($s->fetchAll(PDO::FETCH_ASSOC) ?: []);
        exit;
    }

    // ── DOWNLOAD TESSERA ────────────────────────────────────
    if ($action === 'get_json_content') {
        $fid = $_GET['file_id'] ?? '';
        if (!$fid) { echo json_encode(['error' => 'File ID mancante.']); exit; }
        $tok = getenv('BOT_TOKEN'); if (!$tok) { echo json_encode(['error' => 'BOT_TOKEN non trovato.']); exit; }
        $tg = @file_get_contents("https://api.telegram.org/bot{$tok}/getFile?file_id=" . urlencode($fid));
        if (!$tg) { echo json_encode(['error' => 'Errore Telegram.']); exit; }
        $gf = json_decode($tg, true);
        if (!$gf || empty($gf['result']['file_path'])) { echo json_encode(['error' => 'File scaduto. Ricarica la configurazione.']); exit; }
        $content = @file_get_contents("https://api.telegram.org/file/bot{$tok}/{$gf['result']['file_path']}");
        if (!$content) { echo json_encode(['error' => 'Download fallito.']); exit; }
        echo $content; exit;
    }

    // ── STORICO ─────────────────────────────────────────────
    if ($action === 'get_history') {
        try {
            $limit = min((int)($_GET['limit'] ?? 10), 50);
            $sessions = []; $transactions = [];
            try { $s = db()->prepare("SELECT cs.id, cs.start_time, cs.end_time, cs.energy_kwh, cs.status, rs.slot_label FROM charging_sessions cs LEFT JOIN rfid_slots rs ON cs.slot_id=rs.id JOIN users u ON cs.user_id=u.id WHERE u.telegram_id=? ORDER BY cs.start_time DESC LIMIT ?"); $s->execute([$user_id, $limit]); $sessions = $s->fetchAll(PDO::FETCH_ASSOC); } catch(Exception $e) {}
            try { $s = db()->prepare("SELECT t.id, t.created_at, t.kwh, t.importo_eur, t.status, t.description FROM transactions t JOIN users u ON(t.user_id=u.id OR t.user_id=u.telegram_id) WHERE u.telegram_id=? AND t.status='CONFIRMED' ORDER BY t.created_at DESC LIMIT ?"); $s->execute([$user_id, $limit]); $transactions = $s->fetchAll(PDO::FETCH_ASSOC); } catch(Exception $e) {}
            $history = [];
            foreach ($sessions as $s) { $dur = null; if (!empty($s['start_time']) && !empty($s['end_time'])) { $d = strtotime($s['end_time']) - strtotime($s['start_time']); $dur = sprintf('%dh %02dm', floor($d/3600), floor(($d%3600)/60)); } $history[] = ['id' => $s['id'], 'type' => 'session', 'date' => $s['start_time'], 'kwh' => $s['energy_kwh'] ? number_format((float)$s['energy_kwh'],2,'.','' ) : null, 'eur' => null, 'status' => $s['status'], 'slot_label' => $s['slot_label'] ?? 'Colonnina', 'duration' => $dur]; }
            foreach ($transactions as $t) { $history[] = ['id' => $t['id'], 'type' => 'transaction', 'date' => $t['created_at'], 'kwh' => $t['kwh'] ? number_format((float)$t['kwh'],2,'.','' ) : null, 'eur' => $t['importo_eur'] ? number_format((float)$t['importo_eur'],2,'.','' ) : null, 'status' => $t['status'], 'slot_label' => $t['description'] ?? 'Ricarica', 'duration' => null]; }
            usort($history, fn($a,$b) => strtotime($b['date']) - strtotime($a['date']));
            echo json_encode(['history' => array_slice($history, 0, $limit)]);
        } catch(Exception $e) { echo json_encode(['error' => 'Errore storico.']); }
        exit;
    }

    // ── NOTIFICHE ───────────────────────────────────────────
    if ($action === 'get_notifications') {
        try {
            $n = [];
            try { $s = db()->prepare("SELECT b.id, b.message, b.created_at, b.type FROM broadcasts b WHERE b.is_sent=1 AND(b.target_user_id IS NULL OR b.target_user_id=?) ORDER BY b.created_at DESC LIMIT 20"); $s->execute([$user_id]); foreach ($s->fetchAll(PDO::FETCH_ASSOC) as $r) $n[] = ['id' => $r['id'], 'source' => 'admin', 'message' => $r['message'], 'date' => $r['created_at'], 'type' => $r['type'] ?? 'info']; } catch(Exception $e) {}
            try { $s = db()->prepare("SELECT cs.id, cs.created_at, cs.status, rs.slot_label FROM charging_sessions cs LEFT JOIN rfid_slots rs ON cs.slot_id=rs.id JOIN users u ON cs.user_id=u.id WHERE u.telegram_id=? AND cs.status IN('pending','pending_approval') ORDER BY cs.created_at DESC LIMIT 5"); $s->execute([$user_id]); foreach ($s->fetchAll(PDO::FETCH_ASSOC) as $p) $n[] = ['id' => 'p_'.$p['id'], 'source' => 'system', 'message' => 'Sessione su "'.($p['slot_label'] ?? 'colonnina').'" in attesa di conferma.', 'date' => $p['created_at'], 'type' => 'warning']; } catch(Exception $e) {}
            $saldo = (float)($user['saldo_kwh'] ?? 0);
            if ($saldo > 0 && $saldo < 2.0) $n[] = ['id' => 'low_bal', 'source' => 'system', 'message' => 'Credito quasi esaurito ('.number_format($saldo,2).' kWh). Ricarica il wallet Fox Energy.', 'date' => date('Y-m-d H:i:s'), 'type' => 'warning'];
            usort($n, fn($a,$b) => strtotime($b['date']) - strtotime($a['date']));
            echo json_encode(['notifications' => $n, 'unread' => count($n)]);
        } catch(Exception $e) { echo json_encode(['error' => 'Errore notifiche.']); }
        exit;
    }

    // ── START/END SESSION ───────────────────────────────────
    if ($action === 'start_session') {
        ensureSessionTable();
        try { db()->prepare("UPDATE active_sessions SET status='expired',ended_at=NOW() WHERE user_id=? AND status='active'")->execute([$user_id]); } catch(Exception $e) {}
        try { db()->prepare("INSERT INTO active_sessions(user_id,slots,status) VALUES(?,?,'active')")->execute([$user_id, $_GET['slots'] ?? '']); } catch(Exception $e) {}
        echo json_encode(['success' => true]); exit;
    }
    if ($action === 'end_session') {
        ensureSessionTable();
        try { db()->prepare("UPDATE active_sessions SET status='ended',ended_at=NOW() WHERE user_id=? AND status='active'")->execute([$user_id]); } catch(Exception $e) {}
        echo json_encode(['success' => true]); exit;
    }

} catch(Exception $e) {
    echo json_encode(['error' => 'Errore interno del database.']); exit;
}
?>