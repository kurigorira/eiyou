<?php
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-cache, no-store');

$dataDir = __DIR__ . DIRECTORY_SEPARATOR . 'data';
if (!is_dir($dataDir)) {
    mkdir($dataDir, 0777, true);
}

$allowed = array(
    'staff', 'orders', 'holidays', 'history', 'children', 'config',
    'confirmed', 'hoiku_orders', 'hoiku_history', 'hoiku_confirmed', 'kensa',
    'prices', 'shifts', 'shiftdefs', 'hoiku_config',
    'hoiku_staff', 'hoiku_shifts'
);

$defaults = array(
    'staff'=>'[]', 'orders'=>'{}', 'holidays'=>'[]', 'history'=>'[]',
    'children'=>'[]', 'config'=>'{}', 'confirmed'=>'{}',
    'hoiku_orders'=>'{}', 'hoiku_history'=>'[]', 'hoiku_confirmed'=>'{}',
    'kensa'=>'{}', 'prices'=>'{}', 'shifts'=>'{}',
    'shiftdefs'=>'[]', 'hoiku_config'=>'{}',
    'hoiku_staff'=>'[]', 'hoiku_shifts'=>'{}'
);

/**
 * 部分更新（merge）を指定の深さまで再帰的に適用する。
 *   depth=1 ... 第1階層のキーを置き換え   例) kensa[日]
 *   depth=2 ... 第2階層まで              例) kensa[月][日]
 *   depth=3 ... 第3階層まで              例) shifts[年月][職員ID][日]
 * 値が null のキーは削除する（未割当・取消を表す）。
 */
function mergeAtDepth($data, $patch, $depth) {
    if (!is_array($data)) $data = array();
    foreach ($patch as $k => $v) {
        if ($v === null) {
            unset($data[$k]);
        } elseif ($depth > 1 && is_array($v) && isset($data[$k]) && is_array($data[$k])) {
            $data[$k] = mergeAtDepth($data[$k], $v, $depth - 1);
        } elseif ($depth > 1 && is_array($v)) {
            $data[$k] = mergeAtDepth(array(), $v, $depth - 1);
        } else {
            $data[$k] = $v;
        }
    }
    return $data;
}

/**
 * 空になった配列を JSON のオブジェクト {} として書き出すよう変換する。
 * PHP は空の配列を [] と書き出すため、そのまま読み込むとJavaScript側で
 * 配列として扱われ、キーを追加しても保存されなくなる。
 * merge 対象のデータは連想配列（オブジェクト）しか入らないため、ここでまとめて直す。
 */
function emptyArraysToObjects($v) {
    if (!is_array($v)) return $v;
    if (count($v) === 0) return new stdClass();
    $out = array();
    foreach ($v as $k => $vv) $out[$k] = emptyArraysToObjects($vv);
    return $out;
}

$key = isset($_GET['key']) ? $_GET['key'] : '';

if ($key === 'all') {
    $result = array();
    foreach ($allowed as $k) {
        $file = $dataDir . DIRECTORY_SEPARATOR . $k . '.json';
        if (file_exists($file)) {
            $result[$k] = json_decode(file_get_contents($file), true);
        } else {
            $result[$k] = json_decode($defaults[$k], true);
        }
    }
    echo json_encode($result, JSON_UNESCAPED_UNICODE);
    exit;
}

if (!in_array($key, $allowed)) {
    http_response_code(400);
    echo json_encode(array('error' => 'Invalid key'));
    exit;
}

$file = $dataDir . DIRECTORY_SEPARATOR . $key . '.json';

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    if (file_exists($file)) {
        // 書き込み中(LOCK_EX)の読み取りを待ち、中途半端な内容を返さない
        $fp = @fopen($file, 'r');
        if ($fp && flock($fp, LOCK_SH)) {
            $stat = fstat($fp);
            echo ($stat['size'] > 0) ? fread($fp, $stat['size']) : $defaults[$key];
            flock($fp, LOCK_UN);
            fclose($fp);
        } else {
            if ($fp) fclose($fp);
            readfile($file);
        }
    } else {
        echo $defaults[$key];
    }
} elseif ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = file_get_contents('php://input');
    $decoded = json_decode($input, true);
    if ($decoded === null && $input !== 'null') {
        http_response_code(400);
        echo json_encode(array('error' => 'Invalid JSON'));
        exit;
    }
    $action = isset($_GET['action']) ? $_GET['action'] : '';
    $written = false;
    $errMsg = '';
    $fp = @fopen($file, 'c+');
    if ($fp === false) {
        $errMsg = 'ファイルを開けません: ' . $key . '.json（dataフォルダの書き込み権限、ファイルの読み取り専用属性を確認してください）';
    } elseif (!flock($fp, LOCK_EX)) {
        $errMsg = 'ファイルロックに失敗しました: ' . $key . '.json';
        fclose($fp);
    } else {
        if ($action === 'merge' && is_array($decoded)) {
            $current = '';
            $stat = fstat($fp);
            if ($stat['size'] > 0) {
                $current = fread($fp, $stat['size']);
            }
            $data = json_decode($current, true);
            if (!is_array($data)) $data = array();
            $depth = isset($_GET['depth']) ? intval($_GET['depth']) : 1;
            if ($depth < 1) $depth = 1;
            $data = mergeAtDepth($data, $decoded, $depth);
            $out = json_encode(emptyArraysToObjects($data), JSON_UNESCAPED_UNICODE);
            if ($out === false) {
                $errMsg = 'JSONエンコードに失敗しました（文字コードを確認してください）';
            } else {
                fseek($fp, 0);
                ftruncate($fp, 0);
                $written = (fwrite($fp, $out) !== false);
                if (!$written) $errMsg = 'ファイル書き込みに失敗しました: ' . $key . '.json';
            }
        } else {
            ftruncate($fp, 0);
            $written = (fwrite($fp, $input) !== false);
            if (!$written) $errMsg = 'ファイル書き込みに失敗しました: ' . $key . '.json';
        }
        fflush($fp);
        flock($fp, LOCK_UN);
        fclose($fp);
    }
    if ($written) {
        echo json_encode(array('ok' => true, 'apiVer' => 2), JSON_UNESCAPED_UNICODE);
    } else {
        http_response_code(500);
        echo json_encode(array('error' => $errMsg), JSON_UNESCAPED_UNICODE);
    }
}
