<?php
/* ============================================================
 * 勤務区分 取込スクリプト（JOYNUS II 勤務管理システム対応）
 *
 * JoyKinmData（勤務データ）から職員ごと・日ごとの勤務区分を取得し、
 * 保育園食システムに返します。
 *
 *   JoyKinmData.KinmuTbl = 勤務CD(3バイト) × 31日分 の固定長文字列
 *   → これを1日ずつに分解し、JoyKinmu（勤務種類マスタ）の名称に変換します。
 *
 * ▼ 使い方
 *   下の【接続設定】を自院の環境に合わせて書き換えてください。
 *   書き換え後、保育園食システムの「料金・勤務区分」タブにある
 *   「データベースから同期」で取り込めます。
 *
 * ▼ 動作確認
 *   ブラウザで sync_shifts.php?year=2026&month=9&debug=1 を開くと、
 *   取得した生データと展開結果を確認できます（設定の確認用）。
 *
 * ▼ 注意
 *   必ず参照専用（SELECTのみ）のアカウントを使用してください。
 * ============================================================ */

/* ===================== 【接続設定】ここから ===================== */

// --- 1) 接続文字列（DSN）---
// 使用するDBの行だけ有効にしてください。
// SQL Server : 'sqlsrv:Server=10.20.xxx.xxx,1433;Database=JOYNUS'
// Oracle     : 'oci:dbname=//10.20.xxx.xxx:1521/ORCL;charset=AL32UTF8'
// PostgreSQL : 'pgsql:host=10.20.xxx.xxx;port=5432;dbname=joynus'
// MySQL      : 'mysql:host=10.20.xxx.xxx;port=3306;dbname=joynus;charset=utf8mb4'
$DSN  = '';
$USER = '';
$PASS = '';

// --- 2) 取得する勤務データの種類 ---
// '1' = 予定勤務（翌月の食事注文にはこちらを使います）
// '2' = 実績勤務（実績で集計したい場合）
// '0' = 希望勤務
$KBN = '1';

// --- 3) YYMM（年月）の格納形式 ---
// JoyKinmData.YYMM は6桁。'Ym' なら 202609、'ym' なら 2609 で検索します。
// どちらか分からない場合は 'auto' にすると両方試します。
$YYMM_FORMAT = 'auto';

// --- 4) 部署の絞り込み（任意）---
// 特定の部署だけ取り込む場合は部署CDを列挙します。空なら全部署。
// 例: $BUSYO_FILTER = array('001', '002');
$BUSYO_FILTER = array();

// --- 5) 勤務種類マスタ（勤務CD → 表示名）---
// JoyKinmu の実際の列名に合わせてください。
// 名称に変換せず勤務CDのまま取り込む場合は $USE_KINMU_MASTER = false にします。
$USE_KINMU_MASTER = true;
$KINMU_TABLE      = 'JoyKinmu';   // 勤務種類マスタのテーブル名
$KINMU_CD_COL     = 'Kinmu';      // 勤務CDの列名
$KINMU_NAME_COL   = 'Ryaku';      // 表示名の列名（略称。無ければ 'Name' 等に変更）

// --- 6) テーブル名（通常は変更不要）---
$KINMDATA_TABLE = 'JoyKinmData';

/* ===================== 【接続設定】ここまで ===================== */

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-cache, no-store');

$debug = isset($_GET['debug']) && $_GET['debug'] == '1';

function fail($msg, $extra = null) {
    $out = array('ok' => false, 'error' => $msg);
    if ($extra !== null) $out['detail'] = $extra;
    echo json_encode($out, JSON_UNESCAPED_UNICODE);
    exit;
}

$year  = isset($_GET['year'])  ? intval($_GET['year'])  : 0;
$month = isset($_GET['month']) ? intval($_GET['month']) : 0;
if ($year < 2000 || $month < 1 || $month > 12) {
    fail('年月の指定が正しくありません。');
}

if ($DSN === '') {
    fail('データベース接続が未設定です。サーバーの sync_shifts.php を開き、'
       . '先頭の【接続設定】に接続文字列・ユーザー・パスワードを記入してください。'
       . '設定が済むまではCSV取込をご利用ください。');
}

$driver = substr($DSN, 0, strpos($DSN, ':'));
if (!in_array($driver, PDO::getAvailableDrivers())) {
    fail('PHPの ' . $driver . ' ドライバが有効になっていません。php.ini で拡張を有効にし、'
       . 'Apacheを再起動してください。（現在利用可能: ' . implode(', ', PDO::getAvailableDrivers()) . '）');
}

// 検索する YYMM の候補を組み立てる
$ymCandidates = array();
if ($YYMM_FORMAT === 'Ym' || $YYMM_FORMAT === 'auto') {
    $ymCandidates[] = sprintf('%04d%02d', $year, $month);        // 202609
}
if ($YYMM_FORMAT === 'ym' || $YYMM_FORMAT === 'auto') {
    $ymCandidates[] = sprintf('%02d%02d', $year % 100, $month);  // 2609
}

try {
    $pdo = new PDO($DSN, $USER, $PASS, array(
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ));

    // --- 勤務データを取得（Kojin='000000' は部署行なので除外）---
    $rows = array();
    $usedYm = '';
    foreach ($ymCandidates as $ym) {
        $sql = 'SELECT YYMM, Busyo, Kojin, Kbn, KinmuTbl'
             . ' FROM ' . $KINMDATA_TABLE
             . ' WHERE YYMM = :ym AND Kbn = :kbn AND Kojin <> :zero';
        $params = array(':ym' => $ym, ':kbn' => $KBN, ':zero' => '000000');
        if (count($BUSYO_FILTER) > 0) {
            $ph = array();
            foreach ($BUSYO_FILTER as $i => $b) { $ph[] = ':b'.$i; $params[':b'.$i] = $b; }
            $sql .= ' AND Busyo IN (' . implode(',', $ph) . ')';
        }
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll();
        if (count($rows) > 0) { $usedYm = $ym; break; }
    }

    // --- 勤務CD → 表示名 の対応表 ---
    $nameOf = array();
    if ($USE_KINMU_MASTER) {
        try {
            $ks = $pdo->query('SELECT ' . $KINMU_CD_COL . ' AS cd, ' . $KINMU_NAME_COL . ' AS nm FROM ' . $KINMU_TABLE);
            foreach ($ks->fetchAll() as $k) {
                $cd = trim((string)$k['cd']);
                $nm = trim((string)$k['nm']);
                if ($cd !== '') $nameOf[$cd] = $nm;
            }
        } catch (Exception $e) {
            // マスタが引けない場合は勤務CDのまま返す（設定ミスでも同期は続行）
            $nameOf = array();
        }
    }
} catch (Exception $e) {
    fail('データベースへの接続・取得に失敗しました: ' . $e->getMessage());
}

if (count($rows) === 0) {
    fail($year . '年' . $month . '月の勤務データが見つかりませんでした。'
       . '（検索したYYMM: ' . implode(' / ', $ymCandidates) . ' ／ Kbn=' . $KBN . '）'
       . ' YYMMの格納形式や勤務データ区分の設定をご確認ください。');
}

// --- KinmuTbl（勤務CD 3バイト × 31日分）を1日ずつに分解する ---
$days  = intval(date('t', mktime(0, 0, 0, $month, 1, $year)));
$out   = array();
$count = 0;
$rawSamples = array();

foreach ($rows as $r) {
    $sid = trim((string)$r['Kojin']);
    $tbl = (string)$r['KinmuTbl'];
    if ($sid === '') continue;
    if ($debug && count($rawSamples) < 3) {
        $rawSamples[] = array('Kojin' => $sid, 'Busyo' => trim((string)$r['Busyo']), 'KinmuTbl' => $tbl);
    }
    for ($d = 1; $d <= $days; $d++) {
        $cd = trim(substr($tbl, ($d - 1) * 3, 3));
        if ($cd === '' || $cd === '000') continue;   // 未設定・休みは取り込まない
        $name = isset($nameOf[$cd]) ? $nameOf[$cd] : $cd;
        if ($name === '') $name = $cd;
        if (!isset($out[$sid])) $out[$sid] = array();
        $out[$sid][(string)$d] = $name;
        $count++;
    }
}

$res = array('ok' => true, 'shifts' => $out, 'count' => $count);
if ($debug) {
    $res['debug'] = array(
        'usedYYMM'      => $usedYm,
        'kbn'           => $KBN,
        'rowCount'      => count($rows),
        'daysInMonth'   => $days,
        'kinmuMasterCt' => count($nameOf),
        'kinmuMaster'   => array_slice($nameOf, 0, 20, true),
        'rawSamples'    => $rawSamples,
    );
}
echo json_encode($res, JSON_UNESCAPED_UNICODE);
