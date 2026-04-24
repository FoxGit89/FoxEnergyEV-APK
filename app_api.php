<?php
error_reporting(0);
ini_set('display_errors', 0);
require_once 'functions.php';

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

$action = $_GET['action'] ?? '';

// =========================================================
// LOGIN
// =========================================================
if ($action === 'login') {
    $input = ltrim(trim($_GET['username'] ?? ''), '@');
    $card  = $_GET['card_number'] ?? '';
    if (empty($card)) { echo json_encode(['success'=>false,'error'=>'Inserisci il Numero della tua Tessera Fox Energy.']); exit; }
    $stmt = db()->prepare("SELECT telegram_id, first_name FROM users WHERE (username=? OR telegram_id=?) AND card_number=?");
    $stmt->execute([$input,$input,$card]);
    $u = $stmt->fetch(PDO::FETCH_ASSOC);
    if ($u) {
        try {
            $ac = db()->prepare("SELECT app_access FROM users WHERE telegram_id=?");
            $ac->execute([$u['telegram_id']]);
            $v = $ac->fetchColumn();
            if ($v !== false && (int)$v === 0) { echo json_encode(['success'=>false,'error'=>'Licenza CALISYNC scaduta o revocata.']); exit; }
        } catch(Exception $e) {}
        echo json_encode(['success'=>true,'telegram_id'=>$u['telegram_id'],'first_name'=>$u['first_name']]);
    } else {
        echo json_encode(['success'=>false,'error'=>'Credenziali errate. Verifica Username e Numero Tessera.']);
    }
    exit;
}

// =========================================================
// KILL-SWITCH
// =========================================================
if ($action === 'check_license') {
    $uid = $_GET['user_id'] ?? '';
    try {
        $s = db()->prepare("SELECT app_access FROM users WHERE telegram_id=?");
        $s->execute([$uid]);
        $r = $s->fetch(PDO::FETCH_ASSOC);
        echo json_encode(['access' => isset($r['app_access']) ? (int)$r['app_access']===1 : true]);
    } catch(Exception $e) { echo json_encode(['access'=>true]); }
    exit;
}

// =========================================================
// BARRIERA
// =========================================================
$user_id = $_GET['user_id'] ?? '';
if (empty($user_id)) { echo json_encode(['error'=>'User ID mancante.']); exit; }

try {
    $s = db()->prepare("SELECT * FROM users WHERE telegram_id=?");
    $s->execute([$user_id]);
    $user = $s->fetch(PDO::FETCH_ASSOC);
    if (!$user) { echo json_encode(['error'=>'Utente non autorizzato.']); exit; }

    // =========================================================
    // DASHBOARD — completa con tariffa e badge broadcast
    // =========================================================
    if ($action === 'get_dashboard') {
        $stats = getUserMonthlyStats($user_id);

        // Tariffa attiva per l'utente (giorno, ora, livello loyalty)
        $tariffa = null;
        try {
            $dow  = (int)date('N');
            $ora  = date('H:i:s');
            $oggi = date('Y-m-d');
            $lvl  = (int)($user['loyalty_level'] ?? 0);
            $ts = db()->prepare("
                SELECT level_name, service_description, tariffa_eur_kwh
                FROM services
                WHERE loyalty_level=? AND active=1
                  AND FIND_IN_SET(?,allowed_days)>0
                  AND start_time<=? AND end_time>=?
                  AND (start_date IS NULL OR start_date<=?)
                  AND (end_date IS NULL OR end_date>=?)
                ORDER BY tariffa_eur_kwh ASC LIMIT 1
            ");
            $ts->execute([$lvl,$dow,$ora,$ora,$oggi,$oggi]);
            $tariffa = $ts->fetch(PDO::FETCH_ASSOC);
        } catch(Exception $e) {}

        // Conteggio broadcast ultimi 7 giorni
        $unread_bc = 0;
        try {
            $bs = db()->prepare("
                SELECT COUNT(*) FROM scheduled_broadcasts
                WHERE status='COMPLETED'
                  AND (target_level IS NULL OR target_level='' OR target_level=? OR target_level='all')
                  AND scheduled_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
            ");
            $bs->execute([$user['loyalty_level'] ?? '']);
            $unread_bc = (int)$bs->fetchColumn();
        } catch(Exception $e) {}

        echo json_encode([
            'saldo'             => $user['saldo_kwh'] ?? 0,
            'karma'             => $user['trust_score'] ?? 0,
            'is_premium'        => $user['is_premium'] ?? 0,
            'premium_expires'   => $user['premium_expires_at'] ?? null,
            'loyalty_level'     => $user['loyalty_level'] ?? 0,
            'status'            => $user['status'] ?? 'active',
            'can_overdraft'     => $user['can_overdraft'] ?? 0,
            'monthly_stats'     => $stats,
            'tariffa'           => $tariffa,
            'unread_broadcasts' => $unread_bc,
        ]);
        exit;
    }

    // =========================================================
    // SLOT — con operatori roaming e promo
    // =========================================================
    if ($action === 'get_slots') {
        $u_tg   = (string)$user['telegram_id'];
        $u_name = (string)($user['username'] ?? '');
        $u_score= (int)($user['trust_score'] ?? 100);
        $u_prem = (int)($user['is_premium'] ?? 0);

        $s = db()->prepare("
            SELECT id, slot_label, json_file_id, rfid_uid, promo_from, promo_to, status
            FROM rfid_slots
            WHERE status IN ('active','suspended')
              AND (
                  (min_trust_score<=0 AND (allowed_users IS NULL OR allowed_users=''))
                  OR (min_trust_score>0 AND ?>=min_trust_score AND ?=1)
                  OR FIND_IN_SET(?,allowed_users)>0
                  OR FIND_IN_SET(?,allowed_users)>0
              )
            ORDER BY slot_label ASC
        ");
        $s->execute([$u_score,$u_prem,$u_tg,$u_name]);
        $slots = $s->fetchAll(PDO::FETCH_ASSOC);

        foreach ($slots as &$slot) {
            $slot['operators'] = [];
            $slot['is_promo']  = false;
            try {
                $rs = db()->prepare("SELECT operator_name FROM roaming_settings WHERE rfid_slot_id=? AND is_hidden=0 ORDER BY operator_name ASC");
                $rs->execute([$slot['id']]);
                $slot['operators'] = $rs->fetchAll(PDO::FETCH_COLUMN);
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
    // DOWNLOAD JSON TESSERA DA TELEGRAM
    // =========================================================
    if ($action === 'get_json_content') {
        $file_id = $_GET['file_id'] ?? '';
        if (empty($file_id)) { echo json_encode(['error'=>'File ID mancante.']); exit; }
        $token = getenv('BOT_TOKEN');
        if (empty($token)) { echo json_encode(['error'=>'BOT_TOKEN non trovato.']); exit; }
        $tg = @file_get_contents("https://api.telegram.org/bot{$token}/getFile?file_id={$file_id}");
        if (!$tg) { echo json_encode(['error'=>'Errore Telegram.']); exit; }
        $gf = json_decode($tg, true);
        if (empty($gf['result']['file_path'])) { echo json_encode(['error'=>'File scaduto. Ricaricare la configurazione.']); exit; }
        $content = @file_get_contents("https://api.telegram.org/file/bot{$token}/{$gf['result']['file_path']}");
        if (!$content) { echo json_encode(['error'=>'Download fallito.']); exit; }
        echo $content;
        exit;
    }

    // =========================================================
    // STORICO — transazioni + ricariche wallet
    // =========================================================
    if ($action === 'get_history') {
        $limit = min((int)($_GET['limit'] ?? 15), 50);
        $transactions = []; $recharges = [];
        try {
            $s = db()->prepare("
                SELECT t.id, t.kwh, t.importo_eur, t.status, t.created_at,
                       t.operator_name, t.note,
                       s.service_description, s.level_name,
                       rs.slot_label
                FROM transactions t
                LEFT JOIN services s ON t.servizio_id=s.id
                LEFT JOIN rfid_slots rs ON t.rfid_slot_id=rs.id
                WHERE t.user_id=?
                ORDER BY t.created_at DESC LIMIT ?
            ");
            $s->execute([$user['id'], $limit]);
            $transactions = $s->fetchAll(PDO::FETCH_ASSOC);
        } catch(Exception $e) {}
        try {
            $s = db()->prepare("
                SELECT id, importo_eur, total_credited, bonus_percent,
                       status, method, created_at, note
                FROM wallet_recharges WHERE user_id=?
                ORDER BY created_at DESC LIMIT 10
            ");
            $s->execute([$user['id']]);
            $recharges = $s->fetchAll(PDO::FETCH_ASSOC);
        } catch(Exception $e) {}
        echo json_encode(['transactions'=>$transactions,'recharges'=>$recharges]);
        exit;
    }

    // =========================================================
    // BROADCASTS — messaggi dagli admin
    // =========================================================
    if ($action === 'get_broadcasts') {
        $msgs = [];
        try {
            $lvl = $user['loyalty_level'] ?? '';
            $s = db()->prepare("
                SELECT id, msg_type, custom_subject, message,
                       media_file_id, media_type, scheduled_at
                FROM scheduled_broadcasts
                WHERE status='COMPLETED'
                  AND (target_level IS NULL OR target_level='' OR target_level=? OR target_level='all')
                ORDER BY scheduled_at DESC LIMIT 30
            ");
            $s->execute([$lvl]);
            $msgs = $s->fetchAll(PDO::FETCH_ASSOC);
        } catch(Exception $e) {}
        echo json_encode(['broadcasts'=>$msgs]);
        exit;
    }

    // =========================================================
    // PROFILO — dati utente completi + tariffe + totali lifetime
    // =========================================================
    if ($action === 'get_profile') {
        $tariffe = [];
        try {
            $lvl = (int)($user['loyalty_level'] ?? 0);
            $s = db()->prepare("
                SELECT level_name, service_description, tariffa_eur_kwh, start_time, end_time, allowed_days
                FROM services WHERE loyalty_level=? AND active=1
                ORDER BY tariffa_eur_kwh ASC
            ");
            $s->execute([$lvl]);
            $tariffe = $s->fetchAll(PDO::FETCH_ASSOC);
        } catch(Exception $e) {}

        $totals = ['kwh_total'=>0,'eur_total'=>0,'sessioni'=>0];
        try {
            $s = db()->prepare("
                SELECT COUNT(*) as sessioni,
                       COALESCE(SUM(kwh),0) as kwh_total,
                       COALESCE(SUM(importo_eur),0) as eur_total
                FROM transactions WHERE user_id=? AND status='CONFIRMED'
            ");
            $s->execute([$user['id']]);
            $r = $s->fetch(PDO::FETCH_ASSOC);
            if ($r) $totals = $r;
        } catch(Exception $e) {}

        echo json_encode([
            'telegram_id'     => $user['telegram_id'],
            'username'        => $user['username'] ?? '',
            'first_name'      => $user['first_name'] ?? '',
            'last_name'       => $user['last_name'] ?? '',
            'status'          => $user['status'] ?? 'active',
            'saldo_kwh'       => $user['saldo_kwh'] ?? 0,
            'trust_score'     => $user['trust_score'] ?? 0,
            'loyalty_level'   => $user['loyalty_level'] ?? 0,
            'is_premium'      => $user['is_premium'] ?? 0,
            'premium_expires' => $user['premium_expires_at'] ?? null,
            'can_overdraft'   => $user['can_overdraft'] ?? 0,
            'member_since'    => $user['created_at'] ?? '',
            'tariffe'         => $tariffe,
            'totals'          => $totals,
        ]);
        exit;
    }

    // =========================================================
    // NOTIFICA ADMIN
    // =========================================================
    if ($action === 'notify_admin') {
        $event = $_GET['event'] ?? 'unknown';
        $slots = $_GET['slots'] ?? '';
        $error = $_GET['error'] ?? '';
        $token = getenv('BOT_TOKEN');
        if ($token) {
            $u_name = $user['username'] ?? $user_id;
            $msg  = "⚠️ <b>ALERT CALISYNC</b>\n";
            $msg .= "👤 Utente: @{$u_name} (ID: {$user_id})\n";
            if ($event === 'ble_disconnected_during_session') {
                $msg .= "🔴 <b>BLE DISCONNESSO durante sessione attiva</b>\n";
                $msg .= "💾 Slot: {$slots}\n";
                if ($error) $msg .= "❌ Errore: {$error}\n";
                $msg .= "\n⚠️ Slot potrebbero <b>NON</b> essere stati cancellati!";
            } else {
                $msg .= "📋 Evento: {$event}\n";
                if ($slots) $msg .= "💾 Slot: {$slots}";
            }
            try {
                $admins = db()->query("SELECT chat_id FROM admin_users WHERE chat_id IS NOT NULL AND chat_id!=''")->fetchAll(PDO::FETCH_COLUMN);
                foreach ($admins as $cid) {
                    @file_get_contents("https://api.telegram.org/bot{$token}/sendMessage?chat_id=".urlencode($cid)."&text=".urlencode($msg)."&parse_mode=HTML");
                }
            } catch(Exception $e) {}
        }
        echo json_encode(['success'=>true]);
        exit;
    }

    // =========================================================
    // SESSIONE SICURA
    // =========================================================
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
        echo json_encode(['success'=>true]);
        exit;
    }

} catch(Exception $e) {
    echo json_encode(['error'=>'Errore interno del database.']);
    exit;
}
?>