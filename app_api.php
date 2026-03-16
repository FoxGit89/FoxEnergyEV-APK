<?php
// Disabilita la visualizzazione errori a schermo per non rompere il JSON
error_reporting(0);
ini_set('display_errors', 0);

// Includi il tuo file di connessione
include 'functions.php'; 

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *'); 

$action = $_GET['action'] ?? '';

// =========================================================
// 1. GESTIONE LOGIN (Non richiede user_id in ingresso)
// =========================================================
if ($action == 'login') {
    $input = $_GET['username'] ?? '';
    $input = ltrim($input, '@'); // Toglie la @ se l'utente la scrive
    
    // Cerca l'utente sia per username che per Telegram ID
    $stmt = db()->prepare("SELECT telegram_id, first_name FROM users WHERE username = ? OR telegram_id = ?");
    $stmt->execute([$input, $input]);
    $u = $stmt->fetch(PDO::FETCH_ASSOC);
    
    if ($u) {
        echo json_encode(['success' => true, 'telegram_id' => $u['telegram_id'], 'first_name' => $u['first_name']]);
    } else {
        echo json_encode(['success' => false, 'error' => 'Utente non trovato nel Database.']);
    }
    exit; // Ferma lo script qui dopo il login
}


// =========================================================
// 2. CONTROLLO DI SICUREZZA PER RECUPERO TESSERE
// =========================================================
// Per tutte le azioni seguenti serve che l'app ci mandi l'user_id!
$user_id = $_GET['user_id'] ?? '';

if (empty($user_id)) {
    echo json_encode(['error' => 'User ID missing']);
    exit;
}

try {
    $user = db()->query("SELECT * FROM users WHERE telegram_id = " . db()->quote($user_id))->fetch();

    if (!$user) {
        echo json_encode(['error' => 'Utente non registrato']);
        exit;
    }

    // --- INVIO LISTA SLOT AUTORIZZATI ---
    if ($action == 'get_slots') {
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
    }

    // --- DOWNLOAD CONTENUTO TESSERA DA TELEGRAM ---
    if ($action == 'get_json_content') {
        $file_id = $_GET['file_id'] ?? '';
        if (empty($file_id)) exit;

        // ⚠️ INSERISCI QUI IL TUO BOT TOKEN REALE
        $token = "IL_TUO_BOT_TOKEN_QUI"; 
        
        $getFile = json_decode(file_get_contents("https://api.telegram.org/bot$token/getFile?file_id=$file_id"), true);
        $path = $getFile['result']['file_path'];
        echo file_get_contents("https://api.telegram.org/file/bot$token/$path");
    }

} catch (Exception $e) {
    echo json_encode(['error' => 'Errore database: ' . $e->getMessage()]);
}
?>
