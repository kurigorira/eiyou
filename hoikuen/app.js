'use strict';

var APP_VERSION = '2026-09-25b';

var API_URL = '../api.php';
var WEEKDAYS = ['日','月','火','水','木','金','土'];
var MEAL_KEYS = ['b','s1','l','s2','d'];
var MEAL_NAMES = {b:'朝食',s1:'10時おやつ',l:'昼食',s2:'15時おやつ',d:'夕食'};
var TYPE_LABELS = {'':'−', normal:'普', kizami:'き'};
var TYPE_CYCLE = ['', 'normal', 'kizami'];

var staffList = [];
var children = [];
var holidays = [];
var orders = {};
var opHistory = [];
var config = {};
var hoikuConfirmed = {};
var prices = {};
var shifts = {};
var shiftDefs = [];      // 勤務区分マスタ [{name, meals:{b,s1,l,s2,d}}]
var hoikuConfig = {};    // 保育園専用の設定（管理者パスワード等）
var hAdminMode = false;
var toastTimer = null;
var orderLocked = true;
var orderDirty = false;

function apiSave(key, data) {
  fetch(API_URL + '?key=' + key, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(data)
  }).catch(function(e) { console.error('Save failed:', key, e); });
}

function loadData() {
  return fetch(API_URL + '?key=all').then(function(r) { return r.json(); }).then(function(d) {
    staffList = d.staff || [];
    children = d.children || [];
    holidays = d.holidays || [];
    orders = d.hoiku_orders || {};
    opHistory = d.hoiku_history || [];
    config = d.config || {};
    hoikuConfirmed = d.hoiku_confirmed || {};
    prices = d.prices || {};
    shifts = d.shifts || {};
    shiftDefs = d.shiftdefs || [];
    hoikuConfig = d.hoiku_config || {};
  });
}

function saveOrders() { apiSave('hoiku_orders', orders); }
function saveOrdersForChild(childId, y, m) {
  var key = y + '-' + pad(m);
  var partial = {};
  partial[key] = {};
  partial[key][childId] = (orders[key] && orders[key][childId]) ? orders[key][childId] : null;
  apiMerge('hoiku_orders', partial, 2);
}
// 保存要求を key ごとに直列化する（並行送信で古い内容が新しい内容を上書きするのを防ぐ）
var mergeQueue = {};

function mergePartialInto(target, src, depth) {
  for (var k in src) {
    if (depth >= 2 && src[k] && typeof src[k] === 'object' && !Array.isArray(src[k])) {
      if (!target[k] || typeof target[k] !== 'object' || Array.isArray(target[k])) target[k] = {};
      mergePartialInto(target[k], src[k], depth - 1);
    } else {
      target[k] = src[k];
    }
  }
}

function apiMerge(key, data, depth) {
  var q = mergeQueue[key];
  if (!q) q = mergeQueue[key] = {inFlight: false, pending: null, pendingDepth: depth};
  if (q.inFlight) {
    if (!q.pending) { q.pending = {}; q.pendingDepth = depth; }
    mergePartialInto(q.pending, data, depth || 1);
    return;
  }
  q.inFlight = true;
  var url = API_URL + '?key=' + key + '&action=merge';
  if (depth) url += '&depth=' + depth;
  fetch(url, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(data)
  }).catch(function(e) {
    console.error('Merge failed:', key, e);
  }).then(function() {
    q.inFlight = false;
    if (q.pending) {
      var next = q.pending, nextDepth = q.pendingDepth;
      q.pending = null;
      apiMerge(key, next, nextDepth);
    }
  });
}
function saveHistory() { apiSave('hoiku_history', opHistory); }
function saveConfirmed() { apiSave('hoiku_confirmed', hoikuConfirmed); }

function addHistory(staffId, childId, yearMonth, action, detail) {
  var s = getStaffById(staffId);
  var c = getChildById(childId);
  opHistory.unshift({
    timestamp: new Date().toLocaleString('ja-JP'),
    staffId: staffId,
    staffName: s ? s.name : staffId,
    childId: childId,
    childName: c ? c.name : childId,
    yearMonth: yearMonth,
    action: action,
    detail: detail || ''
  });
  if (opHistory.length > 2000) opHistory = opHistory.slice(0, 2000);
  saveHistory();
}

function showToast(msg) {
  var el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function() { el.classList.remove('show'); }, 2000);
}

function pad(n) { return n < 10 ? '0' + n : '' + n; }
function fmtDate(d) { return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }
function dayOfWeek(y, m, d) { return new Date(y, m-1, d).getDay(); }
function isWeekend(y, m, d) { var dow = dayOfWeek(y,m,d); return dow===0||dow===6; }
function getHolidayName(dateStr) {
  for (var i=0; i<holidays.length; i++) { if(holidays[i].date===dateStr) return holidays[i].name; }
  return null;
}
function isHoliday(dateStr) { return getHolidayName(dateStr) !== null; }
function isWorkday(y, m, d) {
  return !isWeekend(y,m,d) && !isHoliday(y+'-'+pad(m)+'-'+pad(d));
}

function getStaffById(id) {
  for (var i=0; i<staffList.length; i++) { if(staffList[i].id===id) return staffList[i]; }
  return null;
}
function getChildById(id) {
  for (var i=0; i<children.length; i++) { if(children[i].id===id) return children[i]; }
  return null;
}
function getChildrenByStaff(staffId) {
  return children.filter(function(c) { return c.staffId === staffId; });
}
function getStaffWithChildren() {
  var ids = {};
  for (var i=0; i<children.length; i++) ids[children[i].staffId] = true;
  return staffList.filter(function(s) { return ids[s.id]; }).sort(function(a,b) {
    if (a.dept < b.dept) return -1; if (a.dept > b.dept) return 1;
    if (a.id < b.id) return -1; if (a.id > b.id) return 1; return 0;
  });
}

function emptyMeal() { return {b:'',s1:'',l:'',s2:'',d:''}; }

// ==================== 区分・料金・勤務区分 ====================
var CHILD_CATEGORIES = [
  {key:'zaien',  label:'在園児'},
  {key:'ichiji', label:'一時預かり'},
  {key:'gakudo', label:'学童'}
];
function categoryLabel(key) {
  for (var i=0; i<CHILD_CATEGORIES.length; i++) {
    if (CHILD_CATEGORIES[i].key === key) return CHILD_CATEGORIES[i].label;
  }
  return CHILD_CATEGORIES[0].label; // 未設定は在園児として扱う
}
function childCategory(c) { return (c && c.category) ? c.category : 'zaien'; }

function getMealPrice(category, mealKey) {
  var row = prices[category || 'zaien'];
  var v = row ? row[mealKey] : 0;
  v = parseInt(v, 10);
  return isNaN(v) ? 0 : v;
}
function yen(n) { return Number(n || 0).toLocaleString('ja-JP') + '円'; }

function getShift(staffId, y, m, d) {
  var ym = y + '-' + pad(m);
  if (!shifts[ym] || !shifts[ym][staffId]) return '';
  return shifts[ym][staffId][d] || '';
}

// 勤務区分を手入力で書き換える（メモリ上のみ。保存は saveShiftDay / saveShiftStaffMonth）
function setShift(staffId, y, m, d, value) {
  var ym = y + '-' + pad(m);
  // PHPの json_encode は空の配列を [] として書き出すため、
  // 読み込んだ値が配列だったらオブジェクトに作り直してから代入する
  if (!shifts[ym] || Object.prototype.toString.call(shifts[ym]) === '[object Array]') shifts[ym] = {};
  if (!shifts[ym][staffId] || Object.prototype.toString.call(shifts[ym][staffId]) === '[object Array]') {
    shifts[ym][staffId] = {};
  }
  var v = (value == null) ? '' : String(value).trim();
  if (v === '') delete shifts[ym][staffId][d];
  else shifts[ym][staffId][String(d)] = v;
}

// 1日分の勤務区分をサーバーに保存する
function saveShiftDay(staffId, y, m, d, value) {
  var ym = y + '-' + pad(m);
  var partial = {};
  partial[ym] = {};
  partial[ym][staffId] = {};
  partial[ym][staffId][String(d)] = (value === '') ? null : value;
  apiMerge('shifts', partial, 3);
}

// 1人分の1か月をまとめてサーバーに保存する
function saveShiftStaffMonth(staffId, y, m) {
  var ym = y + '-' + pad(m);
  var cur = (shifts[ym] && shifts[ym][staffId]) ? shifts[ym][staffId] : {};
  var hasAny = false;
  for (var k in cur) { hasAny = true; break; }
  if (!hasAny && shifts[ym]) delete shifts[ym][staffId];
  var partial = {};
  partial[ym] = {};
  // 消した日も反映させるため、この職員の1か月分は丸ごと置き換える。
  // 空になったときは null を送る（PHPが {} を [] として書き出すのを防ぐ）
  partial[ym][staffId] = hasAny ? cur : null;
  apiMerge('shifts', partial, 2);
}

// 勤務区分の選択肢。マスタに無い値（DB取込の勤務CD等）も選択肢に残す
function shiftOptionsHtml(current) {
  var cur = current || '';
  var html = '<option value="">−</option>';
  var found = (cur === '');
  for (var i = 0; i < shiftDefs.length; i++) {
    var n = shiftDefs[i].name;
    if (n === cur) found = true;
    html += '<option value="' + esc(n) + '"' + (n === cur ? ' selected' : '') + '>' + esc(n) + '</option>';
  }
  if (!found) {
    html += '<option value="' + esc(cur) + '" selected>' + esc(cur) + '（マスタ未登録）</option>';
  }
  return html;
}

// 子供1人の月間の食数と金額を集計する
function childMonthCost(child, y, m) {
  var days = daysInMonth(y, m);
  var cat = childCategory(child);
  var counts = {b:0,s1:0,l:0,s2:0,d:0};
  var amount = 0;
  for (var d=1; d<=days; d++) {
    var o = getCountedOrder(child.id, y, m, d);
    for (var k=0; k<MEAL_KEYS.length; k++) {
      var mk = MEAL_KEYS[k];
      if (o[mk]) { counts[mk]++; amount += getMealPrice(cat, mk); }
    }
  }
  var total = 0;
  for (var k=0; k<MEAL_KEYS.length; k++) total += counts[MEAL_KEYS[k]];
  return {counts: counts, total: total, amount: amount, category: cat};
}

// 職員別（保護者別）の月間食事代
function staffMonthCostRows(y, m) {
  var byStaff = {};
  for (var i=0; i<children.length; i++) {
    var c = children[i];
    var r = childMonthCost(c, y, m);
    if (r.total === 0) continue;
    if (!byStaff[c.staffId]) byStaff[c.staffId] = {staffId: c.staffId, kids: [], amount: 0, total: 0};
    byStaff[c.staffId].kids.push({child: c, r: r});
    byStaff[c.staffId].amount += r.amount;
    byStaff[c.staffId].total  += r.total;
  }
  var ids = Object.keys(byStaff).sort();
  var out = [];
  for (var j=0; j<ids.length; j++) {
    var s = getStaffById(ids[j]);
    var e = byStaff[ids[j]];
    e.staffName = s ? s.name : ids[j];
    e.dept = s ? s.dept : '';
    out.push(e);
  }
  return out;
}

// 集計用: 「確定」済みの注文だけを対象にする（未確定は0扱い）
function getCountedOrder(childId, y, m, d) {
  if (!getOrderStatus(childId, y, m)) return emptyMeal();
  return getOrder(childId, y, m, d);
}
function getOrder(childId, y, m, d) {
  var key = y+'-'+pad(m);
  if (!orders[key] || !orders[key][childId] || !orders[key][childId][d]) return emptyMeal();
  var o = orders[key][childId][d];
  return {b:o.b||'', s1:o.s1||'', l:o.l||'', s2:o.s2||'', d:o.d||''};
}
function setOrder(childId, y, m, d, meal, val) {
  var key = y+'-'+pad(m);
  if (!orders[key]) orders[key] = {};
  if (!orders[key][childId]) orders[key][childId] = {};
  if (!orders[key][childId][d]) orders[key][childId][d] = emptyMeal();
  orders[key][childId][d][meal] = val;
}

function getOrderStatus(childId, y, m) {
  var sKey = y+'-'+pad(m)+'_'+childId;
  return hoikuConfirmed[sKey] === true;
}
function setOrderConfirmed(childId, y, m, val) {
  var sKey = y+'-'+pad(m)+'_'+childId;
  if (val) hoikuConfirmed[sKey] = true; else delete hoikuConfirmed[sKey];
  var partial = {};
  partial[sKey] = val ? true : null;
  apiMerge('hoiku_confirmed', partial);
}

function getEditPassword() { return config.password || ''; }
function esc(s) { var d=document.createElement('div'); d.textContent=s; return d.innerHTML; }
function typeLabel(v) { return v==='normal'?'普通食':v==='kizami'?'きざみ食':''; }


// ==================== 勤務区分マスタ ====================
// 標準の勤務区分と、その勤務のときに子供に必要な食事
var DEFAULT_SHIFT_DEFS = [
  {name:'Ａ',     code:'', meals:{b:false, s1:true,  l:true,  s2:true,  d:false}},
  {name:'ＡＭ',   code:'', meals:{b:false, s1:true,  l:true,  s2:false, d:false}},
  {name:'ＰＭ',   code:'', meals:{b:false, s1:false, l:false, s2:true,  d:false}},
  {name:'夕診',   code:'', meals:{b:false, s1:false, l:false, s2:true,  d:true }},
  {name:'日夕診', code:'', meals:{b:false, s1:true,  l:true,  s2:true,  d:true }},
  {name:'入',     code:'', meals:{b:false, s1:false, l:false, s2:false, d:true }},
  {name:'明',     code:'', meals:{b:true,  s1:false, l:false, s2:false, d:false}}
];

// 勤務区分は「名称」でも「勤務CD」でも引けるようにする。
// 勤務管理DBから勤務CDのまま取り込まれた場合に対応するため。
function getShiftDef(value) {
  if (!value) return null;
  var v = String(value).trim();
  for (var i=0; i<shiftDefs.length; i++) {
    if (shiftDefs[i].name === v) return shiftDefs[i];
  }
  for (var i=0; i<shiftDefs.length; i++) {
    if (shiftDefs[i].code && String(shiftDefs[i].code).trim() === v) return shiftDefs[i];
  }
  return null;
}

// ==================== 保育園 管理者モード ====================
function getHoikuPassword() { return hoikuConfig.password || ''; }

function applyHoikuAdmin() {
  var els = document.querySelectorAll('.admin-only');
  for (var i=0; i<els.length; i++) els[i].style.display = hAdminMode ? '' : 'none';
  var btn = document.getElementById('hadmin-toggle');
  if (hAdminMode) { btn.textContent = '管理者モード解除'; btn.classList.add('active-admin'); }
  else { btn.textContent = '管理者'; btn.classList.remove('active-admin'); }
  // 管理者の編集権限を注文入力画面にすぐ反映する
  if (document.getElementById('order-child') && document.getElementById('order-child').value) {
    renderOrderGrid();
  } else {
    renderOrderLockNotice();
    setOrderControlsDisabled(isOrderInputBlocked());
  }
}

function toggleHoikuAdmin() {
  if (hAdminMode) {
    hAdminMode = false;
    applyHoikuAdmin();
    showTab('today');
    showToast('管理者モードを解除しました');
    return;
  }
  fetch(API_URL + '?key=hoiku_config&t=' + Date.now()).then(function(r) { return r.json(); })
    .then(function(hc) {
      hoikuConfig = hc || {};
      var pw = getHoikuPassword();
      if (pw) {
        var input = prompt('保育園 管理者パスワードを入力してください');
        if (input === null) return;
        if (input !== pw) { showToast('パスワードが正しくありません'); return; }
      }
      hAdminMode = true;
      applyHoikuAdmin();
      showToast('管理者モードに入りました');
    }).catch(function() { showToast('サーバーとの通信に失敗しました'); });
}

function renderHoikuPwStatus() {
  var el = document.getElementById('hpw-status');
  if (!el) return;
  if (getHoikuPassword()) {
    el.textContent = '※ 保育園専用のパスワードが設定されています。';
    el.style.color = '#28a745';
  } else {
    el.textContent = '※ パスワード未設定。誰でも管理者モードに入れます。';
    el.style.color = '#dc3545';
  }
}

function saveHoikuConfig(next, onDone) {
  fetch(API_URL + '?key=hoiku_config', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(next)
  }).then(function(r) { return r.json(); }).then(function(res) {
    if (!res || !res.ok) { onDone((res && res.error) || '不明なエラー'); return; }
    hoikuConfig = next; onDone(null);
  }).catch(function(e) { onDone('通信エラー: ' + e.message); });
}

// ==================== TAB NAVIGATION ====================
function showTab(name) {
  var tabs = document.querySelectorAll('.tab-content');
  var btns = document.querySelectorAll('.tab-btn');
  for (var i=0; i<tabs.length; i++) tabs[i].classList.remove('active');
  for (var i=0; i<btns.length; i++) btns[i].classList.remove('active');
  document.getElementById('tab-'+name).classList.add('active');
  var btn = document.querySelector('[data-tab="'+name+'"]');
  if (btn) btn.classList.add('active');
  if (name==='today') renderToday();
  if (name==='order') initOrderTab();
  if (name==='report') initReportTab();
  if (name==='history') renderHistory();
  if (name==='children') initChildrenTab();
  if (name==='master') initMasterTab();
  if (name==='hsettings') { renderHoikuPwStatus(); }
}

// ==================== TODAY TAB ====================
function fetchAggregateData(fn) {
  var get = function(key) {
    return fetch(API_URL + '?key=' + key + '&t=' + Date.now()).then(function(r) { return r.json(); });
  };
  Promise.all([get('hoiku_orders'), get('hoiku_confirmed'), get('prices'), get('shifts'), get('children'), get('shiftdefs')])
    .then(function(res) {
      orders = res[0] || {};
      hoikuConfirmed = res[1] || {};
      prices = res[2] || {};
      shifts = res[3] || {};
      children = res[4] || [];
      shiftDefs = res[5] || [];
      fn();
    }).catch(function() { fn(); });
}
function renderToday() {
  fetchAggregateData(renderTodayInner);
}

function renderTodayInner() {
  var dateInput = document.getElementById('today-date');
  var ds = dateInput.value;
  if (!ds) { ds = fmtDate(new Date()); dateInput.value = ds; }
  var parts = ds.split('-');
  var y = parseInt(parts[0]), m = parseInt(parts[1]), d = parseInt(parts[2]);
  var notice = document.getElementById('today-holiday-notice');
  var hName = getHolidayName(ds);
  var dow = dayOfWeek(y,m,d);
  if (hName) { notice.textContent = ds+' は祝日（'+hName+'）です'; notice.style.display='block'; }
  else if (dow===0||dow===6) { notice.textContent = ds+' は'+WEEKDAYS[dow]+'曜日です'; notice.style.display='block'; }
  else { notice.style.display='none'; }

  var lists = {b:[],s1:[],l:[],s2:[],d:[]};
  for (var i=0; i<children.length; i++) {
    var c = children[i];
    var o = getCountedOrder(c.id, y, m, d);
    var s = getStaffById(c.staffId);
    var pName = s ? s.name : c.staffId;
    for (var k=0; k<MEAL_KEYS.length; k++) {
      var mk = MEAL_KEYS[k];
      if (o[mk]) lists[mk].push({childName:c.name, parentName:pName, type:o[mk]});
    }
  }
  for (var k=0; k<MEAL_KEYS.length; k++) {
    var mk = MEAL_KEYS[k];
    document.getElementById('mc-'+mk).textContent = lists[mk].length;
    var tb = document.getElementById('ml-'+mk);
    if (lists[mk].length === 0) {
      tb.innerHTML = '<tr><td colspan="3" style="text-align:center;color:#999">なし</td></tr>';
    } else {
      var html = '';
      for (var j=0; j<lists[mk].length; j++) {
        var item = lists[mk][j];
        html += '<tr><td>'+esc(item.childName)+'</td><td>'+esc(item.parentName)+'</td><td>'+typeLabel(item.type)+'</td></tr>';
      }
      tb.innerHTML = html;
    }
  }
}

// ==================== ORDER TAB ====================
function initOrderTab() {
  var now = new Date();
  var ySel = document.getElementById('order-year');
  var mSel = document.getElementById('order-month');
  if (ySel.options.length === 0) {
    for (var y=now.getFullYear()-1; y<=now.getFullYear()+2; y++) {
      var opt = document.createElement('option'); opt.value=y; opt.textContent=y; ySel.appendChild(opt);
    }
    for (var m=1; m<=12; m++) {
      var opt = document.createElement('option'); opt.value=m; opt.textContent=m; mSel.appendChild(opt);
    }
    var defM = now.getMonth()+2, defY = now.getFullYear();
    if (defM > 12) { defM=1; defY++; }
    ySel.value = defY; mSel.value = defM;
  }
  var g = function(k) { return fetch(API_URL + '?key=' + k + '&t=' + Date.now()).then(function(r) { return r.json(); }); };
  Promise.all([g('config'), g('shifts'), g('children'), g('shiftdefs')]).then(function(res) {
    config = res[0] || {};
    shifts = res[1] || {};
    children = res[2] || [];
    shiftDefs = res[3] || [];
  }).catch(function(){}).then(function() {
    renderOrderLockNotice();
    setOrderControlsDisabled(isOrderInputBlocked());
    populateOrderStaff();
  });
}

function populateOrderStaff() {
  var sel = document.getElementById('order-staff');
  var cur = sel.value;
  sel.innerHTML = '<option value="">-- 選択 --</option>';
  var list = getStaffWithChildren();
  for (var i=0; i<list.length; i++) {
    var o = document.createElement('option');
    o.value = list[i].id;
    o.textContent = list[i].id + ' ' + list[i].name;
    sel.appendChild(o);
  }
  sel.value = cur;
  populateOrderChild();
}

function populateOrderChild() {
  var staffId = document.getElementById('order-staff').value;
  var sel = document.getElementById('order-child');
  var cur = sel.value;
  sel.innerHTML = '<option value="">-- 選択 --</option>';
  if (staffId) {
    var list = getChildrenByStaff(staffId);
    for (var i=0; i<list.length; i++) {
      var o = document.createElement('option');
      o.value = list[i].id;
      o.textContent = list[i].name;
      sel.appendChild(o);
    }
  }
  sel.value = cur;
  renderOrderGrid();
}

function renderOrderGrid() {
  var wrap = document.getElementById('order-grid-wrap');
  var summary = document.getElementById('order-summary');
  var actions = document.getElementById('order-actions');
  var childId = document.getElementById('order-child').value;
  var staffId = document.getElementById('order-staff').value;
  if (!childId || !staffId) {
    wrap.innerHTML = '<p class="placeholder-msg">保護者と子供を選択してください</p>';
    summary.style.display = 'none';
    actions.style.display = 'none';
    return;
  }
  var y = parseInt(document.getElementById('order-year').value);
  var m = parseInt(document.getElementById('order-month').value);
  var cfm = getOrderStatus(childId, y, m);
  renderOrderLockNotice();
  setOrderControlsDisabled(isOrderInputBlocked());
  orderLocked = cfm || isOrderInputBlocked();
  orderDirty = false;
  var days = daysInMonth(y, m);
  var todayStr = fmtDate(new Date());
  var disabledCls = orderLocked ? ' disabled' : '';
  var html = '<table class="order-table"><thead><tr><th>日</th><th>曜</th><th>保護者の勤務</th>';
  for (var k=0; k<MEAL_KEYS.length; k++) html += '<th>'+MEAL_NAMES[MEAL_KEYS[k]]+'</th>';
  html += '<th>備考</th></tr></thead><tbody>';
  var totals = {b:0,s1:0,l:0,s2:0,d:0};
  for (var d=1; d<=days; d++) {
    var dow = dayOfWeek(y,m,d);
    var ds = y+'-'+pad(m)+'-'+pad(d);
    var hName = getHolidayName(ds);
    var cls = '';
    if (hName) cls='day-holiday'; else if (dow===0) cls='day-sun'; else if (dow===6) cls='day-sat';
    if (ds===todayStr) cls += ' day-today';
    var o = getOrder(childId, y, m, d);
    var sh = getShift(staffId, y, m, d);
    html += '<tr class="'+cls+'"><td>'+d+'</td><td>'+WEEKDAYS[dow]+'</td>';
    var sd = sh ? getShiftDef(sh) : null;
    var applyBtn = (sd && !orderLocked)
      ? ' <button class="btn-sm shift-apply" data-d="'+d+'" title="この勤務区分の食事を入れる">反映</button>' : '';
    // 勤務区分はその場で手入力できる（勤務DBから取り込めない場合の入力口）
    var shSel = '<select class="shift-sel" data-d="'+d+'"'
              + (shiftEditAllowed() ? '' : ' disabled') + '>' + shiftOptionsHtml(sh) + '</select>';
    html += '<td style="font-size:0.75rem;white-space:nowrap">'+shSel+applyBtn+'</td>';
    for (var k=0; k<MEAL_KEYS.length; k++) {
      var mk = MEAL_KEYS[k];
      var v = o[mk] || '';
      if (v) totals[mk]++;
      var cellCls = 'meal-cell' + (v ? ' '+v : '') + disabledCls;
      html += '<td class="'+cellCls+'" data-d="'+d+'" data-m="'+mk+'">'+TYPE_LABELS[v]+'</td>';
    }
    html += '<td style="text-align:left;font-size:0.75rem;color:#999">'+(hName||'')+'</td></tr>';
  }
  html += '</tbody></table>';
  wrap.innerHTML = html;
  summary.style.display = '';
  actions.style.display = '';
  for (var k=0; k<MEAL_KEYS.length; k++) {
    document.getElementById('os-'+MEAL_KEYS[k]).textContent = totals[MEAL_KEYS[k]];
  }
  updateOrderButtons();

  var cells = wrap.querySelectorAll('.meal-cell:not(.disabled)');
  for (var i=0; i<cells.length; i++) {
    cells[i].addEventListener('click', createCellClickHandler());
  }
  var applies = wrap.querySelectorAll('button.shift-apply');
  for (var i=0; i<applies.length; i++) {
    applies[i].addEventListener('click', function(ev) {
      ev.preventDefault();
      applyShiftToDay(parseInt(this.getAttribute('data-d'), 10));
    });
  }
  var sels = wrap.querySelectorAll('select.shift-sel');
  for (var i=0; i<sels.length; i++) {
    sels[i].addEventListener('change', onOrderShiftChange);
  }
}

// 勤務区分の手入力が可能か。受付停止中でも管理者なら入力できる
function shiftEditAllowed() { return hAdminMode || !isOrderInputBlocked(); }

// 注文入力画面で勤務区分を変更したとき
function onOrderShiftChange() {
  var staffId = document.getElementById('order-staff').value;
  if (!staffId) return;
  var y = parseInt(document.getElementById('order-year').value);
  var m = parseInt(document.getElementById('order-month').value);
  var d = parseInt(this.getAttribute('data-d'), 10);
  var v = this.value;
  setShift(staffId, y, m, d, v);
  saveShiftDay(staffId, y, m, d, v);
  var sd = v ? getShiftDef(v) : null;
  // 勤務区分を入れたら、その日の食事も入れるか確認する
  if (sd && !orderLocked && confirm(d + '日を「' + sd.name + '」にしました。\nこの勤務区分の食事を注文に反映しますか？')) {
    applyShiftToDay(d);
    return;
  }
  renderOrderGrid();
  showToast(d + '日の勤務区分を「' + (v || '未設定') + '」にしました');
}

// 指定日の勤務区分から、必要な食事を自動で入れる
function applyShiftToDay(day) {
  if (!requireUnlocked()) return;
  var childId = document.getElementById('order-child').value;
  var staffId = document.getElementById('order-staff').value;
  if (!childId || !staffId) return;
  var y = parseInt(document.getElementById('order-year').value);
  var m = parseInt(document.getElementById('order-month').value);
  var sd = getShiftDef(getShift(staffId, y, m, day));
  if (!sd) { showToast('この日の勤務区分に対応する設定がありません'); return; }
  for (var k=0; k<MEAL_KEYS.length; k++) {
    var mk = MEAL_KEYS[k];
    setOrder(childId, y, m, day, mk, (sd.meals && sd.meals[mk]) ? 'normal' : '');
  }
  saveOrdersForChild(childId, y, m);
  orderDirty = true;
  renderOrderGrid();
  showToast(day + '日に「' + sd.name + '」の食事を反映しました');
}

// 月内すべての日に、勤務区分から食事を自動で入れる
function applyShiftToMonth() {
  if (!requireUnlocked()) return;
  var childId = document.getElementById('order-child').value;
  var staffId = document.getElementById('order-staff').value;
  if (!childId || !staffId) { showToast('保護者と子供を選択してください'); return; }
  var y = parseInt(document.getElementById('order-year').value);
  var m = parseInt(document.getElementById('order-month').value);
  var days = daysInMonth(y, m);
  var n = 0;
  for (var d=1; d<=days; d++) {
    var sd = getShiftDef(getShift(staffId, y, m, d));
    if (!sd) continue;
    for (var k=0; k<MEAL_KEYS.length; k++) {
      var mk = MEAL_KEYS[k];
      setOrder(childId, y, m, d, mk, (sd.meals && sd.meals[mk]) ? 'normal' : '');
    }
    n++;
  }
  if (n === 0) { showToast('勤務区分が取り込まれていないか、対応する設定がありません'); return; }
  saveOrdersForChild(childId, y, m);
  orderDirty = true;
  renderOrderGrid();
  showToast(n + '日分に勤務区分から食事を反映しました');
}

function createCellClickHandler() {
  return function() {
    var day = parseInt(this.getAttribute('data-d'));
    var meal = this.getAttribute('data-m');
    var cid = document.getElementById('order-child').value;
    var sid = document.getElementById('order-staff').value;
    var cy = parseInt(document.getElementById('order-year').value);
    var cm = parseInt(document.getElementById('order-month').value);
    if (isOrderInputBlocked()) { showToast('現在、注文の受付を停止しています'); return; }
    var cur = getOrder(cid, cy, cm, day)[meal] || '';
    var idx = TYPE_CYCLE.indexOf(cur);
    var next = TYPE_CYCLE[(idx + 1) % TYPE_CYCLE.length];
    setOrder(cid, cy, cm, day, meal, next);
    saveOrdersForChild(cid, cy, cm);
    this.textContent = TYPE_LABELS[next];
    this.className = 'meal-cell' + (next ? ' '+next : '');
    var detail = day+'日 '+MEAL_NAMES[meal]+' '+(next ? typeLabel(next) : '取消');
    addHistory(sid, cid, cy+'-'+pad(cm), '変更', detail);
    orderDirty = true;
    updateSummary(cy, cm, cid);
    updateOrderButtons();
  };
}

function updateSummary(y, m, childId) {
  var days = daysInMonth(y, m);
  var totals = {b:0,s1:0,l:0,s2:0,d:0};
  for (var d=1; d<=days; d++) {
    var o = getOrder(childId, y, m, d);
    for (var k=0; k<MEAL_KEYS.length; k++) { if (o[MEAL_KEYS[k]]) totals[MEAL_KEYS[k]]++; }
  }
  for (var k=0; k<MEAL_KEYS.length; k++) {
    document.getElementById('os-'+MEAL_KEYS[k]).textContent = totals[MEAL_KEYS[k]];
  }
}

function updateOrderButtons() {
  var childId = document.getElementById('order-child').value;
  if (!childId) return;
  var y = parseInt(document.getElementById('order-year').value);
  var m = parseInt(document.getElementById('order-month').value);
  var cfm = getOrderStatus(childId, y, m);
  var status = document.getElementById('order-status');
  var confirmBtn = document.getElementById('order-confirm');
  var editBtn = document.getElementById('order-edit');
  var unconfirmBtn = document.getElementById('order-unconfirm');
  if (cfm && !orderDirty) {
    status.textContent = '確定済み'; status.className = 'order-status confirmed';
    confirmBtn.style.display = 'none'; editBtn.style.display = '';
    editBtn.textContent = hAdminMode ? '修正（管理者）' : '修正';
  } else if (orderDirty) {
    status.textContent = '未保存の変更があります'; status.className = 'order-status unsaved';
    confirmBtn.style.display = ''; confirmBtn.textContent = '確定'; editBtn.style.display = 'none';
  } else {
    status.textContent = '未確定'; status.className = 'order-status editing';
    confirmBtn.style.display = ''; confirmBtn.textContent = '確定'; editBtn.style.display = 'none';
  }
  // 確定解除は管理者のみ、確定済みのときだけ
  if (unconfirmBtn) unconfirmBtn.style.display = (hAdminMode && cfm) ? '' : 'none';
}

// 管理者が確定を取り消す（保護者がもう一度入力し直せるようにする）
function unconfirmOrder() {
  if (!hAdminMode) { showToast('管理者モードで操作してください'); return; }
  var childId = document.getElementById('order-child').value;
  var staffId = document.getElementById('order-staff').value;
  if (!childId) return;
  var y = parseInt(document.getElementById('order-year').value);
  var m = parseInt(document.getElementById('order-month').value);
  var c = getChildById(childId);
  if (!confirm('【確定解除】' + (c ? c.name : childId) + ' の ' + y + '年' + m + '月の確定を取り消しますか？\n\n'
             + '保護者が再度入力・確定できる状態に戻ります。注文の内容は消えません。')) return;
  setOrderConfirmed(childId, y, m, false);
  addHistory(staffId, childId, y+'-'+pad(m), '確定解除', '管理者');
  orderLocked = false; orderDirty = false;
  renderOrderGrid();
  showToast('確定を解除しました');
}

function getSummaryText(childId, y, m) {
  var days = daysInMonth(y, m);
  var t = {b:0,s1:0,l:0,s2:0,d:0};
  for (var d=1; d<=days; d++) {
    var o = getOrder(childId, y, m, d);
    for (var k=0; k<MEAL_KEYS.length; k++) { if (o[MEAL_KEYS[k]]) t[MEAL_KEYS[k]]++; }
  }
  return '朝'+t.b+' 10おや'+t.s1+' 昼'+t.l+' 15おや'+t.s2+' 夕'+t.d;
}

function confirmOrder() {
  var childId = document.getElementById('order-child').value;
  var staffId = document.getElementById('order-staff').value;
  if (!childId) return;
  if (isOrderInputBlocked()) { showToast('現在、注文の受付を停止しています'); return; }
  var y = parseInt(document.getElementById('order-year').value);
  var m = parseInt(document.getElementById('order-month').value);
  var c = getChildById(childId);
  var ps = getStaffById(staffId);
  var msg = '【確定の確認】この子供の注文で間違いありませんか？\n\n'
    + '　子供　： ' + (c ? c.name : childId) + '\n'
    + '　保護者： ' + (ps ? ps.id + '　' + ps.name : staffId) + '\n'
    + '　対象月： ' + y + '年' + m + '月\n'
    + '　内容　： ' + getSummaryText(childId, y, m) + '\n';
  if (!confirm(msg)) return;
  var was = getOrderStatus(childId, y, m);
  saveOrdersForChild(childId, y, m);
  setOrderConfirmed(childId, y, m, true);
  addHistory(staffId, childId, y+'-'+pad(m), was?'修正確定':'確定', getSummaryText(childId,y,m));
  orderLocked = true; orderDirty = false;
  setCellsDisabled(true);
  updateOrderButtons();
  showToast(y+'年'+m+'月の注文を確定しました');
}

function editOrder() {
  var childId = document.getElementById('order-child').value;
  var staffId = document.getElementById('order-staff').value;
  if (!childId) return;
  if (isOrderInputBlocked()) { showToast('現在、注文の受付を停止しています'); return; }
  // 保育園の管理者はパスワードなしで編集できる
  var savedPw = getEditPassword();
  if (savedPw && !hAdminMode) {
    var input = prompt('編集パスワードを入力してください');
    if (input === null) return;
    if (input !== savedPw) { showToast('パスワードが正しくありません'); return; }
  }
  var y = parseInt(document.getElementById('order-year').value);
  var m = parseInt(document.getElementById('order-month').value);
  addHistory(staffId, childId, y+'-'+pad(m), '修正開始', hAdminMode ? '管理者' : '');
  orderLocked = false; orderDirty = false;
  setCellsDisabled(false);
  var status = document.getElementById('order-status');
  status.textContent = '修正中'; status.className = 'order-status editing';
  document.getElementById('order-confirm').style.display = '';
  document.getElementById('order-confirm').textContent = '確定';
  document.getElementById('order-edit').style.display = 'none';
  showToast('修正モードに切り替えました');
}

function setCellsDisabled(disabled) {
  var cells = document.querySelectorAll('#order-grid-wrap .meal-cell');
  for (var i=0; i<cells.length; i++) {
    if (disabled) cells[i].classList.add('disabled');
    else cells[i].classList.remove('disabled');
  }
  if (!disabled) {
    var activeCells = document.querySelectorAll('#order-grid-wrap .meal-cell:not(.disabled)');
    for (var i=0; i<activeCells.length; i++) {
      activeCells[i].addEventListener('click', createCellClickHandler());
    }
  }
}

// ==================== ORDER LOCK (受付停止) ====================
var DEFAULT_LOCK_MSG = '現在、注文の受付を停止しています。変更が必要な場合は栄養科までご連絡ください。';
function isLockOn() { return !!(config.lock && config.lock.on); }
// 保育園の管理者は受付停止中でも注文を編集できる
function isOrderInputBlocked() {
  if (hAdminMode) return false;
  return isLockOn();
}
function getLockMessage() {
  return (config.lock && config.lock.msg) ? config.lock.msg : DEFAULT_LOCK_MSG;
}
function renderOrderLockNotice() {
  var el = document.getElementById('order-lock-notice');
  if (!el) return;
  if (isLockOn() && !hAdminMode) {
    el.textContent = '【受付停止中】' + getLockMessage();
    el.style.display = 'block';
  } else if (isLockOn() && hAdminMode) {
    el.textContent = '【受付停止中】ただし管理者モードのため、この画面から注文を編集できます。';
    el.style.display = 'block';
  } else if (hAdminMode) {
    el.textContent = '【管理者モード】確定済みの注文もパスワードなしで編集できます。変更は入力履歴に「管理者」と記録されます。';
    el.style.display = 'block';
  } else {
    el.style.display = 'none';
  }
}
function setOrderControlsDisabled(disabled) {
  var ids = ['bulk-weekday-all','bulk-copy-prev','bulk-clear','order-confirm','order-edit'];
  for (var i=0; i<ids.length; i++) {
    var el = document.getElementById(ids[i]);
    if (el) el.disabled = disabled;
  }
}

function requireUnlocked() {
  if (isOrderInputBlocked()) { showToast('現在、注文の受付を停止しています'); return false; }
  if (orderLocked) { showToast('修正ボタンを押してから操作してください'); return false; }
  return true;
}

function bulkSetWeekdayAll() {
  var childId = document.getElementById('order-child').value;
  var staffId = document.getElementById('order-staff').value;
  if (!childId) { showToast('子供を選択してください'); return; }
  if (!requireUnlocked()) return;
  var y = parseInt(document.getElementById('order-year').value);
  var m = parseInt(document.getElementById('order-month').value);
  var days = daysInMonth(y, m);
  for (var d=1; d<=days; d++) {
    if (isWorkday(y, m, d)) {
      for (var k=0; k<MEAL_KEYS.length; k++) setOrder(childId, y, m, d, MEAL_KEYS[k], 'normal');
    }
  }
  saveOrdersForChild(childId, y, m);
  addHistory(staffId, childId, y+'-'+pad(m), '一括操作', '平日全食セット（普通食）');
  orderDirty = true;
  renderOrderGridKeepUnlocked();
  showToast('平日の全食を普通食でセットしました');
}

function bulkCopyPrev() {
  var childId = document.getElementById('order-child').value;
  var staffId = document.getElementById('order-staff').value;
  if (!childId) { showToast('子供を選択してください'); return; }
  if (!requireUnlocked()) return;
  var y = parseInt(document.getElementById('order-year').value);
  var m = parseInt(document.getElementById('order-month').value);
  var py = m===1 ? y-1 : y; var pm = m===1 ? 12 : m-1;
  var prevKey = py+'-'+pad(pm);
  if (!orders[prevKey] || !orders[prevKey][childId]) { showToast('前月のデータがありません'); return; }
  var days = daysInMonth(y, m);
  for (var d=1; d<=days; d++) {
    var prev = getOrder(childId, py, pm, d);
    var key = y+'-'+pad(m);
    if (!orders[key]) orders[key] = {};
    if (!orders[key][childId]) orders[key][childId] = {};
    orders[key][childId][d] = {b:prev.b, s1:prev.s1, l:prev.l, s2:prev.s2, d:prev.d};
  }
  saveOrdersForChild(childId, y, m);
  addHistory(staffId, childId, y+'-'+pad(m), '前月コピー', py+'年'+pm+'月からコピー');
  orderDirty = true;
  renderOrderGridKeepUnlocked();
  showToast('前月のデータをコピーしました');
}

function bulkClear() {
  var childId = document.getElementById('order-child').value;
  var staffId = document.getElementById('order-staff').value;
  if (!childId) { showToast('子供を選択してください'); return; }
  if (!requireUnlocked()) return;
  if (!confirm('この月の注文を全てクリアしますか？')) return;
  var y = parseInt(document.getElementById('order-year').value);
  var m = parseInt(document.getElementById('order-month').value);
  var key = y+'-'+pad(m);
  if (orders[key] && orders[key][childId]) delete orders[key][childId];
  saveOrdersForChild(childId, y, m);
  setOrderConfirmed(childId, y, m, false);
  addHistory(staffId, childId, y+'-'+pad(m), 'クリア', '全注文を削除');
  orderDirty = false; orderLocked = false;
  renderOrderGridKeepUnlocked();
  showToast('クリアしました');
}

function renderOrderGridKeepUnlocked() {
  var saveLocked = orderLocked; var saveDirty = orderDirty;
  renderOrderGrid();
  orderLocked = saveLocked; orderDirty = saveDirty;
  setCellsDisabled(orderLocked);
  updateOrderButtons();
}

// ==================== REPORT TAB ====================
function initReportTab() {
  var now = new Date();
  var ySel = document.getElementById('rpt-year');
  var mSel = document.getElementById('rpt-month');
  if (ySel.options.length === 0) {
    for (var y=now.getFullYear()-1; y<=now.getFullYear()+2; y++) {
      var opt = document.createElement('option'); opt.value=y; opt.textContent=y; ySel.appendChild(opt);
    }
    for (var m=1; m<=12; m++) {
      var opt = document.createElement('option'); opt.value=m; opt.textContent=m; mSel.appendChild(opt);
    }
    ySel.value = now.getFullYear(); mSel.value = now.getMonth()+1;
  }
}




// ==================== 子供管理タブ ====================
function initChildrenTab() {
  var get = function(k) { return fetch(API_URL + '?key=' + k + '&t=' + Date.now()).then(function(r){return r.json();}); };
  Promise.all([get('children'), get('staff')]).then(function(res) {
    children = res[0] || [];
    staffList = res[1] || [];
  }).catch(function(){}).then(function() {
    populateChildStaff();
    renderChildList();
  });
}

function populateChildStaff() {
  var search = (document.getElementById('child-staff-search').value || '').toLowerCase();
  var sel = document.getElementById('child-staff');
  var cur = sel.value;
  sel.innerHTML = '<option value="">-- 選択 --</option>';
  var sorted = staffList.slice().sort(function(a,b) {
    if (a.dept < b.dept) return -1; if (a.dept > b.dept) return 1;
    if (a.id < b.id) return -1; if (a.id > b.id) return 1; return 0;
  });
  for (var i=0; i<sorted.length; i++) {
    var st = sorted[i];
    if (search && st.id.toLowerCase().indexOf(search)===-1 &&
        st.name.toLowerCase().indexOf(search)===-1 &&
        (st.dept||'').toLowerCase().indexOf(search)===-1) continue;
    var o = document.createElement('option');
    o.value = st.id;
    o.textContent = st.id + ' ' + st.name + '（' + (st.dept||'') + '）';
    sel.appendChild(o);
  }
  sel.value = cur;
}

function renderChildList() {
  var tb = document.getElementById('child-list');
  if (!tb) return;
  var sorted = children.slice().sort(function(a,b) {
    if (a.staffId < b.staffId) return -1; if (a.staffId > b.staffId) return 1; return 0;
  });
  var html = '';
  for (var i=0; i<sorted.length; i++) {
    var c = sorted[i];
    var st = getStaffById(c.staffId);
    html += '<tr><td>'+esc(c.name)+'</td>';
    html += '<td>'+esc(st ? st.name+'('+c.staffId+')' : c.staffId)+'</td>';
    html += '<td><select class="child-cat" data-id="'+esc(c.id)+'">';
    for (var k=0; k<CHILD_CATEGORIES.length; k++) {
      var cat = CHILD_CATEGORIES[k];
      html += '<option value="'+cat.key+'"'+(childCategory(c)===cat.key?' selected':'')+'>'+cat.label+'</option>';
    }
    html += '</select></td>';
    html += '<td><button class="btn-del" data-del="'+esc(c.id)+'">削除</button></td></tr>';
  }
  if (!html) html = '<tr><td colspan="4" style="text-align:center;color:#999">子供の登録なし</td></tr>';
  tb.innerHTML = html;
  var sels = tb.querySelectorAll('select.child-cat');
  for (var i=0; i<sels.length; i++) {
    sels[i].addEventListener('change', function() {
      var cid = this.getAttribute('data-id');
      for (var j=0; j<children.length; j++) if (children[j].id === cid) children[j].category = this.value;
      apiSave('children', children);
      showToast('区分を変更しました');
    });
  }
  var dels = tb.querySelectorAll('button[data-del]');
  for (var i=0; i<dels.length; i++) {
    dels[i].addEventListener('click', function() { deleteChild(this.getAttribute('data-del')); });
  }
}

function submitChild(e) {
  e.preventDefault();
  var staffId = document.getElementById('child-staff').value;
  if (!staffId) { showToast('保護者を選択してください'); return; }
  var name = document.getElementById('cf-name').value.trim();
  if (!name) return;
  children.push({
    id: 'C' + Date.now(),
    staffId: staffId,
    name: name,
    category: document.getElementById('cf-category').value || 'zaien'
  });
  apiSave('children', children);
  document.getElementById('cf-name').value = '';
  renderChildList();
  showToast(name + 'を登録しました');
}

function deleteChild(childId) {
  var c = getChildById(childId);
  if (!c) return;
  if (!confirm(c.name + 'を削除しますか？\n（この子供の注文データは残りますが一覧に出なくなります）')) return;
  children = children.filter(function(x){ return x.id !== childId; });
  apiSave('children', children);
  renderChildList();
  showToast('削除しました');
}

// ==================== 料金・勤務区分タブ ====================
function initMasterTab() {
  var ySel = document.getElementById('shift-year');
  var mSel = document.getElementById('shift-month');
  if (ySel && ySel.options.length === 0) {
    var now = new Date();
    for (var y=now.getFullYear()-1; y<=now.getFullYear()+2; y++) {
      var o = document.createElement('option'); o.value=y; o.textContent=y; ySel.appendChild(o);
    }
    for (var m=1; m<=12; m++) {
      var o2 = document.createElement('option'); o2.value=m; o2.textContent=m; mSel.appendChild(o2);
    }
    ySel.value = now.getFullYear(); mSel.value = now.getMonth()+1;
  }
  var get = function(k) { return fetch(API_URL + '?key=' + k + '&t=' + Date.now()).then(function(r){return r.json();}); };
  Promise.all([get('prices'), get('shifts'), get('shiftdefs')]).then(function(res) {
    prices = res[0] || {};
    shifts = res[1] || {};
    shiftDefs = res[2] || [];
  }).catch(function(){}).then(function() {
    renderPriceTable();
    renderShiftDefTable();
    initManualShift();
    renderShiftPreview();
  });
}

// ==================== 勤務区分の手入力（月間） ====================
function initManualShift() {
  var ySel = document.getElementById('msh-year');
  var mSel = document.getElementById('msh-month');
  if (!ySel) return;
  if (ySel.options.length === 0) {
    var now = new Date();
    for (var y=now.getFullYear()-1; y<=now.getFullYear()+2; y++) {
      var o = document.createElement('option'); o.value=y; o.textContent=y; ySel.appendChild(o);
    }
    for (var m=1; m<=12; m++) {
      var o2 = document.createElement('option'); o2.value=m; o2.textContent=m; mSel.appendChild(o2);
    }
    // 注文入力と同じく翌月を初期値にする
    var defM = now.getMonth()+2, defY = now.getFullYear();
    if (defM > 12) { defM = 1; defY++; }
    ySel.value = defY; mSel.value = defM;
  }
  populateManualShiftStaff();
  renderManualShiftBulkValues();
  renderManualShiftGrid();
}

function populateManualShiftStaff() {
  var sel = document.getElementById('msh-staff');
  if (!sel) return;
  var search = (document.getElementById('msh-staff-search').value || '').toLowerCase();
  var cur = sel.value;
  sel.innerHTML = '<option value="">-- 選択 --</option>';
  // 子供が登録されている保護者を先に、続けてその他の職員を並べる
  var withChild = {};
  for (var i=0; i<children.length; i++) withChild[children[i].staffId] = true;
  var sorted = staffList.slice().sort(function(a,b) {
    var aw = withChild[a.id] ? 0 : 1, bw = withChild[b.id] ? 0 : 1;
    if (aw !== bw) return aw - bw;
    if (a.dept < b.dept) return -1; if (a.dept > b.dept) return 1;
    if (a.id < b.id) return -1; if (a.id > b.id) return 1; return 0;
  });
  for (var i=0; i<sorted.length; i++) {
    var st = sorted[i];
    if (search && st.id.toLowerCase().indexOf(search)===-1 &&
        st.name.toLowerCase().indexOf(search)===-1 &&
        (st.dept||'').toLowerCase().indexOf(search)===-1) continue;
    var o = document.createElement('option');
    o.value = st.id;
    o.textContent = (withChild[st.id] ? '★ ' : '') + st.id + ' ' + st.name + '（' + (st.dept||'') + '）';
    sel.appendChild(o);
  }
  sel.value = cur;
}

function renderManualShiftBulkValues() {
  var sel = document.getElementById('msh-bulk-value');
  if (!sel) return;
  var cur = sel.value;
  sel.innerHTML = shiftOptionsHtml('');
  sel.value = cur;
}

function renderManualShiftGrid() {
  var wrap = document.getElementById('msh-grid');
  if (!wrap) return;
  var staffId = document.getElementById('msh-staff').value;
  if (!staffId) {
    wrap.innerHTML = '<p class="placeholder-msg">保護者を選択してください</p>';
    return;
  }
  if (shiftDefs.length === 0) {
    wrap.innerHTML = '<p class="placeholder-msg">先に上の「勤務区分マスタ」に勤務区分を登録してください'
                   + '（「標準の7区分を入れる」で作れます）。</p>';
    return;
  }
  var y = parseInt(document.getElementById('msh-year').value);
  var m = parseInt(document.getElementById('msh-month').value);
  var days = daysInMonth(y, m);
  var html = '<table class="data-table" style="min-width:560px"><thead><tr>'
           + '<th>日</th><th>曜</th><th>勤務区分</th><th>この勤務で出る食事</th></tr></thead><tbody>';
  for (var d=1; d<=days; d++) {
    var dow = dayOfWeek(y, m, d);
    var ds = y+'-'+pad(m)+'-'+pad(d);
    var hName = getHolidayName(ds);
    var cls = '';
    if (hName) cls='day-holiday'; else if (dow===0) cls='day-sun'; else if (dow===6) cls='day-sat';
    var cur = getShift(staffId, y, m, d);
    var sd = cur ? getShiftDef(cur) : null;
    var meals = [];
    if (sd) {
      for (var k=0; k<MEAL_KEYS.length; k++) {
        if (sd.meals && sd.meals[MEAL_KEYS[k]]) meals.push(MEAL_NAMES[MEAL_KEYS[k]]);
      }
    }
    var note = sd ? (meals.length ? meals.join('・') : 'なし')
                  : (cur ? '<span style="color:#dc3545">勤務区分マスタに未登録</span>' : '');
    html += '<tr class="'+cls+'"><td>'+d+'</td><td>'+WEEKDAYS[dow]+(hName?'<br><span style="font-size:0.7rem;color:#999">'+esc(hName)+'</span>':'')+'</td>'
          + '<td><select class="msh-sel" data-d="'+d+'">'+shiftOptionsHtml(cur)+'</select></td>'
          + '<td style="text-align:left;font-size:0.8rem;color:#666">'+note+'</td></tr>';
  }
  html += '</tbody></table>';
  wrap.innerHTML = html;
  var sels = wrap.querySelectorAll('select.msh-sel');
  for (var i=0; i<sels.length; i++) {
    sels[i].addEventListener('change', function() {
      var sid = document.getElementById('msh-staff').value;
      var yy = parseInt(document.getElementById('msh-year').value);
      var mm = parseInt(document.getElementById('msh-month').value);
      var dd = parseInt(this.getAttribute('data-d'), 10);
      setShift(sid, yy, mm, dd, this.value);
      saveShiftDay(sid, yy, mm, dd, this.value);
      renderManualShiftGrid();
      setManualShiftStatus(dd + '日を「' + (this.value || '未設定') + '」にしました');
    });
  }
}

function setManualShiftStatus(msg, isError) {
  var el = document.getElementById('msh-status');
  if (!el) return;
  el.style.color = isError ? '#dc3545' : '';
  el.textContent = msg;
}

function manualShiftContext() {
  var staffId = document.getElementById('msh-staff').value;
  if (!staffId) { setManualShiftStatus('保護者を選択してください', true); return null; }
  return {
    staffId: staffId,
    y: parseInt(document.getElementById('msh-year').value),
    m: parseInt(document.getElementById('msh-month').value)
  };
}

// 平日（土日祝を除く）にまとめて同じ勤務区分を入れる
function manualShiftBulkWeekday() {
  var c = manualShiftContext();
  if (!c) return;
  var v = document.getElementById('msh-bulk-value').value;
  var days = daysInMonth(c.y, c.m);
  var n = 0;
  for (var d=1; d<=days; d++) {
    if (!isWorkday(c.y, c.m, d)) continue;
    setShift(c.staffId, c.y, c.m, d, v);
    n++;
  }
  saveShiftStaffMonth(c.staffId, c.y, c.m);
  renderManualShiftGrid();
  setManualShiftStatus('平日 ' + n + '日を「' + (v || '未設定') + '」にしました');
  showToast('平日 ' + n + '日に反映しました');
}

function manualShiftCopyPrev() {
  var c = manualShiftContext();
  if (!c) return;
  var py = c.m === 1 ? c.y - 1 : c.y;
  var pm = c.m === 1 ? 12 : c.m - 1;
  var pym = py + '-' + pad(pm);
  var src = (shifts[pym] && shifts[pym][c.staffId]) ? shifts[pym][c.staffId] : null;
  if (!src) { setManualShiftStatus(py + '年' + pm + '月の勤務区分がありません', true); return; }
  if (!confirm(py + '年' + pm + '月の勤務区分を ' + c.y + '年' + c.m + '月にコピーします。\n現在の内容は上書きされます。')) return;
  var days = daysInMonth(c.y, c.m);
  var n = 0;
  for (var d=1; d<=days; d++) {
    var v = src[String(d)] || '';
    setShift(c.staffId, c.y, c.m, d, v);
    if (v) n++;
  }
  saveShiftStaffMonth(c.staffId, c.y, c.m);
  renderManualShiftGrid();
  setManualShiftStatus(py + '年' + pm + '月から ' + n + '日分をコピーしました');
  showToast('前月からコピーしました');
}

function manualShiftClear() {
  var c = manualShiftContext();
  if (!c) return;
  var st = getStaffById(c.staffId);
  if (!confirm((st ? st.name : c.staffId) + ' の ' + c.y + '年' + c.m + '月の勤務区分をすべて消します。よろしいですか？')) return;
  var days = daysInMonth(c.y, c.m);
  for (var d=1; d<=days; d++) setShift(c.staffId, c.y, c.m, d, '');
  saveShiftStaffMonth(c.staffId, c.y, c.m);
  renderManualShiftGrid();
  setManualShiftStatus(c.y + '年' + c.m + '月の勤務区分を消しました');
  showToast('当月の勤務区分を消しました');
}

function renderPriceTable() {
  var tb = document.getElementById('price-table');
  if (!tb) return;
  var html = '';
  for (var i=0; i<CHILD_CATEGORIES.length; i++) {
    var cat = CHILD_CATEGORIES[i];
    html += '<tr><td>'+cat.label+'</td>';
    for (var k=0; k<MEAL_KEYS.length; k++) {
      html += '<td><input type="number" min="0" step="10" style="width:90px" class="price-input" ' +
              'data-cat="'+cat.key+'" data-meal="'+MEAL_KEYS[k]+'" value="'+getMealPrice(cat.key, MEAL_KEYS[k])+'"></td>';
    }
    html += '</tr>';
  }
  tb.innerHTML = html;
}

function fillDefaultPrices() {
  // 在園児は保育料金に含まれるため0円、一時預かり・学童は 朝150/昼200/夕200
  var std = {b:150, s1:0, l:200, s2:0, d:200};
  var inputs = document.querySelectorAll('#price-table input.price-input');
  for (var i=0; i<inputs.length; i++) {
    var cat = inputs[i].getAttribute('data-cat');
    var mk  = inputs[i].getAttribute('data-meal');
    inputs[i].value = (cat === 'zaien') ? 0 : std[mk];
  }
  showToast('標準料金を入力しました。「料金を保存」を押してください');
}

function savePrices() {
  var next = {};
  for (var i=0; i<CHILD_CATEGORIES.length; i++) next[CHILD_CATEGORIES[i].key] = {};
  var inputs = document.querySelectorAll('#price-table input.price-input');
  for (var i=0; i<inputs.length; i++) {
    var v = parseInt(inputs[i].value, 10);
    next[inputs[i].getAttribute('data-cat')][inputs[i].getAttribute('data-meal')] = (isNaN(v)||v<0) ? 0 : v;
  }
  var statusEl = document.getElementById('price-status');
  statusEl.textContent = '保存中...';
  fetch(API_URL + '?key=prices', {
    method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(next)
  }).then(function(r){return r.json();}).then(function(res) {
    if (!res || !res.ok) { statusEl.textContent = '保存に失敗しました'; alert('料金の保存に失敗しました: ' + ((res&&res.error)||'不明なエラー')); return; }
    prices = next;
    statusEl.textContent = '保存しました（' + new Date().toLocaleTimeString('ja-JP') + '）';
    showToast('食事料金を保存しました');
  }).catch(function(e) { statusEl.textContent = '保存に失敗しました'; alert('料金の保存に失敗しました: ' + e.message); });
}

function renderShiftDefTable() {
  var tb = document.getElementById('shiftdef-table');
  if (!tb) return;
  var html = '';
  for (var i=0; i<shiftDefs.length; i++) {
    var sd = shiftDefs[i];
    html += '<tr><td>'+esc(sd.name)+'</td>';
    html += '<td><input type="text" class="sd-code" data-i="'+i+'" style="width:110px" value="'+esc(sd.code||'')+'" placeholder="任意"></td>';
    for (var k=0; k<MEAL_KEYS.length; k++) {
      var mk = MEAL_KEYS[k];
      var on = sd.meals && sd.meals[mk];
      html += '<td style="text-align:center"><input type="checkbox" class="sd-chk" data-i="'+i+'" data-meal="'+mk+'"'+(on?' checked':'')+'></td>';
    }
    html += '<td><button class="btn-del" data-sd-del="'+i+'">削除</button></td></tr>';
  }
  if (!html) html = '<tr><td colspan="8" style="text-align:center;color:#999">勤務区分が未登録です。「標準の7区分を入れる」を押してください。</td></tr>';
  tb.innerHTML = html;
  var dels = tb.querySelectorAll('button[data-sd-del]');
  for (var i=0; i<dels.length; i++) {
    dels[i].addEventListener('click', function() {
      var idx = parseInt(this.getAttribute('data-sd-del'), 10);
      if (!confirm(shiftDefs[idx].name + ' を削除しますか？')) return;
      shiftDefs.splice(idx, 1);
      renderShiftDefTable();
      showToast('削除しました。「勤務区分を保存」を押してください');
    });
  }
}

function collectShiftDefs() {
  var codes = document.querySelectorAll('#shiftdef-table input.sd-code');
  for (var i=0; i<codes.length; i++) {
    var idx = parseInt(codes[i].getAttribute('data-i'), 10);
    shiftDefs[idx].code = codes[i].value.trim();
  }
  var chks = document.querySelectorAll('#shiftdef-table input.sd-chk');
  for (var i=0; i<chks.length; i++) {
    var idx = parseInt(chks[i].getAttribute('data-i'), 10);
    var mk = chks[i].getAttribute('data-meal');
    if (!shiftDefs[idx].meals) shiftDefs[idx].meals = {};
    shiftDefs[idx].meals[mk] = chks[i].checked;
  }
  return shiftDefs;
}

function saveShiftDefs() {
  var next = collectShiftDefs();
  var statusEl = document.getElementById('shiftdef-status');
  statusEl.textContent = '保存中...';
  fetch(API_URL + '?key=shiftdefs', {
    method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(next)
  }).then(function(r){return r.json();}).then(function(res) {
    if (!res || !res.ok) { statusEl.textContent = '保存に失敗しました'; alert('勤務区分の保存に失敗しました: ' + ((res&&res.error)||'不明なエラー')); return; }
    shiftDefs = next;
    statusEl.textContent = '保存しました（' + new Date().toLocaleTimeString('ja-JP') + '）';
    renderManualShiftBulkValues();
    renderManualShiftGrid();
    showToast('勤務区分を保存しました');
  }).catch(function(e) { statusEl.textContent = '保存に失敗しました'; alert('勤務区分の保存に失敗しました: ' + e.message); });
}

function addShiftDef(e) {
  e.preventDefault();
  var nameEl = document.getElementById('sd-name');
  var name = nameEl.value.trim();
  if (!name) return;
  if (getShiftDef(name)) { showToast('同じ名前の勤務区分が既にあります'); return; }
  collectShiftDefs();
  var codeEl = document.getElementById('sd-code');
  shiftDefs.push({name: name, code: (codeEl ? codeEl.value.trim() : ''),
                  meals: {b:false,s1:false,l:false,s2:false,d:false}});
  nameEl.value = '';
  if (codeEl) codeEl.value = '';
  renderShiftDefTable();
  showToast(name + ' を追加しました。食事にチェックして保存してください');
}

function fillDefaultShiftDefs() {
  shiftDefs = JSON.parse(JSON.stringify(DEFAULT_SHIFT_DEFS));
  renderShiftDefTable();
  renderManualShiftBulkValues();
  renderManualShiftGrid();
  showToast('標準の7区分を入力しました。「勤務区分を保存」を押してください');
}


// ==================== 職員の勤務区分の取込 ====================
function saveShiftsForMonth(ym, monthData, onDone) {
  var partial = {};
  partial[ym] = monthData;
  fetch(API_URL + '?key=shifts&action=merge', {
    method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(partial)
  }).then(function(r){return r.json();}).then(function(res) {
    if (!res || !res.ok) { onDone((res && res.error) || '不明なエラー'); return; }
    shifts[ym] = monthData; onDone(null);
  }).catch(function(e) { onDone('通信エラー: ' + e.message); });
}

function syncShiftsFromDb() {
  var y = parseInt(document.getElementById('shift-year').value);
  var m = parseInt(document.getElementById('shift-month').value);
  var statusEl = document.getElementById('shift-status');
  statusEl.style.color = '';
  statusEl.textContent = 'データベースから取得中...';
  fetch('../sync_shifts.php?year=' + y + '&month=' + m + '&t=' + Date.now())
    .then(function(r){return r.json();})
    .then(function(res) {
      if (!res || !res.ok) {
        statusEl.style.color = '#dc3545';
        statusEl.textContent = '同期できませんでした: ' + ((res && res.error) || '不明なエラー');
        renderProbeResult(res, true);
        alert('勤務区分の同期に失敗しました。\n\n' + ((res && res.error) || '不明なエラー') +
              '\n\n画面に詳しい原因と対処を表示しました。\n' +
              '当面は「勤務区分の手入力」またはCSV取込をご利用ください。');
        return;
      }
      // 取り込めた場合でも、古い版が残っていれば知らせる
      if (res.version !== EXPECTED_SYNC_VERSION) {
        var pe = document.getElementById('shift-probe-result');
        if (pe) {
          pe.innerHTML = '<div class="notice" style="background:#dc3545;color:#fff;border:none;line-height:1.8">'
            + '<strong>サーバーの sync_shifts.php が古い版です</strong><br>'
            + 'サーバー上の版: ' + esc(res.version || '(版の表示なし)')
            + '　／　この画面が想定する版: ' + esc(EXPECTED_SYNC_VERSION) + '<br>'
            + '最新の sync_shifts.php をサーバーに上書きしてください。</div>';
        }
      }
      var ym = y + '-' + pad(m);
      saveShiftsForMonth(ym, res.shifts || {}, function(err) {
        if (err) { statusEl.style.color = '#dc3545'; statusEl.textContent = '保存に失敗: ' + err; return; }
        statusEl.style.color = '';
        var msg = y+'年'+m+'月の勤務区分を同期しました（'+(res.staffCount||0)+'名 / '+(res.count||0)+'件）';
        var un = res.unmapped || [];
        if (un.length > 0) {
          statusEl.style.color = '#dc3545';
          msg += ' ／ 職員IDに対応づかなかった人が ' + un.length + ' 名います';
          var names = un.slice(0, 10).map(function(u) {
            return (u['氏名'] || '(氏名不明)') + '(' + u['個人CD'] + ')';
          }).join('、');
          alert('勤務区分を同期しましたが、' + un.length + '名は給食システムの職員IDに'
              + '対応づけできませんでした。この職員の勤務区分は取り込まれていません。\n\n'
              + names + (un.length > 10 ? ' ほか' + (un.length-10) + '名' : '')
              + '\n\n【対処】\n'
              + '・職員マスタにその職員が登録されているか確認してください\n'
              + '・登録済みなら、サーバーの data/shift_idmap.json に\n'
              + '  {"' + un[0]['個人CD'] + '": "電子カルテID"} の形で対応を追記してください');
        }
        statusEl.textContent = msg;
        showToast('勤務区分を同期しました');
        renderShiftPreview();
        renderManualShiftGrid();
      });
    })
    .catch(function(e) {
      statusEl.style.color = '#dc3545';
      statusEl.textContent = '同期できませんでした（sync_shifts.php が見つからない可能性があります）';
      renderProbeResult({ok:false, error:'sync_shifts.php を呼び出せませんでした: ' + e.message}, true);
      alert('勤務区分の同期に失敗しました: ' + e.message +
            '\n\nサーバーに sync_shifts.php が配置され、接続設定が済んでいるか確認してください。');
    });
}

// ==================== 勤務DBの接続テスト ====================
function probeShiftDb() {
  var el = document.getElementById('shift-probe-result');
  if (el) el.innerHTML = '<p class="help-text">接続を確認しています...</p>';
  fetch('../sync_shifts.php?probe=1&t=' + Date.now())
    .then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + '（sync_shifts.php がサーバーにありません）');
      return r.text();
    })
    .then(function(txt) {
      var res;
      try { res = JSON.parse(txt); }
      catch (e) {
        // PHPエラーがそのまま返っている場合。中身をそのまま見せる
        renderProbeResult({ok:false, error:'sync_shifts.php が正しく動いていません', raw:txt.slice(0, 800)}, true);
        return;
      }
      renderProbeResult(res, !res.ok);
    })
    .catch(function(e) {
      renderProbeResult({ok:false, error:e.message}, true);
    });
}

// この画面が想定している sync_shifts.php の版。
// サーバーのファイルが古いと、直したはずの不具合が再発するため照合する。
var EXPECTED_SYNC_VERSION = '2026-09-24c';

// 接続テスト・同期エラーの内容を画面に分かりやすく表示する
function renderProbeResult(res, isError) {
  var el = document.getElementById('shift-probe-result');
  if (!el) return;
  if (!res) { el.innerHTML = ''; return; }

  // サーバーの sync_shifts.php が古い版なら、まずそれを知らせる
  var verWarn = '';
  if (!res.raw) {
    var sv = res.version || '';
    if (sv !== EXPECTED_SYNC_VERSION) {
      verWarn = '<div class="notice" style="margin-bottom:10px;background:#dc3545;color:#fff;'
              + 'border:none;line-height:1.8">'
              + '<strong style="font-size:1.05rem">サーバーの sync_shifts.php が古い版です</strong><br>'
              + 'サーバー上の版: ' + esc(sv || '(版の表示なし＝かなり古い版)')
              + '　／　この画面が想定する版: ' + esc(EXPECTED_SYNC_VERSION) + '<br>'
              + '<strong>対処:</strong> 最新の <code>sync_shifts.php</code> をサーバーに上書きしてから、'
              + 'もう一度お試しください。下に出ているエラーは、古い版が原因の可能性があります。'
              + '</div>';
    }
  }
  var rows = [];
  var add = function(k, v) { if (v !== undefined && v !== null && v !== '') rows.push([k, v]); };

  if (isError) {
    var dt = res.detail || {};
    add('結果', '接続できませんでした');
    add('エラー内容', res.error || '不明なエラー');
    add('接続先', dt.host);
    add('データベース', dt.database);
    add('アカウント', dt.user ? (dt.user + (dt.hasPassword ? '（パスワードあり）' : '（パスワードなし）')) : '');
    add('PHPで使えるドライバ', dt.drivers);
    if (dt.tried && dt.tried.length) add('試した接続', dt.tried.join('\n'));
    if (dt.candidates && dt.candidates.length) add('候補', dt.candidates.join(', '));
    if (res.raw) add('サーバーの応答', res.raw);
  } else {
    add('結果', '接続できました');
    add('DBの種類', res.driver);
    add('接続先', res.dsn);
    add('データベース', res.database
        + (res.foundIn && res.foundIn !== res.database ? '（表は ' + res.foundIn + ' にありました）' : ''));
    add('アカウント', res.user);
    var tbl = function(name) {
      var t = res[name];
      if (!t) return;
      var where = t.table ? '（' + t.table + '）' : '';
      if (t.error) add(name, '読めません' + where + ': ' + t.error);
      else if (t.columns && t.columns.length) add(name + ' の列名' + where, t.columns.join(', '));
      else add(name, (t.note || '列が取得できませんでした') + where);
    };
    tbl('JoyKinmData'); tbl('JoyKinmu'); tbl('JoyKojin');
    // どの列を使うことにしたか（列名の大文字小文字違いを自動で吸収している）
    if (res.usedColumns) {
      var uc = [];
      for (var k in res.usedColumns) uc.push(k + ' … ' + res.usedColumns[k]);
      add('実際に使う列', uc.join('\n'));
    }
    // 目的の表が見つからない場合に備えて、このDBにある表を見せる
    if (res.tables && res.tables.length) {
      add('このDBにある表（' + (res.tableCount || res.tables.length) + '個）', res.tables.join(', '));
    }
    if (res.dbSearch && res.dbSearch.length) {
      add('他のDBの探索', res.dbSearch.join('\n'));
    }
  }

  add('sync_shifts.php の版', res.version || '(版の表示なし)');

  var html = verWarn + '<table class="data-table" style="max-width:900px"><tbody>';
  for (var i=0; i<rows.length; i++) {
    // 改行はそのまま見せる（複数の接続を試した内容を1行ずつ読めるように）
    html += '<tr><th style="width:170px;text-align:left;white-space:nowrap">' + esc(rows[i][0]) + '</th>'
          + '<td style="text-align:left;word-break:break-all;font-size:0.8rem;white-space:pre-line">'
          + esc(String(rows[i][1])) + '</td></tr>';
  }
  html += '</tbody></table>';

  // 接続はできたが表が見つからない等のお知らせ
  if (!isError && res.notes && res.notes.length) {
    html += '<div class="notice notice-warning" style="margin-top:10px;border-color:#dc3545;background:#fdecea">'
          + '<strong>確認が必要な点</strong><ul style="margin:6px 0 0 18px;line-height:1.8">';
    for (var i=0; i<res.notes.length; i++) html += '<li>' + esc(res.notes[i]) + '</li>';
    html += '</ul></div>';
  }

  // サーバー側が原因を特定できた場合は、それを最優先で見せる
  var hints = (res.detail && res.detail.hints) ? res.detail.hints : [];
  if (isError && hints.length) {
    html += '<div class="notice notice-warning" style="margin-top:10px;border-color:#dc3545;background:#fdecea">'
          + '<strong>この内容から考えられる原因</strong><ul style="margin:6px 0 0 18px;line-height:1.8">';
    for (var i=0; i<hints.length; i++) html += '<li>' + esc(hints[i]) + '</li>';
    html += '</ul></div>';
  }

  if (isError) {
    html += '<div class="notice notice-warning" style="margin-top:10px">'
          + '<strong>よくある原因と対処</strong><ul style="margin:6px 0 0 18px;line-height:1.8">'
          + '<li><strong>ドライバが入っていない</strong> … php.ini の <code>pdo_sqlsrv</code> / <code>pdo_oci</code> / '
          + '<code>pdo_pgsql</code> / <code>pdo_mysql</code> を有効にしてApacheを再起動してください。</li>'
          + '<li><strong>DBサーバーに届かない</strong> … 給食サーバーからJOYNUSのDBサーバーへ接続できるか'
          + '（ファイアウォール・ポート）をネットワーク担当にご確認ください。</li>'
          + '<li><strong>アカウントが違う</strong> … JOYNUSの管理者に参照専用（SELECTのみ）のアカウントをご確認ください。</li>'
          + '<li><strong>年月の形式が違う</strong> … 接続はできているのにデータが0件の場合は、'
          + 'sync_shifts.php の <code>$KBN</code>（予定/実績）と年月の形式をご確認ください。</li>'
          + '</ul><p style="margin:8px 0 0">'
          + '接続できるようになるまでは、上の<strong>「勤務区分の手入力」</strong>で保護者ごとに入力できます。'
          + '</p></div>';
  } else {
    // 勤務種類マスタの中身。どの列が「Ａ」「夕診」等の名称かを目で確認できる
    if (res.kinmuRows && res.kinmuRows.length) {
      var cols = [];
      for (var i=0; i<res.kinmuRows.length; i++) {
        for (var k in res.kinmuRows[i]) if (cols.indexOf(k) === -1) cols.push(k);
      }
      html += '<div style="margin-top:12px"><strong>勤務種類マスタの中身（先頭' + res.kinmuRows.length + '件）</strong>'
            + '<p class="help-text">「Ａ」「ＡＭ」「夕診」などの名称が入っている列が、勤務区分の表示名です。'
            + '上の「実際に使う列」の表示名が違っていたら、その列名を教えてください。</p>'
            + '<div style="overflow-x:auto"><table class="data-table" style="font-size:0.78rem"><thead><tr>';
      for (var i=0; i<cols.length; i++) html += '<th>' + esc(cols[i]) + '</th>';
      html += '</tr></thead><tbody>';
      for (var i=0; i<res.kinmuRows.length; i++) {
        html += '<tr>';
        for (var j=0; j<cols.length; j++) {
          html += '<td>' + esc(res.kinmuRows[i][cols[j]] || '') + '</td>';
        }
        html += '</tr>';
      }
      html += '</tbody></table></div></div>';
    }
    html += '<p class="help-text" style="margin-top:8px">「実際に使う列」が正しければ、'
          + '「データベースから同期」を押してください。</p>';
  }
  el.innerHTML = html;
}

function importShiftCsv() {
  var f = document.getElementById('shift-csv-file').files[0];
  var statusEl = document.getElementById('shift-status');
  if (!f) { showToast('CSVファイルを選択してください'); return; }
  var reader = new FileReader();
  reader.onload = function(ev) {
    var text = String(ev.target.result || '').replace(/^\uFEFF/, '');
    var lines = text.split(/\r?\n/);
    var byMonth = {}, n = 0, skipped = 0;
    for (var i=0; i<lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      var cols = line.split(',').map(function(x){ return x.trim().replace(/^"|"$/g,''); });
      if (cols.length < 3) { skipped++; continue; }
      var sid = cols[0], dateStr = cols[1], kubun = cols[2];
      var md = /^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/.exec(dateStr);
      if (!md || !sid || !kubun) { skipped++; continue; }
      var ym = md[1] + '-' + pad(parseInt(md[2],10));
      var day = String(parseInt(md[3],10));
      if (!byMonth[ym]) byMonth[ym] = {};
      if (!byMonth[ym][sid]) byMonth[ym][sid] = {};
      byMonth[ym][sid][day] = kubun;
      n++;
    }
    if (n === 0) {
      statusEl.style.color = '#dc3545';
      statusEl.textContent = '取り込める行がありませんでした（形式: 職員ID,日付,勤務区分）';
      return;
    }
    var months = Object.keys(byMonth), done = 0, errs = [];
    statusEl.style.color = ''; statusEl.textContent = '取込中...';
    months.forEach(function(ym) {
      var merged = {}, existing = shifts[ym] || {};
      for (var sid in existing) { merged[sid] = {}; for (var dd in existing[sid]) merged[sid][dd] = existing[sid][dd]; }
      for (var sid2 in byMonth[ym]) {
        if (!merged[sid2]) merged[sid2] = {};
        for (var dd2 in byMonth[ym][sid2]) merged[sid2][dd2] = byMonth[ym][sid2][dd2];
      }
      saveShiftsForMonth(ym, merged, function(err) {
        if (err) errs.push(ym + ': ' + err);
        done++;
        if (done === months.length) {
          if (errs.length) { statusEl.style.color = '#dc3545'; statusEl.textContent = '一部保存に失敗: ' + errs.join(' / '); }
          else {
            statusEl.style.color = '';
            statusEl.textContent = n + '件を取り込みました（対象月: ' + months.join('、') + '）' + (skipped ? ' ／ 読み飛ばし ' + skipped + '行' : '');
            showToast('勤務区分を取り込みました');
          }
          renderShiftPreview();
          renderManualShiftGrid();
        }
      });
    });
  };
  reader.readAsText(f, 'UTF-8');
}

function downloadFile(content, filename, mime) {
  var blob = new Blob([content], {type: mime});
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportShiftCsv() {
  var y = parseInt(document.getElementById('shift-year').value);
  var m = parseInt(document.getElementById('shift-month').value);
  var ym = y + '-' + pad(m);
  var month = shifts[ym] || {};
  var days = daysInMonth(y, m);
  var csv = '\uFEFF職員ID,氏名,日付,勤務区分\n';
  var ids = Object.keys(month).sort();
  for (var i=0; i<ids.length; i++) {
    var st = getStaffById(ids[i]);
    for (var d=1; d<=days; d++) {
      var v = month[ids[i]][d];
      if (!v) continue;
      csv += '"'+ids[i]+'","'+(st?st.name:'')+'","'+y+'-'+pad(m)+'-'+pad(d)+'","'+String(v).replace(/"/g,'""')+'"\n';
    }
  }
  downloadFile(csv, '勤務区分_'+y+'年'+pad(m)+'月.csv', 'text/csv;charset=utf-8');
  showToast('勤務区分CSVを出力しました');
}

function renderShiftPreview() {
  var wrap = document.getElementById('shift-preview');
  if (!wrap) return;
  var y = parseInt(document.getElementById('shift-year').value);
  var m = parseInt(document.getElementById('shift-month').value);
  var ym = y + '-' + pad(m);
  var month = shifts[ym] || {};
  var ids = Object.keys(month).sort();
  if (ids.length === 0) {
    wrap.innerHTML = '<p class="help-text">'+y+'年'+m+'月の勤務区分はまだ取り込まれていません。</p>';
    return;
  }
  var days = daysInMonth(y, m);
  var html = '<p class="help-text">'+y+'年'+m+'月の勤務区分（'+ids.length+'名）</p>';
  html += '<table class="rpt-table"><thead><tr><th>職員ID</th><th>氏名</th>';
  for (var d=1; d<=days; d++) html += '<th>'+d+'</th>';
  html += '</tr></thead><tbody>';
  for (var i=0; i<ids.length; i++) {
    var st = getStaffById(ids[i]);
    html += '<tr><td>'+esc(ids[i])+'</td><td style="white-space:nowrap">'+esc(st?st.name:'')+'</td>';
    for (var d=1; d<=days; d++) html += '<td style="font-size:0.7rem">'+esc(month[ids[i]][d]||'')+'</td>';
    html += '</tr>';
  }
  html += '</tbody></table>';
  wrap.innerHTML = html;
}


// ==================== 食事注文表Excel（添付帳票と同じ形式） ====================
// 出欠確認シート＋区分別の食事注文表シートを出力する
function exportHoikuFormExcel() {
  var y = parseInt(document.getElementById('rpt-year').value);
  var m = parseInt(document.getElementById('rpt-month').value);
  var sheets = [buildAttendanceSheet(y, m)];
  for (var i=0; i<CHILD_CATEGORIES.length; i++) {
    sheets.push(buildOrderFormSheet(y, m, CHILD_CATEGORIES[i]));
  }
  downloadXlsxBook(sheets, '食事注文表_'+y+'年'+pad(m)+'月.xlsx');
  showToast(y+'年'+m+'月の食事注文表を出力しました');
}

// 各シートの一番下に、保護者職員の勤務区分を差し込む。
// 日付の列は上の表と揃えるため、先頭2列（氏名・部署）にしている。
// kids に該当する子供の保護者だけを対象にする（シートごとの区分に合わせる）。
function appendShiftBlock(sheet, y, m, days, kids, label) {
  var idSet = {}, ids = [];
  for (var i=0; i<kids.length; i++) if (kids[i].staffId) idSet[kids[i].staffId] = true;
  for (var sid in idSet) ids.push(sid);
  // 氏名順に並べる（氏名が無い場合はIDで）
  ids.sort(function(a, b) {
    var sa = getStaffById(a), sb = getStaffById(b);
    var na = sa && sa.name ? sa.name : a, nb = sb && sb.name ? sb.name : b;
    return na < nb ? -1 : (na > nb ? 1 : 0);
  });

  sheet.rows.push([]);
  var tr = sheet.rows.length + 1;
  var title = [XC(y+'年'+m+'月　保護者の勤務区分' + (label ? '（'+label+'）' : ''), 3)];
  for (var c=1; c<2+days; c++) title.push(XC('',3));
  sheet.rows.push(title);
  sheet.merges.push('A'+tr+':'+xlsxColLetter(1+days)+tr);

  var hdr = [XC('氏名',1), XC('部署',1)];
  for (var d=1; d<=days; d++) hdr.push(XC(d, dayFillStyle(y,m,d,true)));
  sheet.rows.push(hdr);

  if (ids.length === 0) {
    sheet.rows.push([XC('対象の保護者がいません', 4)]);
    return;
  }
  var anyShift = false;
  for (var i=0; i<ids.length; i++) {
    var st = getStaffById(ids[i]);
    var row = [XC(st && st.name ? st.name : ids[i], 4), XC(staffDept(ids[i]), 4)];
    for (var d=1; d<=days; d++) {
      var v = getShift(ids[i], y, m, d);
      if (v) anyShift = true;
      row.push(XC(v, dayFillStyle(y,m,d,false)));
    }
    sheet.rows.push(row);
  }
  if (!anyShift) {
    sheet.rows.push([XC(y+'年'+m+'月の勤務区分は取り込まれていません', 4)]);
  }
}

// 日付列の見出し（日＋曜日）を作る
function formDayHeader(sheet, y, m, days, startCol) {
  var row1 = [], row2 = [];
  for (var c=0; c<startCol; c++) { row1.push(XC('',0)); row2.push(XC('',0)); }
  for (var d=1; d<=days; d++) {
    row1.push(XC(d, dayFillStyle(y,m,d,true)));
    row2.push(XC(WEEKDAYS[dayOfWeek(y,m,d)], dayFillStyle(y,m,d,true)));
  }
  sheet.rows.push(row1);
  sheet.rows.push(row2);
}

// 出欠確認シート: 区分ごとに子供を並べ、各日に勤務区分（保護者）を表示
function buildAttendanceSheet(y, m) {
  var days = daysInMonth(y, m);
  var sheet = {name:'出欠確認', rows:[], merges:[], cols:[]};
  sheet.cols = [12, 16];
  for (var d=0; d<days; d++) sheet.cols.push(5);
  var ncol = 2 + days;
  var lastCol = xlsxColLetter(ncol - 1);

  var tr = sheet.rows.length + 1;
  var t = [XC(y+'年'+m+'月　出欠確認', 3)];
  for (var c=1; c<ncol; c++) t.push(XC('',3));
  sheet.rows.push(t);
  sheet.merges.push('A'+tr+':'+lastCol+tr);
  sheet.rows.push([XC('区分',1), XC('氏名',1)]);
  // 上で作った見出し行に「区分/氏名」を載せるため、日付2行の先頭を補う
  var hdrStart = sheet.rows.length;
  formDayHeader(sheet, y, m, days, 2);
  sheet.rows[hdrStart][0] = XC('区分',1);
  sheet.rows[hdrStart][1] = XC('氏名',1);
  sheet.rows[hdrStart+1][0] = XC('',1);
  sheet.rows[hdrStart+1][1] = XC('',1);
  sheet.rows.splice(hdrStart-1, 1); // 仮に入れた行を除去
  sheet.merges.push('A'+(hdrStart)+':A'+(hdrStart+1));
  sheet.merges.push('B'+(hdrStart)+':B'+(hdrStart+1));

  for (var ci=0; ci<CHILD_CATEGORIES.length; ci++) {
    var cat = CHILD_CATEGORIES[ci];
    var kids = children.filter(function(c) { return childCategory(c) === cat.key; });
    if (kids.length === 0) continue;
    var blockStart = sheet.rows.length + 1;
    for (var j=0; j<kids.length; j++) {
      var kid = kids[j];
      var row = [XC(j===0 ? cat.label : '', 3), XC(kid.name, 4)];
      for (var d=1; d<=days; d++) {
        var sh = getShift(kid.staffId, y, m, d);
        var o  = getCountedOrder(kid.id, y, m, d);
        var any = false;
        for (var k=0; k<MEAL_KEYS.length; k++) if (o[MEAL_KEYS[k]]) any = true;
        // 添付帳票と同じく「◯＋勤務区分」の形で表示する
        var v = any ? ('◯' + (sh || '')) : '';
        row.push(XC(v, dayFillStyle(y,m,d,false)));
      }
      sheet.rows.push(row);
    }
    if (kids.length > 1) sheet.merges.push('A'+blockStart+':A'+(sheet.rows.length));
  }
  appendShiftBlock(sheet, y, m, days, children, '');
  return sheet;
}

// 食事注文表シート（区分ごと）: 子供1人につき5食分の行、最後に合計食数
function buildOrderFormSheet(y, m, cat) {
  var days = daysInMonth(y, m);
  var NM = MEAL_KEYS.length;
  var sheet = {name:'食事注文表('+cat.label+')', rows:[], merges:[], cols:[]};
  sheet.cols = [16, 12];
  for (var d=0; d<days; d++) sheet.cols.push(5);
  sheet.cols.push(7);
  var ncol = 2 + days + 1;
  var lastCol = xlsxColLetter(ncol - 1);

  var tr = sheet.rows.length + 1;
  var t = [XC(y+'年'+m+'月　食事注文表（'+cat.label+'）', 3)];
  for (var c=1; c<ncol; c++) t.push(XC('',3));
  sheet.rows.push(t);
  sheet.merges.push('A'+tr+':'+lastCol+tr);

  var hdrStart = sheet.rows.length + 1;
  formDayHeader(sheet, y, m, days, 2);
  var i0 = sheet.rows.length - 2, i1 = sheet.rows.length - 1;
  sheet.rows[i0][0] = XC('氏名',1);  sheet.rows[i0][1] = XC('食事',1);
  sheet.rows[i1][0] = XC('',1);      sheet.rows[i1][1] = XC('',1);
  sheet.rows[i0].push(XC('計',1));   sheet.rows[i1].push(XC('',1));
  sheet.merges.push('A'+hdrStart+':A'+(hdrStart+1));
  sheet.merges.push('B'+hdrStart+':B'+(hdrStart+1));
  sheet.merges.push(lastCol+hdrStart+':'+lastCol+(hdrStart+1));

  var kids = children.filter(function(c) { return childCategory(c) === cat.key; });
  var grand = {}; for (var k=0; k<NM; k++) grand[MEAL_KEYS[k]] = [];
  for (var k=0; k<NM; k++) for (var d=0; d<days; d++) grand[MEAL_KEYS[k]].push(0);

  for (var j=0; j<kids.length; j++) {
    var kid = kids[j];
    var blockStart = sheet.rows.length + 1;
    for (var k=0; k<NM; k++) {
      var mk = MEAL_KEYS[k];
      var row = [XC(k===0 ? kid.name : '', 4), XC(MEAL_NAMES[mk], 2)];
      var cnt = 0;
      for (var d=1; d<=days; d++) {
        var o = getCountedOrder(kid.id, y, m, d);
        var on = !!o[mk];
        if (on) { cnt++; grand[mk][d-1]++; }
        row.push(XC(on ? '◯' : '', dayFillStyle(y,m,d,false)));
      }
      row.push(XC(cnt, 3));
      sheet.rows.push(row);
    }
    sheet.merges.push('A'+blockStart+':A'+(sheet.rows.length));
  }
  if (kids.length === 0) {
    sheet.rows.push([XC('該当する子供が登録されていません', 4)]);
    appendShiftBlock(sheet, y, m, days, kids, cat.label);
    return sheet;
  }

  // 合計食数
  sheet.rows.push([]);
  var sumStart = sheet.rows.length + 1;
  for (var k=0; k<NM; k++) {
    var mk = MEAL_KEYS[k];
    var row = [XC(k===0 ? '合計食数' : '', 3), XC(MEAL_NAMES[mk], 3)];
    var tot = 0;
    for (var d=0; d<days; d++) { tot += grand[mk][d]; row.push(XC(grand[mk][d], 3)); }
    row.push(XC(tot, 3));
    sheet.rows.push(row);
  }
  sheet.merges.push('A'+sumStart+':A'+(sheet.rows.length));
  appendShiftBlock(sheet, y, m, days, kids, cat.label);
  return sheet;
}

// ==================== 全期間Excel出力（月ごとにシート） ====================
// 注文データが存在する年月を古い順に返す
function allOrderMonths() {
  var list = [];
  for (var ym in orders) {
    if (/^\d{4}-\d{2}$/.test(ym)) list.push(ym);
  }
  return list.sort();
}

function exportHoikuAllExcel() {
  var months = allOrderMonths();
  if (months.length === 0) { showToast('注文データがありません'); return; }

  var sheets = [];

  // 1枚目: 全期間の職員別サマリー
  var sum = {name:'全期間サマリー', rows:[], merges:[], cols:[10,14,14,10,12,14]};
  var t0 = sum.rows.length + 1;
  sum.rows.push([XC('保育園食 食事代 全期間サマリー', 3), XC('',3), XC('',3), XC('',3), XC('',3), XC('',3)]);
  sum.merges.push('A'+t0+':F'+t0);
  sum.rows.push([XC('対象期間: ' + months[0] + ' 〜 ' + months[months.length-1], 0)]);
  sum.rows.push([]);
  sum.rows.push([XC('職員ID',1), XC('氏名',1), XC('部署',1), XC('対象月数',1), XC('食数',1), XC('食事代',1)]);
  var agg = {};
  for (var i=0; i<months.length; i++) {
    var ymp = months[i].split('-');
    var rows = staffMonthCostRows(parseInt(ymp[0],10), parseInt(ymp[1],10));
    for (var j=0; j<rows.length; j++) {
      var e = rows[j];
      if (!agg[e.staffId]) agg[e.staffId] = {name:e.staffName, dept:e.dept, total:0, amount:0, months:0};
      agg[e.staffId].total  += e.total;
      agg[e.staffId].amount += e.amount;
      agg[e.staffId].months += 1;
    }
  }
  var sids = Object.keys(agg).sort();
  var gTotal = 0, gAmount = 0;
  for (var i=0; i<sids.length; i++) {
    var a = agg[sids[i]];
    gTotal += a.total; gAmount += a.amount;
    sum.rows.push([XC(sids[i],4), XC(a.name,4), XC(a.dept,4), XC(a.months,2), XC(a.total,2), XC(a.amount,3)]);
  }
  var totRow = sum.rows.length + 1;
  sum.rows.push([XC('合計',1), XC('',1), XC('',1), XC('',1), XC(gTotal,3), XC(gAmount,3)]);
  sum.merges.push('A'+totRow+':D'+totRow);
  sheets.push(sum);

  // 2枚目以降: 月ごとの明細
  for (var i=0; i<months.length; i++) {
    var ymp = months[i].split('-');
    var y = parseInt(ymp[0],10), m = parseInt(ymp[1],10);
    sheets.push(buildHoikuMonthSheet(y, m));
  }

  downloadXlsxBook(sheets, '保育園食_食事代集計_全期間.xlsx');
  showToast(months.length + 'か月分をExcelに出力しました');
}

function buildHoikuMonthSheet(y, m) {
  var days = daysInMonth(y, m);
  var NM = MEAL_KEYS.length;
  var sheet = {name: y+'年'+m+'月', rows:[], merges:[], cols:[]};
  sheet.cols = [10, 14, 14, 14, 8];
  for (var k=0; k<NM; k++) sheet.cols.push(7);
  sheet.cols.push(7); sheet.cols.push(12);

  var ncol = 5 + NM + 2;
  var lastCol = xlsxColLetter(ncol - 1);
  var tr = sheet.rows.length + 1;
  var titleRow = [XC(y+'年'+m+'月 保育園食 食事代明細', 3)];
  for (var c=1; c<ncol; c++) titleRow.push(XC('',3));
  sheet.rows.push(titleRow);
  sheet.merges.push('A'+tr+':'+lastCol+tr);

  var hdr = [XC('職員ID',1), XC('氏名',1), XC('部署',1), XC('子供',1), XC('区分',1)];
  for (var k=0; k<NM; k++) hdr.push(XC(MEAL_NAMES[MEAL_KEYS[k]],1));
  hdr.push(XC('食数',1)); hdr.push(XC('食事代',1));
  sheet.rows.push(hdr);

  var rows = staffMonthCostRows(y, m);
  var gTotal = 0, gAmount = 0;
  for (var i=0; i<rows.length; i++) {
    var e = rows[i];
    gTotal += e.total; gAmount += e.amount;
    for (var j=0; j<e.kids.length; j++) {
      var kid = e.kids[j];
      var row = [XC(e.staffId,4), XC(e.staffName,4), XC(e.dept,4),
                 XC(kid.child.name,4), XC(categoryLabel(kid.r.category),2)];
      for (var k=0; k<NM; k++) row.push(XC(kid.r.counts[MEAL_KEYS[k]],2));
      row.push(XC(kid.r.total,2));
      row.push(XC(kid.r.amount,3));
      sheet.rows.push(row);
    }
  }
  var totRow = sheet.rows.length + 1;
  var foot = [XC('合計',1)];
  for (var c=1; c<5+NM; c++) foot.push(XC('',1));
  foot.push(XC(gTotal,3)); foot.push(XC(gAmount,3));
  sheet.rows.push(foot);
  sheet.merges.push('A'+totRow+':'+xlsxColLetter(4+NM)+totRow);

  // 勤務区分（各日の各職員）。画面で選んだ部署の絞り込みをそのまま反映する
  var deptSel = getReportDept();
  sheet.rows.push([]);
  var sr = sheet.rows.length + 1;
  var shTitle = [XC(y+'年'+m+'月 職員別 勤務区分' + (deptSel ? '　【'+deptSel+'】' : ''), 3)];
  for (var c=1; c<3+days; c++) shTitle.push(XC('',3));
  sheet.rows.push(shTitle);
  sheet.merges.push('A'+sr+':'+xlsxColLetter(2+days)+sr);

  var allIds = reportStaffIds(y, m);
  var ids = [];
  for (var i=0; i<allIds.length; i++) if (matchReportDept(allIds[i])) ids.push(allIds[i]);

  var sh = [XC('職員ID',1), XC('氏名',1), XC('部署',1)];
  for (var d=1; d<=days; d++) sh.push(XC(d, dayFillStyle(y,m,d,true)));
  sheet.rows.push(sh);
  if (allIds.length === 0) {
    sheet.rows.push([XC('勤務区分は取り込まれていません', 4)]);
  } else if (ids.length === 0) {
    sheet.rows.push([XC(deptSel + ' に該当する職員がいません', 4)]);
  } else {
    for (var i=0; i<ids.length; i++) {
      var st = getStaffById(ids[i]);
      var r2 = [XC(ids[i],4), XC(st?st.name:'',4), XC(staffDept(ids[i]),4)];
      for (var d=1; d<=days; d++) r2.push(XC(getShift(ids[i], y, m, d), dayFillStyle(y,m,d,false)));
      sheet.rows.push(r2);
    }
  }
  return sheet;
}

// ==================== 食事代・勤務区分セクション ====================
function buildCostSection(y, m) {
  var allRows = staffMonthCostRows(y, m);
  var rows = [];
  for (var i=0; i<allRows.length; i++) if (matchReportDept(allRows[i].staffId)) rows.push(allRows[i]);
  var deptSel = getReportDept();
  var title = y+'年'+m+'月 職員別 食事代'
            + (deptSel ? '　<span style="font-size:0.85rem;font-weight:normal">【'+esc(deptSel)+'】</span>' : '');
  var html = '<div class="rpt-section"><h3>'+title+'</h3>';
  var unset = true;
  for (var i=0; i<CHILD_CATEGORIES.length; i++) {
    for (var k=0; k<MEAL_KEYS.length; k++) {
      if (getMealPrice(CHILD_CATEGORIES[i].key, MEAL_KEYS[k]) > 0) { unset = false; break; }
    }
  }
  if (unset) {
    html += '<p class="notice notice-warning">食事料金マスタが未設定のため金額が0円になります。'
          + '職員給食システムの管理者モード →「保育園マスタ」タブで単価を設定してください。</p>';
  }
  if (rows.length === 0) {
    html += '<p class="help-text">'
         +  (allRows.length === 0 ? '確定済みの注文がありません。'
                                  : esc(deptSel) + ' に確定済みの注文がありません。（全'+allRows.length+'名）')
         +  '</p></div>';
    return html;
  }
  html += '<div style="overflow-x:auto"><table class="rpt-table"><thead><tr>';
  html += '<th>職員ID</th><th>氏名</th><th>部署</th><th>子供</th><th>区分</th>';
  for (var k=0; k<MEAL_KEYS.length; k++) html += '<th>'+MEAL_NAMES[MEAL_KEYS[k]]+'</th>';
  html += '<th>食数</th><th>食事代</th></tr></thead><tbody>';
  var grandAmount = 0, grandTotal = 0;
  for (var i=0; i<rows.length; i++) {
    var e = rows[i];
    grandAmount += e.amount; grandTotal += e.total;
    for (var j=0; j<e.kids.length; j++) {
      var kid = e.kids[j];
      html += '<tr>';
      if (j === 0) {
        html += '<td rowspan="'+e.kids.length+'">'+esc(e.staffId)+'</td>';
        html += '<td rowspan="'+e.kids.length+'" style="white-space:nowrap">'+esc(e.staffName)+'</td>';
        html += '<td rowspan="'+e.kids.length+'" style="white-space:nowrap">'+esc(e.dept)+'</td>';
      }
      html += '<td style="white-space:nowrap">'+esc(kid.child.name)+'</td>';
      html += '<td>'+categoryLabel(kid.r.category)+'</td>';
      for (var k=0; k<MEAL_KEYS.length; k++) html += '<td>'+kid.r.counts[MEAL_KEYS[k]]+'</td>';
      html += '<td>'+kid.r.total+'</td><td style="text-align:right">'+yen(kid.r.amount)+'</td>';
      html += '</tr>';
      if (e.kids.length > 1 && j === e.kids.length - 1) {
        html += '<tr><td colspan="'+(2+MEAL_KEYS.length)+'" style="text-align:right;font-weight:bold">'
             +  esc(e.staffName)+' 合計</td>'
             +  '<td style="font-weight:bold">'+e.total+'</td>'
             +  '<td style="text-align:right;font-weight:bold">'+yen(e.amount)+'</td></tr>';
      }
    }
  }
  html += '</tbody><tfoot><tr><td colspan="'+(5+MEAL_KEYS.length)+'" style="text-align:right">総合計</td>'
       +  '<td>'+grandTotal+'</td><td style="text-align:right">'+yen(grandAmount)+'</td></tr></tfoot>';
  html += '</table></div></div>';
  return html;
}

// ==================== 集計の部署絞り込み ====================
var DEPT_NONE = '（部署未設定）';

function staffDept(staffId) {
  var st = getStaffById(staffId);
  var d = st && st.dept ? String(st.dept).trim() : '';
  return d === '' ? DEPT_NONE : d;
}
function getReportDept() {
  var el = document.getElementById('rpt-dept');
  return el ? el.value : '';
}
// 選んだ部署に含まれるか（空欄は全部署）
function matchReportDept(staffId) {
  var sel = getReportDept();
  return sel === '' || staffDept(staffId) === sel;
}

// 集計の対象になる職員ID（注文がある人＋勤務区分が入っている人）
function reportStaffIds(y, m) {
  var ym = y + '-' + pad(m);
  var month = shifts[ym] || {};
  var idSet = {};
  var rows = staffMonthCostRows(y, m);
  for (var i=0; i<rows.length; i++) idSet[rows[i].staffId] = true;
  for (var sid in month) idSet[sid] = true;
  return Object.keys(idSet).sort();
}

// 部署の選択肢を、実際に集計対象になる職員の部署だけで作る
function populateReportDept(y, m) {
  var sel = document.getElementById('rpt-dept');
  if (!sel) return;
  var cur = sel.value;
  var ids = reportStaffIds(y, m);
  var counts = {};
  for (var i=0; i<ids.length; i++) {
    var d = staffDept(ids[i]);
    counts[d] = (counts[d] || 0) + 1;
  }
  var names = Object.keys(counts).sort(function(a, b) {
    // 「（部署未設定）」は最後に置く
    if (a === DEPT_NONE) return 1;
    if (b === DEPT_NONE) return -1;
    return a < b ? -1 : (a > b ? 1 : 0);
  });
  var html = '<option value="">全部署（' + ids.length + '名）</option>';
  for (var i=0; i<names.length; i++) {
    html += '<option value="' + esc(names[i]) + '">' + esc(names[i]) + '（' + counts[names[i]] + '名）</option>';
  }
  sel.innerHTML = html;
  // 前回選んでいた部署が残っていれば維持する
  sel.value = cur;
  if (sel.selectedIndex < 0) sel.value = '';
}

function buildShiftSection(y, m) {
  var days = daysInMonth(y, m);
  var all = reportStaffIds(y, m);
  var ids = [];
  for (var i=0; i<all.length; i++) if (matchReportDept(all[i])) ids.push(all[i]);
  var deptSel = getReportDept();
  var title = y+'年'+m+'月 職員別 勤務区分'
            + (deptSel ? '　<span style="font-size:0.85rem;font-weight:normal">【'+esc(deptSel)+'】</span>' : '');
  var html = '<div class="rpt-section"><h3>'+title+'</h3>';
  if (all.length === 0) {
    html += '<p class="help-text">勤務区分が取り込まれていません。'
         +  '「料金・勤務区分」タブで取り込むか、「勤務区分の手入力」で入力してください。</p></div>';
    return html;
  }
  if (ids.length === 0) {
    html += '<p class="help-text">'+esc(deptSel)+' に該当する職員がいません。</p></div>';
    return html;
  }
  html += '<p class="help-text">'+ids.length+'名を表示しています'
       +  (deptSel ? '（全'+all.length+'名中）' : '') + '</p>';
  html += '<div style="overflow-x:auto"><table class="rpt-table"><thead><tr><th>職員ID</th><th>氏名</th><th>部署</th>';
  for (var d=1; d<=days; d++) {
    var dow = dayOfWeek(y,m,d);
    var bg = getHolidayName(y+'-'+pad(m)+'-'+pad(d)) ? 'background:#fff8e1;'
           : (dow===0 ? 'background:#fce4ec;' : (dow===6 ? 'background:#e8eaf6;' : ''));
    html += '<th style="'+bg+'">'+d+'<br><span style="font-size:0.7rem">'+WEEKDAYS[dow]+'</span></th>';
  }
  html += '</tr></thead><tbody>';
  for (var i=0; i<ids.length; i++) {
    var st = getStaffById(ids[i]);
    html += '<tr><td>'+esc(ids[i])+'</td><td style="white-space:nowrap">'+esc(st?st.name:'')+'</td>'
         +  '<td style="white-space:nowrap;font-size:0.75rem">'+esc(staffDept(ids[i]))+'</td>';
    for (var d=1; d<=days; d++) {
      var v = getShift(ids[i], y, m, d);
      html += '<td style="font-size:0.7rem;padding:2px">'+esc(v)+'</td>';
    }
    html += '</tr>';
  }
  html += '</tbody></table></div></div>';
  return html;
}

function runReport() {
  fetchAggregateData(runReportInner);
}

function runReportInner() {
  var y = parseInt(document.getElementById('rpt-year').value);
  var m = parseInt(document.getElementById('rpt-month').value);
  var days = daysInMonth(y, m);
  var totals = {b:0,s1:0,l:0,s2:0,d:0};
  var normalTotals = {b:0,s1:0,l:0,s2:0,d:0};
  var kizamiTotals = {b:0,s1:0,l:0,s2:0,d:0};
  var dailyData = [];
  var childRows = [];
  for (var d=1; d<=days; d++) {
    var dayT = {b:0,s1:0,l:0,s2:0,d:0};
    for (var i=0; i<children.length; i++) {
      var c = children[i];
      var o = getCountedOrder(c.id, y, m, d);
      for (var k=0; k<MEAL_KEYS.length; k++) {
        var mk = MEAL_KEYS[k];
        if (o[mk]) { dayT[mk]++; totals[mk]++;
          if (o[mk]==='normal') normalTotals[mk]++; else if (o[mk]==='kizami') kizamiTotals[mk]++;
        }
      }
    }
    dailyData.push({day:d, dow:dayOfWeek(y,m,d), t:dayT});
  }
  for (var i=0; i<children.length; i++) {
    var c = children[i]; var s = getStaffById(c.staffId);
    var ct = {b:0,s1:0,l:0,s2:0,d:0}; var cn = {b:0,s1:0,l:0,s2:0,d:0}; var ck = {b:0,s1:0,l:0,s2:0,d:0};
    for (var d=1; d<=days; d++) {
      var o = getCountedOrder(c.id, y, m, d);
      for (var k=0; k<MEAL_KEYS.length; k++) {
        var mk = MEAL_KEYS[k];
        if (o[mk]) { ct[mk]++; if(o[mk]==='normal') cn[mk]++; else ck[mk]++; }
      }
    }
    var total = 0; for (var k=0; k<MEAL_KEYS.length; k++) total += ct[MEAL_KEYS[k]];
    if (total > 0) childRows.push({childName:c.name, parentName:s?s.name:c.staffId, t:ct, n:cn, k:ck});
  }
  var totalAll = 0; for (var k=0; k<MEAL_KEYS.length; k++) totalAll += totals[MEAL_KEYS[k]];
  var html = '<div class="rpt-section"><h3>'+y+'年'+m+'月 月次合計</h3>';
  html += '<table class="rpt-table"><thead><tr><th>食事</th><th>普通食</th><th>きざみ食</th><th>合計</th></tr></thead><tbody>';
  for (var k=0; k<MEAL_KEYS.length; k++) {
    var mk = MEAL_KEYS[k];
    html += '<tr><td>'+MEAL_NAMES[mk]+'</td><td>'+normalTotals[mk]+'</td><td>'+kizamiTotals[mk]+'</td><td>'+totals[mk]+'</td></tr>';
  }
  html += '</tbody><tfoot><tr><td>合計</td>';
  var nAll=0, kAll=0; for (var k=0; k<MEAL_KEYS.length; k++) { nAll+=normalTotals[MEAL_KEYS[k]]; kAll+=kizamiTotals[MEAL_KEYS[k]]; }
  html += '<td>'+nAll+'</td><td>'+kAll+'</td><td>'+totalAll+'</td></tr></tfoot></table></div>';
  html += '<div class="rpt-section"><h3>子供別集計</h3>';
  html += '<table class="rpt-table"><thead><tr><th>子供名</th><th>保護者</th>';
  for (var k=0; k<MEAL_KEYS.length; k++) html += '<th>'+MEAL_NAMES[MEAL_KEYS[k]]+'</th>';
  html += '<th>合計</th></tr></thead><tbody>';
  for (var i=0; i<childRows.length; i++) {
    var cr = childRows[i];
    html += '<tr><td>'+esc(cr.childName)+'</td><td>'+esc(cr.parentName)+'</td>';
    var rowTotal = 0;
    for (var k=0; k<MEAL_KEYS.length; k++) {
      var mk = MEAL_KEYS[k]; var detail = '';
      if (cr.n[mk]>0 && cr.k[mk]>0) detail = cr.n[mk]+'普/'+cr.k[mk]+'き';
      else if (cr.k[mk]>0) detail = cr.t[mk]+'(き)'; else detail = ''+cr.t[mk];
      html += '<td>'+detail+'</td>'; rowTotal += cr.t[mk];
    }
    html += '<td>'+rowTotal+'</td></tr>';
  }
  html += '</tbody></table></div>';
  html += '<div class="rpt-section"><h3>日別内訳</h3>';
  html += '<table class="rpt-table"><thead><tr><th>日</th><th>曜</th>';
  for (var k=0; k<MEAL_KEYS.length; k++) html += '<th>'+MEAL_NAMES[MEAL_KEYS[k]]+'</th>';
  html += '<th>合計</th></tr></thead><tbody>';
  for (var i=0; i<dailyData.length; i++) {
    var dy = dailyData[i]; var ds = y+'-'+pad(m)+'-'+pad(dy.day);
    var hName = getHolidayName(ds); var label = WEEKDAYS[dy.dow];
    if (hName) label += '('+hName+')';
    var dayTotal = 0;
    html += '<tr><td>'+dy.day+'</td><td style="text-align:center">'+label+'</td>';
    for (var k=0; k<MEAL_KEYS.length; k++) { html += '<td>'+dy.t[MEAL_KEYS[k]]+'</td>'; dayTotal += dy.t[MEAL_KEYS[k]]; }
    html += '<td>'+dayTotal+'</td></tr>';
  }
  html += '</tbody></table></div>';
  populateReportDept(y, m);
  html += buildCostSection(y, m);
  html += buildShiftSection(y, m);
  document.getElementById('rpt-result').innerHTML = html;
}

// 部署を変えたときは、取得済みのデータのまま描き直す（再取得はしない）
function onReportDeptChange() {
  if (!document.getElementById('rpt-result').innerHTML) return;
  runReportInner();
}

// ==================== HISTORY TAB ====================
function renderHistory() {
  populateHistoryFilters();
  var monthF = document.getElementById('hist-month-filter').value;
  var staffF = document.getElementById('hist-staff-filter').value;
  var tb = document.getElementById('history-list');
  var html = ''; var count = 0;
  for (var i=0; i<opHistory.length && count<200; i++) {
    var h = opHistory[i];
    if (monthF && h.yearMonth !== monthF) continue;
    if (staffF && h.staffId !== staffF) continue;
    html += '<tr>';
    html += '<td style="white-space:nowrap">'+esc(h.timestamp)+'</td>';
    html += '<td>'+esc(h.staffName)+'</td><td>'+esc(h.childName)+'</td>';
    html += '<td>'+esc(h.yearMonth)+'</td><td>'+esc(h.action)+'</td><td>'+esc(h.detail)+'</td>';
    html += '</tr>'; count++;
  }
  if (!html) html = '<tr><td colspan="6" style="text-align:center;color:#999">履歴なし</td></tr>';
  tb.innerHTML = html;
}

function populateHistoryFilters() {
  var monthSel = document.getElementById('hist-month-filter');
  var staffSel = document.getElementById('hist-staff-filter');
  var curMonth = monthSel.value, curStaff = staffSel.value;
  var months = {}, staffIds = {};
  for (var i=0; i<opHistory.length; i++) {
    months[opHistory[i].yearMonth] = true;
    staffIds[opHistory[i].staffId] = opHistory[i].staffName;
  }
  monthSel.innerHTML = '<option value="">全期間</option>';
  Object.keys(months).sort().reverse().forEach(function(ym) {
    var o = document.createElement('option'); o.value=ym; o.textContent=ym; monthSel.appendChild(o);
  });
  monthSel.value = curMonth;
  staffSel.innerHTML = '<option value="">全保護者</option>';
  Object.keys(staffIds).sort().forEach(function(id) {
    var o = document.createElement('option'); o.value=id; o.textContent=id+' '+staffIds[id]; staffSel.appendChild(o);
  });
  staffSel.value = curStaff;
}

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', function() {
  loadData().then(function() {
    document.querySelectorAll('.tab-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        // 管理者トグルなど data-tab を持たないボタンは対象外
        var t = this.getAttribute('data-tab');
        if (t) showTab(t);
      });
    });

    var todayInput = document.getElementById('today-date');
    todayInput.value = fmtDate(new Date());
    todayInput.addEventListener('change', renderToday);
    document.getElementById('today-prev').addEventListener('click', function() {
      var d = new Date(todayInput.value); d.setDate(d.getDate()-1); todayInput.value=fmtDate(d); renderToday();
    });
    document.getElementById('today-next').addEventListener('click', function() {
      var d = new Date(todayInput.value); d.setDate(d.getDate()+1); todayInput.value=fmtDate(d); renderToday();
    });
    document.getElementById('today-reset').addEventListener('click', function() {
      todayInput.value = fmtDate(new Date()); renderToday();
    });

    document.getElementById('order-year').addEventListener('change', renderOrderGrid);
    document.getElementById('order-month').addEventListener('change', renderOrderGrid);
    document.getElementById('order-staff').addEventListener('change', populateOrderChild);
    document.getElementById('order-child').addEventListener('change', renderOrderGrid);
    document.getElementById('bulk-shift-month').addEventListener('click', applyShiftToMonth);
    document.getElementById('bulk-weekday-all').addEventListener('click', bulkSetWeekdayAll);
    document.getElementById('bulk-copy-prev').addEventListener('click', bulkCopyPrev);
    document.getElementById('bulk-clear').addEventListener('click', bulkClear);
    document.getElementById('order-confirm').addEventListener('click', confirmOrder);
    document.getElementById('order-edit').addEventListener('click', editOrder);
    document.getElementById('order-unconfirm').addEventListener('click', unconfirmOrder);

    document.getElementById('rpt-run').addEventListener('click', runReport);
    document.getElementById('rpt-dept').addEventListener('change', onReportDeptChange);
    document.getElementById('rpt-all-excel').addEventListener('click', function(){ fetchAggregateData(exportHoikuAllExcel); });
    document.getElementById('rpt-form-excel').addEventListener('click', function(){ fetchAggregateData(exportHoikuFormExcel); });
    document.getElementById('hadmin-toggle').addEventListener('click', toggleHoikuAdmin);
    document.getElementById('child-form').addEventListener('submit', submitChild);
    document.getElementById('child-staff-search').addEventListener('input', populateChildStaff);
    document.getElementById('price-save').addEventListener('click', savePrices);
    document.getElementById('price-default').addEventListener('click', fillDefaultPrices);
    document.getElementById('shiftdef-save').addEventListener('click', saveShiftDefs);
    document.getElementById('shiftdef-default').addEventListener('click', fillDefaultShiftDefs);
    document.getElementById('shiftdef-form').addEventListener('submit', addShiftDef);
    document.getElementById('shift-sync').addEventListener('click', syncShiftsFromDb);
    document.getElementById('shift-probe').addEventListener('click', probeShiftDb);
    document.getElementById('msh-staff-search').addEventListener('input', populateManualShiftStaff);
    document.getElementById('msh-staff').addEventListener('change', renderManualShiftGrid);
    document.getElementById('msh-year').addEventListener('change', renderManualShiftGrid);
    document.getElementById('msh-month').addEventListener('change', renderManualShiftGrid);
    document.getElementById('msh-bulk-weekday').addEventListener('click', manualShiftBulkWeekday);
    document.getElementById('msh-copy-prev').addEventListener('click', manualShiftCopyPrev);
    document.getElementById('msh-clear').addEventListener('click', manualShiftClear);
    document.getElementById('shift-csv-import').addEventListener('click', importShiftCsv);
    document.getElementById('shift-csv-export').addEventListener('click', exportShiftCsv);
    document.getElementById('shift-year').addEventListener('change', renderShiftPreview);
    document.getElementById('shift-month').addEventListener('change', renderShiftPreview);
    document.getElementById('hpw-save').addEventListener('click', function() {
      var pw = document.getElementById('hpw-input').value;
      if (!pw) { showToast('パスワードを入力してください'); return; }
      var next = {}; for (var k in hoikuConfig) next[k] = hoikuConfig[k];
      next.password = pw;
      saveHoikuConfig(next, function(err) {
        if (err) { alert('パスワードの保存に失敗しました: ' + err); return; }
        document.getElementById('hpw-input').value = '';
        renderHoikuPwStatus();
        showToast('保育園の管理者パスワードを設定しました');
      });
    });
    document.getElementById('hpw-clear').addEventListener('click', function() {
      if (!confirm('保育園の管理者パスワードを解除しますか？')) return;
      var next = {}; for (var k in hoikuConfig) next[k] = hoikuConfig[k];
      delete next.password;
      saveHoikuConfig(next, function(err) {
        if (err) { alert('パスワードの解除に失敗しました: ' + err); return; }
        renderHoikuPwStatus();
        showToast('パスワードを解除しました');
      });
    });
    var verEl = document.getElementById('app-version');
    if (verEl) verEl.textContent = 'ver ' + APP_VERSION;
    applyHoikuAdmin();
    document.getElementById('rpt-print').addEventListener('click', function() { window.print(); });

    document.getElementById('hist-month-filter').addEventListener('change', renderHistory);
    document.getElementById('hist-staff-filter').addEventListener('change', renderHistory);

    renderToday();
  }).catch(function(err) {
    document.getElementById('toast').textContent = 'データ読み込みエラー: ' + err.message;
    document.getElementById('toast').classList.add('show');
    document.getElementById('toast').style.opacity = '1';
  });
});
