import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js';
import { getDatabase, ref, set, onValue } from 'https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js';

// same firebase config
const firebaseConfig = {
  apiKey: "AIzaSyBP7NUTGpupGEz5ZH28AhY8DHZKxkKRWTU",
  authDomain: "daily-diary-26dbf.firebaseapp.com",
  databaseURL: "https://daily-diary-26dbf-default-rtdb.firebaseio.com",
  projectId: "daily-diary-26dbf",
  storageBucket: "daily-diary-26dbf.firebasestorage.app",
  messagingSenderId: "994518127061",
  appId: "1:994518127061:web:89064378570723575bed5c",
  measurementId: "G-YRDNL38G9X"
};

let db = null;
let usersRef = null;
try{
  const app = initializeApp(firebaseConfig);
  db = getDatabase(app);
  usersRef = ref(db, '/users');
  // also watch categories so the Manage Users visible-columns stay in sync
  try{
    function currentBoardId(){ return localStorage.getItem('kanban_selected_board') || 'default'; }
    function categoriesPathForBoard(b){ return '/boards/' + (b || currentBoardId()) + '/categories'; }
    var categoriesRef = ref(db, categoriesPathForBoard());
  }catch(e){ var categoriesRef = null; }
}catch(err){
  console.warn('Firebase init (users) failed', err);
}

// Very small user manager that exposes a modal and CRUD operations
let usersModal = null;
let usersListEl = null;
let usersNameInput = null;
let usersPassInput = null;
let usersColorInput = null;
let createCb = null;
let moveCb = null;
let uploadCb = null;
let viewAttachCb = null;
let visibleCheckboxContainer = null;
let usersSearchInput = null;
let usersSortAsc = true;
const DEFAULT_COLUMNS = ['base'];
let isAdminAuthenticated = false; // set when admin successfully authenticates via app.js

// Small toast helper for success messages
function showToast(msg, timeout = 2200){
  try{
    let el = document.getElementById('kb-toast');
    if(!el){ el = document.createElement('div'); el.id = 'kb-toast'; el.style.position='fixed'; el.style.right='12px'; el.style.bottom='20px'; el.style.background='#222'; el.style.color='#fff'; el.style.padding='8px 12px'; el.style.borderRadius='6px'; el.style.zIndex=99999; el.style.fontSize='13px'; el.style.opacity='0'; el.style.transition='opacity 220ms'; document.body.appendChild(el); }
    el.textContent = msg;
    requestAnimationFrame(()=> el.style.opacity = '1');
    setTimeout(()=>{ try{ el.style.opacity='0'; }catch(e){} }, timeout);
  }catch(e){ try{ alert(msg); }catch(e){} }
}

// Helper: get available columns (from in-memory state, local storage, or defaults)
function getAvailableColumns(){
  try{
    // Prefer in-memory kanban state
    if(window._KANBAN && window._KANBAN.state){
      const keys = Object.keys(window._KANBAN.state || {});
      return sanitizeColumns(keys);
    }
    // Next prefer persisted local categories array
  const raw = localStorage.getItem('kanban_categories_v1::' + (localStorage.getItem('kanban_selected_board') || 'default')) || localStorage.getItem('kanban_categories_v1');
    if(raw){
      let parsed = [];
      try{ parsed = JSON.parse(raw); }catch(e){ parsed = String(raw).split(/[,\n\r]+/).map(s=>s.trim()); }
      if(Array.isArray(parsed) && parsed.length){
        return sanitizeColumns(parsed);
      }
    }
  }catch(e){ /* ignore */ }
  return sanitizeColumns(DEFAULT_COLUMNS.slice());
}

// Normalize, trim, dedupe and filter out empty values from a columns array
function sanitizeColumns(arr){
  if(!Array.isArray(arr)) return [];
  const out = [];
  const seen = new Set();
  arr.forEach(v => {
    try{
      if(typeof v !== 'string') v = String(v);
      const t = v.trim();
      if(!t) return;
      if(seen.has(t)) return;
      seen.add(t);
      out.push(t);
    }catch(e){}
  });
  return out;
}

// Render checkboxes for visible columns into visibleCheckboxContainer
function renderVisibleCheckboxes(selected, columns){
  if(!visibleCheckboxContainer) return;
  visibleCheckboxContainer.innerHTML = '';
  // use explicit columns list when provided (e.g., from DB listener), otherwise fall back to available columns
  const cols = Array.isArray(columns) && columns.length ? sanitizeColumns(columns) : getAvailableColumns();
  cols.forEach(c => {
    const wrap = document.createElement('label');
    wrap.style.display = 'flex'; wrap.style.alignItems = 'center'; wrap.style.gap = '6px';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.value = c;
    cb.style.marginRight = '4px';
    if(Array.isArray(selected) && selected.includes(c)) cb.checked = true;
    wrap.appendChild(cb);
    const txt = document.createElement('span'); txt.textContent = c; txt.style.fontSize = '13px';
    wrap.appendChild(txt);
    visibleCheckboxContainer.appendChild(wrap);
  });
}

function buildUsersModal(){
  if(usersModal) return usersModal;
  usersModal = document.createElement('div');
  usersModal.style.position = 'fixed';
  usersModal.style.left = '0';
  usersModal.style.top = '0';
  usersModal.style.right = '0';
  usersModal.style.bottom = '0';
  usersModal.style.background = 'rgba(0,0,0,0.45)';
  usersModal.style.display = 'flex';
  usersModal.style.alignItems = 'center';
  usersModal.style.justifyContent = 'center';

  const panel = document.createElement('div');
  panel.style.width = '420px';
  panel.style.maxHeight = '80vh';
  panel.style.overflow = 'auto';
  panel.style.background = '#fff';
  panel.style.borderRadius = '8px';
  panel.style.padding = '16px';

  const title = document.createElement('h3');
  title.textContent = 'Manage Users';
  panel.appendChild(title);

  // search + sort controls
  const searchRow = document.createElement('div');
  searchRow.style.display = 'flex';
  searchRow.style.gap = '8px';
  searchRow.style.alignItems = 'center';
  searchRow.style.marginBottom = '10px';
  usersSearchInput = document.createElement('input');
  usersSearchInput.placeholder = 'Search users...';
  usersSearchInput.style.flex = '1';
  usersSearchInput.style.padding = '8px';
  usersSearchInput.style.border = '1px solid #ddd';
  // Only include search input to keep the UI compact
  usersSearchInput.addEventListener('input', ()=>{
    try{ const cur = window._USERSCache || JSON.parse(localStorage.getItem('kanban_users_v1')||'{}'); renderUsers(cur); }catch(e){}
  });
  searchRow.appendChild(usersSearchInput);
  panel.appendChild(searchRow);

  usersNameInput = document.createElement('input');
  usersNameInput.placeholder = 'username';
  usersNameInput.style.width = '100%';
  usersNameInput.style.padding = '8px';
  usersNameInput.style.marginBottom = '8px';
  panel.appendChild(usersNameInput);

  usersPassInput = document.createElement('input');
  usersPassInput.placeholder = 'password';
  usersPassInput.type = 'password';
  usersPassInput.style.width = '100%';
  usersPassInput.style.padding = '8px';
  usersPassInput.style.marginBottom = '8px';
  panel.appendChild(usersPassInput);

  // color picker for user (optional)
  usersColorInput = document.createElement('input');
  usersColorInput.type = 'color';
  usersColorInput.title = 'Pick a color to represent this user on cards';
  usersColorInput.style.width = '64px';
  usersColorInput.style.height = '36px';
  usersColorInput.style.padding = '4px';
  usersColorInput.style.marginBottom = '8px';
  // wrapper so label can be added
  const colorWrap = document.createElement('div');
  colorWrap.style.display = 'flex';
  colorWrap.style.alignItems = 'center';
  colorWrap.style.gap = '8px';
  const colorLabel = document.createElement('div');
  colorLabel.textContent = 'Color:';
  colorLabel.style.minWidth = '48px';
  colorWrap.appendChild(colorLabel);
  colorWrap.appendChild(usersColorInput);
  panel.appendChild(colorWrap);

  // permissions: canCreate, canMove, visibleColumns (comma-separated)
  const permWrap = document.createElement('div');
  permWrap.style.display = 'flex';
  permWrap.style.flexDirection = 'column';
  permWrap.style.gap = '6px';
  permWrap.style.marginBottom = '8px';

  // can create
  const createRow = document.createElement('label');
  createCb = document.createElement('input');
  createCb.type = 'checkbox';
  createCb.style.marginRight = '8px';
  createRow.appendChild(createCb);
  createRow.appendChild(document.createTextNode('Can create jobs'));
  permWrap.appendChild(createRow);

  // can move
  const moveRow = document.createElement('label');
  moveCb = document.createElement('input');
  moveCb.type = 'checkbox';
  moveCb.style.marginRight = '8px';
  moveRow.appendChild(moveCb);
  moveRow.appendChild(document.createTextNode('Can move jobs'));
  permWrap.appendChild(moveRow);

  // can upload attachments
  const uploadRow = document.createElement('label');
  uploadCb = document.createElement('input');
  uploadCb.type = 'checkbox';
  uploadCb.style.marginRight = '8px';
  uploadRow.appendChild(uploadCb);
  uploadRow.appendChild(document.createTextNode('Can upload attachments'));
  permWrap.appendChild(uploadRow);

  // can view attachments
  const viewAttachRow = document.createElement('label');
  viewAttachCb = document.createElement('input');
  viewAttachCb.type = 'checkbox';
  viewAttachCb.style.marginRight = '8px';
  viewAttachRow.appendChild(viewAttachCb);
  viewAttachRow.appendChild(document.createTextNode('Can view attachments'));
  permWrap.appendChild(viewAttachRow);

  // visible columns
  const visibleLabel = document.createElement('div');
  visibleLabel.textContent = 'Visible columns (check to show for this user):';
  visibleLabel.style.fontSize = '12px';
  visibleLabel.style.color = '#444';
  visibleCheckboxContainer = document.createElement('div');
  visibleCheckboxContainer.style.display = 'flex';
  visibleCheckboxContainer.style.flexWrap = 'wrap';
  visibleCheckboxContainer.style.gap = '8px';
  // populate checkboxes
  renderVisibleCheckboxes(null);
  permWrap.appendChild(visibleLabel);
  permWrap.appendChild(visibleCheckboxContainer);

  panel.appendChild(permWrap);

  const addBtn = document.createElement('button');
  addBtn.textContent = 'Add / Update User';
  addBtn.addEventListener('click', ()=>{
  const name = (usersNameInput.value||'').trim();
  let pass = (usersPassInput.value||'').trim();
    const color = usersColorInput && usersColorInput.value ? usersColorInput.value : '#cccccc';
    const canCreate = !!(createCb && createCb.checked);
    const canMove = !!(moveCb && moveCb.checked);
    // collect checked visible columns
    let visibleColumns = null;
    try{
      const boxes = visibleCheckboxContainer.querySelectorAll('input[type=checkbox]');
      const sel = Array.from(boxes).filter(b=>b.checked).map(b=>b.value);
      visibleColumns = sel.length ? sel : null;
    }catch(e){ visibleColumns = null; }
    // If updating an existing user and password left blank, preserve existing password
    let existingUser = null;
    try{
      const users = window._USERSCache || JSON.parse(localStorage.getItem('kanban_users_v1')||'{}');
      existingUser = users && users[name] ? users[name] : null;
    }catch(e){ existingUser = null; }
    if(!name) return alert('Enter username');
    if(!pass && existingUser){ pass = existingUser.password || ''; }
    if(!pass) return alert('Enter password for new user');
    // write to DB under /users/{username}
  // read upload/view checkboxes state when saving
  const canUpload = !!(uploadCb && uploadCb.checked);
  const canViewAttachments = !!(viewAttachCb && viewAttachCb.checked);
  const payload = { username: name, password: pass, color, canCreate, canMove, canUpload, canViewAttachments, visibleColumns };
    if(usersRef && db){
      // read existing remote user once and merge to preserve fields (like password) when inputs are blank
      try{
        onValue(ref(db, `/users/${name}`), snap => {
          const existing = snap.val() || {};
          const finalPayload = Object.assign({}, existing, payload);
              set(ref(db, `/users/${name}`), finalPayload).then(()=>{
                usersNameInput.value = '';
                usersPassInput.value = '';
                if(usersColorInput) usersColorInput.value = '#cccccc';
                if(createCb) createCb.checked = false; if(moveCb) moveCb.checked = false; try{ const boxes = visibleCheckboxContainer.querySelectorAll('input[type=checkbox]'); boxes.forEach(b=>b.checked=false);}catch(e){}
                if(uploadCb) uploadCb.checked = false; if(viewAttachCb) viewAttachCb.checked = false;
                try{ localStorage.setItem('kanban_users_version', String(Date.now())); }catch(e){}
                try{ showToast('User saved'); }catch(e){}
              }).catch(err => console.warn('Failed to write user', err));
        }, { onlyOnce: true });
      }catch(e){ console.warn('Failed to merge existing user', e); }
    } else {
      // no remote: merge with local entry and dispatch update
      try{
  const local = JSON.parse(localStorage.getItem('kanban_users_v1') || '{}');
  const existing = local[name] || {};
  local[name] = Object.assign({}, existing, payload);
  localStorage.setItem('kanban_users_v1', JSON.stringify(local));
  usersNameInput.value = '';
  usersPassInput.value = '';
  if(usersColorInput) usersColorInput.value = '#cccccc';
  if(createCb) createCb.checked = false; if(moveCb) moveCb.checked = false; try{ const boxes = visibleCheckboxContainer.querySelectorAll('input[type=checkbox]'); boxes.forEach(b=>b.checked=false);}catch(e){}
  if(uploadCb) uploadCb.checked = false; if(viewAttachCb) viewAttachCb.checked = false;
  renderUsers(local);
  // notify other modules
  const evt = new CustomEvent('users-updated', { detail: { users: local } });
  window.dispatchEvent(evt);
  try{ localStorage.setItem('kanban_users_version', String(Date.now())); }catch(e){}
  try{ showToast('User saved'); }catch(e){}
      }catch(e){ console.warn('Failed to write local user', e); }
    }
  });
  // allow pressing Enter in inputs to submit
  try{
    const submitOnEnter = (e)=>{ if(e.key === 'Enter') addBtn.click(); };
    if(usersNameInput) usersNameInput.addEventListener('keydown', submitOnEnter);
    if(usersPassInput) usersPassInput.addEventListener('keydown', submitOnEnter);
    if(usersColorInput) usersColorInput.addEventListener('keydown', submitOnEnter);
    if(visibleCheckboxContainer) visibleCheckboxContainer.addEventListener('keydown', submitOnEnter);
    if(typeof uploadCb !== 'undefined') uploadCb.addEventListener('keydown', submitOnEnter);
    if(typeof viewAttachCb !== 'undefined') viewAttachCb.addEventListener('keydown', submitOnEnter);
  }catch(e){}
  panel.appendChild(addBtn);

  usersListEl = document.createElement('div');
  usersListEl.style.marginTop = '12px';
  usersListEl.style.display = 'flex';
  usersListEl.style.flexDirection = 'column';
  usersListEl.style.gap = '8px';
  usersListEl.style.maxHeight = '40vh';
  usersListEl.style.overflow = 'auto';
  panel.appendChild(usersListEl);

  const close = document.createElement('button');
  close.textContent = 'Close';
  close.style.marginTop = '12px';
  close.addEventListener('click', ()=>{ usersModal.style.display = 'none'; });
  panel.appendChild(close);

  usersModal.appendChild(panel);
  document.body.appendChild(usersModal);
  return usersModal;
}

function renderUsers(list){
  if(!usersListEl) return;
  usersListEl.innerHTML = '';
  const map = list || {};
  const keys = Object.keys(map || {});
  // apply search filter
  const term = (usersSearchInput && usersSearchInput.value) ? String(usersSearchInput.value).trim().toLowerCase() : '';
  let filtered = keys.filter(k => {
    if(!term) return true;
    return k.toLowerCase().includes(term) || (map[k] && map[k].color && map[k].color.toLowerCase().includes(term));
  });
  // sort by username (A-Z or Z-A), keep admin at top
  filtered.sort((a,b)=>{
    if(a === 'admin') return -1;
    if(b === 'admin') return 1;
    if(usersSortAsc) return a.localeCompare(b);
    return b.localeCompare(a);
  });

  if(filtered.length === 0){
    const empty = document.createElement('div');
    empty.style.color = '#556';
    empty.style.padding = '8px';
    empty.textContent = 'No users match your search.';
    usersListEl.appendChild(empty);
    return;
  }

  filtered.forEach(k => {
    const u = map[k] || {};
    const row = document.createElement('div');
    row.style.display = 'grid';
    row.style.gridTemplateColumns = '1fr 2fr auto';
    row.style.gap = '12px';
    row.style.alignItems = 'center';
    row.style.padding = '8px';
    row.style.borderRadius = '6px';
    row.style.background = '#fff';
    row.style.border = '1px solid #eef3f8';

    // left: swatch + username
    const left = document.createElement('div');
    left.style.display = 'flex';
    left.style.alignItems = 'center';
    const sw = document.createElement('div');
    sw.style.width = '26px'; sw.style.height = '26px'; sw.style.borderRadius = '50%'; sw.style.background = (u.color||'#cccccc'); sw.style.marginRight = '8px';
    sw.title = `Color for ${k}`;
    const nameWrap = document.createElement('div');
    const nameEl = document.createElement('div'); nameEl.textContent = k; nameEl.style.fontWeight = '600';
    if(k === 'admin'){
      const note = document.createElement('div'); note.textContent = 'admin'; note.style.color = '#a00'; note.style.fontSize = '12px'; note.style.marginTop = '2px'; nameWrap.appendChild(note);
    }
    nameWrap.insertBefore(nameEl, nameWrap.firstChild);
    left.appendChild(sw); left.appendChild(nameWrap);

    // middle: permissions summary
    const mid = document.createElement('div');
    mid.style.fontSize = '13px'; mid.style.color = '#556';
    const parts = [];
    if(u.canCreate) parts.push('create'); else parts.push('no-create');
    if(u.canMove) parts.push('move'); else parts.push('no-move');
  if(u.canUpload) parts.push('upload'); else parts.push('no-upload');
  if(u.canViewAttachments) parts.push('view-att'); else parts.push('no-view-att');
    if(Array.isArray(u.visibleColumns) && u.visibleColumns.length) parts.push('visible: ' + u.visibleColumns.join(','));
    mid.textContent = parts.join(' • ');

    // right: actions
    const actions = document.createElement('div');
    actions.style.display = 'flex'; actions.style.alignItems = 'center';
    const edit = document.createElement('button'); edit.textContent = 'Edit'; edit.style.marginRight = '8px';
    edit.addEventListener('click', ()=>{
      if(!usersNameInput || !usersPassInput) return;
      usersNameInput.value = k;
      try{ usersPassInput.value = u.password || ''; }catch(e){ usersPassInput.value = ''; }
      try{ usersColorInput.value = u.color || '#cccccc'; }catch(e){ if(usersColorInput) usersColorInput.value = '#cccccc'; }
  try{ createCb.checked = !!u.canCreate; moveCb.checked = !!u.canMove; renderVisibleCheckboxes(Array.isArray(u.visibleColumns) ? u.visibleColumns : []); }catch(e){}
  try{ uploadCb.checked = !!u.canUpload; viewAttachCb.checked = !!u.canViewAttachments; }catch(e){}
      usersNameInput.focus();
    });
    const del = document.createElement('button'); del.textContent = 'Remove';
    if(!isAdminAuthenticated) del.disabled = true; if(k === 'admin') del.disabled = true;
    del.addEventListener('click', ()=>{
      if(!isAdminAuthenticated) return alert('Admin authentication required');
      if(!confirm(`Remove user ${k}?`)) return;
      set(ref(db, `/users/${k}`), null).catch(err => console.warn('Failed delete user', err));
    });
    actions.appendChild(edit); actions.appendChild(del);

    row.appendChild(left);
    row.appendChild(mid);
    row.appendChild(actions);
    usersListEl.appendChild(row);
  });
}

// default admin user
function ensureDefaultAdmin(){
  if(!usersRef || !db) return;
  onValue(usersRef, snap => {
    const val = snap.val() || {};
    if(!val['admin']){
      // create default admin with a color and full permissions
      set(ref(db, `/users/admin`), { username: 'admin', password: 'admin', color: '#c62828', canCreate: true, canMove: true, canUpload: true, canViewAttachments: true }).catch(err=>console.warn('Failed to create admin', err));
      // re-fetch will trigger render
      return;
    }
    renderUsers(val);
    // notify other modules about users list including colors
    const evt = new CustomEvent('users-updated', { detail: { users: val } });
    window.dispatchEvent(evt);
  }, err=>console.warn('users listen failed', err));
}

// Only open the users manager if admin has authenticated in this session.
window.addEventListener('users-manage', ()=>{
  if(isAdminAuthenticated){
    const m = buildUsersModal();
    // refresh available columns when opening (prefer persisted list)
    try{
      const raw = localStorage.getItem('kanban_categories_v1');
      const parsed = raw ? JSON.parse(raw) : null;
      renderVisibleCheckboxes(null, Array.isArray(parsed) ? parsed : null);
    }catch(e){ try{ renderVisibleCheckboxes(null); }catch(e){} }
    m.style.display = 'flex';
    ensureDefaultAdmin();
  }else{
    console.warn('users-manage requested but admin not authenticated');
  }
});

// Listen for admin authentication success from app.js
window.addEventListener('admin-auth-success', (e)=>{
  const u = e?.detail?.username;
  if(u === 'admin'){
    isAdminAuthenticated = true;
    const m = buildUsersModal();
  try{ const raw = localStorage.getItem('kanban_categories_v1'); const parsed = raw ? JSON.parse(raw) : null; renderVisibleCheckboxes(null, Array.isArray(parsed) ? parsed : null); }catch(e){ try{ renderVisibleCheckboxes(null); }catch(e){} }
    m.style.display = 'flex';
    ensureDefaultAdmin();
  }else{
    console.warn('admin-auth-success received for non-admin user', u);
  }
});

// When categories are updated elsewhere, refresh the visible-columns checkboxes
window.addEventListener('categories-updated', (e)=>{
  try{
    // preserve current selections
    const prev = [];
    if(visibleCheckboxContainer){
      const boxes = visibleCheckboxContainer.querySelectorAll('input[type=checkbox]');
      boxes.forEach(b => { if(b.checked) prev.push(b.value); });
    }
    // re-render with previous selections preserved when possible
    renderVisibleCheckboxes(prev);
  }catch(err){ console.warn('Failed to refresh visible columns after categories update', err); }
});

// expose a tiny login helper
window._USERS = {
  login: async function(username, password){
    if(!usersRef || !db) return false;
    return new Promise((resolve)=>{
      onValue(usersRef, snap => {
        const users = snap.val() || {};
        const u = users[username];
        resolve(!!u && u.password === password);
      }, { onlyOnce: true });
    });
  }
};

// helper to read all users (from remote if available, otherwise local cache)
window._USERS.getAll = async function(){
  if(usersRef && db){
    return new Promise((resolve)=>{
      onValue(usersRef, snap => {
        const users = snap.val() || {};
        resolve(users);
      }, { onlyOnce: true });
    });
  }
  try{
    const local = JSON.parse(localStorage.getItem('kanban_users_v1') || '{}');
    return local;
  }catch(e){ return {}; }
};

// When the users DB changes, notify others and render
if(usersRef){
  onValue(usersRef, snap => {
    const val = snap.val() || {};
    // cache and persist users for quick startup
    try{ window._USERSCache = val; }catch(e){}
    try{ localStorage.setItem('kanban_users_v1', JSON.stringify(val)); }catch(e){}
    renderUsers(val);
    const evt = new CustomEvent('users-updated', { detail: { users: val } });
    window.dispatchEvent(evt);
  }, err=>console.warn('users listen failed', err));
} else {
  // if no remote, render local cache once
  try{
    const local = JSON.parse(localStorage.getItem('kanban_users_v1') || '{}');
    try{ window._USERSCache = local; }catch(e){}
    renderUsers(local);
    const evt = new CustomEvent('users-updated', { detail: { users: local } });
    window.dispatchEvent(evt);
  }catch(e){}
}

// If we have a remote categories reference, listen for changes and refresh checkboxes
if(typeof categoriesRef !== 'undefined' && categoriesRef){
  try{
    onValue(categoriesRef, snap => {
      const val = snap.val() || {};
      // build items with order when available
      const items = Object.keys(val || {}).map(k => {
        const entry = val[k] || {};
        return { title: entry.title || k, order: (typeof entry.order === 'number') ? entry.order : 0 };
      });
      items.sort((a,b)=> (a.order || 0) - (b.order || 0));
      const list = items.map(i => i.title);
  try{ localStorage.setItem('kanban_categories_v1::' + (localStorage.getItem('kanban_selected_board') || 'default'), JSON.stringify(list)); }catch(e){}
  try{ renderVisibleCheckboxes(null, list); }catch(e){}
      // also dispatch a categories-updated event for other modules
      const evt = new CustomEvent('categories-updated', { detail: { categories: list } });
      window.dispatchEvent(evt);
    }, err=>console.warn('categories listen failed', err));
  }catch(e){ /* ignore */ }
}

// respond to storage events (other tabs or manual edits) to refresh checkboxes
window.addEventListener('storage', (e)=>{
  try{
    if(e.key && e.key.indexOf('kanban_categories_v1') === 0){
      renderVisibleCheckboxes(null);
    }
  }catch(err){}
});


