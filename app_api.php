<?php
// Disabilita la visualizzazione errori a schermo per non corrompere l'output JSON
error_reporting(0);
ini_set('display_errors', 0);

// Includi il file di connessione al database e le funzioni principali
require_once 'functions.php'; 

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *'); // Permette le chiamate dall'App Flutter

$action = $_GET['action'] ?? '';

// =========================================================
// 1. GESTIONE LOGIN (Non richiede user_id in ingresso)
// =========================================================
if ($action === 'login') {
    $input = $_GET['username'] ?? '';
    $input = ltrim(trim($input), '@'); // Toglie la chiocciola se l'utente la scrive
    
    // Cerca l'utente sia per username che per Telegram ID
    $stmt = db()->prepare("SELECT telegram_id, first_name FROM users WHERE username = ? OR telegram_id = ?");
    $stmt->execute([$input, $input]);
    $u = $stmt->fetch(PDO::FETCH_ASSOC);
    
    if ($u) {
        echo json_encode(['success' => true, 'telegram_id' => $u['telegram_id'], 'first_name' => $u['first_name']]);
    } else {
        echo json_encode(['success' => false, 'error' => 'Utente non trovato nel Database. Verifica lo Username.']);
    }
    exit; // Ferma l'esecuzione qui dopo il login
}


// =========================================================
// 2. BARRIERA DI SICUREZZA (Per recupero tessere e download)
// =========================================================
// Per tutte le azioni seguenti è obbligatorio che l'app ci mandi l'user_id
$user_id = $_GET['user_id'] ?? '';

if (empty($user_id)) {
    echo json_encode(['error' => 'User ID mancante nella richiesta.']);
    exit;
}

try {
    // Verifica che l'utente esista e recupera i suoi dati/privilegi
    $user = db()->query("SELECT * FROM users WHERE telegram_id = " . db()->quote($user_id))->fetch(PDO::FETCH_ASSOC);

    if (!$user) {
        echo json_encode(['error' => 'Utente non registrato o non autorizzato.']);
        exit;
    }

    // =========================================================
    // 3. INVIO LISTA SLOT AUTORIZZATI
    // =========================================================
    if ($action === 'get_slots') {
        $u_tg = $user['telegram_id'];
        $u_name = $user['username'] ?? '';
        $u_score = $user['trust_score'] ?? 100;
        $u_prem = $user['is_premium'] ?? 0;

        // Estrazione slot in base al Trust Score, abbonamento Premium e Whitelist manuale
        $sql = "SELECT id, slot_label, json_file_id FROM rfid_slots WHERE status IN ('active', 'suspended') 
                AND (
                    (min_trust_score <= 0 AND (allowed_users IS NULL OR allowed_users = ''))
                    OR (min_trust_score > 0 AND $u_score >= min_trust_score AND $u_prem = 1)
                    OR FIND_IN_SET(" . db()->quote($u_tg) . ", allowed_users) > 0 
                    OR FIND_IN_SET(" . db()->quote($u_name) . ", allowed_users) > 0
                ) ORDER BY slot_label ASC";

        $slots = db()->query($sql)->fetchAll(PDO::FETCH_ASSOC);
        
        // Se non ci sono slot restituisce un array vuoto [] e non null
        echo json_encode($slots ?: []);
        exit;
    }

    // =========================================================
    // 4. DOWNLOAD CONTENUTO TESSERA DA TELEGRAM
    // =========================================================
    if ($action === 'get_json_content') {
        $file_id = $_GET['file_id'] ?? '';
        
        if (empty($file_id)) {
            echo json_encode(['error' => 'File ID mancante. Lo slot potrebbe non avere un file JSON associato.']);
            exit;
        }

        // 🔐 Recupera il Token in modo sicuro dalle Variabili d'Ambiente di Railway
        $token = getenv('BOT_TOKEN'); 
        
        if (empty($token)) {
            echo json_encode(['error' => 'Variabile BOT_TOKEN non trovata su Railway! Aggiungila nelle impostazioni del servizio.']);
            exit;
        }
        
        // Chiediamo a Telegram il percorso temporaneo del file
        $tg_response = @file_get_contents("https://api.telegram.org/bot$token/getFile?file_id=$file_id");
        
        if (!$tg_response) {
            echo json_encode(['error' => 'Errore di comunicazione con Telegram (Token errato o file inesistente).']);
            exit;
        }
        
        $getFile = json_decode($tg_response, true);
        
        if (!$getFile || empty($getFile['result']['file_path'])) {
            echo json_encode(['error' => 'Il file JSON è scaduto sui server di Telegram. Ricarica la configurazione dal bot.']);
            exit;
        }
        
        // Scarichiamo il contenuto reale del JSON
        $path = $getFile['result']['file_path'];
        $content = @file_get_contents("https://api.telegram.org/file/bot$token/$path");
        
        if (!$content) {
            echo json_encode(['error' => 'Impossibile scaricare il contenuto fisico del file da Telegram.']);
            exit;
        }
        
        // Stampiamo direttamente il JSON della tessera per l'App Flutter
        echo $content;
        exit;
    }

} catch (Exception $e) {
    echo json_encode(['error' => 'Errore interno del database: ' . $e->getMessage()]);
    exit;
}
?>
