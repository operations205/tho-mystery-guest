
/* ===================== DOMAIN DATA (checklist standards) ===================== */
let PROPERTY_TYPES = [];

/* ===================== MULTI-STANDARD REGISTRY (THO-Audit 4 base + THO-5 Plus elevated tier) ===================== */
/* ===== Data holders populated at boot from the API (see bootstrapMeta / loadData) ===== */
let CLASS_META = {};
let PILLAR_DESC = {};
let CATS = [];
let CATS_PLUS_EXTRA = [];
let STANDARDS = {};
let USERS = [];
let S = {};

function catsForStandard(id){
  return id === 'plus5' ? CATS.concat(CATS_PLUS_EXTRA) : CATS;
}

/* ===================== 6 KEY-AREA TAXONOMY (report cover grouping) ===================== */
// Groups the 43 detailed categories (plus the 17 THO-5 Plus extras) into 6 operational
// areas for the report cover's executive view. Every category id must map to exactly one
// area; any id missing from this map is treated as ungrouped and simply excluded from the
// area rollup (it still appears in the full detailed checklist further down the report).
const KEY_AREAS = {
  front_office: { icon: 'concierge', en: 'Front Office & Arrival', ar: 'الاستقبال والوصول' },
  rooms:        { icon: 'bed', en: 'Rooms & Housekeeping', ar: 'الغرف والتدبير المنزلي' },
  fnb:          { icon: 'restaurant', en: 'Food & Beverage', ar: 'الأطعمة والمشروبات' },
  facilities:   { icon: 'pool', en: 'Facilities & Wellness', ar: 'المرافق والعافية' },
  digital:      { icon: 'devices', en: 'Digital Experience & Safety', ar: 'التجربة الرقمية والسلامة' },
  guest_recovery: { icon: 'diversity_3', en: 'Guest Recovery & Culture', ar: 'استعادة الخدمة والثقافة' }
};
const CAT_KEY_AREA = {
  reservations:'front_office', booking_confirmation:'front_office', doorman_arrival:'front_office',
  porter_arrival:'front_office', checkin_frontdesk:'front_office', telephone_pbx:'front_office',
  concierge:'front_office', checkout_frontdesk:'front_office', porter_doorman_departure:'front_office',
  transport_transfer:'front_office', valet_parking:'front_office',
  room_setup_bedroom:'rooms', room_setup_bathroom:'rooms', turndown_service:'rooms',
  daily_servicing:'rooms', laundry_pressing:'rooms', noise_privacy:'rooms',
  breakfast_service:'fnb', breakfast_food_table:'fnb', restaurant_reservations:'fnb',
  restaurant_service:'fnb', restaurant_food_wine:'fnb', inroom_dining:'fnb', bar_lounge:'fnb',
  events_banqueting:'fnb',
  facilities:'facilities', elevators:'facilities', business_center:'facilities',
  spa_booking:'facilities', spa_treatment:'facilities', kids_family:'facilities',
  wellness_facilities:'facilities', exterior_grounds:'facilities',
  digital:'digital', wifi_tech:'digital', security_safety:'digital', fire_emergency:'digital',
  sustainability:'digital',
  complaint_recovery:'guest_recovery', loyalty:'guest_recovery', behavior:'guest_recovery',
  culture:'guest_recovery', grooming:'guest_recovery',
  // THO-5 Plus extra categories (only present when standardId === 'plus5')
  arrival_ceremony:'front_office', luxury_transfers:'front_office', pet_concierge:'front_office',
  personal_shopper:'front_office', departure_farewell:'front_office',
  butler_service:'rooms', residence_villa:'rooms', bespoke_turndown:'rooms',
  private_dining_chef:'fnb', sommelier_bar:'fnb', events_celebrations_plus:'fnb',
  wellness_longevity:'facilities', kids_ultra:'facilities',
  vip_privacy_security:'digital', sustainability_luxury:'digital',
  guest_profiling:'guest_recovery', art_culture_curation:'guest_recovery'
};
// Averages each area's already-computed category scores (sc.catScores), skipping categories
// with no answered items (null) and any category id absent from the taxonomy above.
function computeKeyAreaScores(sc, catList){
  const sums = {};
  catList.forEach(c=>{
    const area = CAT_KEY_AREA[c.id];
    const s = sc.catScores[c.id];
    if(!area || s===null) return;
    if(!sums[area]) sums[area] = {sum:0,count:0};
    sums[area].sum += s; sums[area].count++;
  });
  const result = {};
  Object.keys(KEY_AREAS).forEach(areaId=>{
    const s = sums[areaId];
    result[areaId] = s && s.count>0 ? Math.round(s.sum/s.count) : null;
  });
  return result;
}
// Small helper for the fully-bilingual report cover: renders AR (right) + EN (left) as a
// stacked pair regardless of the app's current UI language, matching the reference design.
function bl(ar, en){ return `<span class="bl-ar">${esc(ar)}</span><span class="bl-en">${esc(en)}</span>`; }

function standardName(id){
  const s = STANDARDS[id] || STANDARDS.audit4;
  return tl(s.name);
}
function standardTagline(id){
  const s = STANDARDS[id] || STANDARDS.audit4;
  return tl(s.tagline);
}


/* ===================== USERS (org / auth) ===================== */
function defaultHotels(){
  return [
    {id:'h1', name:{en:'Al Faisaliah Hotel', ar:'فندق الفيصلية'}, city:{en:'Riyadh', ar:'الرياض'}, type:1, contact:'Faisal Al-Dossari', phone:'+966 55 123 4567'},
    {id:'h2', name:{en:'Jeddah Corniche Hilton', ar:'هيلتون كورنيش جدة'}, city:{en:'Jeddah', ar:'جدة'}, type:0, contact:'Noura Al-Zahrani', phone:'+966 55 234 5678'},
    {id:'h3', name:{en:'Diriyah Serviced Residences', ar:'مساكن الدرعية الفندقية'}, city:{en:'Riyadh', ar:'الرياض'}, type:3, contact:'Khalid Al-Mutairi', phone:'+966 55 345 6789'},
    {id:'h4', name:{en:'Red Sea Resort & Spa', ar:'منتجع البحر الأحمر والسبا'}, city:{en:'Umluj', ar:'أملج'}, type:4, contact:'Reem Al-Ghamdi', phone:'+966 55 456 7890'},
    {id:'h5', name:{en:'Al Khobar Business Suites', ar:'أجنحة الخبر التجارية'}, city:{en:'Al Khobar', ar:'الخبر'}, type:2, contact:'Yousef Al-Shehri', phone:'+966 55 567 8901'},
    {id:'h6', name:{en:'Makkah Clock Royal Tower', ar:'برج الساعة الملكي بمكة'}, city:{en:'Makkah', ar:'مكة المكرمة'}, type:1, contact:'Huda Al-Amri', phone:'+966 55 678 9012'}
  ];
}
function addDaysISO(n){ const d=new Date(); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10); }
function defaultAssignments(){
  return [
    {id:'as1', hotelId:'h1', inspectorId:'u_sara', dueDate:addDaysISO(3), status:'pending', inspectionId:null, priority:'high', standardId:'audit4', createdAt:Date.now()-2*86400000},
    {id:'as2', hotelId:'h2', inspectorId:'u_sara', dueDate:addDaysISO(10), status:'pending', inspectionId:null, priority:'normal', standardId:'audit4', createdAt:Date.now()-1*86400000},
    {id:'as3', hotelId:'h3', inspectorId:'u_omar', dueDate:addDaysISO(-1), status:'pending', inspectionId:null, priority:'high', standardId:'audit4', createdAt:Date.now()-6*86400000},
    {id:'as4', hotelId:'h4', inspectorId:'u_lama', dueDate:addDaysISO(-5), status:'completed', inspectionId:'insp_demo1', priority:'normal', standardId:'audit4', createdAt:Date.now()-9*86400000},
    {id:'as5', hotelId:'h5', inspectorId:'u_omar', dueDate:addDaysISO(6), status:'pending', inspectionId:null, priority:'normal', standardId:'audit4', createdAt:Date.now()-1*86400000},
    {id:'as6', hotelId:'h6', inspectorId:'u_lama', dueDate:addDaysISO(5), status:'pending', inspectionId:null, priority:'low', standardId:'plus5', createdAt:Date.now()}
  ];
}
function buildDemoInspection(){
  const answers = {};
  let i=0;
  CATS.forEach(cat=>{
    cat.items.forEach(item=>{
      i++;
      let val = 'yes';
      if(item.id==='h3'){ val='no'; }
      else if(i%13===0){ val='no'; }
      else if(i%19===0){ val='na'; }
      let note = '';
      if(item.id==='h3') note = 'Mold traces observed near the shower drain; maintenance flagged on-site.';
      answers[item.id] = {value:val, note};
    });
  });
  return {
    id:'insp_demo1',
    property:'Red Sea Resort & Spa',
    propertyType:PROPERTY_TYPES[4].en,
    propertyTypeLabel:PROPERTY_TYPES[4].en,
    city:'Umluj',
    inspector:'Lama Al-Otaibi',
    visitDate:addDaysISO(-5),
    ref:'RSR-2026-0142',
    hotelId:'h4',
    assignmentId:'as4',
    standardId:'audit4',
    status:'completed',
    createdAt:Date.now()-9*86400000,
    completedAt:Date.now()-5*86400000,
    answers
  };
}

/* ===================== STRINGS ===================== */
function t(key){ return (S[key] && S[key][state.lang]) || key; }
function tc(cat){ return cat[state.lang]; }
function ti(item){ return item[state.lang]; }
function tcls(code){ return CLASS_META[code][state.lang]; }
function tl(obj){ return obj ? (obj[state.lang] || obj.en || '') : ''; }
function ic(name, extra){ return `<span class="material-symbols-outlined${extra?(' '+extra):''}">${name}</span>`; }
function esc(str){
  if(str===undefined || str===null) return '';
  return String(str).replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function initials(nameObj){
  const s = (nameObj && nameObj.en) ? nameObj.en : (typeof nameObj==='string' ? nameObj : '?');
  const parts = s.trim().split(/\s+/);
  return ((parts[0]?parts[0][0]:'') + (parts[1]?parts[1][0]:'')).toUpperCase();
}

/* Password field with a show/hide eye toggle — used anywhere a password is typed, so a
   mistyped character (a real cause of "my new password doesn't work" reports) can be caught
   before submitting instead of guessed at blind. */
function pwField(id, autocomplete){
  // dir="ltr" is critical here, not cosmetic: on an RTL (Arabic) page, a plain input inherits
  // rtl direction, and the browser's bidi algorithm can reorder how Latin letters + symbols
  // (e.g. "Tho@2030*&") are actually inserted as you type — not just displayed differently, the
  // stored value itself comes out scrambled. Passwords must always be typed/stored as LTR.
  // The dir="ltr" MUST be on the wrapper div too, not just the input: the CSS uses logical
  // properties (padding-inline-end / inset-inline-end) for the eye-icon button, which flip
  // physical side based on direction. With only the input forced LTR, the wrapper stayed RTL,
  // so the icon and the input's reserved padding ended up on opposite sides — the icon flipped
  // to the wrong side and sat on top of the first character instead of clear of the text.
  return `<div class="pw-field-wrap" dir="ltr">
    <input id="${id}" type="password" style="text-align:left;" autocomplete="${autocomplete||'off'}" autocapitalize="off" autocorrect="off" spellcheck="false">
    <button type="button" class="pw-toggle-btn" onclick="togglePwVisibility('${id}', this)" tabindex="-1" title="${t('showPassword')}">${ic('visibility')}</button>
  </div>`;
}
function togglePwVisibility(id, btn){
  const input = document.getElementById(id);
  if(!input) return;
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  btn.innerHTML = ic(showing ? 'visibility' : 'visibility_off');
  btn.title = showing ? t('showPassword') : t('hidePassword');
}

/* Toast — a self-dismissing confirmation banner that renders directly into the DOM (not
   through the normal render() cycle, so it survives closeDrawer()/re-render happening right
   after it's shown). Used for success confirmations like "password changed" so the person
   gets an unmistakable, hard-to-miss confirmation rather than relying only on a native
   alert() dialog, which is easy to dismiss/miss on mobile. */
function showToast(message, kind){
  let wrap = document.getElementById('toastWrap');
  if(!wrap){
    wrap = document.createElement('div');
    wrap.id = 'toastWrap';
    wrap.className = 'toast-wrap';
    document.body.appendChild(wrap);
  }
  const el = document.createElement('div');
  el.className = 'toast' + (kind ? ' toast-' + kind : '');
  el.innerHTML = `${ic(kind==='error' ? 'error' : 'check_circle')}<span>${esc(message)}</span>`;
  wrap.appendChild(el);
  requestAnimationFrame(() => { el.classList.add('show'); });
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 3200);
}

