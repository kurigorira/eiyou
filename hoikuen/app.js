'use strict';

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
      if (!target[k] || typeof target[k] !== 'object') target[k] = {};
      for (var k2 in src[k]) target[k][k2] = src[k][k2];
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
  {key:'gakudo', label:'学童'},
  {key:'ichiji', label:'一時預'}
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
}

// ==================== TODAY TAB ====================
function fetchAggregateData(fn) {
  var get = function(key) {
    return fetch(API_URL + '?key=' + key + '&t=' + Date.now()).then(function(r) { return r.json(); });
  };
  Promise.all([get('hoiku_orders'), get('hoiku_confirmed'), get('prices'), get('shifts'), get('children')])
    .then(function(res) {
      orders = res[0] || {};
      hoikuConfirmed = res[1] || {};
      prices = res[2] || {};
      shifts = res[3] || {};
      children = res[4] || [];
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
  Promise.all([g('config'), g('shifts'), g('children')]).then(function(res) {
    config = res[0] || {};
    shifts = res[1] || {};
    children = res[2] || [];
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
    html += '<td style="font-size:0.75rem;white-space:nowrap">'+esc(sh)+'</td>';
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
  if (cfm && !orderDirty) {
    status.textContent = '確定済み'; status.className = 'order-status confirmed';
    confirmBtn.style.display = 'none'; editBtn.style.display = '';
  } else if (orderDirty) {
    status.textContent = '未保存の変更があります'; status.className = 'order-status unsaved';
    confirmBtn.style.display = ''; confirmBtn.textContent = '確定'; editBtn.style.display = 'none';
  } else {
    status.textContent = '未確定'; status.className = 'order-status editing';
    confirmBtn.style.display = ''; confirmBtn.textContent = '確定'; editBtn.style.display = 'none';
  }
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
  var savedPw = getEditPassword();
  if (savedPw) {
    var input = prompt('編集パスワードを入力してください');
    if (input === null) return;
    if (input !== savedPw) { showToast('パスワードが正しくありません'); return; }
  }
  var y = parseInt(document.getElementById('order-year').value);
  var m = parseInt(document.getElementById('order-month').value);
  addHistory(staffId, childId, y+'-'+pad(m), '修正開始', '');
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
function isOrderInputBlocked() {
  return !!(config.lock && config.lock.on);
}
function getLockMessage() {
  return (config.lock && config.lock.msg) ? config.lock.msg : DEFAULT_LOCK_MSG;
}
function renderOrderLockNotice() {
  var el = document.getElementById('order-lock-notice');
  if (!el) return;
  if (isOrderInputBlocked()) {
    el.textContent = '【受付停止中】' + getLockMessage();
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

  // 勤務区分（各日の各職員）
  sheet.rows.push([]);
  var sr = sheet.rows.length + 1;
  var shTitle = [XC(y+'年'+m+'月 職員別 勤務区分', 3)];
  for (var c=1; c<2+days; c++) shTitle.push(XC('',3));
  sheet.rows.push(shTitle);
  sheet.merges.push('A'+sr+':'+xlsxColLetter(1+days)+sr);

  var ym = y + '-' + pad(m);
  var month = shifts[ym] || {};
  var idSet = {};
  for (var i=0; i<rows.length; i++) idSet[rows[i].staffId] = true;
  for (var sid in month) idSet[sid] = true;
  var ids = Object.keys(idSet).sort();

  var sh = [XC('職員ID',1), XC('氏名',1)];
  for (var d=1; d<=days; d++) sh.push(XC(d, dayFillStyle(y,m,d,true)));
  sheet.rows.push(sh);
  if (ids.length === 0) {
    sheet.rows.push([XC('勤務区分は取り込まれていません', 4)]);
  } else {
    for (var i=0; i<ids.length; i++) {
      var st = getStaffById(ids[i]);
      var r2 = [XC(ids[i],4), XC(st?st.name:'',4)];
      for (var d=1; d<=days; d++) r2.push(XC(getShift(ids[i], y, m, d), dayFillStyle(y,m,d,false)));
      sheet.rows.push(r2);
    }
  }
  return sheet;
}

// ==================== 食事代・勤務区分セクション ====================
function buildCostSection(y, m) {
  var rows = staffMonthCostRows(y, m);
  var html = '<div class="rpt-section"><h3>'+y+'年'+m+'月 職員別 食事代</h3>';
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
    html += '<p class="help-text">確定済みの注文がありません。</p></div>';
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

function buildShiftSection(y, m) {
  var days = daysInMonth(y, m);
  var ym = y + '-' + pad(m);
  var month = shifts[ym] || {};
  // 保護者として注文がある職員＋勤務区分が登録されている職員を対象にする
  var idSet = {};
  var rows = staffMonthCostRows(y, m);
  for (var i=0; i<rows.length; i++) idSet[rows[i].staffId] = true;
  for (var sid in month) idSet[sid] = true;
  var ids = Object.keys(idSet).sort();
  var html = '<div class="rpt-section"><h3>'+y+'年'+m+'月 職員別 勤務区分</h3>';
  if (ids.length === 0) {
    html += '<p class="help-text">勤務区分が取り込まれていません。'
         +  '職員給食システムの管理者モード →「保育園マスタ」タブで取り込んでください。</p></div>';
    return html;
  }
  html += '<div style="overflow-x:auto"><table class="rpt-table"><thead><tr><th>職員ID</th><th>氏名</th>';
  for (var d=1; d<=days; d++) {
    var dow = dayOfWeek(y,m,d);
    var bg = getHolidayName(y+'-'+pad(m)+'-'+pad(d)) ? 'background:#fff8e1;'
           : (dow===0 ? 'background:#fce4ec;' : (dow===6 ? 'background:#e8eaf6;' : ''));
    html += '<th style="'+bg+'">'+d+'<br><span style="font-size:0.7rem">'+WEEKDAYS[dow]+'</span></th>';
  }
  html += '</tr></thead><tbody>';
  for (var i=0; i<ids.length; i++) {
    var st = getStaffById(ids[i]);
    html += '<tr><td>'+esc(ids[i])+'</td><td style="white-space:nowrap">'+esc(st?st.name:'')+'</td>';
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
  html += buildCostSection(y, m);
  html += buildShiftSection(y, m);
  document.getElementById('rpt-result').innerHTML = html;
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
      btn.addEventListener('click', function() { showTab(this.getAttribute('data-tab')); });
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
    document.getElementById('bulk-weekday-all').addEventListener('click', bulkSetWeekdayAll);
    document.getElementById('bulk-copy-prev').addEventListener('click', bulkCopyPrev);
    document.getElementById('bulk-clear').addEventListener('click', bulkClear);
    document.getElementById('order-confirm').addEventListener('click', confirmOrder);
    document.getElementById('order-edit').addEventListener('click', editOrder);

    document.getElementById('rpt-run').addEventListener('click', runReport);
    document.getElementById('rpt-all-excel').addEventListener('click', function(){ fetchAggregateData(exportHoikuAllExcel); });
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
