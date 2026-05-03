<?php
// Disabilita la visualizzazione errori a schermo per non corrompere l'output JSON
error_reporting(0);
ini_set('display_errors', 0);

require_once 'functions.php'; 

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: no-referrer');
header('Cache-Control: no-store, no-cache, must-revalidate');

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
        // Cleanup sessioni orfane: active da > 10 min senza slot caricati (connessione non completata)
        // oppure active da > 5 min con slot caricati (sessione 60s + margine generoso)
        try {
            db()->exec("
                UPDATE chameleon_sessions
                SET status='expired', ended_at=NOW(),
                    duration_sec=TIMESTAMPDIFF(SECOND, started_at, NOW()),
                    end_reason='expired'
                WHERE status='active'
                  AND (
                      (
                          (slots_loaded IS NULL OR slots_loaded = '')
                          AND started_at < DATE_SUB(NOW(), INTERVAL 10 MINUTE)
                      )
                      OR started_at < DATE_SUB(NOW(), INTERVAL 5 MINUTE)
                  )
            ");
        } catch(Exception $e) {}

        try {
            if (!function_exists('getUserMonthlyStats')) {
                echo json_encode(['error' => 'La funzione getUserMonthlyStats() manca in functions.php!']);
                exit;
            }

            // Calcola le statistiche mensili
            $stats = getUserMonthlyStats($user_id);

            // Conteggio messaggi broadcast ultimi 7 giorni
            $unread_bc = 0;
            try {
                $bc = db()->prepare("
                    SELECT COUNT(*) FROM scheduled_broadcasts
                    WHERE status='COMPLETED'
                      AND (target_level IS NULL OR target_level='' OR target_level=? OR target_level='all')
                      AND scheduled_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
                ");
                $bc->execute([$user['loyalty_level'] ?? '']);
                $unread_bc = (int)$bc->fetchColumn();
            } catch(Exception $e) {}

            echo json_encode([
                'saldo'             => $user['saldo_kwh'] ?? 0,
                'karma'             => $user['trust_score'] ?? 0,
                'is_premium'        => $user['is_premium'] ?? 0,
                'monthly_stats'     => $stats,
                'unread_broadcasts' => $unread_bc,
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
        $u_tg    = $user['telegram_id'];
        $u_name  = $user['username'] ?? '';
        $u_score = (int)($user['trust_score'] ?? 100);
        $u_prem  = (int)($user['is_premium'] ?? 0);

        $sql = "SELECT id, slot_label, rfid_uid, promo_from, promo_to, status
                FROM rfid_slots WHERE status = 'active'
                AND (
                    (min_trust_score <= 0 AND (allowed_users IS NULL OR allowed_users = ''))
                    OR (min_trust_score > 0 AND $u_score >= min_trust_score AND $u_prem = 1)
                    OR FIND_IN_SET(" . db()->quote($u_tg) . ", allowed_users) > 0
                    OR FIND_IN_SET(" . db()->quote($u_name) . ", allowed_users) > 0
                ) ORDER BY slot_label ASC";

        $slots = db()->query($sql)->fetchAll(PDO::FETCH_ASSOC);

        foreach ($slots as &$slot) {
            $slot['roaming_detail'] = [];
            $slot['is_promo']       = false;
            try {
                // Query unificata: usati (con conteggio) + forzati is_forced=1
                $rs = db()->prepare("
                    SELECT operator_name, SUM(usage_count) as usage_count
                    FROM (
                        SELECT t.operator_name, COUNT(*) as usage_count
                        FROM transactions t
                        WHERE t.rfid_slot_id = ? AND t.status = 'CONFIRMED'
                          AND t.operator_name IS NOT NULL AND t.operator_name != 'N/D'
                        GROUP BY t.operator_name
                        UNION ALL
                        SELECT rs2.operator_name, 0 as usage_count
                        FROM roaming_settings rs2
                        WHERE rs2.rfid_slot_id = ? AND rs2.is_forced = 1
                    ) AS combined
                    GROUP BY operator_name
                    ORDER BY usage_count DESC, operator_name ASC
                ");
                $rs->execute([$slot['id'], $slot['id']]);
                $slot['roaming_detail'] = $rs->fetchAll(PDO::FETCH_ASSOC);

                // Promo attiva oggi
                if (!empty($slot['promo_from']) && !empty($slot['promo_to'])) {
                    $oggi = date('Y-m-d');
                    $slot['is_promo'] = ($oggi >= $slot['promo_from'] && $oggi <= $slot['promo_to']);
                }
            } catch(Exception $e) {}
        }
        echo json_encode($slots ?: []);
        exit;
    }

    // =========================================================
    // 4. DOWNLOAD CONTENUTO TESSERA DA TELEGRAM
    // =========================================================
    if ($action === 'get_json_content') {
        // Accetta slot_id (non file_id) — il file_id non viene mai esposto al client
        $slot_id = (int)($_GET['slot_id'] ?? 0);

        if (empty($slot_id)) {
            echo json_encode(['error' => 'Slot ID mancante.']);
            exit;
        }

        // Recupera file_id dal DB verificando che lo slot sia autorizzato per questo utente
        $file_id = null;
        try {
            $u_tg    = $user['telegram_id'];
            $u_name  = $user['username'] ?? '';
            $u_score = (int)($user['trust_score'] ?? 0);
            $u_prem  = (int)($user['is_premium'] ?? 0);
            $chk = db()->prepare("
                SELECT json_file_id FROM rfid_slots
                WHERE id = ? AND status = 'active'
                  AND (
                      (min_trust_score <= 0 AND (allowed_users IS NULL OR allowed_users = ''))
                      OR (min_trust_score > 0 AND ? >= min_trust_score AND ? = 1)
                      OR FIND_IN_SET(?, allowed_users) > 0
                      OR FIND_IN_SET(?, allowed_users) > 0
                  )
                LIMIT 1
            ");
            $chk->execute([$slot_id, $u_score, $u_prem, $u_tg, $u_name]);
            $row = $chk->fetch(PDO::FETCH_ASSOC);
            if ($row) {
                $file_id = $row['json_file_id'];
            } else {
                try { db()->prepare("INSERT INTO system_logs (level,context,user_id,message) VALUES ('WARNING','FoxSync',?,?)")->execute([$user['id']??null, "Tentativo accesso slot_id non autorizzato: {$slot_id} da {$u_tg}"]); } catch(Exception $e) {}
                echo json_encode(['error' => 'Accesso non autorizzato.']);
                exit;
            }
        } catch(Exception $e) {
            echo json_encode(['error' => 'Errore verifica slot.']);
            exit;
        }

        if (empty($file_id)) {
            echo json_encode(['error' => 'File non configurato per questo slot.']);
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
            // Migrazione: aggiunge session_id se la tabella esiste già senza quella colonna
            try {
                $has_col = db()->query("SHOW COLUMNS FROM chameleon_slot_snapshots LIKE 'session_id'")->fetchAll();
                if (empty($has_col)) {
                    db()->exec("ALTER TABLE chameleon_slot_snapshots ADD COLUMN session_id INT UNSIGNED DEFAULT NULL AFTER id, ADD INDEX idx_session (session_id)");
                }
            } catch(Exception $e) {}

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
    // ── WEB PUSH ──
    if ($action === 'get_vapid_key') {
        echo json_encode(['vapid_public_key' => getenv('VAPID_PUBLIC_KEY') ?: '']);
        exit;
    }

    if ($action === 'save_push_subscription') {
        $endpoint = $_POST['endpoint'] ?? ''; $p256dh = $_POST['p256dh'] ?? ''; $auth = $_POST['auth'] ?? '';
        if (!$endpoint || !$p256dh || !$auth) { echo json_encode(['error'=>'Dati mancanti']); exit; }
        try {
            db()->prepare("INSERT INTO push_subscriptions (user_id,endpoint,p256dh,auth) VALUES (?,?,?,?)
                ON DUPLICATE KEY UPDATE user_id=VALUES(user_id),p256dh=VALUES(p256dh),auth=VALUES(auth),created_at=NOW()")
                ->execute([$user['telegram_id'],$endpoint,$p256dh,$auth]);
            echo json_encode(['success'=>true]);

            // Invia messaggio Telegram con dati ricarica + deep link se slot usato
            if (!empty($slot_used) && !empty($operator)) {
                try {
                    $token = getenv('BOT_TOKEN');
                    if ($token && !empty($user['telegram_id'])) {
                        $sp = 'consumo'
                            . '_' . preg_replace('/[^a-zA-Z0-9]/', '', $slot_used)
                            . '_' . preg_replace('/[^a-zA-Z0-9]/', '', $operator);
                        $tg  = "⚡ <b>Dati ricarica confermati!</b>

";
                        $tg .= "📟 Tessera: <b>" . htmlspecialchars($slot_used) . "</b>
";
                        $tg .= "🔌 Gestore: <b>" . htmlspecialchars($operator) . "</b>
";
                        if (!empty($notes)) $tg .= "📝 Note: " . htmlspecialchars($notes) . "
";
                        $tg .= "\n👉 <a href=\"https://t.me/Fox_Ev_bot?start={$sp}\">Dichiara il consumo ora →</a>\n";
                        $tg .= "\n<i>Tocca il link per aprire il bot con i dati già precompilati.</i>";
                        @file_get_contents(
                            "https://api.telegram.org/bot{$token}/sendMessage"
                            . "?chat_id="  . urlencode($user['telegram_id'])
                            . "&text="     . urlencode($tg)
                            . "&parse_mode=HTML"
                            . "&disable_web_page_preview=1"
                        );
                    }
                } catch(Exception $e) {}
            }
        } catch(Exception $e) { echo json_encode(['error'=>$e->getMessage()]); }
        exit;
    }

    // ── SURVEY POST-SESSIONE ──
    if ($action === 'save_session_survey') {
        $session_id = (int)($_GET['session_id'] ?? 0);
        $slot_used  = trim($_GET['slot_used']   ?? '');
        $operator   = trim($_GET['operator']    ?? '');
        $notes      = trim($_GET['notes']       ?? '');

        if (!$session_id) {
            echo json_encode(['error' => 'session_id mancante']);
            exit;
        }
        try {
            $chk = db()->prepare("
                SELECT id FROM chameleon_sessions
                WHERE id = ? AND (user_id = ? OR telegram_id = ?)
                LIMIT 1
            ");
            $chk->execute([$session_id, $user['id'] ?? 0, $user['telegram_id'] ?? '']);
            if (!$chk->fetch()) {
                echo json_encode(['error' => 'Sessione non trovata']);
                exit;
            }
            $upd = db()->prepare("
                UPDATE chameleon_sessions
                SET survey_slot_used    = ?,
                    survey_operator     = ?,
                    survey_notes        = ?,
                    survey_completed_at = NOW()
                WHERE id = ?
            ");
            $upd->execute([
                $slot_used ?: null,
                $operator  ?: null,
                $notes     ?: null,
                $session_id
            ]);
            echo json_encode(['success' => true]);
        } catch(Exception $e) {
            echo json_encode(['error' => $e->getMessage()]);
        }
        exit;
    }

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
                latitude     DECIMAL(10,6) DEFAULT NULL,
                longitude    DECIMAL(10,6) DEFAULT NULL,
                geo_accuracy INT DEFAULT NULL,
                INDEX idx_user (user_id),
                INDEX idx_started (started_at),
                INDEX idx_status (status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
            // Migrazione: aggiunge colonne geo se tabella esiste già senza
            try {
                $cols = db()->query("SHOW COLUMNS FROM chameleon_sessions LIKE 'latitude'")->fetchAll();
                if (empty($cols)) {
                    db()->exec("ALTER TABLE chameleon_sessions
                        ADD COLUMN latitude DECIMAL(10,6) DEFAULT NULL AFTER ip_address,
                        ADD COLUMN longitude DECIMAL(10,6) DEFAULT NULL AFTER latitude,
                        ADD COLUMN geo_accuracy INT DEFAULT NULL AFTER longitude");
                }
            } catch(Exception $e) {}

            // Migrazione colonne survey post-sessione
            try {
                $hasSurvey = db()->query("SHOW COLUMNS FROM chameleon_sessions LIKE 'survey_slot_used'")->fetchAll();
                if (empty($hasSurvey)) {
                    db()->exec("ALTER TABLE chameleon_sessions
                        ADD COLUMN survey_slot_used    VARCHAR(255) DEFAULT NULL AFTER geo_accuracy,
                        ADD COLUMN survey_operator     VARCHAR(255) DEFAULT NULL AFTER survey_slot_used,
                        ADD COLUMN survey_notes        TEXT         DEFAULT NULL AFTER survey_operator,
                        ADD COLUMN survey_completed_at DATETIME     DEFAULT NULL AFTER survey_notes");
                } else {
                    // Aggiunge survey_notes se mancante (upgrade)
                    $hasNotes = db()->query("SHOW COLUMNS FROM chameleon_sessions LIKE 'survey_notes'")->fetchAll();
                    if (empty($hasNotes)) {
                        db()->exec("ALTER TABLE chameleon_sessions ADD COLUMN survey_notes TEXT DEFAULT NULL AFTER survey_operator");
                    }
                }
            } catch(Exception $e) {}
        } catch(Exception $e) {}

        $ip = '';
        foreach (['HTTP_CF_CONNECTING_IP','HTTP_X_FORWARDED_FOR','REMOTE_ADDR'] as $k) {
            if (!empty($_SERVER[$k])) { $ip = trim(explode(',', $_SERVER[$k])[0]); break; }
        }

        $new_session_id = 0;

        if ($action === 'start_session') {
            $slots = $_GET['slots'] ?? '';
            try {
                // Chiudi sessioni precedenti ancora aperte
                $exp_stmt = db()->prepare("
                    UPDATE chameleon_sessions
                    SET status='expired', ended_at=NOW(),
                        duration_sec=TIMESTAMPDIFF(SECOND, started_at, NOW())
                    WHERE user_id=? AND status='active'
                ");
                $exp_stmt->execute([$user_id]);
                $expired_count = $exp_stmt->rowCount();

                // Se c'era una sessione attiva scaduta → controlla anomalie
                if ($expired_count > 0) {
                    try {
                        $exp_sess = db()->prepare("
                            SELECT duration_sec, slots_loaded
                            FROM chameleon_sessions
                            WHERE user_id=? AND status='expired'
                            ORDER BY ended_at DESC LIMIT 1
                        ");
                        $exp_sess->execute([$user_id]);
                        $es = $exp_sess->fetch(PDO::FETCH_ASSOC);

                        if ($es) {
                            $dur    = (int)($es['duration_sec'] ?? 0);
                            $uname  = '@' . ($user['username'] ?? $user_id);
                            $token  = getenv('BOT_TOKEN');
                            $alerts = [];

                            // Sessione molto lunga (> 120s = 2 min) senza chiusura regolare
                            if ($dur > 120) {
                                $alerts[] = "⏳ Sessione durata {$dur}s senza chiusura regolare (app killata?)";
                            }
                            // Sessione scaduta con slot caricati
                            if (!empty($es['slots_loaded'])) {
                                $alerts[] = "💾 Slot erano caricati: " . $es['slots_loaded'];
                            }

                            if (!empty($alerts) && $token) {
                                // Log admin
                                $log = "Sessione EXPIRED senza chiusura | {$uname} | {$dur}s | " . implode(' | ', $alerts);
                                try {
                                    db()->prepare("INSERT INTO system_logs (level,context,user_id,message) VALUES ('WARNING','FoxSync',?,?)")
                                        ->execute([$user['id']??null, $log]);
                                } catch(Exception $e) {}

                                // Notifica admin
                                $tg  = "🦊 <b>SESSIONE NON CHIUSA REGOLARMENTE</b>
";
                                $tg .= "👤 {$uname} (ID:{$user_id})
";
                                $tg .= "⏱ Durata: {$dur}s

";
                                foreach ($alerts as $a) $tg .= "• {$a}
";
                                $tg .= "
⚠️ Probabile chiusura forzata dell'app";
                                try {
                                    $admins = db()->query("SELECT chat_id FROM admin_users WHERE chat_id IS NOT NULL AND chat_id!=''")->fetchAll(PDO::FETCH_COLUMN);
                                    foreach ($admins as $cid)
                                        @file_get_contents("https://api.telegram.org/bot{$token}/sendMessage?chat_id=".urlencode($cid)."&text=".urlencode($tg)."&parse_mode=HTML");
                                } catch(Exception $e) {}

                                // Notifica utente
                                $tg_u  = "⚠️ <b>FoxSync — Sessione interrotta</b>

";
                                $tg_u .= "La tua sessione Chameleon non è stata chiusa correttamente.

";
                                $tg_u .= "I log verranno verificati dagli amministratori.
";
                                $tg_u .= "Se hai usato le tessere, ricordati di <b>dichiarare il consumo</b> dal bot.";
                                try {
                                    if (!empty($user['telegram_id']))
                                        @file_get_contents("https://api.telegram.org/bot{$token}/sendMessage?chat_id=".urlencode($user['telegram_id'])."&text=".urlencode($tg_u)."&parse_mode=HTML");
                                } catch(Exception $e) {}
                            }
                        }
                    } catch(Exception $e) {}
                }

                $lat = !empty($_GET['lat']) ? (float)$_GET['lat'] : null;
                $lng = !empty($_GET['lng']) ? (float)$_GET['lng'] : null;
                $acc = !empty($_GET['acc']) ? (int)$_GET['acc']   : null;

                $stmt = db()->prepare("
                    INSERT INTO chameleon_sessions
                        (user_id, username, telegram_id, slots_loaded, status, ip_address, latitude, longitude, geo_accuracy)
                    VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?)
                ");
                $stmt->execute([
                    $user_id,
                    $user['username'] ?? null,
                    $user['telegram_id'] ?? $user_id,
                    $slots,
                    $ip,
                    $lat,
                    $lng,
                    $acc,
                ]);
                $new_session_id = (int)db()->lastInsertId();
            } catch(Exception $e) {}

        } else {
            $reason = $_GET['reason'] ?? 'manual';
            if (!in_array($reason, ['manual','auto','ble_lost','expired'])) $reason = 'manual';
            $slots_used = '';
            try {
                db()->prepare("
                    UPDATE chameleon_sessions
                    SET status='ended', end_reason=?, ended_at=NOW(),
                        duration_sec=TIMESTAMPDIFF(SECOND, started_at, NOW())
                    WHERE user_id=? AND status='active'
                ")->execute([$reason, $user_id]);

                // Leggi la sessione appena chiusa per il riassunto
                $sess_row = db()->prepare("
                    SELECT slots_loaded, duration_sec, started_at, ended_at
                    FROM chameleon_sessions
                    WHERE user_id=? AND status='ended'
                    ORDER BY ended_at DESC LIMIT 1
                ");
                $sess_row->execute([$user_id]);
                $closed = $sess_row->fetch(PDO::FETCH_ASSOC);

                if ($closed && !empty($closed['slots_loaded'])) {
                    $slots_used = $closed['slots_loaded'];
                    $dur        = (int)($closed['duration_sec'] ?? 0);
                    $started    = !empty($closed['started_at'])
                        ? date('H:i', strtotime($closed['started_at']))
                        : '—';
                    $ended      = !empty($closed['ended_at'])
                        ? date('H:i', strtotime($closed['ended_at']))
                        : date('H:i');

                    $reason_label = match($reason) {
                        'manual'   => 'Cancellazione manuale',
                        'auto'     => 'Timer 60s scaduto',
                        'ble_lost' => 'Bluetooth disconnesso',
                        default    => $reason,
                    };

                    $token = getenv('BOT_TOKEN');
                    if ($token && !empty($user['telegram_id'])) {
                        $dur_fmt = $dur >= 60 ? floor($dur/60).'min '.($dur%60).'s' : $dur.'s';
                        $msg  = "🦊 <b>FoxSync — Riepilogo Sessione</b>

";
                        $msg .= "⏱ <b>Durata:</b> {$dur_fmt} ({$started} → {$ended})
";
                        $msg .= "📋 <b>Chiusura:</b> {$reason_label}

";
                        $slot_list = array_filter(array_map('trim', explode(',', $slots_used)));
                        if (!empty($slot_list)) {
                            $msg .= "💾 <b>Tessere caricate:</b>
";
                            foreach ($slot_list as $sl) $msg .= "   • " . htmlspecialchars($sl) . "
";
                            $msg .= "
";
                        }
                        $msg .= "━━━━━━━━━━━━━━━
";
                        $msg .= "📱 Compila il questionario nella webapp per dichiarare il consumo.";
                        @file_get_contents(
                            "https://api.telegram.org/bot{$token}/sendMessage"
                            . "?chat_id="  . urlencode($user['telegram_id'])
                            . "&text="     . urlencode($msg)
                            . "&parse_mode=HTML"
                            . "&disable_web_page_preview=1"
                        );
                    }
                }
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
                        $dur   = (int)($sess['duration_sec'] ?? 0);
                        $rsn   = $sess['end_reason'] ?? 'manual';
                        $uname = '@' . ($user['username'] ?? $user_id);
                        $alerts = [];

                        // ANOMALIA 1: sessione < 10s (sospetta in ogni caso)
                        if ($dur > 0 && $dur < 10)
                            $alerts[] = "⚡ Sessione durata solo {$dur}s";

                        // ANOMALIA 2: 5+ sessioni oggi
                        try {
                            $cq = db()->prepare("SELECT COUNT(*) FROM chameleon_sessions WHERE user_id=? AND DATE(started_at)=CURDATE()");
                            $cq->execute([$user_id]);
                            $n = (int)$cq->fetchColumn();
                            if ($n >= 5) $alerts[] = "🔢 {$n} sessioni oggi";
                        } catch(Exception $e) {}

                        // NOTA: 'auto' (timer 60s) NON è anomalia — comportamento normale atteso

                        if (!empty($alerts)) {
                            // Log portale admin
                            $log = "Utilizzo anomalo | {$uname} | {$dur}s | motivo:{$rsn} | Slot: " . ($sess['slots_loaded']??'—') . " | " . implode(' | ', $alerts);
                            try {
                                db()->prepare("INSERT INTO system_logs (level,context,user_id,message) VALUES ('WARNING','FoxSync',?,?)")
                                    ->execute([$user['id']??null, $log]);
                            } catch(Exception $e) {}

                            // Notifica admin Telegram
                            $tg_admin  = "🦊 <b>ANOMALIA FOXSYNC</b>
";
                            $tg_admin .= "👤 {$uname} (ID:{$user_id})
";
                            $tg_admin .= "⏱ Durata: {$dur}s · Motivo: {$rsn}
";
                            $tg_admin .= "💾 Slot: " . ($sess['slots_loaded']??'—') . "

";
                            foreach ($alerts as $a) $tg_admin .= "• {$a}
";
                            try {
                                $admins = db()->query("SELECT chat_id FROM admin_users WHERE chat_id IS NOT NULL AND chat_id!=''")->fetchAll(PDO::FETCH_COLUMN);
                                foreach ($admins as $cid)
                                    @file_get_contents("https://api.telegram.org/bot{$token}/sendMessage?chat_id=".urlencode($cid)."&text=".urlencode($tg_admin)."&parse_mode=HTML");
                            } catch(Exception $e) {}

                            // Notifica utente Telegram
                            $tg_user  = "⚠️ <b>FoxSync Security Alert</b>

";
                            $tg_user .= "È stato rilevato un utilizzo anomalo del tuo Chameleon Ultra.

";
                            $tg_user .= "I log di sessione verranno verificati dagli amministratori.
";
                            $tg_user .= "Attendi un contatto da parte del team Fox Energy a riguardo.

";
                            $tg_user .= "<i>Se ritieni si tratti di un errore, contatta il supporto.</i>";
                            try {
                                if (!empty($user['telegram_id']))
                                    @file_get_contents("https://api.telegram.org/bot{$token}/sendMessage?chat_id=".urlencode($user['telegram_id'])."&text=".urlencode($tg_user)."&parse_mode=HTML");
                            } catch(Exception $e) {}
                        }
                    }
                }
            } catch(Exception $e) {}
        }

        exit;
    }

    // ── MAPPA COLONNINE OCM CON FUZZY MATCHING ──
    if ($action === 'get_map_pois') {
        $lat = $_GET['lat'] ?? '';
        $lng = $_GET['lng'] ?? '';
        $rad = $_GET['radius'] ?? 5; // km
        
        if (empty($lat) || empty($lng)) {
            echo json_encode(['error' => 'Coordinate mancanti.']);
            exit;
        }

        // 1. Estrai tutte le tessere abilitate per l'utente e i loro operatori supportati
        $u_tg    = $user['telegram_id'];
        $u_name  = $user['username'] ?? '';
        $u_score = (int)($user['trust_score'] ?? 100);
        $u_prem  = (int)($user['is_premium'] ?? 0);

        $sql = "SELECT id, slot_label, rfid_uid, promo_from, promo_to, status
                FROM rfid_slots WHERE status = 'active'
                AND (
                    (min_trust_score <= 0 AND (allowed_users IS NULL OR allowed_users = ''))
                    OR (min_trust_score > 0 AND $u_score >= min_trust_score AND $u_prem = 1)
                    OR FIND_IN_SET(" . db()->quote($u_tg) . ", allowed_users) > 0
                    OR FIND_IN_SET(" . db()->quote($u_name) . ", allowed_users) > 0
                )";
        $slots = db()->query($sql)->fetchAll(PDO::FETCH_ASSOC);

        $user_supported_ops = [];
        $slot_map = []; // op_name -> [slot_id, slot_id]

        foreach ($slots as &$slot) {
            try {
                $rs = db()->prepare("
                    SELECT operator_name, SUM(usage_count) as usage_count
                    FROM (
                        SELECT t.operator_name, COUNT(*) as usage_count
                        FROM transactions t
                        WHERE t.rfid_slot_id = ? AND t.status = 'CONFIRMED'
                          AND t.operator_name IS NOT NULL AND t.operator_name != 'N/D'
                        GROUP BY t.operator_name
                        UNION ALL
                        SELECT rs2.operator_name, 0 as usage_count
                        FROM roaming_settings rs2
                        WHERE rs2.rfid_slot_id = ? AND rs2.is_forced = 1
                    ) AS combined
                    GROUP BY operator_name
                    ORDER BY usage_count DESC, operator_name ASC
                ");
                $rs->execute([$slot['id'], $slot['id']]);
                $ops = $rs->fetchAll(PDO::FETCH_ASSOC);
                
                foreach ($ops as $op) {
                    $op_name = strtolower(trim($op['operator_name']));
                    if (!in_array($op_name, $user_supported_ops)) {
                        $user_supported_ops[] = $op_name;
                    }
                    if (!isset($slot_map[$op_name])) $slot_map[$op_name] = [];
                    $slot_map[$op_name][] = $slot['slot_label'];
                }
            } catch(Exception $e) {}
        }

        // Array di normalizzazione Fuzzy
        $op_norm = [
          'enelx' => ['enel x','enel','juicepass','e-distribuzione','endesa','enel x way'],
          'enel x' => ['enel x','enel','juicepass','enel x way'],
          'enel x / ewiva' => ['enel','ewiva'],
          'plenitude' => ['plenitude','be charge','becharge','be_charge','be power','bepower','be-charge','eni gas','eni plenitude','plenitude on the road'],
          'f2x' => ['free to x','free2x','f2x','freetox','autostrade'],
          'free2x' => ['free to x','free2x','f2x'],
          'free to x' => ['free to x','free2x','f2x'],
          'freetox' => ['free to x','free2x','f2x'],
          'atlante' => ['atlante','nhoa'],
          'electra' => ['electra'],
          'electriese' => ['electra'],
          'alectriase' => ['electra'],
          'electriase' => ['electra'],
          'electra france' => ['electra'],
          'duferco' => ['duferco','duferco energia'],
          'a2a' => ['a2a','a2a energia','a2a smart city'],
          'ionity' => ['ionity'],
          'ewiva' => ['ewiva','volkswagen','vw'],
          'acea' => ['acea'],
          'allego' => ['allego','nuon'],
          'ayvens' => ['ayvens','arval','leaseplan'],
          'ges' => ['ges','gestione energie'],
          'iplanet' => ['ip planet','iplanet','ip charge','italiana petroli'],
          'ip planet' => ['ip planet','iplanet'],
          'ip' => ['ip planet','iplanet','ip charge'],
          'fastned' => ['fastned'],
          'enel x way' => ['enel x way','enel x','enel','juicepass']
        ];

        // Normalizza keywords supportate per utente
        $user_keywords = [];
        foreach ($user_supported_ops as $op) {
            $norm_list = $op_norm[$op] ?? [$op];
            foreach ($norm_list as $kw) {
                if (!in_array($kw, $user_keywords)) {
                    $user_keywords[] = $kw;
                }
            }
        }

        // 2. Chiamata a OpenChargeMap
        $ocm_key = getenv('OCM_API_KEY');
        if (empty($ocm_key)) {
            echo json_encode(['error' => 'Chiave API OCM mancante nel server.']);
            exit;
        }

        $ocm_url = "https://api.openchargemap.io/v3/poi?output=json&latitude={$lat}&longitude={$lng}&distance={$rad}&distanceunit=KM&maxresults=150&verbose=false";
        
        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $ocm_url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, 1);
        curl_setopt($ch, CURLOPT_TIMEOUT, 15);
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            "X-API-Key: {$ocm_key}",
            "User-Agent: FoxSync-App"
        ]);
        $response = curl_exec($ch);
        curl_close($ch);

        $pois = json_decode($response, true);
        if (!is_array($pois)) $pois = [];

        // 3. Valutazione POI
        $filtered_pois = [];
        foreach ($pois as $poi) {
            $lat_poi = $poi['AddressInfo']['Latitude'] ?? 0;
            $lng_poi = $poi['AddressInfo']['Longitude'] ?? 0;
            $title = $poi['AddressInfo']['Title'] ?? '';
            $operator = $poi['OperatorInfo']['Title'] ?? '';

            // Estrai info sulle prese
            $connections = [];
            if (isset($poi['Connections']) && is_array($poi['Connections'])) {
                foreach ($poi['Connections'] as $conn) {
                    $type = $conn['ConnectionType']['Title'] ?? 'Sconosciuta';
                    $type = str_replace(' (Mennekes) - Tethered Cable', '', $type);
                    $type = str_replace(' (Mennekes) - Socket', '', $type);
                    $type = str_replace('CCS (Type 2)', 'CCS', $type);
                    $qty = $conn['Quantity'] ?? 1;
                    $power = isset($conn['PowerKW']) ? round($conn['PowerKW']) . 'kW' : '';
                    
                    $conn_str = "{$qty}x {$type}";
                    if ($power) {
                        $conn_str .= " ({$power})";
                    }
                    $connections[] = $conn_str;
                }
            }
            $connections_info = empty($connections) ? 'Nessuna info prese' : implode(', ', $connections);
            
            // Unisci title e operator in lowercase per la ricerca
            $search_str = strtolower($title . ' ' . $operator);
            
            $is_supported = false;
            $matched_slots = [];
            
            foreach ($user_keywords as $kw) {
                if (strpos($search_str, $kw) !== false) {
                    $is_supported = true;
                    // Raccogli slot
                    foreach ($slot_map as $op_name => $s_labels) {
                        $norm_list = $op_norm[$op_name] ?? [$op_name];
                        if (in_array($kw, $norm_list)) {
                            foreach ($s_labels as $sl) {
                                if (!in_array($sl, $matched_slots)) {
                                    $matched_slots[] = $sl;
                                }
                            }
                        }
                    }
                }
            }
            
            $filtered_pois[] = [
                'id' => $poi['ID'],
                'lat' => $lat_poi,
                'lng' => $lng_poi,
                'title' => $title,
                'operator' => $operator,
                'connections_info' => $connections_info,
                'is_supported' => $is_supported,
                'matched_slots' => $matched_slots
            ];
        }

        echo json_encode(['pois' => $filtered_pois]);
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