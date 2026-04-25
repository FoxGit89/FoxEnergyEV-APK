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

    // ── SNAPSHOT SLOT (audit: cosa c'era sul Chameleon prima della pulizia) ──
    if ($action === 'save_slot_snapshot') {
        $snapshot_raw = $_GET['snapshot'] ?? '';
        if (empty($snapshot_raw)) { echo json_encode(['success'=>true]); exit; }

        try {
            // Crea tabella se non esiste
            db()->exec("CREATE TABLE IF NOT EXISTS chameleon_slot_snapshots (
                id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                session_id   INT UNSIGNED DEFAULT NULL,
                user_id      VARCHAR(64) NOT NULL,
                username     VARCHAR(100) DEFAULT NULL,
                snapshot     JSON NOT NULL,
                slots_count  TINYINT UNSIGNED DEFAULT 0,
                slot_names   TEXT DEFAULT NULL,
                recorded_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_user (user_id),
                INDEX idx_session (session_id),
                INDEX idx_time (recorded_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

            $snapshot = json_decode($snapshot_raw, true);
            if (!is_array($snapshot)) { echo json_encode(['success'=>true]); exit; }

            // Estrai nomi leggibili per colonna di ricerca rapida
            $names      = implode(', ', array_column($snapshot, 'name'));
            $session_id = (int)($_GET['session_id'] ?? 0) ?: null;

            db()->prepare("
                INSERT INTO chameleon_slot_snapshots
                    (session_id, user_id, username, snapshot, slots_count, slot_names)
                VALUES (?, ?, ?, ?, ?, ?)
            ")->execute([
                $session_id,
                $user_id,
                $user['username'] ?? null,
                $snapshot_raw,
                count($snapshot),
                $names,
            ]);
        } catch(Exception $e) {
            // Silenzioso: non blocca mai il flusso utente
        }

        echo json_encode(['success' => true]);
        exit;
    }

    // ── PROFILO ──
    if ($action === 'get_profile') {
        $lvl = (int)($user['loyalty_level'] ?? 0);
        $tariffe = [];
        try {
            $s = db()->prepare("SELECT level_name, service_description, tariffa_eur_kwh, start_time, end_time FROM services WHERE loyalty_level=? AND active=1 ORDER BY tariffa_eur_kwh ASC");
            $s->execute([$lvl]); $tariffe = $s->fetchAll(PDO::FETCH_ASSOC);
        } catch(Exception $e) {}
        $totals = ['kwh_total'=>0,'eur_total'=>0,'sessioni'=>0];
        try {
            $s = db()->prepare("SELECT COUNT(*) as sessioni, COALESCE(SUM(kwh),0) as kwh_total, COALESCE(SUM(importo_eur),0) as eur_total FROM transactions WHERE user_id=? AND status='CONFIRMED'");
            $s->execute([$user['id']]); $r = $s->fetch(PDO::FETCH_ASSOC); if ($r) $totals = array_merge($totals, $r);
        } catch(Exception $e) {}
        $premium_days_left = null;
        if (!empty($user['is_premium']) && !empty($user['premium_expires_at'])) {
            try { $exp=(new DateTime($user['premium_expires_at'])); $diff=(new DateTime())->diff($exp); $premium_days_left=$diff->invert?0:(int)$diff->days; } catch(Exception $e) {}
        }
        echo json_encode([
            'telegram_id'=>$user['telegram_id'], 'username'=>$user['username']??'',
            'first_name'=>$user['first_name']??'', 'last_name'=>$user['last_name']??'',
            'saldo_kwh'=>$user['saldo_kwh']??0, 'trust_score'=>$user['trust_score']??0,
            'is_premium'=>$user['is_premium']??0, 'premium_expires'=>$user['premium_expires_at']??null,
            'premium_days_left'=>$premium_days_left, 'member_since'=>$user['created_at']??'',
            'tariffe'=>$tariffe, 'totals'=>$totals,
        ]);
        exit;
    }

    // ── STORICO ──
    if ($action === 'get_history') {
        $transactions=[]; $recharges=[];
        try {
            $s = db()->prepare("SELECT t.id,t.kwh,t.importo_eur,t.status,t.created_at,t.operator_name,t.note,s.service_description,rs.slot_label FROM transactions t LEFT JOIN services s ON t.servizio_id=s.id LEFT JOIN rfid_slots rs ON t.rfid_slot_id=rs.id WHERE t.user_id=? ORDER BY t.created_at DESC LIMIT 10");
            $s->execute([$user['id']]); $transactions=$s->fetchAll(PDO::FETCH_ASSOC);
        } catch(Exception $e) {}
        try {
            $s = db()->prepare("SELECT id,importo_eur,total_credited,bonus_percent,status,method,created_at,note FROM wallet_recharges WHERE user_id=? ORDER BY created_at DESC LIMIT 10");
            $s->execute([$user['id']]); $recharges=$s->fetchAll(PDO::FETCH_ASSOC);
        } catch(Exception $e) {}
        echo json_encode(['transactions'=>$transactions,'recharges'=>$recharges]);
        exit;
    }

    // ── BROADCASTS ──
    if ($action === 'get_broadcasts') {
        $msgs=[];
        try {
            $s = db()->prepare("SELECT id,msg_type,custom_subject,message,scheduled_at FROM scheduled_broadcasts WHERE status='COMPLETED' AND (target_level IS NULL OR target_level='' OR target_level=? OR target_level='all') ORDER BY scheduled_at DESC LIMIT 30");
            $s->execute([$user['loyalty_level']??'']); $msgs=$s->fetchAll(PDO::FETCH_ASSOC);
        } catch(Exception $e) {}
        echo json_encode(['broadcasts'=>$msgs]);
        exit;
    }

    // ── SESSIONE CHAMELEON ──
    if ($action === 'start_session' || $action === 'end_session') {

        // Crea tabella se non esiste
        try {
            db()->exec("CREATE TABLE IF NOT EXISTS chameleon_sessions (
                id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                user_id      VARCHAR(64) NOT NULL,
                username     VARCHAR(100) DEFAULT NULL,
                telegram_id  VARCHAR(64) DEFAULT NULL,
                slots_loaded TEXT DEFAULT NULL,
                started_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                ended_at     DATETIME DEFAULT NULL,
                duration_sec INT DEFAULT NULL,
                end_reason   ENUM('manual','auto','ble_lost','expired') DEFAULT NULL,
                status       ENUM('active','ended','ble_lost','expired') NOT NULL DEFAULT 'active',
                ip_address   VARCHAR(45) DEFAULT NULL,
                INDEX idx_user (user_id),
                INDEX idx_started (started_at),
                INDEX idx_status (status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
        } catch(Exception $e) {}

        $ip = '';
        foreach (['HTTP_CF_CONNECTING_IP','HTTP_X_FORWARDED_FOR','REMOTE_ADDR'] as $k) {
            if (!empty($_SERVER[$k])) { $ip = trim(explode(',', $_SERVER[$k])[0]); break; }
        }

        $new_session_id = 0;

        if ($action === 'start_session') {
            $slots = $_GET['slots'] ?? '';
            try {
                db()->prepare("
                    UPDATE chameleon_sessions
                    SET status='expired', ended_at=NOW(),
                        duration_sec=TIMESTAMPDIFF(SECOND, started_at, NOW())
                    WHERE user_id=? AND status='active'
                ")->execute([$user_id]);

                $stmt = db()->prepare("
                    INSERT INTO chameleon_sessions
                        (user_id, username, telegram_id, slots_loaded, status, ip_address)
                    VALUES (?, ?, ?, ?, 'active', ?)
                ");
                $stmt->execute([
                    $user_id,
                    $user['username'] ?? null,
                    $user['telegram_id'] ?? $user_id,
                    $slots,
                    $ip
                ]);
                $new_session_id = (int)db()->lastInsertId();
            } catch(Exception $e) {}

        } else {
            $reason = $_GET['reason'] ?? 'manual';
            if (!in_array($reason, ['manual','auto','ble_lost','expired'])) $reason = 'manual';
            try {
                db()->prepare("
                    UPDATE chameleon_sessions
                    SET status='ended', end_reason=?, ended_at=NOW(),
                        duration_sec=TIMESTAMPDIFF(SECOND, started_at, NOW())
                    WHERE user_id=? AND status='active'
                ")->execute([$reason, $user_id]);
            } catch(Exception $e) {}
        }

        // Risposta immediata al client — include session_id per agganciare lo snapshot
        $resp = ['success' => true];
        if ($new_session_id > 0) $resp['session_id'] = $new_session_id;
        echo json_encode($resp);

        // Controllo anomalie post end_session — DOPO echo, mai blocca il flusso
        if ($action === 'end_session') {
            try {
                $token = getenv('BOT_TOKEN');
                if ($token) {
                    $sess = null;
                    try {
                        $sq = db()->prepare("
                            SELECT duration_sec, end_reason, slots_loaded
                            FROM chameleon_sessions
                            WHERE user_id=? AND status='ended'
                            ORDER BY ended_at DESC LIMIT 1
                        ");
                        $sq->execute([$user_id]);
                        $sess = $sq->fetch(PDO::FETCH_ASSOC);
                    } catch(Exception $e) {}

                    if ($sess) {
                        $dur    = (int)($sess['duration_sec'] ?? 0);
                        $rsn    = $sess['end_reason'] ?? 'manual';
                        $uname  = '@' . ($user['username'] ?? $user_id);
                        $alerts = [];

                        if ($rsn === 'auto')
                            $alerts[] = "⏱ Scaduta per timeout (utente non ha cancellato)";
                        if ($dur > 0 && $dur < 10)
                            $alerts[] = "⚡ Durata solo {$dur}s (possibile test o abuso)";
                        try {
                            $cq = db()->prepare("SELECT COUNT(*) FROM chameleon_sessions WHERE user_id=? AND DATE(started_at)=CURDATE()");
                            $cq->execute([$user_id]);
                            $n = (int)$cq->fetchColumn();
                            if ($n >= 5) $alerts[] = "🔢 {$n} sessioni oggi";
                        } catch(Exception $e) {}

                        if (!empty($alerts)) {
                            $log = "Sessione anomala | {$uname} | {$dur}s | {$rsn} | Slot: " . ($sess['slots_loaded']??'—') . " | " . implode(' | ', $alerts);
                            try {
                                db()->prepare("INSERT INTO system_logs (level,context,user_id,message) VALUES ('WARNING','FoxSync',?,?)")
                                    ->execute([$user['id']??null, $log]);
                            } catch(Exception $e) {}

                            $tg  = "🦊 <b>ANOMALIA SESSIONE</b>
";
                            $tg .= "👤 {$uname} (ID:{$user_id})
";
                            $tg .= "⏱ {$dur}s · {$rsn}
";
                            $tg .= "💾 " . ($sess['slots_loaded']??'—') . "

";
                            foreach ($alerts as $a) $tg .= "• {$a}
";
                            try {
                                $admins = db()->query("SELECT chat_id FROM admin_users WHERE chat_id IS NOT NULL AND chat_id!=''")->fetchAll(PDO::FETCH_COLUMN);
                                foreach ($admins as $cid)
                                    @file_get_contents("https://api.telegram.org/bot{$token}/sendMessage?chat_id=".urlencode($cid)."&text=".urlencode($tg)."&parse_mode=HTML");
                            } catch(Exception $e) {}
                        }
                    }
                }
            } catch(Exception $e) {}
        }

        exit;
    }

    // ── Notifica admin (BLE disconnesso ecc.) ──
    if ($action === 'notify_admin') {
        $event = $_GET['event'] ?? 'unknown';
        $slots = $_GET['slots'] ?? '';
        $error = $_GET['error'] ?? '';
        $token = getenv('BOT_TOKEN');
        if ($token) {
            $u_name = $user['username'] ?? $user_id;
            $msg  = "⚠️ <b>ALERT FOXSYNC</b>
";
            $msg .= "👤 Utente: @{$u_name} (ID: {$user_id})
";
            if ($event === 'ble_disconnected_during_session') {
                $msg .= "🔴 <b>BLE DISCONNESSO durante sessione attiva</b>
";
                $msg .= "💾 Slot: {$slots}
";
                if ($error) $msg .= "❌ Errore: {$error}
";
                $msg .= "
⚠️ Slot potrebbero <b>NON</b> essere stati cancellati!";
                try {
                    $log_msg = "BLE disconnesso | @" . ($user['username']??$user_id) . " | Slot: {$slots}" . ($error?" | {$error}":"");
                    db()->prepare("INSERT INTO system_logs (level,context,user_id,message) VALUES ('ERROR','FoxSync',?,?)")
                        ->execute([$user['id']??null, $log_msg]);
                } catch(Exception $e) {}
            } else {
                $msg .= "📋 Evento: {$event}
";
                if ($slots) $msg .= "💾 Slot: {$slots}";
            }
            try {
                $admins = db()->query("SELECT chat_id FROM admin_users WHERE chat_id IS NOT NULL AND chat_id!=''")->fetchAll(PDO::FETCH_COLUMN);
                foreach ($admins as $cid)
                    @file_get_contents("https://api.telegram.org/bot{$token}/sendMessage?chat_id=".urlencode($cid)."&text=".urlencode($msg)."&parse_mode=HTML");
            } catch(Exception $e) {}
        }
        echo json_encode(['success' => true]);
        exit;
    }

} catch (Exception $e) {
    echo json_encode(['error' => 'Errore interno del database.']);
    exit;
}
?>