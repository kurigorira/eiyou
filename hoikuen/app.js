'use strict';

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
var toastTimer = null;
var orderLocked = true;
var orderDirty = false;

function loadData() {
  try {
    staffList = JSON.parse(localStorage.getItem('eiyou_staff') || '[]');
    children = JSON.parse(localStorage.getItem('eiyou_children') || '[]');
    holidays = JSON.parse(localStorage.getItem('eiyou_holidays') || '[]');
    orders = JSON.parse(localStorage.getItem('eiyou_hoiku_orders') || '{}');
    opHistory = JSON.parse(localStorage.getItem('eiyou_hoiku_history') || '[]');
  } catch(e) { staffList=[]; children=[]; holidays=[]; orders={}; opHistory=[]; }
}
function saveOrders() { localStorage.setItem('eiyou_hoiku_orders', JSON.stringify(orders)); }
function saveHistory() { localStorage.setItem('eiyou_hoiku_history', JSON.stringify(opHistory)); }

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

function getConfirmKey(childId, y, m) {
  return 'eiyou_hoiku_confirmed_'+y+'-'+pad(m)+'_'+childId;
}
function getOrderStatus(childId, y, m) {
  return localStorage.getItem(getConfirmKey(childId, y, m)) === '1';
}
function setOrderConfirmed(childId, y, m, val) {
  if (val) localStorage.setItem(getConfirmKey(childId, y, m), '1');
  else localStorage.removeItem(getConfirmKey(childId, y, m));
}

function getEditPassword() { return localStorage.getItem('eiyou_edit_password') || ''; }

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
function renderToday() {
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
    var o = getOrder(c.id, y, m, d);
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
  populateOrderStaff();
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
  var confirmed = getOrderStatus(childId, y, m);
  orderLocked = confirmed;
  orderDirty = false;
  var days = daysInMonth(y, m);
  var todayStr = fmtDate(new Date());
  var disabledCls = orderLocked ? ' disabled' : '';

  var html = '<table class="order-table"><thead><tr><th>日</th><th>曜</th>';
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
    html += '<tr class="'+cls+'"><td>'+d+'</td><td>'+WEEKDAYS[dow]+'</td>';
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
    cells[i].addEventListener('click', function() {
      var day = parseInt(this.getAttribute('data-d'));
      var meal = this.getAttribute('data-m');
      var cid = document.getElementById('order-child').value;
      var sid = document.getElementById('order-staff').value;
      var cy = parseInt(document.getElementById('order-year').value);
      var cm = parseInt(document.getElementById('order-month').value);
      var cur = getOrder(cid, cy, cm, day)[meal] || '';
      var idx = TYPE_CYCLE.indexOf(cur);
      var next = TYPE_CYCLE[(idx + 1) % TYPE_CYCLE.length];
      setOrder(cid, cy, cm, day, meal, next);
      this.textContent = TYPE_LABELS[next];
      this.className = 'meal-cell' + (next ? ' '+next : '');
      var detail = day+'日 '+MEAL_NAMES[meal]+' '+(next ? typeLabel(next) : '取消');
      addHistory(sid, cid, cy+'-'+pad(cm), '変更', detail);
      orderDirty = true;
      updateSummary(cy, cm, cid);
      updateOrderButtons();
    });
  }
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
  var confirmed = getOrderStatus(childId, y, m);
  var status = document.getElementById('order-status');
  var confirmBtn = document.getElementById('order-confirm');
  var editBtn = document.getElementById('order-edit');

  if (confirmed && !orderDirty) {
    status.textContent = '確定済み';
    status.className = 'order-status confirmed';
    confirmBtn.style.display = 'none';
    editBtn.style.display = '';
  } else if (orderDirty) {
    status.textContent = '未保存の変更があります';
    status.className = 'order-status unsaved';
    confirmBtn.style.display = '';
    confirmBtn.textContent = '確定';
    editBtn.style.display = 'none';
  } else {
    status.textContent = '未確定';
    status.className = 'order-status editing';
    confirmBtn.style.display = '';
    confirmBtn.textContent = '確定';
    editBtn.style.display = 'none';
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
  var y = parseInt(document.getElementById('order-year').value);
  var m = parseInt(document.getElementById('order-month').value);
  var was = getOrderStatus(childId, y, m);
  saveOrders();
  setOrderConfirmed(childId, y, m, true);
  addHistory(staffId, childId, y+'-'+pad(m), was?'修正確定':'確定', getSummaryText(childId,y,m));
  orderLocked = true;
  orderDirty = false;
  setCellsDisabled(true);
  updateOrderButtons();
  showToast(y+'年'+m+'月の注文を確定しました');
}

function editOrder() {
  var childId = document.getElementById('order-child').value;
  var staffId = document.getElementById('order-staff').value;
  if (!childId) return;
  var savedPw = getEditPassword();
  if (savedPw) {
    var input = prompt('編集パスワードを入力してください');
    if (input === null) return;
    if (input !== savedPw) { showToast('パスワードが正しくありません'); return; }
  }
  var y = parseInt(document.getElementById('order-year').value);
  var m = parseInt(document.getElementById('order-month').value);
  addHistory(staffId, childId, y+'-'+pad(m), '修正開始', '');
  orderLocked = false;
  orderDirty = false;
  setCellsDisabled(false);
  var status = document.getElementById('order-status');
  status.textContent = '修正中';
  status.className = 'order-status editing';
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
    var wrap = document.getElementById('order-grid-wrap');
    var activeCells = wrap.querySelectorAll('.meal-cell:not(.disabled)');
    for (var i=0; i<activeCells.length; i++) {
      activeCells[i].addEventListener('click', createCellClickHandler());
    }
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
    var cur = getOrder(cid, cy, cm, day)[meal] || '';
    var idx = TYPE_CYCLE.indexOf(cur);
    var next = TYPE_CYCLE[(idx + 1) % TYPE_CYCLE.length];
    setOrder(cid, cy, cm, day, meal, next);
    this.textContent = TYPE_LABELS[next];
    this.className = 'meal-cell' + (next ? ' '+next : '');
    var detail = day+'日 '+MEAL_NAMES[meal]+' '+(next ? typeLabel(next) : '取消');
    addHistory(sid, cid, cy+'-'+pad(cm), '変更', detail);
    orderDirty = true;
    updateSummary(cy, cm, cid);
    updateOrderButtons();
  };
}

function requireUnlocked() {
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
      for (var k=0; k<MEAL_KEYS.length; k++) {
        setOrder(childId, y, m, d, MEAL_KEYS[k], 'normal');
      }
    }
  }
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
  var py = m===1 ? y-1 : y;
  var pm = m===1 ? 12 : m-1;
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
  setOrderConfirmed(childId, y, m, false);
  addHistory(staffId, childId, y+'-'+pad(m), 'クリア', '全注文を削除');
  orderDirty = false;
  orderLocked = false;
  renderOrderGridKeepUnlocked();
  showToast('クリアしました');
}

function renderOrderGridKeepUnlocked() {
  var saveLocked = orderLocked;
  var saveDirty = orderDirty;
  renderOrderGrid();
  orderLocked = saveLocked;
  orderDirty = saveDirty;
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

function runReport() {
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
      var o = getOrder(c.id, y, m, d);
      for (var k=0; k<MEAL_KEYS.length; k++) {
        var mk = MEAL_KEYS[k];
        if (o[mk]) {
          dayT[mk]++;
          totals[mk]++;
          if (o[mk]==='normal') normalTotals[mk]++;
          else if (o[mk]==='kizami') kizamiTotals[mk]++;
        }
      }
    }
    dailyData.push({day:d, dow:dayOfWeek(y,m,d), t:dayT});
  }

  for (var i=0; i<children.length; i++) {
    var c = children[i];
    var s = getStaffById(c.staffId);
    var ct = {b:0,s1:0,l:0,s2:0,d:0};
    var cn = {b:0,s1:0,l:0,s2:0,d:0};
    var ck = {b:0,s1:0,l:0,s2:0,d:0};
    for (var d=1; d<=days; d++) {
      var o = getOrder(c.id, y, m, d);
      for (var k=0; k<MEAL_KEYS.length; k++) {
        var mk = MEAL_KEYS[k];
        if (o[mk]) { ct[mk]++; if(o[mk]==='normal') cn[mk]++; else ck[mk]++; }
      }
    }
    var total = 0;
    for (var k=0; k<MEAL_KEYS.length; k++) total += ct[MEAL_KEYS[k]];
    if (total > 0) {
      childRows.push({childName:c.name, parentName:s?s.name:c.staffId, t:ct, n:cn, k:ck});
    }
  }

  var totalAll = 0;
  for (var k=0; k<MEAL_KEYS.length; k++) totalAll += totals[MEAL_KEYS[k]];

  var html = '<div class="rpt-section"><h3>'+y+'年'+m+'月 月次合計</h3>';
  html += '<table class="rpt-table"><thead><tr><th>食事</th><th>普通食</th><th>きざみ食</th><th>合計</th></tr></thead><tbody>';
  for (var k=0; k<MEAL_KEYS.length; k++) {
    var mk = MEAL_KEYS[k];
    html += '<tr><td>'+MEAL_NAMES[mk]+'</td><td>'+normalTotals[mk]+'</td><td>'+kizamiTotals[mk]+'</td><td>'+totals[mk]+'</td></tr>';
  }
  html += '</tbody><tfoot><tr><td>合計</td>';
  var nAll=0, kAll=0;
  for (var k=0; k<MEAL_KEYS.length; k++) { nAll+=normalTotals[MEAL_KEYS[k]]; kAll+=kizamiTotals[MEAL_KEYS[k]]; }
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
      var mk = MEAL_KEYS[k];
      var detail = '';
      if (cr.n[mk]>0 && cr.k[mk]>0) detail = cr.n[mk]+'普/'+cr.k[mk]+'き';
      else if (cr.k[mk]>0) detail = cr.t[mk]+'(き)';
      else detail = ''+cr.t[mk];
      html += '<td>'+detail+'</td>';
      rowTotal += cr.t[mk];
    }
    html += '<td>'+rowTotal+'</td></tr>';
  }
  html += '</tbody></table></div>';

  html += '<div class="rpt-section"><h3>日別内訳</h3>';
  html += '<table class="rpt-table"><thead><tr><th>日</th><th>曜</th>';
  for (var k=0; k<MEAL_KEYS.length; k++) html += '<th>'+MEAL_NAMES[MEAL_KEYS[k]]+'</th>';
  html += '<th>合計</th></tr></thead><tbody>';
  for (var i=0; i<dailyData.length; i++) {
    var dy = dailyData[i];
    var ds = y+'-'+pad(m)+'-'+pad(dy.day);
    var hName = getHolidayName(ds);
    var label = WEEKDAYS[dy.dow];
    if (hName) label += '('+hName+')';
    var dayTotal = 0;
    html += '<tr><td>'+dy.day+'</td><td style="text-align:center">'+label+'</td>';
    for (var k=0; k<MEAL_KEYS.length; k++) {
      html += '<td>'+dy.t[MEAL_KEYS[k]]+'</td>';
      dayTotal += dy.t[MEAL_KEYS[k]];
    }
    html += '<td>'+dayTotal+'</td></tr>';
  }
  html += '</tbody></table></div>';

  document.getElementById('rpt-result').innerHTML = html;
}

// ==================== HISTORY TAB ====================
function renderHistory() {
  populateHistoryFilters();
  var monthF = document.getElementById('hist-month-filter').value;
  var staffF = document.getElementById('hist-staff-filter').value;

  var tb = document.getElementById('history-list');
  var html = '';
  var count = 0;
  for (var i=0; i<opHistory.length && count<200; i++) {
    var h = opHistory[i];
    if (monthF && h.yearMonth !== monthF) continue;
    if (staffF && h.staffId !== staffF) continue;
    html += '<tr>';
    html += '<td style="white-space:nowrap">'+esc(h.timestamp)+'</td>';
    html += '<td>'+esc(h.staffName)+'</td>';
    html += '<td>'+esc(h.childName)+'</td>';
    html += '<td>'+esc(h.yearMonth)+'</td>';
    html += '<td>'+esc(h.action)+'</td>';
    html += '<td>'+esc(h.detail)+'</td>';
    html += '</tr>';
    count++;
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
  loadData();

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
  document.getElementById('rpt-print').addEventListener('click', function() { window.print(); });

  document.getElementById('hist-month-filter').addEventListener('change', renderHistory);
  document.getElementById('hist-staff-filter').addEventListener('change', renderHistory);

  renderToday();
});
