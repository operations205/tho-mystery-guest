/* ===================== STATE & PERSISTENCE ===================== */
/* ===================== API HELPER ===================== */
async function api(method, path, body){
  const opts = { method, headers:{}, credentials:'same-origin' };
  if(body !== undefined){
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch('/api' + path, opts);
  let data = null;
  try{ data = await res.json(); }catch(e){ data = null; }
  if(!res.ok){
    const err = new Error((data && data.error) || ('HTTP ' + res.status));
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}
const apiGet = (path) => api('GET', path);
const apiPost = (path, body) => api('POST', path, body);
const apiPut = (path, body) => api('PUT', path, body);
const apiDelete = (path) => api('DELETE', path);

let state = {
  lang:'ar',
  session:null,           // {userId, role}
  view:'login',
  loginRole:'admin',
  loginError:'',
  loading:true,
  hotels:[],
  assignments:[],
  inspections:[],
  settings:null,
  templates:{},
  clients:[],
  documents:[],
  hotelAccounts:{},
  openHotelAccountId:null,
  hotelAccountReveal:null,
  selectedClientId:null,
  currentAssignmentId:null,
  currentInspectionId:null,
  activeCatIndex:0,
  reportMode:'detailed',
  sidebarOpen:false,
  drawer:null,             // {type:'property'|'inspector'|'assignment'|'client', editId:null|id}
  inspTab:'assignments',
  inspFilterStatus:'all',
  standardsDocId:'audit4'
};

/* Placeholder tags available inside uploaded proposal/contract .docx templates. */
const PLACEHOLDER_TAGS = [
  {key:'client_name', en:'Client name (Arabic)', ar:'اسم العميل (عربي)'},
  {key:'client_name_en', en:'Client name (English)', ar:'اسم العميل (إنجليزي)'},
  {key:'hotel_name', en:'Hotel / property name (Arabic)', ar:'اسم الفندق (عربي)'},
  {key:'hotel_name_en', en:'Hotel / property name (English)', ar:'اسم الفندق (إنجليزي)'},
  {key:'client_contact', en:'Contact person', ar:'المسؤول عن التواصل'},
  {key:'client_phone', en:'Client phone', ar:'هاتف العميل'},
  {key:'client_email', en:'Client email', ar:'بريد العميل'},
  {key:'num_visits', en:'Number of visits', ar:'عدد الزيارات'},
  {key:'visit_frequency', en:'Visit frequency', ar:'تكرار الزيارات'},
  {key:'price_per_visit', en:'Price per visit', ar:'سعر الزيارة'},
  {key:'total_price', en:'Total price', ar:'الإجمالي'},
  {key:'currency', en:'Currency', ar:'العملة'},
  {key:'contract_duration', en:'Contract duration (months)', ar:'مدة العقد بالشهور'},
  {key:'start_date', en:'Start date', ar:'تاريخ البدء'},
  {key:'end_date', en:'End date', ar:'تاريخ الانتهاء'},
  {key:'document_date', en:'Document date', ar:'تاريخ المستند'},
  {key:'document_ref', en:'Reference number', ar:'الرقم المرجعي'},
  {key:'company_name', en:'Your company name (Arabic)', ar:'اسم شركتكم (عربي)'},
  {key:'company_name_en', en:'Your company name (English)', ar:'اسم شركتكم (إنجليزي)'},
  {key:'company_email', en:'Your company email', ar:'بريد الشركة'},
  {key:'company_phone', en:'Your company phone', ar:'هاتف الشركة'},
  {key:'company_website', en:'Your company website', ar:'موقع الشركة'}
];
let pendingLogoDataUrl = undefined;

/* Loads public strings + (if logged in) session + all app data from the API.
   Called once at boot, and again right after a successful login. */
async function loadData(){
  const meta = await apiGet('/meta/strings');
  S = meta;

  let me = null;
  try{ me = (await apiGet('/auth/me')).user; }catch(e){ me = null; }

  if(!me){
    state.session = null;
    return;
  }
  state.session = { userId: me.id, role: me.role, hotelId: me.hotelId || null };

  if (me.role === 'hotel') {
    // The hotel side only ever needs: strings for rendering the report layout, its own hotel
    // record, and its own completed inspections. Everything else (clients, templates, other
    // hotels' data) is admin/inspector business and stays out of this session entirely.
    const [standardsMeta, audit4Cats, plus5Cats, hotels, inspections, settings] = await Promise.all([
      apiGet('/standards'),
      apiGet('/standards/audit4/categories'),
      apiGet('/standards/plus5/categories'),
      apiGet('/hotels'),
      apiGet('/inspections'),
      apiGet('/settings')
    ]);
    STANDARDS = standardsMeta.STANDARDS;
    CLASS_META = standardsMeta.CLASS_META;
    PILLAR_DESC = standardsMeta.PILLAR_DESC;
    PROPERTY_TYPES = standardsMeta.PROPERTY_TYPES;
    CATS = audit4Cats;
    CATS_PLUS_EXTRA = plus5Cats.slice(audit4Cats.length);
    USERS = [ { id: me.id, role: me.role, username: me.username, name: me.name, title: me.title } ];
    state.hotels = hotels;
    state.assignments = [];
    state.inspections = inspections;
    state.settings = settings;
    state.templates = {};
    state.clients = [];
    state.documents = [];
    state.hotelAccounts = {};
    return;
  }

  const [standardsMeta, audit4Cats, plus5Cats, hotels, inspectors, assignments, inspections, settings, templates, clients, documents, hotelAccounts] = await Promise.all([
    apiGet('/standards'),
    apiGet('/standards/audit4/categories'),
    apiGet('/standards/plus5/categories'),
    apiGet('/hotels'),
    apiGet('/inspectors'),
    apiGet('/assignments'),
    apiGet('/inspections'),
    apiGet('/settings'),
    apiGet('/templates'),
    apiGet('/clients'),
    // Client proposals/contracts are admin-only server-side now (they contain pricing an
    // inspector has no business need to see) — skip the call entirely for non-admins so boot()
    // doesn't fail on a 403 from Promise.all.
    me.role === 'admin' ? apiGet('/documents') : Promise.resolve([]),
    me.role === 'admin' ? apiGet('/hotels/accounts') : Promise.resolve({})
  ]);
  STANDARDS = standardsMeta.STANDARDS;
  CLASS_META = standardsMeta.CLASS_META;
  PILLAR_DESC = standardsMeta.PILLAR_DESC;
  PROPERTY_TYPES = standardsMeta.PROPERTY_TYPES;
  CATS = audit4Cats;
  CATS_PLUS_EXTRA = plus5Cats.slice(audit4Cats.length); // plus5 endpoint already returns audit4+extra; keep only the extra part
  USERS = [ { id: me.id, role: me.role, username: me.username, name: me.name, title: me.title, email: me.email }, ...inspectors ];
  state.hotels = hotels;
  state.assignments = assignments;
  state.inspections = inspections;
  state.settings = settings;
  state.templates = templates;
  state.clients = clients;
  state.documents = documents;
  state.hotelAccounts = hotelAccounts;
}

/* No-op placeholders kept so any leftover call sites don't throw — persistence now happens
   server-side inside the action functions themselves (submitDrawer, setAnswerM, etc). */
function saveHotels(){}
function saveAssignments(){}
function saveInspections(){}
function saveSession(){}

function newId(prefix){ return prefix + '_' + Date.now() + '_' + Math.floor(Math.random()*1000); }

/* ===================== AUTH ===================== */
function currentUser(){ return state.session ? USERS.find(u=>u.id===state.session.userId) : null; }
function setLoginRole(role){ state.loginRole = role; state.loginError=''; render(); }
async function attemptLogin(){
  const username = (document.getElementById('f_username')||{}).value || '';
  const password = (document.getElementById('f_password')||{}).value || '';
  try{
    await apiPost('/auth/login', { username: username.trim(), password, role: state.loginRole });
  }catch(e){
    state.loginError = t('invalidLogin');
    render();
    return;
  }
  state.loginError = '';
  await loadData();
  if(state.session.role==='admin'){
    state.view = 'admin-overview';
    // One-time check for any still-unviewed seeded demo-account passwords (see db/seed.js) --
    // near-always empty after the very first admin login ever, since the server deletes these
    // rows the moment they're returned. Fire-and-forget: a failure here shouldn't block login.
    apiGet('/auth/seed-credentials').then(res => {
      if(res && res.credentials && res.credentials.length){
        state.drawer = { type: 'seedCredentials', credentials: res.credentials };
        render();
      }
    }).catch(()=>{});
  }
  else if(state.session.role==='hotel'){ state.view = 'hotel-reports'; }
  else{ state.view = 'inspector-home'; state.inspTab='assignments'; }
  render();
}
async function logout(){
  try{ await apiPost('/auth/logout'); }catch(e){}
  state.session = null;
  state.hotels = []; state.assignments = []; state.inspections = []; state.hotelAccounts = {};
  state.view = 'login';
  render();
}

/* ===================== NAV ===================== */
function go(view){ state.view = view; state.sidebarOpen=false; render(); window.scrollTo(0,0); }
function toggleLang(){
  // Switching language re-renders the whole page from state -- any open drawer form (settings,
  // hotel, inspector, assignment, ...) or the admin-settings page's own inline fields have no
  // oninput sync back to state, so a straight re-render silently threw away whatever the person
  // had typed but not saved yet. Snapshot every id'd form field's current value before the
  // re-render and restore it into the same-id element afterward -- field ids are stable across
  // a language switch (only the surrounding label text/dir changes), so this works generically
  // for any open form without needing per-field wiring.
  const fieldSnapshot = {};
  document.querySelectorAll('input[id], select[id], textarea[id]').forEach(el => {
    if(el.type === 'checkbox' || el.type === 'radio') fieldSnapshot[el.id] = { checked: el.checked };
    else fieldSnapshot[el.id] = { value: el.value };
  });

  state.lang = state.lang === 'ar' ? 'en' : 'ar';
  document.documentElement.lang = state.lang;
  document.documentElement.dir = state.lang === 'ar' ? 'rtl' : 'ltr';
  render();

  Object.keys(fieldSnapshot).forEach(id => {
    const el = document.getElementById(id);
    if(!el) return;
    const snap = fieldSnapshot[id];
    if('checked' in snap) el.checked = snap.checked;
    else el.value = snap.value;
  });
}
function toggleSidebar(){ state.sidebarOpen = !state.sidebarOpen; render(); }
function openDrawer(type, editId){ state.drawer = {type, editId: editId || null}; render(); }
function closeDrawer(){ state.drawer = null; render(); }

/* ===================== SCORING ===================== */
function computeScores(insp){
  const cats = catsForStandard(insp.standardId || 'audit4');
  let yes=0, no=0, na=0;
  let critYes=0, critAnswered=0;
  const catScores = {};
  const catCounts = {};
  const clsScores = {};
  let criticalFails = [];
  cats.forEach(cat=>{
    let cy=0, cn=0;
    cat.items.forEach(item=>{
      const a = insp.answers[item.id];
      if(!a || !a.value) return;
      if(a.value==='yes'){ yes++; cy++; clsAdd(item.cls,1,1);
        if(item.crit){ critYes++; critAnswered++; } }
      else if(a.value==='no'){ no++; cn++; clsAdd(item.cls,0,1);
        if(item.crit){ critAnswered++; criticalFails.push({cat, item, note:a.note}); } }
      else if(a.value==='na'){ na++; }
    });
    const catTotal = cy+cn;
    catScores[cat.id] = catTotal>0 ? Math.round((cy/catTotal)*100) : null;
    // How many yes/no answers this category's percentage is actually based on -- a category
    // where only 1 item was applicable (rest N/A) can swing to a stark 0% or 100% off a single
    // answer. Callers that headline "the weakest area" or count it as a flagged opportunity
    // need this to avoid spotlighting a single data point as if it were a real pattern.
    catCounts[cat.id] = catTotal;
  });
  function clsAdd(cls,y,total){
    if(!clsScores[cls]) clsScores[cls]={y:0,t:0};
    clsScores[cls].y += y; clsScores[cls].t += total;
  }
  const total = yes+no;
  const overall = total>0 ? Math.round((yes/total)*100) : 0;
  const clsPct = {};
  Object.keys(clsScores).forEach(k=>{ clsPct[k] = Math.round((clsScores[k].y/clsScores[k].t)*100); });
  const answeredCount = yes+no+na;
  const totalItems = cats.reduce((s,c)=>s+c.items.length,0);
  // Mandatory/critical-item compliance: null (shown as "-") when no mandatory item was
  // answered yet, rather than a misleading 100%.
  const mandatoryCompliance = critAnswered>0 ? Math.round((critYes/critAnswered)*100) : null;
  return {overall, catScores, catCounts, clsPct, criticalFails, answeredCount, totalItems, yes, no, na, mandatoryCompliance};
}
function gradeInfo(overall, hasCritical){
  if(hasCritical) return {label:t('gradeCritical'), cls:'badge-red'};
  if(overall>=90) return {label:t('gradeExcellent'), cls:'badge-green'};
  if(overall>=75) return {label:t('gradeGood'), cls:'badge-green'};
  if(overall>=60) return {label:t('gradeImprove'), cls:'badge-amber'};
  return {label:t('gradeCritical'), cls:'badge-red'};
}
function scoreColor(pct){
  if(pct===null) return 'var(--muted)';
  if(pct>=85) return 'var(--green)';
  if(pct>=65) return 'var(--amber)';
  return 'var(--red)';
}

/* ===================== SMALL HELPERS ===================== */
function hotelById(id){ return state.hotels.find(h=>h.id===id); }
function userById(id){ return USERS.find(u=>u.id===id); }

/* Bilingual-aware display for inspection records. property_name/inspector_name on the
   inspection row are a denormalized ENGLISH-ONLY snapshot captured once at creation time
   (see POST /inspections/start on the server -- it stores hotel.name_en/user.name_en only,
   never the Arabic equivalents). Rendering that field directly means the hotel/inspector
   name always shows in English no matter what state.lang is set to.
   Fix: prefer a live lookup of the hotel/inspector's real bilingual {en,ar} name via tl(),
   and fall back to the English snapshot only when the live record is gone -- e.g. the hotel
   or inspector was later deleted (inspections.hotel_id/inspector_id are ON DELETE SET NULL
   specifically so old reports keep rendering via this snapshot). */
function inspPropertyName(insp){
  const hotel = hotelById(insp.hotelId);
  return hotel ? tl(hotel.name) : insp.property;
}
function inspInspectorName(insp){
  const u = userById(insp.inspectorId);
  return (u && u.name) ? tl(u.name) : insp.inspector;
}
function inspectionById(id){ return state.inspections.find(i=>i.id===id); }
function assignmentById(id){ return state.assignments.find(a=>a.id===id); }
function isOverdue(as){ return as.status!=='completed' && as.dueDate < new Date().toISOString().slice(0,10); }
function assignmentStatusBadge(as){
  if(as.status==='completed') return `<span class="badge badge-green">${ic('task_alt')}${t('statusDone')}</span>`;
  if(isOverdue(as)) return `<span class="badge badge-red">${ic('schedule')}${t('statusOverdue')}</span>`;
  if(as.status==='in_progress') return `<span class="badge badge-amber">${ic('hourglass_top')}${t('statusProgress')}</span>`;
  return `<span class="badge badge-gray">${ic('schedule')}${t('statusPending')}</span>`;
}
function priorityBadge(p){
  if(p==='high') return `<span class="badge badge-red">${t('priorityHigh')}</span>`;
  if(p==='low') return `<span class="badge badge-gray">${t('priorityLow')}</span>`;
  return `<span class="badge badge-gold">${t('priorityNormal')}</span>`;
}
function standardBadge(id){
  if(id==='plus5') return `<span class="badge" style="background:var(--navy);color:#fff;">${ic('workspace_premium')}${standardName('plus5')}</span>`;
  return `<span class="badge badge-gray">${standardName('audit4')}</span>`;
}

