/* =========================================================
   출동! 인성 대원의 등원 대작전 — iPad Landscape Dashboard
   - 식단 없음 / 등원 준비·루틴·일정 전용
   - Firebase Realtime DB(rooms/<roomId>/homeState) 실시간 동기화
   ========================================================= */
(function () {
  'use strict';

  /* ---------- 상수 ---------- */
  var VERSION = 1;
  var ROOM_KEY = 'insung_home_room_v1';
  var STORE_KEY = 'insung_home_state_v1';
  var CLIENT_KEY = 'insung_home_client_v1';
  var MIN_ROOM_LEN = 12;
  var MAX_ROOM_LEN = 64;
  var DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
  var DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
  var DEFAULT_DEPART = '08:50';

  var FB_BASE = 'https://www.gstatic.com/firebasejs/11.6.0/';
  var FB_CONFIG = {
    apiKey: 'AIzaSyDNY7_-ZiyldaN0vKh_85PSgtDs1Vu-Ex4',
    authDomain: 'insungstudy-family.firebaseapp.com',
    databaseURL: 'https://insungstudy-family-default-rtdb.asia-southeast1.firebasedatabase.app',
    projectId: 'insungstudy-family',
    storageBucket: 'insungstudy-family.firebasestorage.app',
    messagingSenderId: '998917381035',
    appId: '1:998917381035:web:ee085bbf08f4272bc350ee'
  };

  var LAT = 37.526;
  var LON = 126.864;
  var WEATHER_URL = 'https://api.open-meteo.com/v1/forecast?latitude=' + LAT + '&longitude=' + LON +
    '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day' +
    '&hourly=precipitation_probability' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
    '&timezone=Asia%2FSeoul&forecast_days=1';
  var AIR_URL = 'https://air-api.open-meteo.com/v1/air-quality?latitude=' + LAT + '&longitude=' + LON +
    '&current=pm10,pm2_5&timezone=Asia%2FSeoul';

  /* ---------- 작은 도우미 ---------- */
  function byId(id) { return document.getElementById(id); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function uid(prefix) {
    return (prefix || 'x') + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
  }
  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function dict(v) { return isObj(v) ? v : {}; }
  function list(v) { return Array.isArray(v) ? v : []; }
  function text(v) { return v == null ? '' : String(v); }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  function stableStringify(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
    var keys = Object.keys(value).sort();
    return '{' + keys.map(function (k) {
      return JSON.stringify(k) + ':' + stableStringify(value[k]);
    }).join(',') + '}';
  }

  var dayFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', weekday: 'short' });
  var WD_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  var seoulFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short'
  });

  function seoulNow() {
    var parts = {};
    seoulFmt.formatToParts(new Date()).forEach(function (p) { parts[p.type] = p.value; });
    var wd = parts.weekday in WD_INDEX ? WD_INDEX[parts.weekday] : Number(dayFmt && 0);
    return {
      year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
      hour: Number(parts.hour) % 24, minute: Number(parts.minute), second: Number(parts.second),
      weekday: wd,
      dateKey: parts.year + '-' + parts.month + '-' + parts.day
    };
  }
  function todayKey() { return seoulNow().dateKey; }
  function weekdayOfKey(key) {
    var p = String(key).split('-');
    if (p.length !== 3) return 1;
    var d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
    return d.getUTCDay();
  }
  function dateKeyOffset(days) {
    var n = seoulNow();
    var d = new Date(Date.UTC(n.year, n.month - 1, n.day));
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }
  function offsetToDay(day) {
    var today = seoulNow();
    return dateKeyOffset((Number(day) - today.weekday + 7) % 7);
  }
  function shortDate(key) {
    var p = String(key).split('-');
    return Number(p[1]) + '/' + Number(p[2]);
  }

  /* ---------- 퍼피구조대 스타일 자체 SVG 강아지 ---------- */
  var DOGS = {
    chase: { name: '체이스', fur: '#F6D7A8', ear: '#8A5B34', muzzle: '#FFF3DF', hatMain: '#2F62C8', hatDark: '#1F4491' },
    marshall: { name: '마샬', fur: '#FBF3E6', ear: '#3F3F4A', muzzle: '#FFFFFF', hatMain: '#E8453C', hatDark: '#B62B24', spots: true },
    skye: { name: '스카이', fur: '#F9D6E3', ear: '#F0A9C6', muzzle: '#FFF4F9', hatMain: '#F062A0', hatDark: '#C9437C', pointy: true },
    rubble: { name: '러블', fur: '#D9B485', ear: '#8B6240', muzzle: '#F7E9D2', hatMain: '#F6C23F', hatDark: '#D9A62A' },
    rocky: { name: '로키', fur: '#B9BEC7', ear: '#7B818C', muzzle: '#F2F4F7', hatMain: '#5FA84B', hatDark: '#3E7A2E' },
    zuma: { name: '주마', fur: '#B5793F', ear: '#7A4A20', muzzle: '#EACDA8', hatMain: '#F08A2E', hatDark: '#C46818' }
  };

  function hatSVG(kind, d) {
    if (kind === 'marshall') {
      return '<path d="M18 54c0-22 19-34 42-34s42 12 42 34z" fill="' + d.hatMain + '"/>' +
        '<path d="M12 51h96c2 9-4 13-13 13H25c-9 0-15-4-13-13z" fill="' + d.hatDark + '"/>' +
        '<path d="M50 23h20v20a8 8 0 0 1-8 8h-4a8 8 0 0 1-8-8z" fill="#FFD447"/>' +
        '<path d="M60 29l1.7 3.6 4 .6-2.9 2.8.7 3.9-3.5-1.9-3.5 1.9.7-3.9-2.9-2.8 4-.6z" fill="#E8453C"/>';
    }
    if (kind === 'skye') {
      return '<path d="M24 52c0-16 16-25 36-25s36 9 36 25z" fill="' + d.hatMain + '" opacity=".92"/>' +
        '<rect x="17" y="43" width="86" height="9" rx="4.5" fill="' + d.hatDark + '"/>' +
        '<circle cx="40" cy="48" r="12" fill="#9FE3F7" stroke="' + d.hatDark + '" stroke-width="4"/>' +
        '<circle cx="80" cy="48" r="12" fill="#9FE3F7" stroke="' + d.hatDark + '" stroke-width="4"/>' +
        '<path d="M52 48h16" stroke="' + d.hatDark + '" stroke-width="4"/>' +
        '<circle cx="36.5" cy="44" r="3.4" fill="#fff" opacity=".85"/>' +
        '<circle cx="76.5" cy="44" r="3.4" fill="#fff" opacity=".85"/>';
    }
    if (kind === 'rubble') {
      return '<path d="M24 54c0-17 16-27 36-27s36 10 36 27z" fill="' + d.hatMain + '"/>' +
        '<path d="M54 26h12v28H54z" fill="' + d.hatDark + '"/>' +
        '<rect x="14" y="51" width="92" height="10" rx="5" fill="#E0A92B"/>';
    }
    if (kind === 'rocky') {
      return '<path d="M22 52c0-17 17-27 38-27s38 10 38 27z" fill="' + d.hatMain + '"/>' +
        '<path d="M60 52h44c7 0 9 7 2 10-9 4-25 5-46 5z" fill="' + d.hatDark + '"/>' +
        '<circle cx="60" cy="27" r="4.5" fill="' + d.hatDark + '"/>';
    }
    if (kind === 'zuma') {
      return '<path d="M22 52c0-19 17-30 38-30s38 11 38 30z" fill="' + d.hatMain + '"/>' +
        '<path d="M17 49h86c2 9-4 14-13 14H30c-9 0-15-5-13-14z" fill="' + d.hatDark + '"/>' +
        '<path d="M54 22h12v13H54z" fill="#FFD447"/>' +
        '<rect x="45" y="38" width="30" height="6" rx="3" fill="#FFF0C9" opacity=".9"/>';
    }
    /* chase — 파랑 경찰모 */
    return '<path d="M20 52c1-20 18-31 40-31s39 11 40 31z" fill="' + d.hatMain + '"/>' +
      '<rect x="13" y="47" width="94" height="11" rx="5.5" fill="' + d.hatDark + '"/>' +
      '<circle cx="60" cy="36" r="9.5" fill="#FFD447"/>' +
      '<path d="M60 27.8l2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8z" fill="#C9971A"/>';
  }

  function earsSVG(kind, d) {
    if (d.pointy) {
      return '<path d="M34 46 24 12 56 34Z" fill="' + d.ear + '"/>' +
        '<path d="M86 46 96 12 64 34Z" fill="' + d.ear + '"/>' +
        '<path d="M38 44 31 25 51 36Z" fill="#FFE1EE"/>' +
        '<path d="M82 44 89 25 69 36Z" fill="#FFE1EE"/>';
    }
    return '<ellipse cx="22" cy="80" rx="13" ry="25" fill="' + d.ear + '" transform="rotate(-14 22 80)"/>' +
      '<ellipse cx="98" cy="80" rx="13" ry="25" fill="' + d.ear + '" transform="rotate(14 98 80)"/>';
  }

  function dogSVG(kind, cls) {
    var d = DOGS[kind] || DOGS.chase;
    var s = '<svg class="dog ' + (cls || '') + '" viewBox="0 0 120 134" role="img" aria-label="' + d.name + '">';
    s += '<g class="bob">';
    s += earsSVG(kind, d);
    s += '<circle cx="60" cy="74" r="40" fill="' + d.fur + '"/>';
    if (kind === 'chase') {
      s += '<ellipse cx="44" cy="68" rx="15" ry="13" fill="#A9764A" opacity=".45"/>';
    }
    if (d.spots) {
      s += '<ellipse cx="30" cy="60" rx="9" ry="7" fill="#3F3F4A" opacity=".8"/>';
      s += '<ellipse cx="92" cy="77" rx="7" ry="6" fill="#3F3F4A" opacity=".75"/>';
    }
    s += '<ellipse cx="60" cy="88" rx="25" ry="17" fill="' + d.muzzle + '"/>';
    s += '<circle cx="44" cy="70" r="6.6" fill="#3B2A20"/><circle cx="76" cy="70" r="6.6" fill="#3B2A20"/>';
    s += '<circle cx="46.2" cy="67.6" r="2.3" fill="#fff"/><circle cx="78.2" cy="67.6" r="2.3" fill="#fff"/>';
    s += '<ellipse cx="60" cy="82" rx="7.6" ry="5.8" fill="#3B2A20"/>';
    s += '<path d="M60 88v4M60 92c-4 3.6-7.6 3.6-10.6 0M60 92c4 3.6 7.6 3.6 10.6 0" fill="none" stroke="#3B2A20" stroke-width="2.4" stroke-linecap="round"/>';
    s += '<ellipse cx="31" cy="85" rx="7" ry="5" fill="#FF9DB0" opacity=".4"/>';
    s += '<ellipse cx="89" cy="85" rx="7" ry="5" fill="#FF9DB0" opacity=".4"/>';
    s += hatSVG(kind, d);
    s += '<path d="M35 109c7.5 6 16.5 9 25 9s17.5-3 25-9" fill="none" stroke="' + d.hatDark + '" stroke-width="8" stroke-linecap="round"/>';
    s += '<circle cx="60" cy="121" r="7.5" fill="' + d.hatMain + '" stroke="#fff" stroke-width="2.2"/>';
    s += '<g transform="translate(56.1 117.1) scale(0.078)" fill="#fff"><use href="#pawShape"/></g>';
    s += '</g></svg>';
    return s;
  }

  /* ---------- 기본 설정값 ---------- */
  function defaultSettings() {
    return {
      departTime: DEFAULT_DEPART,
      routine: [
        { id: 'r1', emoji: '☀️', label: '기상 & 물 한 잔', dog: 'chase', cheer: '체이스: 일어날 시간이에요!' },
        { id: 'r2', emoji: '🪥', label: '세수하고 치카치카', dog: 'marshall', cheer: '마샬: 반짝반짝 씻어 볼까요?' },
        { id: 'r3', emoji: '👕', label: '오늘 날씨 옷 입기', dog: 'skye', cheer: '스카이: 날씨 보고 골라요!' },
        { id: 'r4', emoji: '🎒', label: '물통·가방 챙기기', dog: 'rubble', cheer: '러블: 준비물 하나도 빠짐없이!' },
        { id: 'r5', emoji: '👟', label: '신발 신고 출동!', dog: 'rocky', cheer: '로키: 준비 끝, 출발!' }
      ],
      prepEvery: [
        { id: 'e1', label: '물통' },
        { id: 'e2', label: '손수건' }
      ],
      prepByDay: {
        '1': [{ id: 'm1', label: '낮잠이불·수건' }],
        '2': [], '3': [], '4': [],
        '5': [{ id: 'f1', label: '하원 가방 확인' }],
        '6': [], '0': []
      },
      schedule: {
        '1': [{ id: 'k1', time: '', label: '🎒 인성 유치원 등원' }],
        '2': [
          { id: 'k2', time: '', label: '🎒 인성 유치원 등원' },
          { id: 'k3', time: '', label: '👵 인성 할머니집 저녁' },
          { id: 'k4', time: '', label: '🏊‍♀️ 엄마 저녁 수영' }
        ],
        '3': [{ id: 'k5', time: '', label: '🎒 인성 유치원 등원' }],
        '4': [
          { id: 'k6', time: '', label: '🎒 인성 유치원 등원' },
          { id: 'k7', time: '', label: '🏊‍♀️ 엄마 저녁 수영' }
        ],
        '5': [{ id: 'k8', time: '', label: '🎒 인성 유치원 등원' }],
        '6': [{ id: 'k9', time: '', label: '🏡 가족 주말 시간' }],
        '0': [{ id: 'k10', time: '', label: '🏡 가족 주말 시간' }]
      }
    };
  }

  function normalizeSettings(raw) {
    var def = defaultSettings();
    var s = isObj(raw) ? raw : {};
    var out = {
      departTime: /^\d{2}:\d{2}$/.test(text(s.departTime)) ? text(s.departTime) : def.departTime,
      routine: [],
      prepEvery: [],
      prepByDay: {},
      schedule: {}
    };
    list(s.routine).forEach(function (item, i) {
      if (!isObj(item)) return;
      var label = text(item.label).slice(0, 40);
      if (!label) return;
      out.routine.push({
        id: text(item.id) || uid('r'),
        emoji: text(item.emoji).slice(0, 4),
        label: label,
        dog: DOGS[item.dog] ? item.dog : ['chase', 'marshall', 'skye', 'rubble', 'rocky', 'zuma'][i % 6],
        cheer: text(item.cheer).slice(0, 60)
      });
    });
    if (!out.routine.length) out.routine = def.routine;
    list(s.prepEvery).forEach(function (item) {
      if (!isObj(item) || !text(item.label)) return;
      out.prepEvery.push({ id: text(item.id) || uid('e'), label: text(item.label).slice(0, 30) });
    });
    [1, 2, 3, 4, 5, 6, 0].forEach(function (day) {
      out.prepByDay[String(day)] = [];
      list(dict(s.prepByDay)[String(day)]).forEach(function (item) {
        if (!isObj(item) || !text(item.label)) return;
        out.prepByDay[String(day)].push({ id: text(item.id) || uid('d'), label: text(item.label).slice(0, 30) });
      });
      out.schedule[String(day)] = [];
      list(dict(s.schedule)[String(day)]).forEach(function (item) {
        if (!isObj(item) || !text(item.label)) return;
        out.schedule[String(day)].push({
          id: text(item.id) || uid('k'),
          time: /^\d{2}:\d{2}$/.test(text(item.time)) ? text(item.time) : '',
          label: text(item.label).slice(0, 40)
        });
      });
    });
    if (!out.prepEvery.length) out.prepEvery = def.prepEvery;
    return out;
  }

  /* ---------- 상태 ---------- */
  function newClientId() {
    var saved = '';
    try { saved = window.localStorage.getItem(CLIENT_KEY) || ''; } catch (e) { saved = ''; }
    if (saved) return saved;
    var id = 'c' + Math.random().toString(36).slice(2, 10);
    try { window.localStorage.setItem(CLIENT_KEY, id); } catch (e) { /* 무시 */ }
    return id;
  }

  var clientId = newClientId();
  var state = {
    v: VERSION,
    clientId: clientId,
    settings: { value: defaultSettings(), at: Date.now() },
    routine: {},
    prep: {},
    note: { text: '', at: 0 }
  };

  function normalizeDayMap(raw) {
    var out = {};
    var src = dict(raw);
    Object.keys(src).forEach(function (key) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return;
      var node = dict(src[key]);
      var checked = {};
      Object.keys(dict(node.checked)).forEach(function (k) {
        if (node.checked[k] === true) checked[k] = true;
      });
      out[key] = { checked: checked, at: Number(node.at) || 0 };
    });
    return out;
  }

  function normalizeState(raw) {
    var src = isObj(raw) ? raw : {};
    return {
      v: VERSION,
      clientId: text(src.clientId) || clientId,
      settings: {
        value: normalizeSettings(dict(src.settings).value),
        at: Number(dict(src.settings).at) || 0
      },
      routine: normalizeDayMap(src.routine),
      prep: normalizeDayMap(src.prep),
      note: {
        text: text(dict(src.note).text).slice(0, 160),
        at: Number(dict(src.note).at) || 0
      }
    };
  }

  function later(a, b) {
    if (!a) return b;
    if (!b) return a;
    var aa = Number(a.at) || 0;
    var ba = Number(b.at) || 0;
    if (aa !== ba) return aa > ba ? a : b;
    return stableStringify(a) >= stableStringify(b) ? a : b;
  }

  function mergeDayMaps(a, b) {
    var out = {};
    var keys = Object.keys(a).concat(Object.keys(b));
    keys.forEach(function (k) {
      if (out[k]) return;
      out[k] = later(a[k], b[k]);
    });
    return out;
  }

  function mergeState(a, b) {
    return {
      v: VERSION,
      clientId: a.clientId,
      settings: later(a.settings, b.settings),
      routine: mergeDayMaps(a.routine, b.routine),
      prep: mergeDayMaps(a.prep, b.prep),
      note: later(a.note, b.note)
    };
  }

  function loadLocal() {
    var raw = '';
    try { raw = window.localStorage.getItem(STORE_KEY) || ''; } catch (e) { raw = ''; }
    if (!raw) return;
    try {
      var parsed = JSON.parse(raw);
      var loaded = normalizeState(parsed);
      loaded.clientId = clientId;
      state = loaded;
    } catch (e) { /* 무시 */ }
  }

  var saveTimer = 0;
  function saveLocal() {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(function () {
      try { window.localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* 무시 */ }
    }, 80);
  }

  function pruneOldDays() {
    var keep = {};
    for (var i = -2; i <= 8; i++) keep[dateKeyOffset(i)] = true;
    [state.routine, state.prep].forEach(function (map) {
      Object.keys(map).forEach(function (k) { if (!keep[k]) delete map[k]; });
    });
  }

  function getSettings() { return state.settings.value; }
  function dayEntry(map, key) {
    if (!map[key]) map[key] = { checked: {}, at: 0 };
    if (!isObj(map[key].checked)) map[key].checked = {};
    return map[key];
  }

  /* ---------- 렌더: 히어로 ---------- */

  function renderHeroDogs() {
    var box = byId('heroDogs');
    if (!box) return;
    box.innerHTML = dogSVG('chase') + dogSVG('marshall') + dogSVG('skye');
  }

  function renderClock() {
    var n = seoulNow();
    var clock = byId('clock');
    var today = byId('todayLabel');
    if (clock) clock.textContent = pad2(n.hour) + ':' + pad2(n.minute) + ':' + pad2(n.second);
    if (today) {
      today.textContent = n.year + '년 ' + n.month + '월 ' + n.day + '일 (' + DAY_NAMES[n.weekday] + ')';
    }
  }

  function parseTime(str) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(text(str));
    if (!m) return 8 * 60 + 50;
    return clamp(Number(m[1]), 0, 23) * 60 + clamp(Number(m[2]), 0, 59);
  }

  function renderCountdown() {
    var n = seoulNow();
    var nowMin = n.hour * 60 + n.minute + n.second / 60;
    var departTime = getSettings().departTime || DEFAULT_DEPART;
    var depart = parseTime(departTime);
    var diff = depart - nowMin;
    var tomorrow = false;
    /* 출발 시간이 2시간 넘게 지났으면 내일 아침 출동을 가리킨다 */
    if (diff < -120) { diff += 1440; tomorrow = true; }

    var timeEl = byId('cdTime');
    var barEl = byId('cdFill');
    var badgeEl = byId('cdBadge');
    var subEl = byId('cdSub');
    var kickerEl = byId('cdKicker');
    if (!timeEl) return;

    var totalSec = Math.max(0, Math.round(diff * 60));
    var hh = Math.floor(totalSec / 3600);
    var mm = Math.floor((totalSec % 3600) / 60);
    var ss = totalSec % 60;
    if (tomorrow) {
      timeEl.textContent = hh + '시간 ' + mm + '분';
      timeEl.className = 'cd-time wide';
    } else if (diff >= 0) {
      timeEl.className = 'cd-time';
      timeEl.textContent = hh > 0
        ? hh + ':' + pad2(mm) + ':' + pad2(ss)
        : pad2(mm) + ':' + pad2(ss);
    } else {
      timeEl.className = 'cd-time';
      timeEl.textContent = '00:00';
    }
    if (kickerEl) kickerEl.textContent = tomorrow ? '내일 등원 출발까지' : '등원 출발까지';

    var pct = 0;
    if (!tomorrow) {
      var start = depart - 120;
      pct = clamp(((nowMin - start) / 120) * 100, 0, 100);
    }
    if (barEl) barEl.style.width = pct.toFixed(1) + '%';

    var total = getSettings().routine.length;
    var done = countRoutineDone();
    var badge = 'calm';
    var label = '여유 있어요';
    if (total > 0 && done >= total) {
      badge = 'done'; label = '모두 완료 🎉';
    } else if (diff <= 20) {
      badge = 'go'; label = '출동 시간!';
    } else if (diff <= 60) {
      badge = 'ready'; label = '슬슬 준비해요!';
    }
    if (badgeEl) { badgeEl.dataset.state = badge; badgeEl.textContent = label; }

    if (subEl) {
      if (tomorrow) subEl.textContent = '내일 ' + departTime + ' 출발 예정';
      else if (diff < 0) subEl.textContent = departTime + ' 출발 시간이에요';
      else subEl.textContent = departTime + ' 출발 예정 · ' + (done >= total ? '준비 끝!' : (total - done) + '단계 남았어요');
    }
  }

  function countRoutineDone() {
    var key = todayKey();
    var checked = dict((state.routine[key] || {}).checked);
    return getSettings().routine.filter(function (item) { return checked[item.id] === true; }).length;
  }

  /* ---------- 렌더: 루틴 ---------- */
  function renderRoutine() {
    var listEl = byId('routineList');
    if (!listEl) return;
    var settings = getSettings();
    var key = todayKey();
    var checked = dict((state.routine[key] || {}).checked);
    var total = settings.routine.length;
    var done = settings.routine.filter(function (i) { return checked[i.id] === true; }).length;

    listEl.innerHTML = settings.routine.map(function (item, idx) {
      var on = checked[item.id] === true;
      var dog = DOGS[item.dog] ? item.dog : ['chase', 'marshall', 'skye', 'rubble', 'rocky', 'zuma'][idx % 6];
      return '<li><button type="button" class="step" data-step="' + item.id + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
        '<span class="step-dog">' + dogSVG(dog) + '</span>' +
        '<span class="step-body">' +
        '<span class="step-label">' + (item.emoji ? item.emoji + ' ' : '') + escapeHTML(item.label) + '</span>' +
        '<span class="step-cheer">' + escapeHTML(item.cheer || '톡 눌러서 완료!') + '</span>' +
        '</span>' +
        '<span class="step-check" aria-hidden="true">✓</span>' +
        '</button></li>';
    }).join('');

    var countEl = byId('routineCount');
    if (countEl) {
      countEl.textContent = done + ' / ' + total;
      countEl.className = 'pill ' + (total > 0 && done >= total ? 'full' : 'blue');
    }
    var fill = byId('routineFill');
    if (fill) {
      fill.style.width = (total ? (done / total) * 100 : 0) + '%';
      fill.className = total > 0 && done >= total ? 'full' : '';
    }
    var foot = byId('routineFoot');
    if (foot) {
      if (total > 0 && done >= total) {
        foot.textContent = '출동 준비 완료! 인성 대원 최고예요 🐾🎉';
        foot.className = 'routine-foot done';
      } else {
        foot.textContent = '대원, 위에서부터 차례대로 톡톡 눌러 봐요!';
        foot.className = 'routine-foot';
      }
    }
    maybeCelebrate(done, total);
  }

  function escapeHTML(str) {
    return text(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------- 렌더: 준비물 ---------- */
  var prepDay = null; /* 선택한 요일(0-6). null이면 오늘 기준 */

  function prepItemsFor(dateKey) {
    var settings = getSettings();
    var day = weekdayOfKey(dateKey);
    var every = settings.prepEvery.map(function (i) { return { id: i.id, label: i.label, tag: '매일' }; });
    var daily = dict(settings.prepByDay)[String(day)] || [];
    daily.forEach(function (i) { every.push({ id: i.id, label: i.label, tag: dayLabelShort(day) }); });
    return every;
  }

  function dayLabelShort(day) { return DAY_NAMES[day] + '요일'; }

  function selectedPrepDate() {
    if (prepDay === null) return todayKey();
    return offsetToDay(prepDay);
  }

  function renderPrepTabs() {
    var el = byId('prepTabs');
    if (!el) return;
    var today = seoulNow();
    var sel = (prepDay === null ? today.weekday : prepDay);
    el.innerHTML = DAY_ORDER.map(function (d) {
      var isToday = d === today.weekday;
      return '<button type="button" data-prep-day="' + d + '" class="' + (d === sel ? 'on ' : '') + (d === 0 ? 'sun ' : (d === 6 ? 'sat ' : '')) + (isToday ? 'today' : '') + '" role="tab" aria-selected="' + (d === sel) + '">' + DAY_NAMES[d] + '</button>';
    }).join('');
  }

  function renderPrep() {
    var listEl = byId('prepList');
    if (!listEl) return;
    var date = selectedPrepDate();
    var items = prepItemsFor(date);
    var checked = dict((state.prep[date] || {}).checked);
    var done = items.filter(function (i) { return checked[i.id] === true; }).length;

    listEl.innerHTML = items.length
      ? items.map(function (item) {
        var on = checked[item.id] === true;
        return '<li><button type="button" class="check-item" data-prep-item="' + item.id + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
          '<span class="check-box" aria-hidden="true">✓</span>' +
          '<span class="label">' + escapeHTML(item.label) + '</span>' +
          '<span class="tag">' + escapeHTML(item.tag) + '</span>' +
          '</button></li>';
      }).join('')
      : '<li class="check-empty">이 날은 추가 준비물이 없어요. 매일 챙기는 것만 확인!</li>';

    var countEl = byId('prepCount');
    if (countEl) {
      countEl.textContent = done + ' / ' + items.length;
      countEl.className = 'pill ' + (items.length && done >= items.length ? 'full' : 'green');
    }
    var cap = byId('prepCaption');
    if (cap) {
      var today = todayKey();
      var offset = Math.round((new Date(date + 'T00:00:00Z') - new Date(today + 'T00:00:00Z')) / 86400000);
      var rel = offset === 0 ? '오늘' : (offset === 1 ? '내일' : dayLabelShort(weekdayOfKey(date)));
      cap.textContent = rel + ' 준비물 · ' + shortDate(date) + '(' + DAY_NAMES[weekdayOfKey(date)] + ')';
    }
  }

  /* ---------- 렌더: 일정 ---------- */
  var planDay = null;

  function renderPlanTabs() {
    var el = byId('planTabs');
    if (!el) return;
    var today = seoulNow();
    var sel = (planDay === null ? today.weekday : planDay);
    el.innerHTML = DAY_ORDER.map(function (d) {
      return '<button type="button" data-plan-day="' + d + '" class="' + (d === sel ? 'on ' : '') + (d === 0 ? 'sun ' : (d === 6 ? 'sat ' : '')) + (d === today.weekday ? 'today' : '') + '" role="tab" aria-selected="' + (d === sel) + '">' + DAY_NAMES[d] + '</button>';
    }).join('');
  }

  function renderPlan() {
    var listEl = byId('planList');
    if (!listEl) return;
    var today = seoulNow();
    var day = planDay === null ? today.weekday : planDay;
    var items = (dict(getSettings().schedule)[String(day)] || []).slice();
    var isToday = day === today.weekday;

    listEl.innerHTML = items.length
      ? items.map(function (item) {
        return '<li class="plan-item' + (isToday ? ' today-hl' : '') + '">' +
          (item.time ? '<span class="time">' + escapeHTML(item.time) + '</span>' : '') +
          '<span>' + escapeHTML(item.label) + '</span></li>';
      }).join('')
      : '<li class="plan-empty">이 날은 등록된 일정이 없어요.</li>';

    var cap = byId('planCaption');
    if (cap) {
      var rel = isToday ? '오늘' : (day === (today.weekday + 1) % 7 ? '내일' : '');
      var dateKey = offsetToDay(day);
      cap.textContent = (rel ? rel + ' 일정' : dayLabelShort(day) + ' 일정') + ' · ' + shortDate(dateKey) + '(' + DAY_NAMES[day] + ')';
    }
    var dogEl = byId('planDog');
    if (dogEl && !dogEl.innerHTML) dogEl.innerHTML = dogSVG('zuma');
    var deco = byId('planDeco');
    if (deco && !deco.innerHTML) deco.innerHTML = dogSVG('rubble') + dogSVG('rocky');
    var prepDeco = byId('prepDeco');
    if (prepDeco && !prepDeco.innerHTML) prepDeco.innerHTML = dogSVG('zuma');
  }

  /* ---------- 렌더: 메모 ---------- */
  function renderNote() {
    var el = byId('noteText');
    var timeEl = byId('noteTime');
    if (!el) return;
    var note = state.note;
    if (note && note.text) {
      el.textContent = note.text;
      el.className = 'note-text';
      if (timeEl) {
        if (note.at) {
          var d = new Date(Number(note.at));
          timeEl.textContent = '마지막 수정 ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
        } else timeEl.textContent = '';
      }
    } else {
      el.textContent = '엄마가 남긴 알림이 아직 없어요 · ✏️를 눌러 한 줄 남겨 보세요';
      el.className = 'note-text empty';
      if (timeEl) timeEl.textContent = '';
    }
  }

  /* ---------- 렌더: 동기화 배지 ---------- */
  var sync = {
    room: '', fb: null, ref: null, loading: null, path: '', fallback: false, watched: false,
    online: false, subscribed: false, lastError: '', pushTimer: 0, applying: false, writeBlocked: false
  };

  function renderSync() {
    var el = byId('syncStatus');
    if (!el) return;
    var name = !sync.room ? 'off' : ((sync.online && sync.subscribed && !sync.lastError) ? 'online' : 'wait');
    if (el.dataset.state !== name) el.dataset.state = name;
    el.textContent = name === 'online' ? '🟢 실시간 연결됨'
      : (name === 'wait' ? '🟡 연결 중·오프라인' : '⚪ 이 기기만 저장 중');
    if (settingsTab === 'sync') renderSettings('sync');
  }

  /* ---------- Firebase ---------- */
  function storedRoom() {
    try { return window.localStorage.getItem(ROOM_KEY) || ''; } catch (e) { return ''; }
  }
  function saveRoom(id) {
    try {
      if (id) window.localStorage.setItem(ROOM_KEY, id);
      else window.localStorage.removeItem(ROOM_KEY);
    } catch (e) { /* 무시 */ }
  }
  function cleanRoomId(raw) {
    if (typeof raw !== 'string') return '';
    var id = raw.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    return id.length >= MIN_ROOM_LEN ? id.slice(0, MAX_ROOM_LEN) : '';
  }
  function newRoomId() {
    var alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
    var out = 'home-';
    for (var i = 0; i < 16; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
    return out;
  }

  function loadFirebase() {
    if (!sync.loading) {
      sync.loading = Promise.all([
        import(FB_BASE + 'firebase-app.js'),
        import(FB_BASE + 'firebase-auth.js'),
        import(FB_BASE + 'firebase-database.js')
      ]).then(function (mods) {
        var app = mods[0].initializeApp(FB_CONFIG);
        return {
          app: app,
          auth: mods[1].getAuth(app),
          authApi: mods[1],
          db: mods[2].getDatabase(app),
          dbApi: mods[2]
        };
      });
      sync.loading = sync.loading.then(null, function (err) {
        sync.loading = null;
        throw err;
      });
    }
    return sync.loading;
  }

  function detachRoom() {
    if (sync.ref && sync.fb) {
      try { sync.fb.dbApi.off(sync.ref); } catch (e) { /* 무시 */ }
    }
    sync.ref = null;
    sync.subscribed = false;
    sync.lastError = '';
    window.clearTimeout(sync.pushTimer);
  }

  function connectRoom(roomId) {
    var id = cleanRoomId(roomId);
    if (!id) { toast('방 코드가 올바르지 않아요 · 가족 링크의 코드를 그대로 붙여넣어 주세요.'); return false; }
    detachRoom();
    sync.room = id;
    sync.path = '';
    sync.fallback = false;
    sync.writeBlocked = false;
    sync.online = false;
    sync.subscribed = false;
    saveRoom(id);
    renderSync();
    loadFirebase().then(function (fb) {
      sync.fb = fb;
      if (sync.room !== id) return;
      if (fb.auth.currentUser) { startRoom(id); return; }
      return fb.authApi.signInAnonymously(fb.auth).then(function () { startRoom(id); }, function () {
        if (sync.room !== id) return;
        sync.lastError = 'auth';
        renderSync();
        toast('동기화 로그인에 실패했어요. 잠시 뒤 다시 연결해 주세요.');
      });
    }).catch(function () {
      if (sync.room !== id) return;
      sync.lastError = 'load';
      renderSync();
      toast('지금은 실시간 연결을 쓸 수 없어요. 이 기기에만 저장할게요.');
    });
    return true;
  }

  function startRoom(id) {
    if (!sync.fb || sync.room !== id || sync.ref) return;
    attachRoom(id);
  }

  function roomRoot(id) { return 'rooms/' + id; }

  /* 이 Firebase 프로젝트의 보안 규칙은 방 루트(rooms/<방코드>)에 state·updatedAt·clientId
     봉투를 쓰는 방식만 허용한다(다른 가족 앱과 같음). 그래서 기본은 방 루트에 쓰고,
     루트가 막히면 rooms/<방코드>/homeState 로 한 번만 옮겨 본다. */
  function altRoomPath(id, current) {
    var root = roomRoot(id);
    return current === root ? root + '/homeState' : root;
  }

  function attachRoom(id) {
    var fb = sync.fb;
    if (!fb || sync.room !== id) return;
    var path = sync.path || roomRoot(id);
    try {
      var ref = fb.dbApi.ref(fb.db, path);
      sync.ref = ref;
      fb.dbApi.onValue(ref, function (snap) {
        if (sync.room !== id) return;
        sync.subscribed = true;
        sync.lastError = '';
        renderSync();
        onRemote(snap.val());
      }, function (err) {
        if (sync.room !== id) return;
        var code = String((err && (err.code || err.message)) || err);
        if (!sync.fallback && code.indexOf('permission') >= 0) {
          sync.fallback = true;
          sync.path = altRoomPath(id, path);
          detachRoom();
          attachRoom(id);
          return;
        }
        sync.subscribed = false;
        sync.lastError = code;
        renderSync();
        toast('이 방에는 들어갈 수 없어요. 방 코드를 확인해 주세요.');
      });
      if (!sync.watched) {
        sync.watched = true;
        try {
          var connRef = fb.dbApi.ref(fb.db, '.info/connected');
          fb.dbApi.onValue(connRef, function (snapConn) {
            sync.online = !!snapConn.val();
            renderSync();
          });
        } catch (e) { /* 무시 */ }
      }
      renderSync();
    } catch (e) { renderSync(); }
  }

  function disconnectRoom() {
    detachRoom();
    sync.room = '';
    sync.online = false;
    saveRoom('');
    renderSync();
    toast('이 기기에만 저장하도록 바꿨어요.');
  }

  function isPristine(s) {
    var anyCheck = false;
    [s.routine, s.prep].forEach(function (map) {
      Object.keys(map || {}).forEach(function (k) {
        if (Object.keys(dict(map[k].checked)).length) anyCheck = true;
      });
    });
    var noteText = text(s.note && s.note.text);
    var defStr = stableStringify(defaultSettings());
    var setStr = stableStringify(s.settings.value);
    return !anyCheck && !noteText && defStr === setStr;
  }

  function pushNow() {
    window.clearTimeout(sync.pushTimer);
    if (!sync.ref || !sync.fb || sync.writeBlocked) return;
    var payload = {
      state: {
        settings: state.settings,
        routine: state.routine,
        prep: state.prep,
        note: state.note,
        v: VERSION
      },
      updatedAt: sync.fb.dbApi.serverTimestamp(),
      clientId: clientId,
      v: VERSION
    };
    try {
      sync.fb.dbApi.set(sync.ref, payload).then(function () {
        sync.lastError = '';
        sync.writeBlocked = false;
        renderSync();
      }, function (err) {
        var code = String((err && (err.code || err.message)) || err);
        if (code.indexOf('permission') >= 0 && !sync.fallback && sync.room) {
          /* 보안 규칙이 이 경로를 막으면 같은 방의 다른 경로로 한 번만 옮긴다 */
          sync.fallback = true;
          sync.path = altRoomPath(sync.room, sync.path || roomRoot(sync.room));
          detachRoom();
          attachRoom(sync.room);
          return;
        }
        if (code.indexOf('permission') >= 0) sync.writeBlocked = true;
        sync.lastError = code;
        renderSync();
      });
    } catch (e) {
      sync.lastError = 'push';
      renderSync();
    }
  }

  function pushSoon() {
    if (!sync.ref) { saveLocal(); return; }
    window.clearTimeout(sync.pushTimer);
    sync.pushTimer = window.setTimeout(pushNow, 240);
  }

  function onRemote(raw) {
    if (!raw) {
      if (!sync.writeBlocked && !isPristine(state)) pushNow();
      return;
    }
    var remote = normalizeState(dict(raw).state);
    if (raw.clientId === clientId) return;
    sync.applying = true;
    var merged = mergeState(state, remote);
    var localChanged = stableStringify(merged) !== stableStringify(state);
    var remoteChanged = stableStringify(merged) !== stableStringify(remote);
    if (localChanged) {
      state = merged;
      pruneOldDays();
      saveLocal();
      renderAll();
      toast('🔄 다른 기기 기록과 맞췄어요');
    }
    sync.applying = false;
    if (remoteChanged) pushSoon();
  }

  /* ---------- 날씨 ---------- */
  var weatherTimer = 0;

  function wmoInfo(code, isDay) {
    var night = isDay === 0;
    var map = {
      0: { icon: night ? '🌙' : '☀️', label: night ? '맑은 밤' : '맑음' },
      1: { icon: night ? '🌙' : '🌤️', label: '대체로 맑음' },
      2: { icon: '⛅', label: '구름 조금' },
      3: { icon: '☁️', label: '흐림' },
      45: { icon: '🌫️', label: '안개' },
      48: { icon: '🌫️', label: '서리 안개' },
      51: { icon: '🌦️', label: '약한 이슬비' },
      53: { icon: '🌦️', label: '이슬비' },
      55: { icon: '🌦️', label: '진한 이슬비' },
      56: { icon: '🌧️', label: '어는 이슬비' },
      57: { icon: '🌧️', label: '어는 이슬비' },
      61: { icon: '🌧️', label: '약한 비' },
      63: { icon: '🌧️', label: '비' },
      65: { icon: '🌧️', label: '강한 비' },
      66: { icon: '🌧️', label: '어는 비' },
      67: { icon: '🌧️', label: '어는 비' },
      71: { icon: '🌨️', label: '약한 눈' },
      73: { icon: '🌨️', label: '눈' },
      75: { icon: '❄️', label: '많은 눈' },
      77: { icon: '🌨️', label: '눈알갱이' },
      80: { icon: '🌦️', label: '소나기' },
      81: { icon: '🌧️', label: '소나기' },
      82: { icon: '⛈️', label: '강한 소나기' },
      85: { icon: '🌨️', label: '눈 소나기' },
      86: { icon: '❄️', label: '눈 소나기' },
      95: { icon: '⛈️', label: '뇌우' },
      96: { icon: '⛈️', label: '우박 동반 뇌우' },
      99: { icon: '⛈️', label: '우박 동반 뇌우' }
    };
    return map[code] || { icon: night ? '🌙' : '🌤️', label: '구름 사이' };
  }

  function pmGrade(kind, value) {
    if (value == null || isNaN(value)) return null;
    var v = Number(value);
    if (kind === 'pm10') {
      if (v <= 30) return { label: '좋음', cls: 'good' };
      if (v <= 80) return { label: '보통', cls: '' };
      if (v <= 150) return { label: '나쁨', cls: 'bad' };
      return { label: '매우나쁨', cls: 'bad' };
    }
    if (v <= 15) return { label: '좋음', cls: 'good' };
    if (v <= 35) return { label: '보통', cls: '' };
    if (v <= 75) return { label: '나쁨', cls: 'bad' };
    return { label: '매우나쁨', cls: 'bad' };
  }

  function outfitTips(w) {
    var tips = [];
    var feel = w.feels != null ? Number(w.feels) : Number(w.temp);
    var code = Number(w.code);
    var isRain = (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95;
    var isSnow = (code >= 71 && code <= 77) || code === 85 || code === 86;

    if (isSnow) tips.push('❄️ 눈이 와요 · 장갑·목도리 챙겨요');
    else if (isRain || (w.pop != null && Number(w.pop) >= 50)) tips.push('☔ 비 예보! 우산 챙겨요');

    if (feel <= 0) tips.push('🧣 패딩에 목도리까지 꽁꽁');
    else if (feel <= 4) tips.push('🧥 두꺼운 외투 입어요');
    else if (feel <= 9) tips.push('🧥 따뜻한 겉옷 필수!');
    else if (feel <= 15) tips.push('🧶 얇은 겉옷 한 장');
    else if (feel <= 20) tips.push('👕 긴팔에 가벼운 겉옷');
    else if (feel <= 26) tips.push('👚 반팔에 얇은 겉옷');
    else if (feel <= 30) tips.push('🩳 시원한 옷 + 물통');
    else tips.push('🥵 아주 더워요 · 모자·물통');

    if (w.pm && w.pm.cls === 'bad') tips.push('😷 미세먼지 ' + w.pm.label + ' · 마스크');
    if (!tips.length) tips.push('🌤️ 오늘도 신나게 출동해요!');
    return tips.slice(0, 2).join(' · ');
  }

  function setWeatherError() {
    var desc = byId('wDesc');
    var tip = byId('wTip');
    var icon = byId('wIcon');
    if (icon) icon.textContent = '🌤️';
    if (desc) desc.textContent = '날씨를 못 불러왔어요';
    if (tip) tip.textContent = '🌤️ 밖을 보고 골라요 · 우산은 가방에 챙겨요';
    var temp = byId('wTemp');
    if (temp) temp.textContent = '--';
  }

  function renderWeather(w) {
    var icon = byId('wIcon');
    var temp = byId('wTemp');
    var desc = byId('wDesc');
    var tip = byId('wTip');
    var chips = byId('wChips');

    if (icon) icon.textContent = w.icon;
    if (temp) temp.textContent = Math.round(w.temp);
    if (desc) desc.textContent = '목동 ' + w.label + ' · 체감 ' + Math.round(w.feels) + '°';

    var chipHTML = '';
    chipHTML += '<li class="w-chip">체감 <b>' + Math.round(w.feels) + '°</b></li>';
    chipHTML += '<li class="w-chip">최저·최고 <b>' + Math.round(w.tmin) + '° / ' + Math.round(w.tmax) + '°</b></li>';
    chipHTML += '<li class="w-chip">강수 <b>' + (w.pop == null ? '–' : Math.round(w.pop) + '%') + '</b></li>';
    if (w.pm) {
      chipHTML += '<li class="w-chip ' + w.pm.cls + '">미세먼지 <b>' + w.pm.label + '</b></li>';
    } else {
      chipHTML += '<li class="w-chip">미세먼지 <b>–</b></li>';
    }
    if (chips) chips.innerHTML = chipHTML;
    if (tip) tip.textContent = outfitTips(w);
  }

  function loadWeather() {
    var n = seoulNow();
    var weatherController = window.AbortController ? new AbortController() : null;
    var abortTimer = weatherController ? window.setTimeout(function () {
      try { weatherController.abort(); } catch (e) { /* 무시 */ }
    }, 9000) : 0;
    var airPromise = fetch(AIR_URL, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('air ' + r.status);
      return r.json();
    }).catch(function () { return null; });

    fetch(WEATHER_URL, { cache: 'no-store', signal: weatherController ? weatherController.signal : undefined }).then(function (r) {
      if (!r.ok) throw new Error('weather ' + r.status);
      return r.json();
    }).then(function (data) {
      var cur = dict(data.current);
      var daily = dict(data.daily);
      var hourly = dict(data.hourly);
      var hourList = list(hourly.time);
      var popList = list(hourly.precipitation_probability);
      var idx = 0;
      for (var i = 0; i < hourList.length; i++) {
        if (String(hourList[i]).slice(11, 13) === pad2(n.hour) && String(hourList[i]).slice(0, 10) === n.dateKey) { idx = i; break; }
      }
      var pop = popList[idx] != null ? popList[idx] : (list(daily.precipitation_probability_max)[0]);
      var info = wmoInfo(Number(cur.weather_code), Number(cur.is_day));
      var tempNow = Number(cur.temperature_2m);
      var tmin = Number(list(daily.temperature_2m_min)[0]);
      var tmax = Number(list(daily.temperature_2m_max)[0]);
      var weather = {
        temp: tempNow,
        feels: isFinite(Number(cur.apparent_temperature)) ? Number(cur.apparent_temperature) : tempNow,
        code: Number(cur.weather_code),
        tmin: isFinite(tmin) ? tmin : tempNow,
        tmax: isFinite(tmax) ? tmax : tempNow,
        pop: pop,
        icon: info.icon,
        label: info.label,
        pm: null
      };
      if (!isFinite(weather.temp)) throw new Error('bad temp');
      return airPromise.then(function (air) {
        if (air && air.current) {
          var a = air.current;
          var g10 = pmGrade('pm10', a.pm10);
          var g25 = pmGrade('pm25', a.pm2_5);
          weather.pm10 = a.pm10;
          weather.pm25 = a.pm2_5;
          var severe = { '좋음': 1, '보통': 2, '나쁨': 3, '매우나쁨': 4 };
          if (g10 && g25) weather.pm = (severe[g25.label] >= severe[g10.label] ? g25 : g10);
          else weather.pm = g25 || g10;
        }
        renderWeather(weather);
        window.clearTimeout(abortTimer);
      });
    }).catch(function () {
      window.clearTimeout(abortTimer);
      setWeatherError();
    });
  }

  /* ---------- 렌더 전체 ---------- */
  function renderAll() {
    renderClock();
    renderCountdown();
    renderRoutine();
    renderPrepTabs();
    renderPrep();
    renderPlanTabs();
    renderPlan();
    renderNote();
    renderSync();
  }

  /* ---------- 축하 ---------- */
  var wasComplete = false;
  var firstRender = true;
  function maybeCelebrate(done, total) {
    var complete = total > 0 && done >= total;
    if (firstRender) {          /* 이미 다 되어 있는 상태로 열었을 땐 팝업 없이 */
      firstRender = false;
      wasComplete = complete;
      return;
    }
    if (complete && !wasComplete) openCelebrate(total);
    wasComplete = complete;
  }

  function openCelebrate(total) {
    var dogs = byId('celebrateDogs');
    if (dogs) dogs.innerHTML = dogSVG('chase') + dogSVG('marshall') + dogSVG('skye');
    var sub = byId('celebrateSub');
    if (sub) sub.textContent = total + '단계를 모두 해냈어요. 이제 신나게 출발!';
    var modal = byId('celebrateModal');
    if (modal) modal.hidden = false;
    confetti();
  }

  function confetti() {
    var layer = byId('confetti');
    if (!layer) return;
    var colors = ['#FF6B6B', '#FFC93C', '#4ECB71', '#4C9AFF', '#F062A0', '#F08A2E', '#9B7BFF'];
    var frag = document.createDocumentFragment();
    for (var i = 0; i < 70; i++) {
      var piece = document.createElement('i');
      var size = 6 + Math.random() * 7;
      piece.style.left = (Math.random() * 100).toFixed(2) + '%';
      piece.style.width = size.toFixed(0) + 'px';
      piece.style.height = (size * 1.4).toFixed(0) + 'px';
      piece.style.background = colors[Math.floor(Math.random() * colors.length)];
      piece.style.animationDuration = (2.1 + Math.random() * 1.6).toFixed(2) + 's';
      piece.style.animationDelay = (Math.random() * .5).toFixed(2) + 's';
      piece.style.transform = 'rotate(' + Math.floor(Math.random() * 360) + 'deg)';
      frag.appendChild(piece);
    }
    layer.innerHTML = '';
    layer.appendChild(frag);
    window.setTimeout(function () { layer.innerHTML = ''; }, 4200);
  }

  /* ---------- 토스트 ---------- */
  var toastTimer = 0;
  function toast(msg) {
    var el = byId('toast');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () { el.hidden = true; }, 2600);
  }

  /* ---------- 상호작용 ---------- */
  function toggleRoutine(id) {
    var key = todayKey();
    var entry = dayEntry(state.routine, key);
    if (entry.checked[id]) delete entry.checked[id];
    else entry.checked[id] = true;
    entry.at = Date.now();
    saveLocal();
    pushSoon();
    renderRoutine();
    renderCountdown();
  }

  function togglePrep(dateKey, id) {
    var entry = dayEntry(state.prep, dateKey);
    if (entry.checked[id]) delete entry.checked[id];
    else entry.checked[id] = true;
    entry.at = Date.now();
    saveLocal();
    pushSoon();
    renderPrep();
    renderCountdown();
  }

  function updateNote(value) {
    var v = text(value).trim().slice(0, 160);
    if (v === state.note.text) { closeNoteModal(); return; }
    state.note = { text: v, at: Date.now() };
    saveLocal();
    pushSoon();
    renderNote();
    closeNoteModal();
    toast(v ? '📌 알림을 저장했어요' : '알림을 지웠어요');
  }

  /* ---------- 설정 ---------- */
  var settingsTab = 'basic';
  var prepEditDay = 'every';
  var planEditDay = '1';

  function openSettings(tab) {
    var modal = byId('settingsModal');
    if (!modal) return;
    settingsTab = tab || 'basic';
    modal.hidden = false;
    renderSettings(settingsTab);
  }
  function closeSettings() {
    var modal = byId('settingsModal');
    if (modal) modal.hidden = true;
  }

  function touchSettings() {
    state.settings.at = Date.now();
    saveLocal();
    pushSoon();
    renderRoutine();
    renderPrep();
    renderPlan();
    renderCountdown();
  }

  function dogOptions(selected) {
    return Object.keys(DOGS).map(function (k) {
      return '<option value="' + k + '"' + (k === selected ? ' selected' : '') + '>' + DOGS[k].name + '</option>';
    }).join('');
  }

  function renderSettings(tab) {
    var body = byId('settingsBody');
    if (!body) return;
    settingsTab = tab;
    document.querySelectorAll('.set-tab').forEach(function (btn) {
      btn.classList.toggle('on', btn.dataset.tab === tab);
    });
    var s = getSettings();

    if (tab === 'basic') {
      body.innerHTML =
        '<div class="field">' +
          '<label class="field-label" for="departInput">등원 출발 목표 시간</label>' +
          '<div class="field-row">' +
            '<input type="time" id="departInput" value="' + escapeHTML(s.departTime) + '" />' +
            '<span class="set-hint">이 시간까지 카운트다운이 돌아가요.</span>' +
          '</div>' +
        '</div>' +
        '<div class="field">' +
          '<p class="field-label">오늘 체크 다시 하기</p>' +
          '<div class="field-row">' +
            '<button type="button" class="danger-btn" id="resetToday">오늘 루틴·준비물 체크 모두 지우기</button>' +
          '</div>' +
          '<p class="set-hint" style="margin-top:6px">내일 아침엔 날짜가 바뀌면서 저절로 초기화돼요. 설정·준비물 목록은 그대로 남아요.</p>' +
        '</div>' +
        '<div class="info-box">아이패드에서 <b>홈 화면에 추가</b>해 두면 앱처럼 전체 화면으로 열려요. ' +
        '가족 링크를 엄마·아빠 폰에도 열어 두면 체크와 알림이 1초 안에 함께 반영돼요.</div>';
      var depart = byId('departInput');
      if (depart) {
        depart.addEventListener('change', function () {
          var v = this.value || DEFAULT_DEPART;
          s.departTime = v;
          touchSettings();
          toast('출발 시간을 ' + v + '로 바꿨어요');
        });
      }
      var reset = byId('resetToday');
      if (reset) {
        reset.addEventListener('click', function () {
          var key = todayKey();
          state.routine[key] = { checked: {}, at: Date.now() };
          state.prep[key] = { checked: {}, at: Date.now() };
          saveLocal(); pushSoon(); renderAll();
          toast('오늘 체크를 모두 지웠어요');
        });
      }
      return;
    }

    if (tab === 'routine') {
      body.innerHTML =
        '<p class="field-label">아침 루틴 단계 · 아이패드에 큰 카드로 보여요</p>' +
        '<div class="row-list" id="routineRows">' + s.routine.map(function (item, i) {
          return '<div class="edit-row" data-row="' + item.id + '">' +
            '<input type="text" class="emoji-input" data-field="emoji" data-id="' + item.id + '" value="' + escapeHTML(item.emoji) + '" maxlength="4" aria-label="' + (i + 1) + '단계 이모지" />' +
            '<input type="text" class="text-input grow" data-field="label" data-id="' + item.id + '" value="' + escapeHTML(item.label) + '" maxlength="40" aria-label="' + (i + 1) + '단계 이름" />' +
            '<select class="small-select" data-field="dog" data-id="' + item.id + '" aria-label="' + (i + 1) + '단계 캐릭터">' + dogOptions(item.dog) + '</select>' +
            '<button type="button" class="del" data-del-routine="' + item.id + '" aria-label="단계 삭제">✕</button>' +
            '<input type="text" class="text-input grow" data-field="cheer" data-id="' + item.id + '" value="' + escapeHTML(item.cheer) + '" maxlength="60" placeholder="응원 한마디" style="flex:1 1 100%" aria-label="' + (i + 1) + '단계 응원 문구" />' +
            '</div>';
        }).join('') + '</div>' +
        '<div class="add-row">' +
          '<input type="text" id="newRoutine" class="text-input" placeholder="예) 🧴 선크림 바르기" maxlength="40" />' +
          '<button type="button" class="primary-btn" id="addRoutine">추가</button>' +
        '</div>';
      bindRoutineEditor();
      return;
    }

    if (tab === 'prep') {
      var dayKeys = ['every', '1', '2', '3', '4', '5', '6', '0'];
      var items = prepEditDay === 'every' ? s.prepEvery : (dict(s.prepByDay)[prepEditDay] || []);
      body.innerHTML =
        '<p class="field-label">요일별 준비물 · 매일 챙기는 것과 요일마다 챙기는 것</p>' +
        '<div class="sub-tabs" id="prepSubTabs">' + dayKeys.map(function (d) {
          var label = d === 'every' ? '매일' : DAY_NAMES[Number(d)];
          return '<button type="button" data-prep-edit="' + d + '" class="' + (prepEditDay === d ? 'on' : '') + '">' + label + '</button>';
        }).join('') + '</div>' +
        '<div class="row-list" id="prepRows">' + items.map(function (item) {
          return '<div class="edit-row" data-row="' + item.id + '">' +
            '<input type="text" class="text-input grow" data-prep-field="label" data-id="' + item.id + '" value="' + escapeHTML(item.label) + '" maxlength="30" />' +
            '<button type="button" class="del" data-del-prep="' + item.id + '">✕</button>' +
            '</div>';
        }).join('') + (items.length ? '' : '<p class="set-hint">이 날은 추가 준비물이 없어요.</p>') + '</div>' +
        '<div class="add-row">' +
          '<input type="text" id="newPrep" class="text-input" placeholder="예) 수영가방" maxlength="30" />' +
          '<button type="button" class="primary-btn" id="addPrep">추가</button>' +
        '</div>';
      bindPrepEditor();
      return;
    }

    if (tab === 'plan') {
      var days = ['1', '2', '3', '4', '5', '6', '0'];
      var dayItems = dict(s.schedule)[planEditDay] || [];
      body.innerHTML =
        '<p class="field-label">요일별 가족 일정 · 이 화면 오른쪽에 자동으로 보여요</p>' +
        '<div class="sub-tabs" id="planSubTabs">' + days.map(function (d) {
          return '<button type="button" data-plan-edit="' + d + '" class="' + (planEditDay === d ? 'on' : '') + '">' + DAY_NAMES[Number(d)] + '</button>';
        }).join('') + '</div>' +
        '<div class="row-list" id="planRows">' + dayItems.map(function (item) {
          return '<div class="edit-row" data-row="' + item.id + '">' +
            '<input type="time" class="small-select" data-plan-field="time" data-id="' + item.id + '" value="' + escapeHTML(item.time) + '" aria-label="일정 시간" />' +
            '<input type="text" class="text-input grow" data-plan-field="label" data-id="' + item.id + '" value="' + escapeHTML(item.label) + '" maxlength="40" />' +
            '<button type="button" class="del" data-del-plan="' + item.id + '">✕</button>' +
            '</div>';
        }).join('') + (dayItems.length ? '' : '<p class="set-hint">이 날은 등록된 일정이 없어요.</p>') + '</div>' +
        '<div class="add-row">' +
          '<input type="text" id="newPlan" class="text-input" placeholder="예) 🎨 미술학원" maxlength="40" />' +
          '<button type="button" class="primary-btn" id="addPlan">추가</button>' +
        '</div>';
      bindPlanEditor();
      return;
    }

    /* sync */
    body.innerHTML =
      '<div class="info-box" style="margin-bottom:12px">' +
        '가족 방 코드로 엄마 폰·아빠 폰·아이패드가 같은 화면을 봐요. ' +
        '체크와 알림은 <b>1초 안에</b> 서로 반영되고, 방 코드는 이 브라우저에만 저장돼요.' +
      '</div>' +
      '<div class="field">' +
        '<label class="field-label" for="roomInput">가족 방 코드</label>' +
        '<div class="room-row">' +
          '<input type="text" id="roomInput" value="' + escapeHTML(sync.room) + '" placeholder="home-xxxxxxxxxxxxxxxx" maxlength="64" />' +
          '<button type="button" class="primary-btn" id="roomConnect">연결</button>' +
        '</div>' +
        '<div class="btn-row">' +
          '<button type="button" class="ghost-btn" id="roomNew">새 방 만들기</button>' +
          '<button type="button" class="ghost-btn" id="roomCopy">🔗 가족 링크 복사</button>' +
          '<button type="button" class="ghost-btn" id="roomOff">연결 해제</button>' +
        '</div>' +
      '</div>' +
      '<div class="field">' +
        '<p class="field-label">현재 상태</p>' +
        '<div class="info-box" id="syncInfo">' + syncInfoText() + '</div>' +
      '</div>';
    var connectBtn = byId('roomConnect');
    if (connectBtn) {
      connectBtn.addEventListener('click', function () {
        var input = byId('roomInput');
        var id = cleanRoomId(input ? input.value : '');
        if (!id) { toast('방 코드는 영문·숫자 12자 이상이에요.'); return; }
        connectRoom(id);
        toast('실시간 연결을 시작했어요');
        renderSettings('sync');
      });
    }
    var newBtn = byId('roomNew');
    if (newBtn) {
      newBtn.addEventListener('click', function () {
        var id = newRoomId();
        connectRoom(id);
        renderSettings('sync');
        toast('새 가족 방을 만들었어요 · 가족 링크를 복사해 폰에 열어 주세요');
      });
    }
    var copyBtn = byId('roomCopy');
    if (copyBtn) copyBtn.addEventListener('click', copyFamilyLink);
    var offBtn = byId('roomOff');
    if (offBtn) {
      offBtn.addEventListener('click', function () {
        disconnectRoom();
        renderSettings('sync');
      });
    }
  }

  function syncInfoText() {
    if (!sync.room) return '⚪ 지금은 이 기기에만 저장하고 있어요. <b>새 방 만들기</b>를 누르면 가족 링크가 생겨요.';
    if (sync.online && sync.subscribed && !sync.lastError) {
      return '🟢 실시간 연결됨 · 방 코드 <b>' + escapeHTML(sync.room) + '</b><br/>다른 기기와 체크·알림이 함께 반영돼요.';
    }
    return '🟡 연결 중이에요 · 방 코드 <b>' + escapeHTML(sync.room) + '</b><br/>네트워크가 느리거나 오프라인이면 이 기기에 먼저 저장해 두고 다시 맞춰요.';
  }

  function bindRoutineEditor() {
    var s = getSettings();
    document.querySelectorAll('#routineRows [data-field]').forEach(function (input) {
      input.addEventListener('input', function () {
        var id = this.dataset.id;
        var field = this.dataset.field;
        var item = s.routine.filter(function (i) { return i.id === id; })[0];
        if (!item) return;
        item[field] = this.value;
        touchSettings();
      });
      if (input.tagName === 'SELECT') {
        input.addEventListener('change', function () {
          var item = s.routine.filter(function (i) { return i.id === this.dataset.id; }.bind(this))[0];
          if (item) { item.dog = this.value; touchSettings(); }
        });
      }
    });
    document.querySelectorAll('[data-del-routine]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (s.routine.length <= 1) { toast('루틴은 한 단계 이상 있어야 해요.'); return; }
        var id = this.dataset.delRoutine;
        s.routine = s.routine.filter(function (i) { return i.id !== id; });
        touchSettings();
        renderSettings('routine');
      });
    });
    var add = byId('addRoutine');
    if (add) {
      add.addEventListener('click', function () {
        var input = byId('newRoutine');
        var raw = text(input ? input.value : '').trim();
        if (!raw) return;
        s.routine.push({
          id: uid('r'),
          emoji: '',
          label: raw.replace(/^[^\w가-힣]+\s*/, '').slice(0, 40) || raw.slice(0, 40),
          dog: ['chase', 'marshall', 'skye', 'rubble', 'rocky', 'zuma'][s.routine.length % 6],
          cheer: ''
        });
        touchSettings();
        renderSettings('routine');
        toast('루틴 단계를 추가했어요');
      });
    }
  }

  function bindPrepEditor() {
    var s = getSettings();
    document.querySelectorAll('[data-prep-edit]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        prepEditDay = this.dataset.prepEdit;
        renderSettings('prep');
      });
    });
    document.querySelectorAll('#prepRows [data-prep-field]').forEach(function (input) {
      input.addEventListener('input', function () {
        var id = this.dataset.id;
        var arr = prepEditDay === 'every' ? s.prepEvery : (dict(s.prepByDay)[prepEditDay] || []);
        var item = arr.filter(function (i) { return i.id === id; })[0];
        if (item) { item.label = this.value; touchSettings(); }
      });
    });
    document.querySelectorAll('[data-del-prep]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = this.dataset.delPrep;
        if (prepEditDay === 'every') s.prepEvery = s.prepEvery.filter(function (i) { return i.id !== id; });
        else s.prepByDay[prepEditDay] = (dict(s.prepByDay)[prepEditDay] || []).filter(function (i) { return i.id !== id; });
        touchSettings();
        renderSettings('prep');
      });
    });
    var add = byId('addPrep');
    if (add) {
      add.addEventListener('click', function () {
        var input = byId('newPrep');
        var raw = text(input ? input.value : '').trim();
        if (!raw) return;
        var item = { id: uid('p'), label: raw.slice(0, 30) };
        if (prepEditDay === 'every') s.prepEvery.push(item);
        else {
          if (!s.prepByDay[prepEditDay]) s.prepByDay[prepEditDay] = [];
          s.prepByDay[prepEditDay].push(item);
        }
        touchSettings();
        renderSettings('prep');
      });
    }
  }

  function bindPlanEditor() {
    var s = getSettings();
    document.querySelectorAll('[data-plan-edit]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        planEditDay = this.dataset.planEdit;
        renderSettings('plan');
      });
    });
    document.querySelectorAll('#planRows [data-plan-field]').forEach(function (input) {
      input.addEventListener('input', function () {
        var id = this.dataset.id;
        var arr = dict(s.schedule)[planEditDay] || [];
        var item = arr.filter(function (i) { return i.id === id; })[0];
        if (item) { item[this.dataset.planField] = this.value; touchSettings(); }
      });
      input.addEventListener('change', function () {
        var id = this.dataset.id;
        var arr = dict(s.schedule)[planEditDay] || [];
        var item = arr.filter(function (i) { return i.id === id; })[0];
        if (item) { item[this.dataset.planField] = this.value; touchSettings(); }
      });
    });
    document.querySelectorAll('[data-del-plan]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = this.dataset.delPlan;
        s.schedule[planEditDay] = (dict(s.schedule)[planEditDay] || []).filter(function (i) { return i.id !== id; });
        touchSettings();
        renderSettings('plan');
      });
    });
    var add = byId('addPlan');
    if (add) {
      add.addEventListener('click', function () {
        var input = byId('newPlan');
        var raw = text(input ? input.value : '').trim();
        if (!raw) return;
        if (!s.schedule[planEditDay]) s.schedule[planEditDay] = [];
        s.schedule[planEditDay].push({ id: uid('k'), time: '', label: raw.slice(0, 40) });
        touchSettings();
        renderSettings('plan');
      });
    }
  }

  /* ---------- 메모 모달 ---------- */
  function openNoteModal() {
    var modal = byId('noteModal');
    var input = byId('noteInput');
    if (input) input.value = state.note.text || '';
    if (modal) modal.hidden = false;
    if (input) window.setTimeout(function () { input.focus(); }, 60);
  }
  function closeNoteModal() {
    var modal = byId('noteModal');
    if (modal) modal.hidden = true;
  }

  /* ---------- 가족 링크 ---------- */
  function familyLink() {
    var room = sync.room || '';
    var base = location.origin + location.pathname;
    return room ? base + '?room=' + encodeURIComponent(room) : base;
  }

  function copyText(str) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(str).then(function () { return true; }, function () { return fallbackCopy(str); });
    }
    return Promise.resolve(fallbackCopy(str));
  }
  function fallbackCopy(str) {
    try {
      var ta = document.createElement('textarea');
      ta.value = str;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch (e) { return false; }
  }

  function copyFamilyLink() {
    if (!sync.room) {
      var id = newRoomId();
      connectRoom(id);
      window.setTimeout(function () {
        copyText(familyLink()).then(function (ok) {
          toast(ok ? '🔗 가족 링크를 복사했어요 · 폰에 붙여넣어 주세요' : '링크: ' + familyLink());
        });
      }, 400);
      return;
    }
    copyText(familyLink()).then(function (ok) {
      toast(ok ? '🔗 가족 링크를 복사했어요' : '링크: ' + familyLink());
    });
  }

  /* ---------- 이벤트 연결 ---------- */
  function bindEvents() {
    var routineList = byId('routineList');
    if (routineList) {
      routineList.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-step]');
        if (!btn) return;
        toggleRoutine(btn.dataset.step);
      });
    }

    var prepList = byId('prepList');
    if (prepList) {
      prepList.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-prep-item]');
        if (!btn) return;
        togglePrep(selectedPrepDate(), btn.dataset.prepItem);
      });
    }

    var prepTabs = byId('prepTabs');
    if (prepTabs) {
      prepTabs.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-prep-day]');
        if (!btn) return;
        prepDay = Number(btn.dataset.prepDay);
        renderPrepTabs();
        renderPrep();
      });
    }

    var planTabs = byId('planTabs');
    if (planTabs) {
      planTabs.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-plan-day]');
        if (!btn) return;
        planDay = Number(btn.dataset.planDay);
        renderPlanTabs();
        renderPlan();
      });
    }

    var noteEdit = byId('noteEdit');
    if (noteEdit) noteEdit.addEventListener('click', openNoteModal);
    var noteClose = byId('noteClose');
    if (noteClose) noteClose.addEventListener('click', closeNoteModal);
    var noteSave = byId('noteSave');
    if (noteSave) {
      noteSave.addEventListener('click', function () {
        var input = byId('noteInput');
        updateNote(input ? input.value : '');
      });
    }
    var noteClear = byId('noteClear');
    if (noteClear) noteClear.addEventListener('click', function () { updateNote(''); });
    document.querySelectorAll('[data-quick]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var input = byId('noteInput');
        if (input) { input.value = this.dataset.quick; input.focus(); }
      });
    });

    var openBtn = byId('openSettings');
    if (openBtn) openBtn.addEventListener('click', function () { openSettings('basic'); });
    var syncBadge = byId('syncStatus');
    if (syncBadge) {
      syncBadge.addEventListener('click', function () {
        openSettings(sync.room ? 'sync' : 'sync');
      });
    }
    var copyBtn = byId('copyLink');
    if (copyBtn) copyBtn.addEventListener('click', copyFamilyLink);

    var settingsClose = byId('settingsClose');
    if (settingsClose) settingsClose.addEventListener('click', closeSettings);
    var settingsDone = byId('settingsDone');
    if (settingsDone) settingsDone.addEventListener('click', closeSettings);
    document.querySelectorAll('.set-tab').forEach(function (btn) {
      btn.addEventListener('click', function () { renderSettings(this.dataset.tab); });
    });

    var celebrateClose = byId('celebrateClose');
    if (celebrateClose) {
      celebrateClose.addEventListener('click', function () {
        var modal = byId('celebrateModal');
        if (modal) modal.hidden = true;
      });
    }

    [byId('settingsModal'), byId('noteModal')].forEach(function (modal) {
      if (!modal) return;
      modal.addEventListener('click', function (e) {
        if (e.target === modal) modal.hidden = true;
      });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      ['settingsModal', 'noteModal', 'celebrateModal'].forEach(function (id) {
        var m = byId(id);
        if (m && !m.hidden) m.hidden = true;
      });
    });

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) return;
      checkRollover();
      renderClock();
      renderCountdown();
    });

    window.addEventListener('online', function () { if (sync.room && !sync.ref && sync.fb) startRoom(sync.room); renderSync(); });
    window.addEventListener('offline', function () { sync.online = false; renderSync(); });
  }

  /* ---------- 날짜 넘김 ---------- */
  var currentDay = todayKey();
  function checkRollover() {
    var key = todayKey();
    if (key === currentDay) return;
    currentDay = key;
    prepDay = null;
    planDay = null;
    pruneOldDays();
    saveLocal();
    renderAll();
    loadWeather();
    toast('새 아침이에요! 오늘 루틴을 새로 시작해요 ☀️');
  }

  /* ---------- 시작 ---------- */
  function boot() {
    loadLocal();
    pruneOldDays();
    renderHeroDogs();
    bindEvents();

    var urlRoom = '';
    try { urlRoom = new URLSearchParams(location.search).get('room') || ''; } catch (e) { urlRoom = ''; }
    var room = cleanRoomId(urlRoom) || storedRoom();
    if (room) {
      sync.room = room;
      saveRoom(room);
      loadFirebase().then(function (fb) {
        sync.fb = fb;
        if (fb.auth.currentUser) { startRoom(room); return; }
        return fb.authApi.signInAnonymously(fb.auth).then(function () { startRoom(room); });
      }).catch(function () { sync.lastError = 'load'; renderSync(); });
    }

    renderAll();
    loadWeather();
    window.setInterval(function () {
      renderClock();
      renderCountdown();
    }, 1000);
    window.setInterval(checkRollover, 20000);
    window.setInterval(loadWeather, 15 * 60 * 1000);

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { renderClock(); });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
