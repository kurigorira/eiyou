'use strict';

var WEEKDAYS = ['日','月','火','水','木','金','土'];

var DEFAULT_HOLIDAYS = [
  {date:'2026-01-01',name:'元日'},{date:'2026-01-12',name:'成人の日'},
  {date:'2026-02-11',name:'建国記念の日'},{date:'2026-02-23',name:'天皇誕生日'},
  {date:'2026-03-20',name:'春分の日'},{date:'2026-04-29',name:'昭和の日'},
  {date:'2026-05-03',name:'憲法記念日'},{date:'2026-05-04',name:'みどりの日'},
  {date:'2026-05-05',name:'こどもの日'},{date:'2026-05-06',name:'振替休日'},
  {date:'2026-07-20',name:'海の日'},{date:'2026-08-11',name:'山の日'},
  {date:'2026-09-21',name:'敬老の日'},{date:'2026-09-23',name:'秋分の日'},
  {date:'2026-10-12',name:'スポーツの日'},{date:'2026-11-03',name:'文化の日'},
  {date:'2026-11-23',name:'勤労感謝の日'},
  {date:'2027-01-01',name:'元日'},{date:'2027-01-11',name:'成人の日'},
  {date:'2027-02-11',name:'建国記念の日'},{date:'2027-02-23',name:'天皇誕生日'},
  {date:'2027-03-21',name:'春分の日'},{date:'2027-04-29',name:'昭和の日'},
  {date:'2027-05-03',name:'憲法記念日'},{date:'2027-05-04',name:'みどりの日'},
  {date:'2027-05-05',name:'こどもの日'},{date:'2027-07-19',name:'海の日'},
  {date:'2027-08-11',name:'山の日'},{date:'2027-09-20',name:'敬老の日'},
  {date:'2027-09-23',name:'秋分の日'},{date:'2027-10-11',name:'スポーツの日'},
  {date:'2027-11-03',name:'文化の日'},{date:'2027-11-23',name:'勤労感謝の日'},
  {date:'2028-01-01',name:'元日'},{date:'2028-01-10',name:'成人の日'},
  {date:'2028-02-11',name:'建国記念の日'},{date:'2028-02-23',name:'天皇誕生日'},
  {date:'2028-03-20',name:'春分の日'},{date:'2028-04-29',name:'昭和の日'},
  {date:'2028-05-03',name:'憲法記念日'},{date:'2028-05-04',name:'みどりの日'},
  {date:'2028-05-05',name:'こどもの日'},{date:'2028-07-17',name:'海の日'},
  {date:'2028-08-11',name:'山の日'},{date:'2028-09-18',name:'敬老の日'},
  {date:'2028-09-22',name:'秋分の日'},{date:'2028-10-09',name:'スポーツの日'},
  {date:'2028-11-03',name:'文化の日'},{date:'2028-11-23',name:'勤労感謝の日'}
];

var staffList = [];
var orders = {};
var holidays = [];
var opHistory = [];
var children = [];
var toastTimer = null;
var adminMode = false;

function loadData() {
  try {
    staffList = JSON.parse(localStorage.getItem('eiyou_staff') || '[]');
    orders = JSON.parse(localStorage.getItem('eiyou_orders') || '{}');
    holidays = JSON.parse(localStorage.getItem('eiyou_holidays') || '[]');
    opHistory = JSON.parse(localStorage.getItem('eiyou_history') || '[]');
    children = JSON.parse(localStorage.getItem('eiyou_children') || '[]');
  } catch(e) { staffList=[]; orders={}; holidays=[]; opHistory=[]; children=[]; }
}
function saveChildren() { localStorage.setItem('eiyou_children', JSON.stringify(children)); }
function getChildrenByStaff(staffId) {
  return children.filter(function(c) { return c.staffId === staffId; });
}
function saveStaff() { localStorage.setItem('eiyou_staff', JSON.stringify(staffList)); }
function saveOrders() { localStorage.setItem('eiyou_orders', JSON.stringify(orders)); }
function saveHolidays() { localStorage.setItem('eiyou_holidays', JSON.stringify(holidays)); }
function saveHistory() { localStorage.setItem('eiyou_history', JSON.stringify(opHistory)); }

function addHistory(staffId, yearMonth, action, detail) {
  var s = getStaffById(staffId);
  var name = s ? s.name : staffId;
  opHistory.unshift({
    timestamp: new Date().toLocaleString('ja-JP'),
    staffId: staffId,
    staffName: name,
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
  var ds = y+'-'+pad(m)+'-'+pad(d);
  return !isWeekend(y,m,d) && !isHoliday(ds);
}

function getStaffById(id) {
  for (var i=0; i<staffList.length; i++) { if(staffList[i].id===id) return staffList[i]; }
  return null;
}
function getDepartments() {
  var deps = {};
  for (var i=0; i<staffList.length; i++) deps[staffList[i].dept] = true;
  return Object.keys(deps).sort();
}
function getStaffSorted() {
  return staffList.slice().sort(function(a,b) {
    if (a.dept < b.dept) return -1; if (a.dept > b.dept) return 1;
    if (a.id < b.id) return -1; if (a.id > b.id) return 1; return 0;
  });
}

var orderLocked = true;
var orderDirty = false;

function getOrderStatus(staffId, y, m) {
  var key = y+'-'+pad(m);
  var sKey = 'eiyou_confirmed_'+key+'_'+staffId;
  return localStorage.getItem(sKey) === '1';
}
function setOrderConfirmed(staffId, y, m, val) {
  var key = y+'-'+pad(m);
  var sKey = 'eiyou_confirmed_'+key+'_'+staffId;
  if (val) localStorage.setItem(sKey, '1'); else localStorage.removeItem(sKey);
}

function emptyMeal() { return {b:false,l:false,d:false,dd:false}; }
function getOrder(staffId, y, m, d) {
  var key = y+'-'+pad(m);
  if (!orders[key] || !orders[key][staffId] || !orders[key][staffId][d]) return emptyMeal();
  var o = orders[key][staffId][d];
  return {b:!!o.b, l:!!o.l, d:!!o.d, dd:!!o.dd};
}
function setOrder(staffId, y, m, d, meal, val) {
  var key = y+'-'+pad(m);
  if (!orders[key]) orders[key] = {};
  if (!orders[key][staffId]) orders[key][staffId] = {};
  if (!orders[key][staffId][d]) orders[key][staffId][d] = emptyMeal();
  orders[key][staffId][d][meal] = val;
}

function parseCSV(text) {
  var lines = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n');
  if (lines.length > 0 && lines[0].charCodeAt(0) === 0xFEFF) lines[0] = lines[0].substring(1);
  var result = [];
  for (var i=0; i<lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    var fields = [];
    var inQuote = false, field = '';
    for (var j=0; j<line.length; j++) {
      var ch = line[j];
      if (inQuote) {
        if (ch==='"' && j+1<line.length && line[j+1]==='"') { field+='"'; j++; }
        else if (ch==='"') inQuote = false;
        else field += ch;
      } else {
        if (ch==='"') inQuote = true;
        else if (ch===',') { fields.push(field); field=''; }
        else field += ch;
      }
    }
    fields.push(field);
    result.push(fields);
  }
  return result;
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
  if (name==='staff') { renderStaffList(); populateChildStaff(); renderChildList(); }
  if (name==='order') initOrderTab();
  if (name==='report') initReportTab();
  if (name==='history') renderHistory();
  if (name==='holiday') renderHolidayList();
}

// ==================== TODAY TAB ====================
function renderToday() {
  var dateInput = document.getElementById('today-date');
  var ds = dateInput.value;
  if (!ds) { var now=new Date(); ds=fmtDate(now); dateInput.value=ds; }
  var parts = ds.split('-');
  var y = parseInt(parts[0]), m = parseInt(parts[1]), d = parseInt(parts[2]);
  var notice = document.getElementById('today-holiday-notice');
  var hName = getHolidayName(ds);
  var dow = dayOfWeek(y,m,d);
  if (hName) { notice.textContent = ds+' は祝日（'+hName+'）です'; notice.style.display='block'; }
  else if (dow===0||dow===6) { notice.textContent = ds+' は'+WEEKDAYS[dow]+'曜日です'; notice.style.display='block'; }
  else { notice.style.display='none'; }

  var bList=[], lList=[], dList=[], ddList=[];
  var sorted = getStaffSorted();
  for (var i=0; i<sorted.length; i++) {
    var s = sorted[i];
    var o = getOrder(s.id, y, m, d);
    if (o.b) bList.push(s);
    if (o.l) lList.push(s);
    if (o.d) dList.push(s);
    if (o.dd) ddList.push(s);
  }
  fillMealList('b-list', bList); document.getElementById('b-count').textContent = bList.length;
  fillMealList('l-list', lList); document.getElementById('l-count').textContent = lList.length;
  fillMealList('d-list', dList); document.getElementById('d-count').textContent = dList.length;
  fillMealList('dd-list', ddList); document.getElementById('dd-count').textContent = ddList.length;
}
function fillMealList(tbodyId, list) {
  var tb = document.getElementById(tbodyId);
  if (list.length===0) { tb.innerHTML='<tr><td colspan="3" style="text-align:center;color:#999">なし</td></tr>'; return; }
  var html='';
  for (var i=0; i<list.length; i++) {
    html+='<tr><td>'+esc(list[i].id)+'</td><td>'+esc(list[i].name)+'</td><td>'+esc(list[i].dept)+'</td></tr>';
  }
  tb.innerHTML = html;
}
function esc(s) { var d=document.createElement('div'); d.textContent=s; return d.innerHTML; }

// ==================== STAFF TAB ====================
var editingStaffId = null;

function renderStaffList() {
  var search = (document.getElementById('staff-search').value||'').toLowerCase();
  var sorted = getStaffSorted();
  var tb = document.getElementById('staff-list');
  var html = '';
  for (var i=0; i<sorted.length; i++) {
    var s = sorted[i];
    if (search && s.id.toLowerCase().indexOf(search)===-1 && s.name.toLowerCase().indexOf(search)===-1 && s.dept.toLowerCase().indexOf(search)===-1) continue;
    var cc = getChildrenByStaff(s.id).length;
    html+='<tr><td>'+esc(s.id)+'</td><td>'+esc(s.name)+'</td><td>'+esc(s.dept)+'</td>';
    html+='<td>'+(cc>0?cc+'人':'')+'</td>';
    html+='<td><button class="btn-edit" onclick="editStaff(\''+esc(s.id)+'\')">編集</button>';
    html+='<button class="btn-del" onclick="deleteStaff(\''+esc(s.id)+'\')">削除</button></td></tr>';
  }
  if (!html) html='<tr><td colspan="5" style="text-align:center;color:#999">職員データがありません</td></tr>';
  tb.innerHTML = html;
}

function submitStaff(e) {
  e.preventDefault();
  var id = document.getElementById('sf-id').value.trim();
  var name = document.getElementById('sf-name').value.trim();
  var dept = document.getElementById('sf-dept').value.trim();
  if (!id||!name||!dept) return;
  if (editingStaffId) {
    var s = getStaffById(editingStaffId);
    if (s) { s.name=name; s.dept=dept; }
    saveStaff(); cancelEditStaff();
    showToast('職員情報を更新しました');
  } else {
    if (getStaffById(id)) { showToast('このIDは既に登録されています'); return; }
    staffList.push({id:id, name:name, dept:dept});
    saveStaff();
    showToast('職員を登録しました');
  }
  document.getElementById('staff-form').reset();
  renderStaffList();
}

function editStaff(id) {
  var s = getStaffById(id);
  if (!s) return;
  editingStaffId = id;
  document.getElementById('sf-id').value = s.id;
  document.getElementById('sf-id').readOnly = true;
  document.getElementById('sf-name').value = s.name;
  document.getElementById('sf-dept').value = s.dept;
  document.getElementById('sf-submit').textContent = '更新';
  document.getElementById('sf-cancel').style.display = '';
  document.getElementById('staff-form-title').textContent = '職員編集';
}

function cancelEditStaff() {
  editingStaffId = null;
  document.getElementById('sf-id').readOnly = false;
  document.getElementById('sf-submit').textContent = '登録';
  document.getElementById('sf-cancel').style.display = 'none';
  document.getElementById('staff-form-title').textContent = '職員登録';
  document.getElementById('staff-form').reset();
}

function deleteStaff(id) {
  var s = getStaffById(id);
  if (!s) return;
  if (!confirm(s.name+'（'+id+'）を削除しますか？\n関連する注文・子供データも削除されます。')) return;
  staffList = staffList.filter(function(x){return x.id!==id;});
  children = children.filter(function(c){return c.staffId!==id;});
  for (var key in orders) { if (orders[key][id]) delete orders[key][id]; }
  saveStaff(); saveOrders(); saveChildren();
  showToast('削除しました');
  renderStaffList();
}

function importCSV() {
  var fileInput = document.getElementById('csv-file');
  if (!fileInput.files.length) { showToast('ファイルを選択してください'); return; }
  var overwrite = document.getElementById('csv-overwrite').checked;
  var reader = new FileReader();
  reader.onload = function(e) {
    var rows = parseCSV(e.target.result);
    var added=0, updated=0, skipped=0;
    for (var i=0; i<rows.length; i++) {
      var r = rows[i];
      if (r.length<3) continue;
      var id=r[0].trim(), name=r[1].trim(), dept=r[2].trim();
      if (!id||!name||!dept) continue;
      if (id==='ID'||id==='職員ID'||id==='id') continue;
      var existing = getStaffById(id);
      if (existing) {
        if (overwrite) { existing.name=name; existing.dept=dept; updated++; }
        else skipped++;
      } else { staffList.push({id:id,name:name,dept:dept}); added++; }
    }
    saveStaff(); renderStaffList();
    showToast('追加:'+added+'件 更新:'+updated+'件 スキップ:'+skipped+'件');
    fileInput.value='';
  };
  reader.readAsText(fileInput.files[0], 'UTF-8');
}

function exportCSV() {
  var sorted = getStaffSorted();
  var csv = '\uFEFF職員ID,氏名,部署\n';
  for (var i=0; i<sorted.length; i++) {
    var s = sorted[i];
    csv += '"'+s.id.replace(/"/g,'""')+'","'+s.name.replace(/"/g,'""')+'","'+s.dept.replace(/"/g,'""')+'"\n';
  }
  downloadFile(csv, '職員マスタ_'+fmtDate(new Date())+'.csv', 'text/csv;charset=utf-8');
}

function downloadFile(content, filename, type) {
  var blob = new Blob([content], {type:type});
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

// ==================== ORDER TAB ====================
function initOrderTab() {
  var now = new Date();
  var ySel = document.getElementById('order-year');
  var mSel = document.getElementById('order-month');
  if (ySel.options.length===0) {
    for (var y=now.getFullYear()-1; y<=now.getFullYear()+2; y++) {
      var opt = document.createElement('option'); opt.value=y; opt.textContent=y; ySel.appendChild(opt);
    }
    for (var m=1; m<=12; m++) {
      var opt = document.createElement('option'); opt.value=m; opt.textContent=m; mSel.appendChild(opt);
    }
    var defM = now.getMonth()+2; var defY = now.getFullYear();
    if (defM>12) { defM=1; defY++; }
    ySel.value = defY; mSel.value = defM;
  }
  populateOrderDept();
  populateOrderStaff();
}

function populateOrderDept() {
  var sel = document.getElementById('order-dept');
  var cur = sel.value;
  sel.innerHTML = '<option value="">全部署</option>';
  var deps = getDepartments();
  for (var i=0; i<deps.length; i++) {
    var o = document.createElement('option'); o.value=deps[i]; o.textContent=deps[i]; sel.appendChild(o);
  }
  sel.value = cur;
}

function populateOrderStaff() {
  var dept = document.getElementById('order-dept').value;
  var sel = document.getElementById('order-staff');
  var cur = sel.value;
  sel.innerHTML = '<option value="">-- 選択 --</option>';
  var sorted = getStaffSorted();
  for (var i=0; i<sorted.length; i++) {
    if (dept && sorted[i].dept !== dept) continue;
    var o = document.createElement('option');
    o.value = sorted[i].id;
    o.textContent = sorted[i].id + ' ' + sorted[i].name;
    sel.appendChild(o);
  }
  sel.value = cur;
  renderOrderGrid();
}

function renderOrderGrid() {
  var wrap = document.getElementById('order-grid-wrap');
  var summary = document.getElementById('order-summary');
  var actions = document.getElementById('order-actions');
  var staffId = document.getElementById('order-staff').value;
  if (!staffId) {
    wrap.innerHTML = '<p class="placeholder-msg">職員を選択してください</p>';
    summary.style.display = 'none';
    actions.style.display = 'none';
    return;
  }
  var y = parseInt(document.getElementById('order-year').value);
  var m = parseInt(document.getElementById('order-month').value);
  var confirmed = getOrderStatus(staffId, y, m);
  orderLocked = confirmed;
  orderDirty = false;
  var days = daysInMonth(y, m);
  var todayStr = fmtDate(new Date());
  var disabled = orderLocked ? ' disabled' : '';
  var html = '<table class="order-table"><thead><tr><th>日</th><th>曜日</th><th>朝食</th><th>昼食</th><th>夕食</th><th>夕食医師</th><th>備考</th></tr></thead><tbody>';
  var totB=0, totL=0, totD=0, totDD=0;
  for (var d=1; d<=days; d++) {
    var dow = dayOfWeek(y,m,d);
    var ds = y+'-'+pad(m)+'-'+pad(d);
    var hName = getHolidayName(ds);
    var cls = '';
    if (hName) cls='day-holiday'; else if (dow===0) cls='day-sun'; else if (dow===6) cls='day-sat';
    if (ds===todayStr) cls += ' day-today';
    var o = getOrder(staffId, y, m, d);
    if (o.b) totB++; if (o.l) totL++; if (o.d) totD++; if (o.dd) totDD++;
    html += '<tr class="'+cls+'">';
    html += '<td>'+d+'</td><td>'+WEEKDAYS[dow]+'</td>';
    html += '<td><input type="checkbox" data-d="'+d+'" data-m="b"'+(o.b?' checked':'')+disabled+'></td>';
    html += '<td><input type="checkbox" data-d="'+d+'" data-m="l"'+(o.l?' checked':'')+disabled+'></td>';
    html += '<td><input type="checkbox" data-d="'+d+'" data-m="d"'+(o.d?' checked':'')+disabled+'></td>';
    html += '<td><input type="checkbox" data-d="'+d+'" data-m="dd"'+(o.dd?' checked':'')+disabled+'></td>';
    html += '<td style="text-align:left;font-size:0.8rem;color:#999">'+(hName||'')+'</td>';
    html += '</tr>';
  }
  html += '</tbody></table>';
  wrap.innerHTML = html;
  summary.style.display = '';
  actions.style.display = '';
  document.getElementById('os-b').textContent = totB;
  document.getElementById('os-l').textContent = totL;
  document.getElementById('os-d').textContent = totD;
  document.getElementById('os-dd').textContent = totDD;
  updateOrderButtons();

  var MEAL_NAMES = {b:'朝食',l:'昼食',d:'夕食',dd:'夕食医師'};
  var checks = wrap.querySelectorAll('input[type="checkbox"]');
  for (var i=0; i<checks.length; i++) {
    checks[i].addEventListener('change', function() {
      var sid = document.getElementById('order-staff').value;
      var cy = parseInt(document.getElementById('order-year').value);
      var cm = parseInt(document.getElementById('order-month').value);
      var day = parseInt(this.getAttribute('data-d'));
      var meal = this.getAttribute('data-m');
      setOrder(sid, cy, cm, day, meal, this.checked);
      var act = this.checked ? '追加' : '取消';
      addHistory(sid, cy+'-'+pad(cm), '変更', day+'日 '+MEAL_NAMES[meal]+' '+act);
      orderDirty = true;
      updateOrderSummary(cy, cm, sid);
      updateOrderButtons();
    });
  }
}

function updateOrderButtons() {
  var staffId = document.getElementById('order-staff').value;
  if (!staffId) return;
  var y = parseInt(document.getElementById('order-year').value);
  var m = parseInt(document.getElementById('order-month').value);
  var confirmed = getOrderStatus(staffId, y, m);
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

function getOrderSummaryText(staffId, y, m) {
  var days = daysInMonth(y, m);
  var t = {b:0,l:0,d:0,dd:0};
  for (var d=1; d<=days; d++) {
    var o = getOrder(staffId, y, m, d);
    if (o.b) t.b++; if (o.l) t.l++; if (o.d) t.d++; if (o.dd) t.dd++;
  }
  return '朝'+t.b+' 昼'+t.l+' 夕'+t.d+' 夕医'+t.dd;
}

function confirmOrder() {
  var staffId = document.getElementById('order-staff').value;
  if (!staffId) return;
  var y = parseInt(document.getElementById('order-year').value);
  var m = parseInt(document.getElementById('order-month').value);
  var wasConfirmed = getOrderStatus(staffId, y, m);
  saveOrders();
  setOrderConfirmed(staffId, y, m, true);
  var ym = y+'-'+pad(m);
  var summary = getOrderSummaryText(staffId, y, m);
  addHistory(staffId, ym, wasConfirmed ? '修正確定' : '確定', summary);
  orderLocked = true;
  orderDirty = false;
  setCheckboxDisabled(true);
  updateOrderButtons();
  showToast(y+'年'+m+'月の注文を確定しました');
}

function getEditPassword() {
  return localStorage.getItem('eiyou_edit_password') || '';
}
function setEditPassword(pw) {
  if (pw) localStorage.setItem('eiyou_edit_password', pw);
  else localStorage.removeItem('eiyou_edit_password');
}

function editOrder() {
  var staffId = document.getElementById('order-staff').value;
  if (!staffId) return;
  var savedPw = getEditPassword();
  if (savedPw) {
    var input = prompt('編集パスワードを入力してください');
    if (input === null) return;
    if (input !== savedPw) { showToast('パスワードが正しくありません'); return; }
  }
  var y = parseInt(document.getElementById('order-year').value);
  var m = parseInt(document.getElementById('order-month').value);
  addHistory(staffId, y+'-'+pad(m), '修正開始', '');
  orderLocked = false;
  orderDirty = false;
  setCheckboxDisabled(false);
  var status = document.getElementById('order-status');
  status.textContent = '修正中';
  status.className = 'order-status editing';
  document.getElementById('order-confirm').style.display = '';
  document.getElementById('order-confirm').textContent = '確定';
  document.getElementById('order-edit').style.display = 'none';
  showToast('修正モードに切り替えました');
}

function setCheckboxDisabled(disabled) {
  var checks = document.querySelectorAll('#order-grid-wrap input[type="checkbox"]');
  for (var i=0; i<checks.length; i++) checks[i].disabled = disabled;
}

function updateOrderSummary(y, m, staffId) {
  var days = daysInMonth(y, m);
  var totB=0, totL=0, totD=0, totDD=0;
  for (var d=1; d<=days; d++) {
    var o = getOrder(staffId, y, m, d);
    if (o.b) totB++; if (o.l) totL++; if (o.d) totD++; if (o.dd) totDD++;
  }
  document.getElementById('os-b').textContent = totB;
  document.getElementById('os-l').textContent = totL;
  document.getElementById('os-d').textContent = totD;
  document.getElementById('os-dd').textContent = totDD;
}

function requireUnlocked() {
  if (orderLocked) { showToast('修正ボタンを押してから操作してください'); return false; }
  return true;
}

function bulkSetWeekday(meal) {
  var staffId = document.getElementById('order-staff').value;
  if (!staffId) { showToast('職員を選択してください'); return; }
  if (!requireUnlocked()) return;
  var y = parseInt(document.getElementById('order-year').value);
  var m = parseInt(document.getElementById('order-month').value);
  var days = daysInMonth(y, m);
  for (var d=1; d<=days; d++) {
    if (isWorkday(y, m, d)) {
      setOrder(staffId, y, m, d, meal, true);
    }
  }
  var mealName = {b:'朝食',l:'昼食',d:'夕食',dd:'夕食医師'}[meal];
  addHistory(staffId, y+'-'+pad(m), '一括操作', '平日'+mealName+'セット');
  orderDirty = true;
  renderOrderGridKeepUnlocked();
  showToast('平日の'+mealName+'をセットしました');
}

function bulkCopyPrev() {
  var staffId = document.getElementById('order-staff').value;
  if (!staffId) { showToast('職員を選択してください'); return; }
  if (!requireUnlocked()) return;
  var y = parseInt(document.getElementById('order-year').value);
  var m = parseInt(document.getElementById('order-month').value);
  var py = m===1 ? y-1 : y;
  var pm = m===1 ? 12 : m-1;
  var prevKey = py+'-'+pad(pm);
  if (!orders[prevKey] || !orders[prevKey][staffId]) { showToast('前月のデータがありません'); return; }
  var days = daysInMonth(y, m);
  for (var d=1; d<=days; d++) {
    var prev = getOrder(staffId, py, pm, d);
    if (prev.b||prev.l||prev.d||prev.dd) {
      var key = y+'-'+pad(m);
      if (!orders[key]) orders[key] = {};
      if (!orders[key][staffId]) orders[key][staffId] = {};
      orders[key][staffId][d] = {b:prev.b, l:prev.l, d:prev.d, dd:prev.dd};
    }
  }
  addHistory(staffId, y+'-'+pad(m), '前月コピー', py+'年'+pm+'月からコピー');
  orderDirty = true;
  renderOrderGridKeepUnlocked();
  showToast('前月のデータをコピーしました');
}

function bulkClear() {
  var staffId = document.getElementById('order-staff').value;
  if (!staffId) { showToast('職員を選択してください'); return; }
  if (!requireUnlocked()) return;
  if (!confirm('この月の注文を全てクリアしますか？')) return;
  var y = parseInt(document.getElementById('order-year').value);
  var m = parseInt(document.getElementById('order-month').value);
  var key = y+'-'+pad(m);
  if (orders[key] && orders[key][staffId]) delete orders[key][staffId];
  setOrderConfirmed(staffId, y, m, false);
  addHistory(staffId, y+'-'+pad(m), 'クリア', '全注文を削除');
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
  setCheckboxDisabled(orderLocked);
  updateOrderButtons();
}

function navigateStaff(dir) {
  var sel = document.getElementById('order-staff');
  var idx = sel.selectedIndex + dir;
  if (idx < 1) idx = sel.options.length - 1;
  if (idx >= sel.options.length) idx = 1;
  sel.selectedIndex = idx;
  renderOrderGrid();
}

// ==================== REPORT TAB ====================
function initReportTab() {
  var now = new Date();
  var ySel = document.getElementById('rpt-year');
  var mSel = document.getElementById('rpt-month');
  if (ySel.options.length===0) {
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
  var sorted = getStaffSorted();

  var totalB=0, totalL=0, totalD=0, totalDD=0;
  var deptData = {};
  var dailyData = [];

  for (var d=1; d<=days; d++) {
    var dayB=0, dayL=0, dayD=0, dayDD=0;
    for (var i=0; i<sorted.length; i++) {
      var s = sorted[i];
      var o = getOrder(s.id, y, m, d);
      if (o.b) { dayB++; totalB++; }
      if (o.l) { dayL++; totalL++; }
      if (o.d) { dayD++; totalD++; }
      if (o.dd) { dayDD++; totalDD++; }
      if (!deptData[s.dept]) deptData[s.dept] = {b:0,l:0,d:0,dd:0};
      if (o.b) deptData[s.dept].b++;
      if (o.l) deptData[s.dept].l++;
      if (o.d) deptData[s.dept].d++;
      if (o.dd) deptData[s.dept].dd++;
    }
    dailyData.push({day:d, dow:dayOfWeek(y,m,d), b:dayB, l:dayL, d:dayD, dd:dayDD});
  }

  var totalAll = totalB+totalL+totalD+totalDD;
  var html = '<div class="rpt-section"><h3>'+y+'年'+m+'月 月次合計</h3>';
  html += '<table class="rpt-table"><thead><tr><th>食事</th><th>食数</th></tr></thead><tbody>';
  html += '<tr><td>朝食</td><td>'+totalB+'</td></tr>';
  html += '<tr><td>昼食</td><td>'+totalL+'</td></tr>';
  html += '<tr><td>夕食</td><td>'+totalD+'</td></tr>';
  html += '<tr><td>夕食医師</td><td>'+totalDD+'</td></tr>';
  html += '</tbody><tfoot><tr><td>合計</td><td>'+totalAll+'</td></tr></tfoot></table></div>';

  html += '<div class="rpt-section"><h3>部署別集計</h3>';
  html += '<table class="rpt-table"><thead><tr><th>部署</th><th>朝食</th><th>昼食</th><th>夕食</th><th>夕食医師</th><th>合計</th></tr></thead><tbody>';
  var deptKeys = Object.keys(deptData).sort();
  var sumB=0,sumL=0,sumD=0,sumDD=0;
  for (var i=0; i<deptKeys.length; i++) {
    var dp = deptData[deptKeys[i]];
    html += '<tr><td>'+esc(deptKeys[i])+'</td><td>'+dp.b+'</td><td>'+dp.l+'</td><td>'+dp.d+'</td><td>'+dp.dd+'</td><td>'+(dp.b+dp.l+dp.d+dp.dd)+'</td></tr>';
    sumB+=dp.b; sumL+=dp.l; sumD+=dp.d; sumDD+=dp.dd;
  }
  html += '</tbody><tfoot><tr><td>合計</td><td>'+sumB+'</td><td>'+sumL+'</td><td>'+sumD+'</td><td>'+sumDD+'</td><td>'+(sumB+sumL+sumD+sumDD)+'</td></tr></tfoot></table></div>';

  html += '<div class="rpt-section"><h3>日別内訳</h3>';
  html += '<table class="rpt-table"><thead><tr><th>日</th><th>曜日</th><th>朝食</th><th>昼食</th><th>夕食</th><th>夕食医師</th><th>合計</th></tr></thead><tbody>';
  for (var i=0; i<dailyData.length; i++) {
    var dy = dailyData[i];
    var ds = y+'-'+pad(m)+'-'+pad(dy.day);
    var hName = getHolidayName(ds);
    var label = WEEKDAYS[dy.dow];
    if (hName) label += '('+hName+')';
    html += '<tr><td>'+dy.day+'</td><td style="text-align:center">'+label+'</td><td>'+dy.b+'</td><td>'+dy.l+'</td><td>'+dy.d+'</td><td>'+dy.dd+'</td><td>'+(dy.b+dy.l+dy.d+dy.dd)+'</td></tr>';
  }
  html += '</tbody></table></div>';

  document.getElementById('rpt-result').innerHTML = html;
}

// ==================== HISTORY TAB ====================
function renderHistory() {
  populateHistoryFilters();
  var monthF = document.getElementById('hist-month-filter').value;
  var staffF = document.getElementById('hist-staff-filter').value;
  var actionF = document.getElementById('hist-action-filter').value;

  var tb = document.getElementById('history-list');
  var html = '';
  var count = 0;
  for (var i=0; i<opHistory.length && count<200; i++) {
    var h = opHistory[i];
    if (monthF && h.yearMonth !== monthF) continue;
    if (staffF && h.staffId !== staffF) continue;
    if (actionF && h.action !== actionF) continue;
    html += '<tr>';
    html += '<td style="white-space:nowrap">'+esc(h.timestamp)+'</td>';
    html += '<td>'+esc(h.staffId)+' '+esc(h.staffName)+'</td>';
    html += '<td>'+esc(h.yearMonth)+'</td>';
    html += '<td>'+esc(h.action)+'</td>';
    html += '<td>'+esc(h.detail)+'</td>';
    html += '</tr>';
    count++;
  }
  if (!html) html = '<tr><td colspan="5" style="text-align:center;color:#999">履歴なし</td></tr>';
  tb.innerHTML = html;
}

function populateHistoryFilters() {
  var monthSel = document.getElementById('hist-month-filter');
  var staffSel = document.getElementById('hist-staff-filter');
  var curMonth = monthSel.value;
  var curStaff = staffSel.value;

  var months = {};
  var staffIds = {};
  for (var i=0; i<opHistory.length; i++) {
    months[opHistory[i].yearMonth] = true;
    staffIds[opHistory[i].staffId] = opHistory[i].staffName;
  }

  monthSel.innerHTML = '<option value="">全期間</option>';
  Object.keys(months).sort().reverse().forEach(function(ym) {
    var o = document.createElement('option'); o.value=ym; o.textContent=ym; monthSel.appendChild(o);
  });
  monthSel.value = curMonth;

  staffSel.innerHTML = '<option value="">全職員</option>';
  Object.keys(staffIds).sort().forEach(function(id) {
    var o = document.createElement('option'); o.value=id; o.textContent=id+' '+staffIds[id]; staffSel.appendChild(o);
  });
  staffSel.value = curStaff;
}

function clearHistory() {
  var savedPw = getEditPassword();
  if (savedPw) {
    var input = prompt('管理者パスワードを入力してください');
    if (input === null) return;
    if (input !== savedPw) { showToast('パスワードが正しくありません'); return; }
  }
  if (!confirm('履歴を全て削除しますか？')) return;
  opHistory = [];
  saveHistory();
  renderHistory();
  showToast('履歴を削除しました');
}

// ==================== HOLIDAY TAB ====================
function renderHolidayList() {
  var yearFilter = document.getElementById('holiday-year-filter');
  if (yearFilter.options.length===0) {
    var now = new Date();
    for (var y=now.getFullYear()-1; y<=now.getFullYear()+3; y++) {
      var opt = document.createElement('option'); opt.value=y; opt.textContent=y+'年'; yearFilter.appendChild(opt);
    }
    yearFilter.value = now.getFullYear();
  }
  var fy = yearFilter.value;
  var sorted = holidays.slice().sort(function(a,b) { return a.date<b.date?-1:a.date>b.date?1:0; });
  var tb = document.getElementById('holiday-list');
  var html = '';
  for (var i=0; i<sorted.length; i++) {
    var h = sorted[i];
    if (h.date.substring(0,4) !== fy) continue;
    var parts = h.date.split('-');
    var dow = dayOfWeek(parseInt(parts[0]), parseInt(parts[1]), parseInt(parts[2]));
    html += '<tr><td>'+h.date+'</td><td>'+WEEKDAYS[dow]+'</td><td>'+esc(h.name)+'</td>';
    html += '<td><button class="btn-del" onclick="deleteHoliday(\''+h.date+'\')">削除</button></td></tr>';
  }
  if (!html) html = '<tr><td colspan="4" style="text-align:center;color:#999">データなし</td></tr>';
  tb.innerHTML = html;
}

function submitHoliday(e) {
  e.preventDefault();
  var date = document.getElementById('hf-date').value;
  var name = document.getElementById('hf-name').value.trim();
  if (!date||!name) return;
  if (isHoliday(date)) { showToast('この日付は既に登録されています'); return; }
  holidays.push({date:date, name:name});
  saveHolidays();
  document.getElementById('holiday-form').reset();
  renderHolidayList();
  showToast('休日を登録しました');
}

function deleteHoliday(date) {
  holidays = holidays.filter(function(h){return h.date!==date;});
  saveHolidays(); renderHolidayList();
  showToast('削除しました');
}

function initHolidays() {
  if (!confirm('2026-2028年の祝日データ（'+DEFAULT_HOLIDAYS.length+'件）を追加します。\n既存データと重複する日付はスキップされます。')) return;
  var added = 0;
  for (var i=0; i<DEFAULT_HOLIDAYS.length; i++) {
    if (!isHoliday(DEFAULT_HOLIDAYS[i].date)) {
      holidays.push({date:DEFAULT_HOLIDAYS[i].date, name:DEFAULT_HOLIDAYS[i].name});
      added++;
    }
  }
  saveHolidays(); renderHolidayList();
  showToast(added+'件追加しました');
}

// ==================== CHILDREN MANAGEMENT ====================
function populateChildStaff() {
  var sel = document.getElementById('child-staff');
  sel.innerHTML = '<option value="">-- 選択 --</option>';
  var sorted = getStaffSorted();
  for (var i=0; i<sorted.length; i++) {
    var o = document.createElement('option');
    o.value = sorted[i].id;
    o.textContent = sorted[i].id + ' ' + sorted[i].name;
    sel.appendChild(o);
  }
}

function renderChildList() {
  var tb = document.getElementById('child-list');
  var html = '';
  var sorted = children.slice().sort(function(a,b) {
    if (a.staffId < b.staffId) return -1; if (a.staffId > b.staffId) return 1;
    return 0;
  });
  for (var i=0; i<sorted.length; i++) {
    var c = sorted[i];
    var s = getStaffById(c.staffId);
    var pName = s ? s.name+'('+c.staffId+')' : c.staffId;
    html += '<tr><td>'+esc(c.name)+'</td><td>'+esc(pName)+'</td>';
    html += '<td><button class="btn-del" onclick="deleteChild(\''+esc(c.id)+'\')">削除</button></td></tr>';
  }
  if (!html) html = '<tr><td colspan="3" style="text-align:center;color:#999">子供の登録なし</td></tr>';
  tb.innerHTML = html;
}

function submitChild(e) {
  e.preventDefault();
  var staffId = document.getElementById('child-staff').value;
  if (!staffId) { showToast('職員を選択してください'); return; }
  var name = document.getElementById('cf-name').value.trim();
  if (!name) return;
  var id = 'C' + Date.now();
  children.push({id: id, staffId: staffId, name: name});
  saveChildren();
  document.getElementById('cf-name').value = '';
  renderChildList();
  renderStaffList();
  showToast(name + 'を登録しました');
}

function deleteChild(childId) {
  var c = null;
  for (var i=0; i<children.length; i++) { if (children[i].id===childId) { c=children[i]; break; } }
  if (!c) return;
  if (!confirm(c.name + 'を削除しますか？')) return;
  children = children.filter(function(x){return x.id!==childId;});
  saveChildren();
  renderChildList();
  renderStaffList();
  showToast('削除しました');
}

// ==================== DATA MANAGEMENT ====================
function updatePwStatus() {
  var el = document.getElementById('pw-status');
  if (getEditPassword()) {
    el.textContent = '※ パスワードが設定されています。確定済み注文の修正時にパスワード入力が必要です。';
    el.style.color = '#28a745';
  } else {
    el.textContent = '※ パスワード未設定。誰でも確定済み注文を修正できます。';
    el.style.color = '#dc3545';
  }
}

function dataExport() {
  var data = { staff: staffList, orders: orders, holidays: holidays, history: opHistory, children: children, exportDate: fmtDate(new Date()) };
  var json = JSON.stringify(data, null, 2);
  downloadFile(json, '給食管理データ_'+fmtDate(new Date())+'.json', 'application/json');
  showToast('エクスポートしました');
}

function dataImport() {
  var fileInput = document.getElementById('data-import-file');
  if (!fileInput.files.length) { showToast('ファイルを選択してください'); return; }
  if (!confirm('現在のデータは全て上書きされます。よろしいですか？')) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    try {
      var data = JSON.parse(e.target.result);
      if (data.staff) staffList = data.staff;
      if (data.orders) orders = data.orders;
      if (data.holidays) holidays = data.holidays;
      if (data.history) opHistory = data.history;
      if (data.children) children = data.children;
      saveStaff(); saveOrders(); saveHolidays(); saveHistory(); saveChildren();
      showToast('インポートしました');
      showTab('today');
    } catch(ex) { showToast('ファイル形式が不正です'); }
  };
  reader.readAsText(fileInput.files[0], 'UTF-8');
}

function dataClear() {
  if (!confirm('全データを削除します。この操作は元に戻せません。\n本当に削除しますか？')) return;
  staffList=[]; orders={}; holidays=[]; opHistory=[]; children=[];
  saveStaff(); saveOrders(); saveHolidays(); saveHistory(); saveChildren();
  showToast('全データを削除しました');
  showTab('today');
}

// ==================== ADMIN MODE ====================
function toggleAdmin() {
  if (adminMode) {
    adminMode = false;
    applyAdminMode();
    showTab('today');
    showToast('管理者モードを解除しました');
    return;
  }
  var savedPw = getEditPassword();
  if (savedPw) {
    var input = prompt('管理者パスワードを入力してください');
    if (input === null) return;
    if (input !== savedPw) { showToast('パスワードが正しくありません'); return; }
  }
  adminMode = true;
  applyAdminMode();
  showToast('管理者モードに入りました');
}

function applyAdminMode() {
  var els = document.querySelectorAll('.admin-only');
  for (var i = 0; i < els.length; i++) {
    els[i].style.display = adminMode ? '' : 'none';
  }
  var btn = document.getElementById('admin-toggle');
  if (adminMode) {
    btn.textContent = '管理者モード解除';
    btn.classList.add('active-admin');
  } else {
    btn.textContent = '管理者';
    btn.classList.remove('active-admin');
  }
}

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', function() {
  try {
  loadData();

  document.querySelectorAll('.tab-btn').forEach(function(btn) {
    if (btn.id === 'admin-toggle') return;
    btn.addEventListener('click', function() { showTab(this.getAttribute('data-tab')); });
  });
  document.getElementById('admin-toggle').addEventListener('click', toggleAdmin);

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

  document.getElementById('staff-form').addEventListener('submit', submitStaff);
  document.getElementById('sf-cancel').addEventListener('click', cancelEditStaff);
  document.getElementById('staff-search').addEventListener('input', renderStaffList);
  document.getElementById('csv-import').addEventListener('click', importCSV);
  document.getElementById('csv-export').addEventListener('click', exportCSV);
  document.getElementById('child-staff').addEventListener('change', renderChildList);
  document.getElementById('child-form').addEventListener('submit', submitChild);

  document.getElementById('order-year').addEventListener('change', renderOrderGrid);
  document.getElementById('order-month').addEventListener('change', renderOrderGrid);
  document.getElementById('order-dept').addEventListener('change', populateOrderStaff);
  document.getElementById('order-staff').addEventListener('change', renderOrderGrid);
  document.getElementById('order-prev-staff').addEventListener('click', function(){navigateStaff(-1);});
  document.getElementById('order-next-staff').addEventListener('click', function(){navigateStaff(1);});
  document.getElementById('bulk-weekday-b').addEventListener('click', function(){bulkSetWeekday('b');});
  document.getElementById('bulk-weekday-l').addEventListener('click', function(){bulkSetWeekday('l');});
  document.getElementById('bulk-weekday-d').addEventListener('click', function(){bulkSetWeekday('d');});
  document.getElementById('bulk-weekday-dd').addEventListener('click', function(){bulkSetWeekday('dd');});
  document.getElementById('bulk-copy-prev').addEventListener('click', bulkCopyPrev);
  document.getElementById('bulk-clear').addEventListener('click', bulkClear);
  document.getElementById('order-confirm').addEventListener('click', confirmOrder);
  document.getElementById('order-edit').addEventListener('click', editOrder);

  document.getElementById('rpt-run').addEventListener('click', runReport);
  document.getElementById('rpt-print').addEventListener('click', function(){window.print();});

  document.getElementById('hist-month-filter').addEventListener('change', renderHistory);
  document.getElementById('hist-staff-filter').addEventListener('change', renderHistory);
  document.getElementById('hist-action-filter').addEventListener('change', renderHistory);
  document.getElementById('hist-clear').addEventListener('click', clearHistory);

  document.getElementById('holiday-form').addEventListener('submit', submitHoliday);
  document.getElementById('holiday-init').addEventListener('click', initHolidays);
  document.getElementById('holiday-year-filter').addEventListener('change', renderHolidayList);

  document.getElementById('pw-save').addEventListener('click', function() {
    var pw = document.getElementById('pw-input').value;
    if (!pw) { showToast('パスワードを入力してください'); return; }
    setEditPassword(pw);
    document.getElementById('pw-input').value = '';
    updatePwStatus();
    showToast('パスワードを設定しました');
  });
  document.getElementById('pw-clear').addEventListener('click', function() {
    if (!confirm('パスワードを解除しますか？')) return;
    setEditPassword('');
    updatePwStatus();
    showToast('パスワードを解除しました');
  });
  updatePwStatus();

  document.getElementById('data-export').addEventListener('click', dataExport);
  document.getElementById('data-import').addEventListener('click', dataImport);
  document.getElementById('data-clear').addEventListener('click', dataClear);

  renderToday();
  } catch(err) {
    document.getElementById('toast').textContent = 'エラー: ' + err.message;
    document.getElementById('toast').classList.add('show');
    document.getElementById('toast').style.opacity = '1';
  }
});
