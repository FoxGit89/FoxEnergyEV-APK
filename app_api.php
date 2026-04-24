<?php
// Disabilita la visualizzazione errori a schermo per non corrompere l'output JSON
error_reporting(0);
ini_set('display_errors', 0);

require_once 'functions.php'; 

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *'); 

$action = $_GET['action'] ?? '';

// =========================================================
// 1. GESTIONE LOGIN (Con Username + Numero Tessera)
// =========================================================
if ($action === 'login') {
    $input = $_GET['username'] ?? '';
    $input = ltrim(trim($input), '@');
    $card = $_GET['card_number'] ?? ''; // <--- NUOVO CAMPO
    
    if (empty($card)) {
        echo json_encode(['success' => false, 'error' => 'Inserisci il Numero della tua Tessera Fox Energy.']);
        exit;
    }

    // 🕵️‍♂️ Controllo incrociato: Username/ID + Numero Tessera
    $stmt = db()->prepare("SELECT telegram_id, first_name FROM users WHERE (username = ? OR telegram_id = ?) AND card_number = ?");
    $stmt->execute([$input, $input, $card]);
    $u = $stmt->fetch(PDO::FETCH_ASSOC);
    
    if ($u) {
        // Controllo se l'utente è stato bloccato dal Kill-Switch
        try {
            $lic_check = db()->query("SELECT app_access FROM users WHERE telegram_id = " . db()->quote($u['telegram_id']))->fetchColumn();
            if ($lic_check !== false && $lic_check == 0) {
                echo json_encode(['success' => false, 'error' => 'Licenza INFOSYNC scaduta o revocata.']);
                exit;
            }
        } catch (Exception $e) {}

        echo json_encode(['success' => true, 'telegram_id' => $u['telegram_id'], 'first_name' => $u['first_name']]);
    } else {
        echo json_encode(['success' => false, 'error' => 'Credenziali errate. Verifica Username e Numero Tessera.']);
    }
    exit;
}

// =========================================================
// 1.5 CONTROLLO LICENZA IN TEMPO REALE (KILL-SWITCH)
// =========================================================
if ($action === 'check_license') {
    $user_id = $_GET['user_id'] ?? '';
    try {
        $user = db()->query("SELECT app_access FROM users WHERE telegram_id = " . db()->quote($user_id))->fetch(PDO::FETCH_ASSOC);
        $has_access = isset($user['app_access']) ? (int)$user['app_access'] : 1; 
        echo json_encode(['access' => $has_access === 1]);
    } catch (Exception $e) {
        // Se la colonna non esiste, di default lasciamo passare
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
    $user = db()->query("SELECT * FROM users WHERE telegram_id = " . db()->quote($user_id))->fetch(PDO::FETCH_ASSOC);

    if (!$user) {
        echo json_encode(['error' => 'Utente non registrato o non autorizzato.']);
        exit;
    }

    // =========================================================
    // 2.5 DASHBOARD FINANZIARIA & STORICO TRANSAZIONI
    // =========================================================
    if ($action === 'get_dashboard') {
        try {
            if (!function_exists('getUserMonthlyStats')) {
                echo json_encode(['error' => 'La funzione getUserMonthlyStats() manca in functions.php!']);
                exit;
            }

            // Calcola le statistiche mensili
            $stats = getUserMonthlyStats($user_id);

            echo json_encode([
                'saldo' => $user['saldo_kwh'] ?? 0,
                'karma' => $user['trust_score'] ?? 0,
                'is_premium' => $user['is_premium'] ?? 0,
                'monthly_stats' => $stats
            ]);
            exit;

        } catch (\Throwable $e) {
            echo json_encode(['error' => 'CRASH PHP: ' . $e->getMessage()]);
            exit;
        }
    }

    // =========================================================
    // 3. INVIO LISTA SLOT AUTORIZZATI
    // =========================================================
    if ($action === 'get_slots') {
        $u_tg = $user['telegram_id'];
        $u_name = $user['username'] ?? '';
        $u_score = $user['trust_score'] ?? 100;
        $u_prem = $user['is_premium'] ?? 0;

        $sql = "SELECT id, slot_label, json_file_id FROM rfid_slots WHERE status IN ('active', 'suspended') 
                AND (
                    (min_trust_score <= 0 AND (allowed_users IS NULL OR allowed_users = ''))
                    OR (min_trust_score > 0 AND $u_score >= min_trust_score AND $u_prem = 1)
                    OR FIND_IN_SET(" . db()->quote($u_tg) . ", allowed_users) > 0 
                    OR FIND_IN_SET(" . db()->quote($u_name) . ", allowed_users) > 0
                ) ORDER BY slot_label ASC";

        $slots = db()->query($sql)->fetchAll(PDO::FETCH_ASSOC);
        echo json_encode($slots ?: []);
        exit;
    }

    // =========================================================
    // 4. DOWNLOAD CONTENUTO TESSERA DA TELEGRAM
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
        
        $tg_response = @file_get_contents("https://api.telegram.org/bot$token/getFile?file_id=$file_id");
        if (!$tg_response) {
            echo json_encode(['error' => 'Errore di comunicazione con Telegram.']);
            exit;
        }
        
        $getFile = json_decode($tg_response, true);
        if (!$getFile || empty($getFile['result']['file_path'])) {
            echo json_encode(['error' => 'Il file JSON è scaduto sui server di Telegram. Ricarica la configurazione.']);
            exit;
        }
        
        $path = $getFile['result']['file_path'];
        $content = @file_get_contents("https://api.telegram.org/file/bot$token/$path");
        
        if (!$content) {
            echo json_encode(['error' => 'Impossibile scaricare il file.']);
            exit;
        }
        echo $content;
        exit;
    }

    // ── Notifica tutti gli admin da tabella admin_users.chat_id ──
    if ($action === 'notify_admin') {
        $event = $_GET['event'] ?? 'unknown';
        $slots = $_GET['slots'] ?? '';
        $error = $_GET['error'] ?? '';
        $token = getenv('BOT_TOKEN');

        if ($token) {
            $u_name = $user['username'] ?? $user_id;
            $msg = "⚠️ <b>ALERT CALISYNC</b>\n";
            $msg .= "👤 Utente: @{$u_name} (ID: {$user_id})\n";
            if ($event === 'ble_disconnected_during_session') {
                $msg .= "🔴 Evento: <b>BLE DISCONNESSO durante sessione attiva</b>\n";
                $msg .= "💾 Slot caricati: {$slots}\n";
                if ($error) $msg .= "❌ Errore: {$error}\n";
                $msg .= "\n⚠️ Gli slot potrebbero <b>NON</b> essere stati cancellati!";
            } else {
                $msg .= "📋 Evento: {$event}\n";
                if ($slots) $msg .= "💾 Slot: {$slots}";
            }

            // Leggi tutti gli admin_chat_id dalla tabella admin_users
            try {
                $admins = db()->query("SELECT chat_id FROM admin_users WHERE chat_id IS NOT NULL AND chat_id != ''")->fetchAll(PDO::FETCH_COLUMN);
                foreach ($admins as $chat_id) {
                    @file_get_contents(
                        "https://api.telegram.org/bot{$token}/sendMessage?chat_id=" . urlencode($chat_id) .
                        "&text=" . urlencode($msg) . "&parse_mode=HTML"
                    );
                }
            } catch (Exception $e) {
                // Tabella non trovata o errore: ignora silenziosamente
            }
        }
        echo json_encode(['success' => true]);
        exit;
    }


    // ── Sessione sicura ──
    if ($action === 'start_session' || $action === 'end_session') {
        try {
            db()->exec("CREATE TABLE IF NOT EXISTS active_sessions(id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, user_id VARCHAR(64), status VARCHAR(20) DEFAULT 'active', started_at DATETIME DEFAULT CURRENT_TIMESTAMP, ended_at DATETIME) ENGINE=InnoDB");
            if ($action === 'start_session') {
                db()->prepare("UPDATE active_sessions SET status='expired',ended_at=NOW() WHERE user_id=? AND status='active'")->execute([$user_id]);
                db()->prepare("INSERT INTO active_sessions(user_id,status) VALUES(?,'active')")->execute([$user_id]);
            } else {
                db()->prepare("UPDATE active_sessions SET status='ended',ended_at=NOW() WHERE user_id=? AND status='active'")->execute([$user_id]);
            }
        } catch(Exception $e) {}
        echo json_encode(['success' => true]);
        exit;
    }


} catch (Exception $e) {
    echo json_encode(['error' => 'Errore interno del database.']);
    exit;
}
?>