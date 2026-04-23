<?php
error_reporting(0);
ini_set('display_errors', 0);

require_once 'functions.php';

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

// Gestione preflight CORS
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$action = $_GET['action'] ?? '';

// =========================================================
// HELPER: legge parametri da POST (JSON body) o GET
// =========================================================
function getParam(string $key, string $default = ''): string {
    static $postBody = null;
    if ($postBody === null) {
        $raw = file_get_contents('php://input');
        $postBody = ($raw !== false && $raw !== '') ? (json_decode($raw, true) ?? []) : [];
    }
    if (isset($postBody[$key])) return (string)$postBody[$key];
    return isset($_GET[$key]) ? (string)$_GET[$key] : $default;
}

// =========================================================
// RATE LIMITING
// Max 5 tentativi per IP in 15 minuti
// La tabella viene creata automaticamente al primo utilizzo
// =========================================================
function ensureRateLimitTable(): void {
    static $created = false;
    if ($created) return;
    try {
        db()->exec("
            CREATE TABLE IF NOT EXISTS login_attempts (
                id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                ip           VARCHAR(45) NOT NULL,
                attempted_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_ip_time (ip, attempted_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        ");
        $created = true;
    } catch (Exception $e) {}
}

function checkRateLimit(string $ip): array {
    ensureRateLimitTable();
    $window   = 15 * 60; // secondi
    $maxTries = 5;
    $since    = date('Y-m-d H:i:s', time() - $window);

    $stmt = db()->prepare("SELECT COUNT(*) FROM login_attempts WHERE ip = ? AND attempted_at > ?");
    $stmt->execute([$ip, $since]);
    $count = (int)$stmt->fetchColumn();

    if ($count >= $maxTries) {
        $oldest = db()->prepare(
            "SELECT attempted_at FROM login_attempts WHERE ip = ? AND attempted_at > ? ORDER BY attempted_at ASC LIMIT 1"
        );
        $oldest->execute([$ip, $since]);
        $oldestTime = $oldest->fetchColumn();
        $waitMin    = max(1, (int)ceil((strtotime($oldestTime) + $window - time()) / 60));
        return ['blocked' => true, 'wait_minutes' => $waitMin];
    }

    return ['blocked' => false, 'remaining' => $maxTries - $count];
}

function recordLoginAttempt(string $ip): void {
    ensureRateLimitTable();
    try {
        db()->prepare("INSERT INTO login_attempts (ip) VALUES (?)")->execute([$ip]);
    } catch (Exception $e) {}
}

function clearLoginAttempts(string $ip): void {
    ensureRateLimitTable();
    try {
        db()->prepare("DELETE FROM login_attempts WHERE ip = ?")->execute([$ip]);
    } catch (Exception $e) {}
}

function getClientIp(): string {
    foreach (['HTTP_CF_CONNECTING_IP', 'HTTP_X_FORWARDED_FOR', 'REMOTE_ADDR'] as $k) {
        if (!empty($_SERVER[$k])) return trim(explode(',', $_SERVER[$k])[0]);
    }
    return '0.0.0.0';
}

// =========================================================
// 1. LOGIN  — solo POST
// =========================================================
if ($action === 'login') {

    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        http_response_code(405);
        echo json_encode(['success' => false, 'error' => 'Metodo non consentito.']);
        exit;
    }

    $ip    = getClientIp();
    $input = ltrim(trim(getParam('username')), '@');
    $card  = getParam('card_number');

    if (empty($input) || empty($card)) {
        echo json_encode(['success' => false, 'error' => 'Compila tutti i campi richiesti.']);
        exit;
    }

    // Controlla rate limit prima di interrogare il DB
    $rl = checkRateLimit($ip);
    if ($rl['blocked']) {
        echo json_encode([
            'success'      => false,
            'error'        => "Troppi tentativi falliti. Riprova tra {$rl['wait_minutes']} minuti.",
            'rate_limited' => true,
        ]);
        exit;
    }

    $stmt = db()->prepare(
        "SELECT telegram_id, first_name FROM users WHERE (username = ? OR telegram_id = ?) AND card_number = ?"
    );
    $stmt->execute([$input, $input, $card]);
    $u = $stmt->fetch(PDO::FETCH_ASSOC);

    if ($u) {
        // Controlla kill-switch
        try {
            $lic = db()->prepare("SELECT app_access FROM users WHERE telegram_id = ?");
            $lic->execute([$u['telegram_id']]);
            $access = $lic->fetchColumn();
            if ($access !== false && (int)$access === 0) {
                echo json_encode(['success' => false, 'error' => 'Licenza INFOSYNC scaduta o revocata.']);
                exit;
            }
        } catch (Exception $e) {}

        clearLoginAttempts($ip); // reset contatore su login riuscito
        echo json_encode([
            'success'     => true,
            'telegram_id' => $u['telegram_id'],
            'first_name'  => $u['first_name'],
        ]);
    } else {
        recordLoginAttempt($ip);

        // Mostra quanti tentativi rimangono (solo se pochi)
        $rlAfter   = checkRateLimit($ip);
        $remaining = !$rlAfter['blocked'] ? ($rlAfter['remaining'] ?? 0) : 0;
        $extra     = ($remaining > 0 && $remaining <= 2)
            ? " ({$remaining} " . ($remaining === 1 ? 'tentativo rimasto' : 'tentativi rimasti') . ")"
            : '';

        echo json_encode(['success' => false, 'error' => "Credenziali errate. Verifica Username e Numero Tessera.{$extra}"]);
    }
    exit;
}

// =========================================================
// 1.5 KILL-SWITCH LICENZA
// =========================================================
if ($action === 'check_license') {
    $user_id = $_GET['user_id'] ?? '';
    try {
        $stmt = db()->prepare("SELECT app_access FROM users WHERE telegram_id = ?");
        $stmt->execute([$user_id]);
        $row        = $stmt->fetch(PDO::FETCH_ASSOC);
        $has_access = isset($row['app_access']) ? (int)$row['app_access'] : 1;
        echo json_encode(['access' => $has_access === 1]);
    } catch (Exception $e) {
        echo json_encode(['access' => true]);
    }
    exit;
}

// =========================================================
// 2. BARRIERA DI SICUREZZA
// =========================================================
$user_id = $_GET['user_id'] ?? '';

if (empty($user_id)) {
    echo json_encode(['error' => 'User ID mancante nella richiesta.']);
    exit;
}

try {
    $stmt = db()->prepare("SELECT * FROM users WHERE telegram_id = ?");
    $stmt->execute([$user_id]);
    $user = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$user) {
        echo json_encode(['error' => 'Utente non registrato o non autorizzato.']);
        exit;
    }

    // =========================================================
    // 2.5 DASHBOARD
    // =========================================================
    if ($action === 'get_dashboard') {
        try {
            if (!function_exists('getUserMonthlyStats')) {
                echo json_encode(['error' => 'La funzione getUserMonthlyStats() manca in functions.php!']);
                exit;
            }
            $stats = getUserMonthlyStats($user_id);
            echo json_encode([
                'saldo'         => $user['saldo_kwh'] ?? 0,
                'karma'         => $user['trust_score'] ?? 0,
                'is_premium'    => $user['is_premium'] ?? 0,
                'monthly_stats' => $stats,
            ]);
            exit;
        } catch (\Throwable $e) {
            echo json_encode(['error' => 'CRASH PHP: ' . $e->getMessage()]);
            exit;
        }
    }

    // =========================================================
    // 3. SLOT AUTORIZZATI
    // FIX: rimosso db()->quote() dai parametri — passava le
    // stringhe con virgolette dentro il prepared statement,
    // causando FIND_IN_SET('\'123456\'', allowed_users) = 0 sempre
    // =========================================================
    if ($action === 'get_slots') {
        $u_tg    = (string)$user['telegram_id'];
        $u_name  = (string)($user['username'] ?? '');
        $u_score = (int)($user['trust_score'] ?? 100);
        $u_prem  = (int)($user['is_premium'] ?? 0);

        $stmt = db()->prepare("
            SELECT id, slot_label, json_file_id
            FROM rfid_slots
            WHERE status IN ('active', 'suspended')
            AND (
                (min_trust_score <= 0 AND (allowed_users IS NULL OR allowed_users = ''))
                OR (min_trust_score > 0 AND ? >= min_trust_score AND ? = 1)
                OR FIND_IN_SET(?, allowed_users) > 0
                OR FIND_IN_SET(?, allowed_users) > 0
            )
            ORDER BY slot_label ASC
        ");
        $stmt->execute([$u_score, $u_prem, $u_tg, $u_name]);
        $slots = $stmt->fetchAll(PDO::FETCH_ASSOC);
        echo json_encode($slots ?: []);
        exit;
    }

    // =========================================================
    // 4. DOWNLOAD TESSERA DA TELEGRAM
    // =========================================================
    if ($action === 'get_json_content') {
        $file_id = $_GET['file_id'] ?? '';

        if (empty($file_id)) {
            echo json_encode(['error' => 'File ID mancante.']);
            exit;
        }

        $token = getenv('BOT_TOKEN');
        if (empty($token)) {
            echo json_encode(['error' => 'Variabile BOT_TOKEN non trovata su Railway!']);
            exit;
        }

        $tg_response = @file_get_contents(
            "https://api.telegram.org/bot{$token}/getFile?file_id=" . urlencode($file_id)
        );
        if (!$tg_response) {
            echo json_encode(['error' => 'Errore di comunicazione con Telegram.']);
            exit;
        }

        $getFile = json_decode($tg_response, true);
        if (!$getFile || empty($getFile['result']['file_path'])) {
            echo json_encode(['error' => 'Il file JSON è scaduto sui server di Telegram. Ricarica la configurazione.']);
            exit;
        }

        $path    = $getFile['result']['file_path'];
        $content = @file_get_contents("https://api.telegram.org/file/bot{$token}/{$path}");

        if (!$content) {
            echo json_encode(['error' => 'Impossibile scaricare il file.']);
            exit;
        }
        echo $content;
        exit;
    }

    // =========================================================
    // 5. STORICO SESSIONI
    // =========================================================
    if ($action === 'get_history') {
        try {
            $limit        = min((int)($_GET['limit'] ?? 10), 50);
            $sessions     = [];
            $transactions = [];

            try {
                $stmt = db()->prepare("
                    SELECT cs.id, cs.start_time, cs.end_time, cs.energy_kwh, cs.status, rs.slot_label
                    FROM charging_sessions cs
                    LEFT JOIN rfid_slots rs ON cs.slot_id = rs.id
                    JOIN users u ON cs.user_id = u.id
                    WHERE u.telegram_id = ?
                    ORDER BY cs.start_time DESC
                    LIMIT ?
                ");
                $stmt->execute([$user_id, $limit]);
                $sessions = $stmt->fetchAll(PDO::FETCH_ASSOC);
            } catch (Exception $e) {}

            try {
                $stmt2 = db()->prepare("
                    SELECT t.id, t.created_at, t.kwh, t.importo_eur, t.status, t.description
                    FROM transactions t
                    JOIN users u ON (t.user_id = u.id OR t.user_id = u.telegram_id)
                    WHERE u.telegram_id = ?
                    AND t.status = 'CONFIRMED'
                    ORDER BY t.created_at DESC
                    LIMIT ?
                ");
                $stmt2->execute([$user_id, $limit]);
                $transactions = $stmt2->fetchAll(PDO::FETCH_ASSOC);
            } catch (Exception $e2) {}

            $history = [];

            foreach ($sessions as $s) {
                $duration = null;
                if (!empty($s['start_time']) && !empty($s['end_time'])) {
                    $diff     = strtotime($s['end_time']) - strtotime($s['start_time']);
                    $duration = sprintf('%dh %02dm', floor($diff / 3600), floor(($diff % 3600) / 60));
                }
                $history[] = [
                    'id'         => $s['id'],
                    'type'       => 'session',
                    'date'       => $s['start_time'],
                    'kwh'        => $s['energy_kwh'] ? number_format((float)$s['energy_kwh'], 2, '.', '') : null,
                    'eur'        => null,
                    'status'     => $s['status'],
                    'slot_label' => $s['slot_label'] ?? 'Colonnina',
                    'duration'   => $duration,
                ];
            }

            foreach ($transactions as $t) {
                $history[] = [
                    'id'         => $t['id'],
                    'type'       => 'transaction',
                    'date'       => $t['created_at'],
                    'kwh'        => $t['kwh'] ? number_format((float)$t['kwh'], 2, '.', '') : null,
                    'eur'        => $t['importo_eur'] ? number_format((float)$t['importo_eur'], 2, '.', '') : null,
                    'status'     => $t['status'],
                    'slot_label' => $t['description'] ?? 'Ricarica',
                    'duration'   => null,
                ];
            }

            usort($history, fn($a, $b) => strtotime($b['date']) - strtotime($a['date']));
            echo json_encode(['history' => array_slice($history, 0, $limit)]);
            exit;

        } catch (Exception $e) {
            echo json_encode(['error' => 'Errore storico: ' . $e->getMessage()]);
            exit;
        }
    }

    // =========================================================
    // 6. NOTIFICHE
    // =========================================================
    if ($action === 'get_notifications') {
        try {
            $notifications = [];

            try {
                $stmt = db()->prepare("
                    SELECT b.id, b.message, b.created_at, b.type
                    FROM broadcasts b
                    WHERE b.is_sent = 1
                    AND (b.target_user_id IS NULL OR b.target_user_id = ?)
                    ORDER BY b.created_at DESC LIMIT 20
                ");
                $stmt->execute([$user_id]);
                foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
                    $notifications[] = [
                        'id' => $r['id'], 'source' => 'admin',
                        'message' => $r['message'], 'date' => $r['created_at'],
                        'type' => $r['type'] ?? 'info',
                    ];
                }
            } catch (Exception $e) {}

            try {
                $stmt2 = db()->prepare("
                    SELECT cs.id, cs.created_at, cs.status, rs.slot_label
                    FROM charging_sessions cs
                    LEFT JOIN rfid_slots rs ON cs.slot_id = rs.id
                    JOIN users u ON cs.user_id = u.id
                    WHERE u.telegram_id = ?
                    AND cs.status IN ('pending', 'pending_approval')
                    ORDER BY cs.created_at DESC LIMIT 5
                ");
                $stmt2->execute([$user_id]);
                foreach ($stmt2->fetchAll(PDO::FETCH_ASSOC) as $p) {
                    $notifications[] = [
                        'id'      => 'pending_' . $p['id'],
                        'source'  => 'system',
                        'message' => 'Sessione su "' . ($p['slot_label'] ?? 'colonnina') . '" in attesa di approvazione.',
                        'date'    => $p['created_at'],
                        'type'    => 'warning',
                    ];
                }
            } catch (Exception $e2) {}

            $saldo = (float)($user['saldo_kwh'] ?? 0);
            if ($saldo > 0 && $saldo < 2.0) {
                $notifications[] = [
                    'id'      => 'low_balance',
                    'source'  => 'system',
                    'message' => 'Il tuo credito è quasi esaurito (' . number_format($saldo, 2) . ' kWh rimanenti). Ricarica il wallet.',
                    'date'    => date('Y-m-d H:i:s'),
                    'type'    => 'warning',
                ];
            }

            usort($notifications, fn($a, $b) => strtotime($b['date']) - strtotime($a['date']));
            echo json_encode(['notifications' => $notifications, 'unread' => count($notifications)]);
            exit;

        } catch (Exception $e) {
            echo json_encode(['error' => 'Errore notifiche: ' . $e->getMessage()]);
            exit;
        }
    }

} catch (Exception $e) {
    echo json_encode(['error' => 'Errore interno del database.']);
    exit;
}
?>
