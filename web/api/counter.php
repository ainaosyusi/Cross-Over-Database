<?php
/**
 * 訪問者カウンターAPI
 *
 * GET /api/counter.php → 今日の訪問者数を返し、アクセスを記録
 *
 * IPアドレスのハッシュで重複排除（同一人物は1日1カウント）
 * データは日付ごとにJSONファイルに保存
 */

header('Content-Type: application/json; charset=utf-8');

$dataFile = __DIR__ . '/counter_data.json';

// データ読み込み
function loadData() {
    global $dataFile;
    if (!file_exists($dataFile)) return [];
    $json = file_get_contents($dataFile);
    $data = json_decode($json, true);
    return is_array($data) ? $data : [];
}

// データ保存
function saveData($data) {
    global $dataFile;
    file_put_contents($dataFile, json_encode($data, JSON_UNESCAPED_UNICODE));
}

$today = date('Y-m-d');
$data = loadData();

// 古いデータを削除（7日分のみ保持）
foreach (array_keys($data) as $date) {
    if ($date < date('Y-m-d', strtotime('-7 days'))) {
        unset($data[$date]);
    }
}

// 今日のエントリがなければ作成
if (!isset($data[$today])) {
    $data[$today] = [];
}

// 訪問者を記録（IPハッシュで重複排除、プライバシー配慮）
$ip = $_SERVER['REMOTE_ADDR'] ?? '';
$ipHash = substr(hash('sha256', $ip . $today), 0, 16);

if (!in_array($ipHash, $data[$today])) {
    $data[$today][] = $ipHash;
    saveData($data);
}

// 累計カウンター（別ファイルで永続化）
$totalFile = __DIR__ . '/counter_total.json';
$totalData = file_exists($totalFile) ? json_decode(file_get_contents($totalFile), true) : ['total' => 308, 'counted' => []];
if (!is_array($totalData)) $totalData = ['total' => 308, 'counted' => []];

// 全期間で未カウントのIPハッシュなら累計に加算
$ipHashTotal = substr(hash('sha256', $ip . 'total'), 0, 16);
if (!in_array($ipHashTotal, $totalData['counted'])) {
    $totalData['total']++;
    $totalData['counted'][] = $ipHashTotal;
    // counted配列が肥大化しないよう最新5000件のみ保持
    if (count($totalData['counted']) > 5000) {
        $totalData['counted'] = array_slice($totalData['counted'], -5000);
    }
    file_put_contents($totalFile, json_encode($totalData));
}

// レスポンス
$todayCount = count($data[$today]);

echo json_encode([
    'today' => $todayCount,
    'total' => $totalData['total'],
]);
