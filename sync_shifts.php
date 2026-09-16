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
 * ▼ 設定でやること
 *   下の【接続設定】の $DB_HOST に、JOYNUSのデータベースサーバーの
 *   IPアドレス（またはホスト名）を入れるだけです。
 *   DBの種類が分からない場合は $DB_TYPE = 'auto' のままで構いません
 *   （利用可能なドライバを順に試し、つながったものを使います）。
 *
 * ▼ 動作確認（ブラウザで開いてください）
 *   1) 接続確認とテーブル調査
 *      sync_shifts.php?probe=1
 *      → つながったDSN、JoyKinmData / JoyKinmu の列名が表示されます
 *   2) 取込内容の確認
 *      sync_shifts.php?year=2026&month=9&debug=1
 *      → 取得件数・勤務種類マスタ・生データのサンプルが表示されます
 *
 * ▼ 注意
 *   必ず参照専用（SELECTのみ）のアカウントを使用してください。
 * ============================================================ */

/* ===================== 【接続設定】ここから ===================== */

// --- 1) データベース接続 ---
// $DB_TYPE: 'auto' | 'sqlsrv'(SQL Server) | 'oci'(Oracle) | 'pgsql' | 'mysql'
$DB_TYPE = 'auto';
$DB_HOST = '10.20.1.36';  // JOYNUSのDBサーバー
$DB_PORT = '';            // 既定ポート以外の場合のみ指定（例: '1433'）
$DB_NAME = 'nagasakidb';
$DB_USER = 'viewer';
$DB_PASS = '';            // パスワードなし

// --- 2) 取得する勤務データの種類 ---
// '1' = 予定勤務（翌月の食事注文にはこちらを使います）
// '2' = 実績勤務、'0' = 希望勤務
$KBN = '1';

// --- 3) YYMM（年月）の格納形式 ---
// 'auto'（既定）なら 202609 と 2609 の両方を試します。
$YYMM_FORMAT = 'auto';

// --- 4) 部署の絞り込み（任意）---
// 例: $BUSYO_FILTER = array('001', '002');  空なら全部署
$BUSYO_FILTER = array();

// --- 5) 勤務種類マスタ（勤務CD → 表示名）---
// probe=1 で調べた実際の列名に合わせてください。
// 変換せず勤務CDのまま取り込む場合は $USE_KINMU_MASTER = false にします。
// （勤務CDのままでも、保育園の「勤務区分マスタ」の勤務CD欄で対応づけできます）
$USE_KINMU_MASTER = true;
$KINMU_TABLE      = 'JoyKinmu';
$KINMU_CD_COL     = 'Kinmu';      // 勤務CDの列名
$KINMU_NAME_COL   = 'Ryaku';      // 表示名の列名（略称）

// --- 6) テーブル名（通常は変更不要）---
$KINMDATA_TABLE = 'JoyKinmData';

/* ===================== 【接続設定】ここまで ===================== */

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-cache, no-store');

// 1つのドライバを試す際の接続待ち時間（秒）。順に試すので短めにする。
define('CONNECT_TIMEOUT', 5);

$debug = isset($_GET['debug']) && $_GET['debug'] == '1';
$probe = isset($_GET['probe']) && $_GET['probe'] == '1';

function fail($msg, $extra = null) {
    $out = array('ok' => false, 'error' => $msg);
    if ($extra !== null) $out['detail'] = $extra;
    echo json_encode($out, JSON_UNESCAPED_UNICODE);
    exit;
}

/** 設定から接続文字列の候補を組み立てる */
function buildDsnCandidates($type, $host, $port, $name) {
    $avail = PDO::getAvailableDrivers();
    $mk = array(
        'sqlsrv' => 'sqlsrv:Server=' . $host . ($port ? ',' . $port : '') . ';Database=' . $name
                  . ';LoginTimeout=' . CONNECT_TIMEOUT,
        'pgsql'  => 'pgsql:host=' . $host . ';port=' . ($port ? $port : '5432') . ';dbname=' . $name
                  . ';connect_timeout=' . CONNECT_TIMEOUT,
        'mysql'  => 'mysql:host=' . $host . ';port=' . ($port ? $port : '3306') . ';dbname=' . $name . ';charset=utf8mb4',
        'oci'    => 'oci:dbname=//' . $host . ':' . ($port ? $port : '1521') . '/' . $name . ';charset=AL32UTF8',
        // SQL Server は sqlsrv が無い環境で ODBC 経由になることがある
        'odbc'   => 'odbc:Driver={SQL Server};Server=' . $host . ';Database=' . $name,
    );
    $order = ($type === 'auto') ? array('sqlsrv', 'odbc', 'oci', 'pgsql', 'mysql') : array($type);
    $out = array();
    foreach ($order as $d) {
        if (!isset($mk[$d])) continue;
        if (!in_array($d, $avail)) continue;   // 未導入のドライバは試さない
        $out[$d] = $mk[$d];
    }
    return $out;
}

/** 候補を順に試して接続する */
function connectDb($cands, $user, $pass, &$usedDriver, &$tried) {
    foreach ($cands as $drv => $dsn) {
        try {
            $pdo = new PDO($dsn, $user, $pass, array(
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_TIMEOUT => CONNECT_TIMEOUT,
            ));
            $usedDriver = $drv;
            return $pdo;
        } catch (Exception $e) {
            $tried[] = $drv . ': ' . $e->getMessage();
        }
    }
    return null;
}

/** テーブル名・列名をDBの種類に合わせて引用符で囲む
 *  PostgreSQL / Oracle は大文字小文字を区別するため、JoyKinmData のような
 *  大小混在の名前はそのまま書くと見つからない。 */
function qid($driver, $name) {
    switch ($driver) {
        case 'mysql':  return '`' . str_replace('`', '``', $name) . '`';
        case 'sqlsrv':
        case 'odbc':   return '[' . str_replace(']', ']]', $name) . ']';
        default:       return '"' . str_replace('"', '""', $name) . '"';  // pgsql / oci
    }
}

/** テーブルの列名を1行だけ読んで調べる */
function probeColumns($pdo, $driver, $table) {
    try {
        $st = $pdo->query('SELECT * FROM ' . qid($driver, $table));
        $row = $st->fetch();
        $st->closeCursor();
        if ($row === false) return array('columns' => array(), 'note' => 'テーブルは存在しますが行がありません');
        return array('columns' => array_keys($row), 'sample' => $row);
    } catch (Exception $e) {
        return array('error' => $e->getMessage());
    }
}

if ($DB_HOST === '') {
    fail('データベースサーバーのアドレスが未設定です。サーバーの sync_shifts.php を開き、'
       . '【接続設定】の $DB_HOST にJOYNUSのDBサーバーのIPアドレスを記入してください。'
       . '（データベース名 ' . $DB_NAME . ' ／ アカウント ' . $DB_USER . ' は設定済みです）'
       . ' 設定が済むまではCSV取込をご利用ください。');
}

$cands = buildDsnCandidates($DB_TYPE, $DB_HOST, $DB_PORT, $DB_NAME);
if (count($cands) === 0) {
    fail('利用できるデータベースドライバがPHPに入っていません。'
       . 'php.ini で pdo_sqlsrv / pdo_oci / pdo_pgsql / pdo_mysql のいずれかを有効にし、'
       . 'Apacheを再起動してください。（現在利用可能: ' . implode(', ', PDO::getAvailableDrivers()) . '）');
}

$usedDriver = '';
$tried = array();
$pdo = connectDb($cands, $DB_USER, $DB_PASS, $usedDriver, $tried);
if ($pdo === null) {
    fail('データベースに接続できませんでした。サーバーアドレス・DBの種類・アカウントをご確認ください。',
         array('tried' => $tried, 'candidates' => array_keys($cands)));
}

/* ---------- 調査モード: 接続確認とテーブルの列名を表示 ---------- */
if ($probe) {
    echo json_encode(array(
        'ok'          => true,
        'mode'        => 'probe',
        'driver'      => $usedDriver,
        'dsn'         => $cands[$usedDriver],
        'database'    => $DB_NAME,
        'user'        => $DB_USER,
        'JoyKinmData' => probeColumns($pdo, $usedDriver, $KINMDATA_TABLE),
        'JoyKinmu'    => probeColumns($pdo, $usedDriver, $KINMU_TABLE),
        'hint'        => 'JoyKinmu の列名を確認し、$KINMU_CD_COL と $KINMU_NAME_COL を合わせてください。',
    ), JSON_UNESCAPED_UNICODE);
    exit;
}

$year  = isset($_GET['year'])  ? intval($_GET['year'])  : 0;
$month = isset($_GET['month']) ? intval($_GET['month']) : 0;
if ($year < 2000 || $month < 1 || $month > 12) {
    fail('年月の指定が正しくありません。');
}

// 検索する YYMM の候補
$ymCandidates = array();
if ($YYMM_FORMAT === 'Ym' || $YYMM_FORMAT === 'auto') {
    $ymCandidates[] = sprintf('%04d%02d', $year, $month);        // 202609
}
if ($YYMM_FORMAT === 'ym' || $YYMM_FORMAT === 'auto') {
    $ymCandidates[] = sprintf('%02d%02d', $year % 100, $month);  // 2609
}

try {
    // --- 勤務データを取得（Kojin='000000' は部署行なので除外）---
    $rows = array();
    $usedYm = '';
    foreach ($ymCandidates as $ym) {
        $sql = 'SELECT ' . qid($usedDriver,'YYMM') . ' AS "YYMM", '
             . qid($usedDriver,'Busyo')    . ' AS "Busyo", '
             . qid($usedDriver,'Kojin')    . ' AS "Kojin", '
             . qid($usedDriver,'Kbn')      . ' AS "Kbn", '
             . qid($usedDriver,'KinmuTbl') . ' AS "KinmuTbl"'
             . ' FROM ' . qid($usedDriver, $KINMDATA_TABLE)
             . ' WHERE ' . qid($usedDriver,'YYMM')  . ' = :ym'
             . '   AND ' . qid($usedDriver,'Kbn')   . ' = :kbn'
             . '   AND ' . qid($usedDriver,'Kojin') . ' <> :zero';
        $params = array(':ym' => $ym, ':kbn' => $KBN, ':zero' => '000000');
        if (count($BUSYO_FILTER) > 0) {
            $ph = array();
            foreach ($BUSYO_FILTER as $i => $b) { $ph[] = ':b'.$i; $params[':b'.$i] = $b; }
            $sql .= ' AND ' . qid($usedDriver,'Busyo') . ' IN (' . implode(',', $ph) . ')';
        }
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll();
        if (count($rows) > 0) { $usedYm = $ym; break; }
    }

    // --- 勤務CD → 表示名 の対応表 ---
    $nameOf = array();
    $kinmuErr = '';
    if ($USE_KINMU_MASTER) {
        try {
            $ks = $pdo->query('SELECT ' . qid($usedDriver,$KINMU_CD_COL) . ' AS "cd", '
                            . qid($usedDriver,$KINMU_NAME_COL) . ' AS "nm"'
                            . ' FROM ' . qid($usedDriver,$KINMU_TABLE));
            foreach ($ks->fetchAll() as $k) {
                $cd = trim((string)$k['cd']);
                $nm = trim((string)$k['nm']);
                if ($cd !== '') $nameOf[$cd] = $nm;
            }
        } catch (Exception $e) {
            // 列名が違う等で引けない場合は勤務CDのまま返す（同期は続行）
            $kinmuErr = $e->getMessage();
            $nameOf = array();
        }
    }
} catch (Exception $e) {
    fail('勤務データの取得に失敗しました: ' . $e->getMessage(),
         array('driver' => $usedDriver, 'table' => $KINMDATA_TABLE));
}

if (count($rows) === 0) {
    fail($year . '年' . $month . '月の勤務データが見つかりませんでした。'
       . '（検索したYYMM: ' . implode(' / ', $ymCandidates) . ' ／ Kbn=' . $KBN . '）'
       . ' YYMMの格納形式や勤務データ区分の設定をご確認ください。'
       . ' sync_shifts.php?probe=1 で接続内容を確認できます。');
}

// --- KinmuTbl（勤務CD 3バイト × 31日分）を1日ずつに分解 ---
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
        'driver'        => $usedDriver,
        'usedYYMM'      => $usedYm,
        'kbn'           => $KBN,
        'rowCount'      => count($rows),
        'daysInMonth'   => $days,
        'kinmuMasterCt' => count($nameOf),
        'kinmuMaster'   => array_slice($nameOf, 0, 20, true),
        'kinmuError'    => $kinmuErr,
        'rawSamples'    => $rawSamples,
    );
}
echo json_encode($res, JSON_UNESCAPED_UNICODE);
