<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *'); 
include 'functions.php';

$user_id = $_GET['user_id'] ?? '';
$action = $_GET['action'] ?? '';

if (empty($user_id)) {
    echo json_encode(['error' => 'User ID missing']);
    exit;
}

$user = db()->query("SELECT * FROM users WHERE telegram_id = " . db()->quote($user_id))->fetch(PDO::FETCH_ASSOC);

if (!$user) {
    echo json_encode(['error' => 'User not found']);
    exit;
}

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

if ($action == 'get_json_content') {
    $file_id = $_GET['file_id'] ?? '';
    if (empty($file_id)) exit;
    $token = "IL_TUO_BOT_TOKEN"; // Metti il token reale
    $getFile = json_decode(file_get_contents("https://api.telegram.org/bot$token/getFile?file_id=$file_id"), true);
    $path = $getFile['result']['file_path'];
    echo file_get_contents("https://api.telegram.org/file/bot$token/$path");
}
