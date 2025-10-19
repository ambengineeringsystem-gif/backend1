import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js';
import { getDatabase, ref, onChildAdded, onChildChanged, onChildRemoved, set, update, remove } from 'https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js';

// Minimal default: single base column (renameable but not removable)
const DEFAULT_COLUMNS = ['base'];
let COLUMNS = DEFAULT_COLUMNS.slice();

// Listen for cross-tab user updates (version key) and re-fetch users
window.addEventListener('storage', async (e)=>{
  try{
    if(e.key === 'kanban_users_version'){
      if(window._USERS && window._USERS.getAll){
        const users = await window._USERS.getAll();
        window._USERSCache = users || {};
        const evt = new CustomEvent('users-updated', { detail: { users: users || {} } });
        window.dispatchEvent(evt);
      }
    }
  }catch(err){}
});

// Listen for current-user changes across tabs and refresh UI immediately
window.addEventListener('storage', (e)=>{
  try{
    if(e.key === 'kanban_current_user'){
      try{ const raw = localStorage.getItem('kanban_current_user'); if(raw) currentUser = JSON.parse(raw); else currentUser = null; }catch(err){ currentUser = null; }
      try{ updateCurrentUserUI(); }catch(err){}
    }
  }catch(err){}
});
const STORAGE_KEY = 'kanban_jobs_v1';

const board = document.getElementById('board');
// job creation only via left createTaskBtn
// export/import UI removed
// clear button removed; hamburger menu will provide actions
const hamburgerBtn = document.getElementById('hamburgerBtn');
const hamburgerMenu = document.getElementById('hamburgerMenu');
// Create Task removed from menu; use left createTaskBtn
const menuManageCategories = document.getElementById('menuRemoveCategory');
const menuManageUsers = document.getElementById('menuManageUsers');
const menuLogin = document.getElementById('menuLogin');
const menuLogout = document.getElementById('menuLogout');
const currentUserDisplay = document.getElementById('currentUserDisplay');
const loginModal = document.getElementById('loginModal');
const loginUser = document.getElementById('loginUser');
const loginPass = document.getElementById('loginPass');
const loginCancel = document.getElementById('loginCancel');
const loginSubmit = document.getElementById('loginSubmit');
const loginError = document.getElementById('loginError');
const adminAuthModal = document.getElementById('adminAuthModal');
const adminAuthUser = document.getElementById('adminAuthUser');
const adminAuthPass = document.getElementById('adminAuthPass');
const adminAuthCancel = document.getElementById('adminAuthCancel');
const adminAuthSubmit = document.getElementById('adminAuthSubmit');
const adminAuthError = document.getElementById('adminAuthError');
const cardTemplate = document.getElementById('cardTemplate');
const createTaskBtn = document.getElementById('createTaskBtn');
const createModal = document.getElementById('createModal');
const createTitle = document.getElementById('createTitle');
const createDesc = document.getElementById('createDesc');
const createAssignee = document.getElementById('createAssignee');
const createDue = document.getElementById('createDue');
const createCategory = document.getElementById('createCategory');
const createCancel = document.getElementById('createCancel');
const createSave = document.getElementById('createSave');
const detailsModal = document.getElementById('detailsModal');
const detailTitle = document.getElementById('detailTitle');
const detailDesc = document.getElementById('detailDesc');
const detailAssignee = document.getElementById('detailAssignee');
const detailDue = document.getElementById('detailDue');
const detailCategory = document.getElementById('detailCategory');
const detailCreated = document.getElementById('detailCreated');
const detailClose = document.getElementById('detailClose');
const attachmentsList = document.getElementById('attachmentsList');
const attachBtn = document.getElementById('attachBtn');
const attachmentInput = document.getElementById('attachmentInput');
const attachmentStatus = document.getElementById('attachmentStatus');

let state = {};
let currentUser = null; // { username }
let userAvatarEl = null; // DOM element for the colored initial avatar
// Firebase configuration (provided by the user)
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

let db;
let cardsRef = null; // ref to /boards/{boardId}/cards
function currentBoardId(){ return localStorage.getItem('kanban_selected_board') || 'default'; }
function cardsPathForBoard(b){ return 'boards/' + (b || currentBoardId()) + '/cards'; }
const WRITE_DEBOUNCE_MS = 400;
const pendingWrites = new Set(); // cardIds currently being written locally
const cardWriteTimers = Object.create(null); // per-card debounce timers

try{
  const app = initializeApp(firebaseConfig);
  db = getDatabase(app);
  cardsRef = ref(db, `/${cardsPathForBoard()}`);
}catch(err){
  console.warn('Firebase init failed or blocked by browser', err);
}

function createInitialState(){
  const s = {};
  COLUMNS.forEach(col => s[col] = []);
  return s;
}

function load(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return createInitialState();
    return JSON.parse(raw);
  }catch(e){
    console.error('Failed to load state', e);
    return createInitialState();
  }
}

// categories storage helpers
function loadLocalCategories(){
  try{ const raw = localStorage.getItem('kanban_categories_v1::' + currentBoardId()) || localStorage.getItem('kanban_categories_v1'); if(!raw) return null; return JSON.parse(raw); }catch(e){ return null; }
}

function setCategories(list){
  if(!Array.isArray(list) || list.length === 0) return;
  // merge provided categories with defaults (preserve defaults)
  const oldColumns = COLUMNS.slice();
  // If the incoming list provides a first element, treat that as the base name
  try{ if(Array.isArray(list) && list.length && list[0]) DEFAULT_COLUMNS[0] = list[0]; }catch(e){}
  const merged = Array.from(new Set(DEFAULT_COLUMNS.concat(list)));
  COLUMNS = merged;
  // ensure state has keys for new categories
  COLUMNS.forEach(c => { if(!state[c]) state[c]=[] });
  // move any cards whose column no longer exists into the first category
  oldColumns.forEach(old => {
    if(!COLUMNS.includes(old) && state[old]){
      const cardsToMove = state[old].splice(0);
      if(cardsToMove.length){
        const target = COLUMNS[0];
        state[target] = state[target].concat(cardsToMove);
      }
      delete state[old];
    }
  });
  // reassign orders
  COLUMNS.forEach(col => (state[col] || []).forEach((c,i)=> c.order = i));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  render();
}

function save(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// --- Remote helpers (per-card) ---
function remoteWriteCard(card){
  if(!cardsRef || !db) return Promise.reject(new Error('no-remote'));
  pendingWrites.add(card.id);
  const payload = {
    id: card.id,
    title: card.title,
    column: card.column,
    order: typeof card.order === 'number' ? card.order : 0,
    description: card.description || '',
    assignee: card.assignee || '',
    due: card.due || null,
    attachments: Array.isArray(card.attachments) ? card.attachments : [],
    // ensure creation timestamp is preserved in remote DB; if missing, set now
    created: typeof card.created === 'number' ? card.created : Date.now(),
    createdBy: card.createdBy || null,
    updatedAt: Date.now()
  };
  return set(ref(db, `boards/default/cards/${card.id}`), payload)
    .catch(err => console.warn('Failed to write card', card.id, err))
    .finally(() => pendingWrites.delete(card.id));
}

function scheduleRemoteWriteCard(card){
  if(!cardsRef) return;
  if(cardWriteTimers[card.id]) clearTimeout(cardWriteTimers[card.id]);
  cardWriteTimers[card.id] = setTimeout(()=>{
    remoteWriteCard(card);
    delete cardWriteTimers[card.id];
  }, WRITE_DEBOUNCE_MS);
}

function remoteRemoveCard(cardId){
  if(!cardsRef || !db) return Promise.reject(new Error('no-remote'));
  pendingWrites.add(cardId);
  return set(ref(db, `boards/default/cards/${cardId}`), null)
    .catch(err => console.warn('Failed to remove remote card', cardId, err))
    .finally(() => pendingWrites.delete(cardId));
}

function remoteBatchUpdateOrders(columns){
  if(!cardsRef || !db) return;
  const updates = {};
  const rootRef = ref(db, '/');
  const uniqueCols = Array.from(new Set(columns));
  uniqueCols.forEach(col => {
    (state[col] || []).forEach((card, idx) => {
      updates[`${cardsPathForBoard()}/${card.id}/order`] = idx;
    });
  });
  // Fire-and-forget
  update(rootRef, updates).catch(err => console.warn('Failed batch update orders', err));
}

function scheduleRemoteWrite(){
  if(!remoteRef) return; // no remote configured
  if(writeTimer) clearTimeout(writeTimer);
  // clone state and add updatedAt to allow simple conflict avoidance
  const payload = {state, updatedAt: Date.now()};
  writeTimer = setTimeout(()=>{
    // prevent writing if remote has a newer timestamp
    set(remoteRef, payload).catch(err => console.warn('Failed to write remote state', err));
    writeTimer = null;
  }, WRITE_DEBOUNCE_MS);
}

function render(){
  // If not signed in, hide tasks and show a sign-in prompt
  if(!currentUser){
    board.innerHTML = '';
    const prompt = document.createElement('div');
    prompt.style.padding = '40px';
    prompt.style.textAlign = 'center';
    prompt.style.color = '#444';
    prompt.innerHTML = '<h2>Please sign in to view tasks</h2>';
    const btn = document.createElement('button');
    btn.textContent = 'Sign in';
    btn.style.marginTop = '12px';
    btn.addEventListener('click', ()=>{ if(loginModal) loginModal.style.display = 'flex'; });
    prompt.appendChild(btn);
    board.appendChild(prompt);
    return;
  }

  board.innerHTML = '';
  COLUMNS.forEach(col => {
    const colEl = document.createElement('section');
    colEl.className = 'column';
    colEl.dataset.col = col;

    const header = document.createElement('h2');
    header.textContent = col;
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = `(${state[col].length})`;
    header.appendChild(count);

    const drop = document.createElement('div');
    drop.className = 'dropzone';
    drop.dataset.col = col;

    // respect current user's visibleColumns permission
    try{
      const users = window._USERSCache || {};
      const me = (currentUser && currentUser.username) ? findUser(users, currentUser.username) : null;
      if(me && Array.isArray(me.visibleColumns) && me.visibleColumns.length){
        if(!me.visibleColumns.includes(col)){
          // skip rendering this column
          return;
        }
      }
    }catch(e){/* ignore */}

    drop.addEventListener('dragover', e => {
      e.preventDefault();
      drop.classList.add('over');
    });
    drop.addEventListener('dragleave', e => drop.classList.remove('over'));

    drop.addEventListener('drop', e => {
      e.preventDefault();
      drop.classList.remove('over');
      const cardId = e.dataTransfer.getData('text/plain');
      moveCard(cardId, col);
    });

    state[col].forEach(card => {
      const node = createCardNode(card);
      drop.appendChild(node);
    });

    colEl.appendChild(header);
    colEl.appendChild(drop);
    board.appendChild(colEl);
  });
}

// Rebind top-level cards listeners when the selected board changes
function attachCardsListeners(){
  try{
    if(!db) return;
    cardsRef = ref(db, '/' + cardsPathForBoard());
    // TODO: attach child listeners if needed (onChildAdded/onChildChanged/onChildRemoved)
  }catch(e){ console.warn('attachCardsListeners', e); }
}

attachCardsListeners();

window.addEventListener('board-changed', (e)=>{ try{ attachCardsListeners(); render(); }catch(err){} });

// Create and insert the user avatar circle before the createTaskBtn
function ensureUserAvatar(){
  if(userAvatarEl) return userAvatarEl;
  userAvatarEl = document.createElement('div');
  userAvatarEl.className = 'user-avatar';
  userAvatarEl.style.display = 'none';
  userAvatarEl.title = '';
  // insert before Create Task button when available
  try{
    if(createTaskBtn && createTaskBtn.parentNode){
      createTaskBtn.parentNode.insertBefore(userAvatarEl, createTaskBtn);
    }
  }catch(e){}
  return userAvatarEl;
}

// Update the current user UI: avatar, text, and create button enabled state based on permissions
function updateCurrentUserUI(){
  ensureUserAvatar();
  // default to not signed in
  if(!currentUser){
    if(currentUserDisplay) currentUserDisplay.textContent = 'Not signed in';
    if(userAvatarEl) userAvatarEl.style.display = 'none';
    if(createTaskBtn) createTaskBtn.disabled = true;
    return;
  }
  const username = currentUser.username;
  if(currentUserDisplay) currentUserDisplay.textContent = '';
  // get user color and permissions from cached users if available
  let users = window._USERSCache || null;
  let u = findUser(users, username);
  // If not found in in-memory cache, try the persisted localStorage snapshot
  if(!u){
    try{
      const raw = localStorage.getItem('kanban_users_v1');
      if(raw){
        const parsed = JSON.parse(raw);
        if(parsed && Object.keys(parsed).length){
          users = parsed;
          window._USERSCache = users;
          u = findUser(users, username);
        }
      }
    }catch(e){ /* ignore parse errors */ }
  }
  const color = u && u.color ? u.color : '#6b7280';
  const canCreate = u && typeof u.canCreate !== 'undefined' ? !!u.canCreate : true;
  const canUpload = u && typeof u.canUpload !== 'undefined' ? !!u.canUpload : true;
  // populate avatar
  if(userAvatarEl){
    userAvatarEl.textContent = (username && username[0]) ? username[0].toUpperCase() : '?';
    userAvatarEl.style.background = color;
    userAvatarEl.style.color = '#fff';
    userAvatarEl.style.display = 'inline-flex';
    userAvatarEl.title = username;
  }
  if(createTaskBtn) createTaskBtn.disabled = !canCreate;
  // show/hide attach button entirely per permission
  try{ if(attachBtn) attachBtn.style.display = canUpload ? '' : 'none'; }catch(e){}

  // Show Manage Users menu only for the unremovable admin account
  try{
    if(menuManageUsers){
      menuManageUsers.style.display = (username === 'admin') ? '' : 'none';
    }
  }catch(e){}

  // Ensure the standalone ADMIN button visibility matches current user as well
  try{
    const adminBtn = document.getElementById('menuAdmin');
    if(adminBtn) adminBtn.style.display = (username === 'admin') ? '' : 'none';
  }catch(e){}

  // Also fetch freshest user state in background (if available) and re-apply UI to ensure any remote changes propagate
  try{
    if(window._USERS && window._USERS.getAll){
      window._USERS.getAll().then(users => {
        try{
          if(users && Object.keys(users).length){
            window._USERSCache = users;
            const fresh = findUser(users, username);
            const freshCanCreate = fresh && typeof fresh.canCreate !== 'undefined' ? !!fresh.canCreate : canCreate;
            const freshCanUpload = fresh && typeof fresh.canUpload !== 'undefined' ? !!fresh.canUpload : canUpload;
            if(createTaskBtn) createTaskBtn.disabled = !freshCanCreate;
            try{ if(attachBtn) attachBtn.style.display = freshCanUpload ? '' : 'none'; }catch(e){}
            // hide attachments area if user not allowed to view
            try{
              const attachmentsContainer = document.querySelector('.attachments') || document.getElementById('attachmentsList')?.parentNode;
              if(fresh && fresh.canViewAttachments === false){ if(attachmentsContainer) attachmentsContainer.style.display = 'none'; }
              else { if(attachmentsContainer) attachmentsContainer.style.display = ''; }
            }catch(e){}
          }
        }catch(e){/* ignore */}
      }).catch(()=>{});
    }
  }catch(e){}
}

function createCardNode(card){
  const tpl = cardTemplate.content.cloneNode(true);
  const el = tpl.querySelector('.card');
  const title = tpl.querySelector('.card-title');
  const del = tpl.querySelector('.delete');

  el.dataset.id = card.id;
  title.textContent = card.title;
  // apply creator color if available
  try{
    const createdBy = card.createdBy;
    if(createdBy){
      // attempt to get color from users helper cache
      const users = (window._USERS && window._USERS.getAll) ? awaitMaybeUsersSync() : null;
      const color = users && users[createdBy] && users[createdBy].color ? users[createdBy].color : null;
      if(color){
        el.style.setProperty('--creator-color', color);
        el.classList.add('has-creator-color');
      } else {
        el.style.removeProperty('--creator-color');
        el.classList.remove('has-creator-color');
      }
    }
  }catch(e){/* ignore color application errors */}
  title.addEventListener('input', () => {
    card.title = title.textContent.trim();
    save();
    // debounce per-card remote writes
    scheduleRemoteWriteCard(card);
  });

  // show details modal when clicking the card (but not when clicking delete or editing title)
  el.addEventListener('click', e => {
    if(e.target.closest('.delete')) return; // ignore delete button clicks
    // show modal
    if(!detailsModal) return;
    if(detailTitle) detailTitle.textContent = card.title || '';
    if(detailDesc) detailDesc.textContent = card.description || '';
    if(detailAssignee) detailAssignee.textContent = card.assignee || '';
  if(detailDue) detailDue.textContent = formatDateStr(card.due);
  if(detailCategory) detailCategory.textContent = card.column || '';
  if(detailCreated) detailCreated.textContent = formatDateStr(card.created);
    const createdByEl = document.getElementById('detailCreatedBy');
    if(createdByEl) createdByEl.textContent = card.createdBy || 'unknown';
  // set current card id for attachment handlers and render attachments
  try{ detailsModal.dataset.cardId = card.id; }catch(e){}
  try{ renderAttachmentsForCard(card); }catch(e){ console.warn('Failed to render attachments', e); }
  detailsModal.style.display = 'flex';
  });

  del.addEventListener('click', () => {
    deleteCard(card.id);
  });

  el.addEventListener('dragstart', e => {
    // check permission: current user must have canMove
    try{
      const users = window._USERSCache || {};
      const me = (currentUser && currentUser.username) ? findUser(users, currentUser.username) : null;
      if(me && me.canMove === false){
        e.preventDefault();
        return;
      }
    }catch(e){}
    e.dataTransfer.setData('text/plain', card.id);
    requestAnimationFrame(() => el.setAttribute('dragging', ''));
  });
  el.addEventListener('dragend', () => el.removeAttribute('dragging'));

  return el;
}

// Attachment helpers
// Use window.BACKEND if provided. Otherwise prefer the page origin when served over http(s).
// If page is file:// or origin is empty, fall back to localhost:3000 where the STORAGE server commonly runs.
function getQueryParam(name){
  try{ const params = new URLSearchParams(location.search); return params.get(name); }catch(e){ return null; }
}

const _explicitBackend = getQueryParam('backend') || (typeof window.BACKEND === 'string' && window.BACKEND.length ? window.BACKEND : null);
const BACKEND_BASE = _explicitBackend
  || (location && location.protocol && location.protocol.startsWith('http') && location.host ? `${location.protocol}//${location.host}` : 'http://localhost:3000');

if(_explicitBackend && console && console.info) console.info('Using explicit backend:', _explicitBackend);

async function presignUpload(key, contentType){
  try{
    const body = { key, contentType };
    if(currentUser && currentUser.username) body.username = currentUser.username;
    if(console && console.info) console.info('presign-upload request body', body);
    const res = await fetch(BACKEND_BASE + '/presign-upload', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    if(!res.ok){
      const text = await res.text().catch(()=>null);
      throw new Error(`presign failed: ${res.status} ${res.statusText} ${text||''}`);
    }
    const j = await res.json();
    return j.url;
  }catch(e){
    console.warn('presignUpload failed', e);
    if(attachmentStatus) attachmentStatus.textContent = 'Failed to contact backend for upload (see console)';
    return null;
  }
}

async function presignDownload(key){
  try{
    const body = { key };
    if(currentUser && currentUser.username) body.username = currentUser.username;
    if(console && console.info) console.info('presign-download request body', body);
    const res = await fetch(BACKEND_BASE + '/presign-download', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    if(!res.ok){
      const text = await res.text().catch(()=>null);
      throw new Error(`presign failed: ${res.status} ${res.statusText} ${text||''}`);
    }
    const j = await res.json();
    return j.url;
  }catch(e){
    console.warn('presignDownload failed', e);
    if(attachmentStatus) attachmentStatus.textContent = 'Failed to contact backend for download (see console)';
    return null;
  }
}

async function uploadFileForCard(card, file){
  if(!file) return null;
  // check permission: current user must be allowed to upload
  try{
    const users = window._USERSCache || {};
    const me = (currentUser && currentUser.username) ? findUser(users, currentUser.username) : null;
    if(me && me.canUpload === false){
      if(attachmentStatus) attachmentStatus.textContent = 'You do not have permission to upload attachments';
      return null;
    }
  }catch(e){}
  const key = `attachments/${card.id}/${Date.now()}_${file.name}`;
  attachmentStatus.textContent = 'Requesting upload URL...';
  const url = await presignUpload(key, file.type || 'application/pdf');
  if(!url) { attachmentStatus.textContent = 'Failed to get upload URL'; return null; }
  attachmentStatus.textContent = 'Uploading...';
  try{
    const putRes = await fetch(url, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/pdf' }, body: file });
    if(!putRes.ok){ attachmentStatus.textContent = 'Upload failed'; return null; }
    attachmentStatus.textContent = 'Upload complete';
    const entry = { key, name: file.name, uploadedAt: Date.now(), contentType: file.type || 'application/pdf' };
    // persist into card attachments
    card.attachments = Array.isArray(card.attachments) ? card.attachments : [];
  try{ entry.attachedInCategory = card.column || null; }catch(e){ entry.attachedInCategory = null; }
  card.attachments.push(entry);
    save();
    scheduleRemoteWriteCard(card);
    return entry;
  }catch(e){ attachmentStatus.textContent = 'Upload error'; console.warn(e); return null; }
}

function renderAttachmentsForCard(card){
  if(!attachmentsList) return;
  // respect permission to view attachments; hide the attachments container if not allowed
  try{
    const users = window._USERSCache || {};
    const me = (currentUser && currentUser.username) ? findUser(users, currentUser.username) : null;
    const attachmentsContainer = document.querySelector('.attachments') || document.getElementById('attachmentsList')?.parentNode;
    if(me && me.canViewAttachments === false){
      if(attachmentsContainer) attachmentsContainer.style.display = 'none';
      return;
    } else {
      if(attachmentsContainer) attachmentsContainer.style.display = '';
    }
  }catch(e){}
  const list = (card.attachments || []);
  if(!list.length){ attachmentsList.textContent = 'No attachments'; return; }
  attachmentsList.innerHTML = '';
  list.forEach(a => {
    const row = document.createElement('div');
    row.style.display = 'flex'; row.style.alignItems = 'center'; row.style.gap = '8px'; row.style.marginBottom = '6px';
    const name = document.createElement('div'); name.textContent = a.name || a.key; name.style.flex = '1';
    try{
      const catText = a.attachedInCategory || card.column || '—';
      const badge = document.createElement('span');
      badge.textContent = catText;
      badge.style.marginRight = '8px'; badge.style.padding = '2px 6px'; badge.style.borderRadius = '6px'; badge.style.fontSize='12px';
      if(a.attachedInCategory){ badge.style.background = '#eef2ff'; badge.style.color='#1f2937'; }
      else { badge.style.background = '#fff7ed'; badge.style.color = '#92400e'; badge.title = 'Category not recorded at upload; showing current column'; }
      row.appendChild(badge);
    }catch(e){}
    row.appendChild(name);
    const dl = document.createElement('button'); dl.textContent = 'Download'; dl.style.padding = '6px 8px';
    dl.addEventListener('click', async ()=>{
      dl.disabled = true; dl.textContent = 'Getting link...';
      const url = await presignDownload(a.key);
      if(!url){ dl.textContent = 'Failed'; setTimeout(()=>{ dl.disabled=false; dl.textContent='Download'; }, 1500); return; }
      // open in new tab
      window.open(url, '_blank');
      dl.disabled = false; dl.textContent = 'Download';
    });
    row.appendChild(name); row.appendChild(dl);
    attachmentsList.appendChild(row);
  });
}

// wire attachment controls
if(attachBtn && attachmentInput){
  attachBtn.addEventListener('click', ()=>{
    // check current user's upload permission
    try{
      const users = window._USERSCache || {};
      const me = (currentUser && currentUser.username) ? findUser(users, currentUser.username) : null;
      if(me && me.canUpload === false){ return alert('You do not have permission to upload attachments'); }
    }catch(e){}
    if(attachmentInput) attachmentInput.click();
  });
  attachmentInput.addEventListener('change', async (e)=>{
    const files = e.target.files; if(!files || !files.length) return;
    // the modal must have a currently shown card — attempt to find by title
    const title = detailTitle ? detailTitle.textContent : null;
    // find card in state by title and created date is not reliable; instead, support attaching only when details modal was opened and a lastViewedCard is set.
    try{
      const lastCardId = detailsModal.dataset.cardId;
      if(!lastCardId){ attachmentStatus.textContent = 'No card selected'; return; }
      const card = Object.values(state).flat().find(c => c.id === lastCardId);
      if(!card){ attachmentStatus.textContent = 'Card not found'; return; }
      await uploadFileForCard(card, files[0]);
      renderAttachmentsForCard(card);
    }catch(e){ console.warn(e); }
  });
}


// Helper to synchronously attempt to read users cache; returns object or null
function awaitMaybeUsersSync(){
  try{
    // If _USERS.getAll is a function, it may be async. We attempt to read last-known users from window._USERSCache
    if(window._USERSCache) return window._USERSCache;
    // try to call getAll but don't await (synchronously impossible) - instead return null
    return null;
  }catch(e){ return null; }
}

// Find a user record by username with case-insensitive fallback
function findUser(usersMap, username){
  if(!usersMap || !username) return null;
  if(usersMap[username]) return usersMap[username];
  const lower = username.toLowerCase();
  for(const k of Object.keys(usersMap)){
    if(k.toLowerCase() === lower) return usersMap[k];
  }
  return null;
}

function addCard(title, col = COLUMNS[0]){
  const id = 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);
  const card = {id, title, created: Date.now(), column: col, order: (state[col] || []).length};
  state[col].push(card);
  save();
  render();
  // write this new card to remote
  scheduleRemoteWriteCard(card);
}

function moveCard(cardId, toCol){
  for(const col of COLUMNS){
    const idx = state[col].findIndex(c => c.id === cardId);
    if(idx !== -1){
      const [card] = state[col].splice(idx,1);
      // update card metadata
      card.column = toCol;
      state[toCol].push(card);
      // reassign order indexes for affected columns
      (state[col] || []).forEach((c,i)=> c.order = i);
      (state[toCol] || []).forEach((c,i)=> c.order = i);
      save();
      render();
      // schedule remote writes
      scheduleRemoteWriteCard(card);
      remoteBatchUpdateOrders([col, toCol]);
      return;
    }
  }
}

function deleteCard(cardId){
  for(const col of COLUMNS){
    const idx = state[col].findIndex(c => c.id === cardId);
    if(idx !== -1){
      state[col].splice(idx,1);
      // reassign orders
      (state[col] || []).forEach((c,i)=> c.order = i);
      save();
      render();
      // remove remote
      remoteRemoveCard(cardId);
      remoteBatchUpdateOrders([col]);
      return;
    }
  }
}

// Button in top-left: CREATE TASK + (single entry point)
if(createTaskBtn){
  createTaskBtn.addEventListener('click', () => {
    // require signed-in user to create jobs
    if(!currentUser){
      if(loginModal) loginModal.style.display = 'flex';
      if(loginUser) loginUser.value = '';
      if(loginPass) loginPass.value = '';
      if(loginError) loginError.style.display = 'none';
      return;
    }
    // Open modal and populate categories
    // check permission
    try{
      const users = window._USERSCache || {};
      const me = (currentUser && currentUser.username) ? users[currentUser.username] : null;
      if(me && me.canCreate === false){
        return alert('You do not have permission to create jobs');
      }
    }catch(e){}
    if(createModal) createModal.style.display = 'flex';
    if(createCategory){
      createCategory.innerHTML = '';
      COLUMNS.forEach(col => {
        const opt = document.createElement('option');
        opt.value = col; opt.textContent = col; createCategory.appendChild(opt);
      });
    }
    if(createTitle) createTitle.value = '';
    if(createDesc) createDesc.value = '';
    if(createAssignee) createAssignee.value = '';
    if(createDue) createDue.value = '';
  });
}

// export/import functionality removed per user request

// Hook up hamburger menu actions (guard in case elements are missing)
if(hamburgerBtn && hamburgerMenu){
  hamburgerBtn.addEventListener('click', ()=>{
    const vis = hamburgerMenu.style.display !== 'none';
    hamburgerMenu.style.display = vis ? 'none' : 'block';
  });
}
// Create task via left `createTaskBtn` only
if(menuManageCategories){
  menuManageCategories.addEventListener('click', ()=>{
    // open centralized manage UI in categories.js (categories.js will request admin auth if needed)
    const evt = new CustomEvent('categories-manage');
    window.dispatchEvent(evt);
    if(hamburgerMenu) hamburgerMenu.style.display = 'none';
  });
}

// Listen for category manager requests that require admin authentication
window.addEventListener('request-admin-auth', (e)=>{
  // show the admin auth modal so the caller can authenticate as admin
  if(adminAuthModal){
    if(adminAuthUser) adminAuthUser.value = '';
    if(adminAuthPass) adminAuthPass.value = '';
    if(adminAuthError) adminAuthError.style.display = 'none';
    adminAuthModal.style.display = 'flex';
  } else {
    // fallback: show login modal
    if(loginModal){ loginModal.style.display = 'flex'; }
  }
});
if(menuManageUsers){
  menuManageUsers.addEventListener('click', ()=>{
    // require admin authentication before opening users manager
    if(adminAuthModal){
      adminAuthModal.style.display = 'flex';
      if(adminAuthUser) adminAuthUser.value = '';
      if(adminAuthPass) adminAuthPass.value = '';
      if(adminAuthError) adminAuthError.style.display = 'none';
    }else{
      const evt = new CustomEvent('users-manage');
      window.dispatchEvent(evt);
    }
    if(hamburgerMenu) hamburgerMenu.style.display = 'none';
  });
}
// Login/logout handlers
if(menuLogin){
  menuLogin.addEventListener('click', ()=>{
    if(loginModal) loginModal.style.display = 'flex';
    if(loginUser) loginUser.value = '';
    if(loginPass) loginPass.value = '';
    if(loginError) loginError.style.display = 'none';
    if(hamburgerMenu) hamburgerMenu.style.display = 'none';
  });
}
if(menuLogout){
  menuLogout.addEventListener('click', ()=>{
    if(!currentUser) return alert('Not signed in');
    currentUser = null; localStorage.removeItem('kanban_current_user');
    try{ updateCurrentUserUI(); }catch(e){}
    alert('Signed out');
    if(hamburgerMenu) hamburgerMenu.style.display = 'none';
    render();
  });
}

// Make the current user display clickable: open login when signed out, prompt logout when signed in
if(currentUserDisplay){
  // visual affordance
  currentUserDisplay.style.cursor = 'pointer';
  currentUserDisplay.title = 'Click to sign in or out';
  currentUserDisplay.addEventListener('click', ()=>{
    if(!currentUser){
      // open login modal
      if(loginModal) loginModal.style.display = 'flex';
      if(loginUser) loginUser.value = '';
      if(loginPass) loginPass.value = '';
      if(loginError) loginError.style.display = 'none';
      return;
    }
    // if signed in, confirm sign out
    const confirmOut = confirm('Sign out ' + (currentUser && currentUser.username ? currentUser.username : '') + '?');
    if(confirmOut){
      currentUser = null; localStorage.removeItem('kanban_current_user');
      try{ updateCurrentUserUI(); }catch(e){}
      alert('Signed out');
      render();
    }
  });
}

if(loginCancel){ loginCancel.addEventListener('click', ()=>{ if(loginModal) loginModal.style.display = 'none'; }); }
// submit login when pressing Enter in username or password
if(loginUser){ loginUser.addEventListener('keydown', (e)=>{ if(e.key === 'Enter') loginSubmit.click(); }); }
if(loginPass){ loginPass.addEventListener('keydown', (e)=>{ if(e.key === 'Enter') loginSubmit.click(); }); }
if(loginSubmit){ loginSubmit.addEventListener('click', async ()=>{
  const u = loginUser && loginUser.value && loginUser.value.trim();
  const p = loginPass && loginPass.value && loginPass.value.trim();
  if(!u || !p){ if(loginError){ loginError.textContent = 'Enter username and password'; loginError.style.display = 'block'; } return; }
  // use users helper
  const ok = await (window._USERS && window._USERS.login ? window._USERS.login(u,p) : Promise.resolve(false));
  if(ok){
    currentUser = { username: u };
    localStorage.setItem('kanban_current_user', JSON.stringify(currentUser));
    // ensure we have latest users data (color/permissions) before updating UI
    try{
      if(window._USERS && window._USERS.getAll){
        const users = await window._USERS.getAll();
        window._USERSCache = users || {};
      } else {
        window._USERSCache = window._USERSCache || {};
      }
    }catch(e){ window._USERSCache = window._USERSCache || {}; }
    try{ updateCurrentUserUI(); }catch(e){}
    if(loginModal) loginModal.style.display = 'none';
    // re-render board now that user is signed in
    render();
  }else{
    if(loginError){ loginError.textContent = 'Invalid username or password'; loginError.style.display = 'block'; }
  }
}); }

// Admin auth modal handlers
if(adminAuthCancel){ adminAuthCancel.addEventListener('click', ()=>{ if(adminAuthModal) adminAuthModal.style.display = 'none'; }); }
// submit admin auth when pressing Enter
if(adminAuthUser){ adminAuthUser.addEventListener('keydown', (e)=>{ if(e.key === 'Enter') adminAuthSubmit.click(); }); }
if(adminAuthPass){ adminAuthPass.addEventListener('keydown', (e)=>{ if(e.key === 'Enter') adminAuthSubmit.click(); }); }
if(adminAuthSubmit){ adminAuthSubmit.addEventListener('click', async ()=>{
  const u = adminAuthUser && adminAuthUser.value && adminAuthUser.value.trim();
  const p = adminAuthPass && adminAuthPass.value && adminAuthPass.value.trim();
  if(!u || !p){ if(adminAuthError){ adminAuthError.textContent = 'Enter username and password'; adminAuthError.style.display = 'block'; } return; }
  // validate via users helper
  const ok = await (window._USERS && window._USERS.login ? window._USERS.login(u,p) : Promise.resolve(false));
  if(ok){
    // Dispatch a guarded event that users.js will listen for to open the manager
    const evt = new CustomEvent('admin-auth-success', { detail: { username: u } });
    window.dispatchEvent(evt);
    if(adminAuthModal) adminAuthModal.style.display = 'none';
  }else{
    if(adminAuthError){ adminAuthError.textContent = 'Invalid admin credentials'; adminAuthError.style.display = 'block'; }
  }
}); }

// restore current user from localStorage
try{
  const raw = localStorage.getItem('kanban_current_user');
  if(raw) currentUser = JSON.parse(raw);
  // update UI for restored user (avatar, permissions)
  // Attempt to load users first so we can show the correct avatar color on refresh
  (async ()=>{
    try{
      if(window._USERS && window._USERS.getAll){
        const users = await window._USERS.getAll();
        window._USERSCache = users || {};
      } else {
        // fallback to any cached copy
        window._USERSCache = window._USERSCache || {};
      }
    }catch(e){ window._USERSCache = window._USERSCache || {}; }
    try{ updateCurrentUserUI(); }catch(e){}
  })();
}catch(e){}

// Create modal handlers
if(createCancel){ createCancel.addEventListener('click', ()=>{ if(createModal) createModal.style.display = 'none'; }); }
if(createSave){ createSave.addEventListener('click', ()=>{
  const title = createTitle && createTitle.value.trim();
  if(!title) return alert('Enter a job title');
  const id = 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);
  const col = (createCategory && createCategory.value) || COLUMNS[0];
  const card = {
    id, title,
    description: createDesc ? createDesc.value.trim() : '',
    assignee: createAssignee ? createAssignee.value.trim() : '',
    due: createDue && createDue.value ? createDue.value : null,
    created: Date.now(),
    column: col,
    createdBy: currentUser ? currentUser.username : 'anonymous',
    order: (state[col] || []).length
  };
  state[col].push(card);
  save(); render();
  scheduleRemoteWriteCard(card);
  if(createModal) createModal.style.display = 'none';
}); }

if(detailClose){ detailClose.addEventListener('click', ()=>{
  if(detailsModal){ detailsModal.style.display = 'none'; try{ delete detailsModal.dataset.cardId; }catch(e){} }
  try{ if(attachmentStatus) attachmentStatus.textContent = ''; }catch(e){}
}); }

// helper: format date string (optional)
function formatDateStr(d){ if(!d) return '—'; try{ return new Date(d).toLocaleDateString(); }catch(e){ return d; } }

// initialize
state = load();
// ensure keys exist
// attempt to load categories from local storage and apply
const persistedCats = loadLocalCategories();
COLUMNS = Array.from(new Set(DEFAULT_COLUMNS.concat(Array.isArray(persistedCats) ? persistedCats : [])));
COLUMNS.forEach(col => { if(!state[col]) state[col]=[] });
render();

// expose for debugging
window._KANBAN = {state, save, render};

// listen for categories updates from categories.js module
window.addEventListener('categories-updated', e => {
  const list = e?.detail?.categories;
  if(!Array.isArray(list) || list.length===0) return;
  setCategories(list);
});

// Remote -> Local sync: per-card listeners
if(cardsRef){
  const statusEl = document.getElementById('status');
  onChildAdded(cardsRef, snap => {
    const id = snap.key;
    const remoteCard = snap.val();
    if(!remoteCard) return;
    if(pendingWrites.has(id)) return; // ignore our own write echo
    applyRemoteCard(remoteCard);
    if(statusEl) statusEl.textContent = 'Synced';
  });
  onChildChanged(cardsRef, snap => {
    const id = snap.key;
    const remoteCard = snap.val();
    if(!remoteCard) return;
    if(pendingWrites.has(id)) return;
    applyRemoteCard(remoteCard);
    if(statusEl) statusEl.textContent = 'Synced';
  });
  onChildRemoved(cardsRef, snap => {
    const id = snap.key;
    // remove locally
    for(const col of COLUMNS){
      const idx = state[col].findIndex(c => c.id === id);
      if(idx !== -1){
        state[col].splice(idx,1);
        (state[col] || []).forEach((c,i)=> c.order = i);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        render();
        break;
      }
    }
  });
}

// Listen for users updates so we can re-render cards with new colors
window.addEventListener('users-updated', async (e)=>{
  try{
    // Prefer to fetch the freshest users snapshot when available
    let users = e?.detail?.users || null;
    try{
      if(window._USERS && window._USERS.getAll){
        const fetched = await window._USERS.getAll();
        if(fetched && Object.keys(fetched).length) users = fetched;
      }
    }catch(err){ /* ignore fetch errors and fall back to event payload */ }
    users = users || (e?.detail?.users || {});
    // cache for synchronous reads
    window._USERSCache = users;
    // re-render the board so cards pick up new colors
    render();
    // update current user UI (avatar/permissions) and attachments visibility
    try{ updateCurrentUserUI(); }catch(e){}
    try{ if(detailsModal && detailsModal.style.display === 'flex'){ const lastCardId = detailsModal.dataset.cardId; if(lastCardId){ const card = Object.values(state).flat().find(c => c.id === lastCardId); if(card) renderAttachmentsForCard(card); } } }catch(e){}
    // update create button enabled state based on current user's permission
    try{
      if(currentUser && createTaskBtn){
        const me = findUser(users, currentUser.username);
        createTaskBtn.disabled = !!(me && me.canCreate === false) ? true : false;
      }
    }catch(e){}
  }catch(err){ console.warn('users-updated handling failed', err); }
});

function applyRemoteCard(remoteCard){
  // place or update card in local state if newer
  const id = remoteCard.id;
  const col = remoteCard.column || COLUMNS[0];
  // find existing
  let found = null;
  for(const c of COLUMNS){
    const idx = state[c].findIndex(x=> x.id === id);
    if(idx !== -1){ found = {col:c, idx}; break; }
  }
  const localCard = found ? state[found.col][found.idx] : null;
  if(!localCard){
    // new card
    const card = Object.assign({}, remoteCard);
    // ensure column exists
    if(!state[col]) state[col] = [];
    // add at specified order or push
    if(typeof remoteCard.order === 'number') state[col].splice(remoteCard.order,0,card);
    else state[col].push(card);
    (state[col] || []).forEach((c,i)=> c.order = i);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    render();
    return;
  }
  // existing card: update if remote is newer
  if(!localCard.updatedAt || (remoteCard.updatedAt && remoteCard.updatedAt > localCard.updatedAt)){
    // remove from old col if changed
    if(found.col !== col){
      state[found.col].splice(found.idx, 1);
      if(!state[col]) state[col] = [];
      state[col].splice(typeof remoteCard.order === 'number' ? remoteCard.order : state[col].length, 0, remoteCard);
    }else{
      // replace
      state[found.col][found.idx] = Object.assign({}, state[found.col][found.idx], remoteCard);
    }
    (state[col] || []).forEach((c,i)=> c.order = i);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    render();
  }
}


