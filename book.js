#!/usr/bin/env node
/**
 * 台鐵訂票 CLI(測試模式 / 模擬)
 *
 * 限制:每次只訂 1 張票、不處理付款流程(僅產生訂位代號)。
 *
 * 用法:
 *   node book.js --from 台北 --to 高雄 --date 2026-05-10
 *   node book.js --from 台北 --to 花蓮 --date 2026-05-10 --at "2026-05-09 00:00:00"
 *   node book.js --config job.json
 *
 * 參數:
 *   --from        起站(必填)
 *   --to          訖站(必填)
 *   --date        乘車日期 YYYY-MM-DD(必填)
 *   --time        最早出發時間 HH:MM(預設 06:00)
 *   --train       對號車種篩選 1=自強類 2=莒光(預設全部對號車)
 *   --train-no    指定要訂的車次號碼,例:--train-no 117
 *   --at          排程時間 YYYY-MM-DD HH:MM[:SS](預設立即執行)
 *   --retry       最大重試次數(預設 12)
 *   --interval    重試間隔毫秒(預設 5000)
 *   --query       只查詢車次列表,不訂票
 *   --config      從 JSON 檔讀參數
 *
 * 環境變數(--query 才會用到):
 *   TDX_CLIENT_ID      TDX 帳號的 client id
 *   TDX_CLIENT_SECRET  TDX 帳號的 client secret
 *   有設定 → 用 TDX 真實時刻表 API;沒設定 → 退回隨機模擬資料。
 *   免費註冊:https://tdx.transportdata.tw/
 *
 * 注意:訂票流程仍為模擬器,以隨機邏輯產生訂位結果、不會實際付款,
 *       也未串接台鐵 e 訂通(訂票需 CAPTCHA,自動化違反其 ToS)。
 */

const fs = require('fs');
const path = require('path');

const STATIONS = [
  '基隆','七堵','八堵','南港','松山','台北','萬華','板橋','樹林','鶯歌',
  '桃園','中壢','新竹','竹南','苗栗','豐原','台中','彰化','員林','斗六',
  '嘉義','新營','台南','岡山','高雄','屏東','潮州','枋寮','台東','花蓮',
  '羅東','宜蘭','蘇澳'
];
const STATION_KM = Object.fromEntries(STATIONS.map((s, i) => [s, i * 22]));

// 僅對號車種(可劃位):自強 / 太魯閣 / 普悠瑪 / 莒光
const TRAIN_TYPES = [
  { id: 1, name: '自強號',   rate: 2.27, speed: 1.0  },
  { id: 1, name: '太魯閣號', rate: 2.27, speed: 0.95 },
  { id: 1, name: '普悠瑪號', rate: 2.27, speed: 0.95 },
  { id: 2, name: '莒光號',   rate: 1.75, speed: 1.3  }
];

const TICKETS_FILE = path.join(__dirname, 'tickets.json');
const LOG_FILE     = path.join(__dirname, 'book.log');

// === TDX 真實 API ===
const TDX_AUTH_URL = 'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token';
const TDX_API_BASE = 'https://tdx.transportdata.tw/api/basic/v3/Rail/TRA';

// 車站名稱 → 台鐵車站代碼(TDX StationID)
const STATION_ID = {
  '基隆':'0900','七堵':'0930','八堵':'0940','南港':'0980','松山':'0990',
  '台北':'1000','萬華':'1010','板橋':'1020','樹林':'1040','鶯歌':'1070',
  '桃園':'1080','中壢':'1100','新竹':'1210','竹南':'1250','苗栗':'3160',
  '豐原':'3270','台中':'3300','彰化':'3360','員林':'3390','斗六':'3470',
  '嘉義':'4080','新營':'4150','台南':'4220','岡山':'4290','高雄':'4400',
  '屏東':'5000','潮州':'5050','枋寮':'5160','台東':'7330','花蓮':'7000',
  '羅東':'7080','宜蘭':'7110','蘇澳':'7150'
};

let _tokenCache = null;
async function getTdxToken() {
  if (_tokenCache && _tokenCache.expiresAt > Date.now()) return _tokenCache.token;
  const id = process.env.TDX_CLIENT_ID, secret = process.env.TDX_CLIENT_SECRET;
  if (!id || !secret) throw new Error('未設定 TDX_CLIENT_ID / TDX_CLIENT_SECRET 環境變數');
  const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret });
  const res = await fetch(TDX_AUTH_URL, {
    method: 'POST', body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });
  if (!res.ok) throw new Error(`TDX 認證失敗 ${res.status}:${(await res.text()).slice(0,200)}`);
  const data = await res.json();
  _tokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return data.access_token;
}

async function tdxFetch(path) {
  const token = await getTdxToken();
  const res = await fetch(`${TDX_API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` }});
  if (!res.ok) throw new Error(`TDX API ${path} 失敗 ${res.status}:${(await res.text()).slice(0,200)}`);
  return res.json();
}

function durationOf(dep, arr) {
  if (!dep || !arr) return '';
  const [dh, dm] = dep.split(':').map(Number);
  const [ah, am] = arr.split(':').map(Number);
  let mins = (ah * 60 + am) - (dh * 60 + dm);
  if (mins < 0) mins += 24 * 60;
  return `${Math.floor(mins/60)}h${mins%60}m`;
}

// 對號車種:自強 / 太魯閣 / 普悠瑪 / 莒光
function isReservedType(name) { return /自強|太魯閣|普悠瑪|莒光/.test(name); }
function fareClassOf(name) {
  if (/自強|太魯閣|普悠瑪/.test(name)) return 1;
  if (/莒光/.test(name)) return 2;
  if (/復興/.test(name)) return 3;
  return 4;
}

async function tdxQueryTrains(cfg) {
  const fromId = STATION_ID[cfg.from], toId = STATION_ID[cfg.to];
  if (!fromId || !toId) throw new Error(`不支援的車站:${cfg.from} 或 ${cfg.to}`);

  const [tt, fareData] = await Promise.all([
    tdxFetch(`/DailyTrainTimetable/OD/${fromId}/to/${toId}/${cfg.date}?%24format=JSON`),
    tdxFetch(`/ODFare/${fromId}/to/${toId}?%24format=JSON`).catch(() => null)
  ]);

  // 票價:全票對應 FareClass → 價格
  const fareMap = {};
  if (fareData) {
    const fares = (Array.isArray(fareData) ? fareData[0] : fareData)?.Fares || [];
    for (const f of fares) {
      if (f.TicketType === 1) fareMap[f.FareClass] = f.Price;
    }
  }

  const items = tt.TrainTimetables || [];
  return items.map(item => {
    const info = item.TrainInfo || {};
    const o = item.OriginStopTime || {};
    const d = item.DestinationStopTime || {};
    const typeName = info.TrainTypeName?.Zh_tw || info.TrainTypeCode || '';
    return {
      no: info.TrainNo,
      type: typeName,
      depart: o.DepartureTime,
      arrive: d.ArrivalTime,
      duration: durationOf(o.DepartureTime, d.ArrivalTime),
      fare: fareMap[fareClassOf(typeName)] ?? null
    };
  })
  .filter(t => isReservedType(t.type))
  .filter(t => cfg.train === 'all'
            || (cfg.train === '1' && /自強|太魯閣|普悠瑪/.test(t.type))
            || (cfg.train === '2' && /莒光/.test(t.type)))
  .filter(t => !cfg.time || t.depart >= cfg.time)
  .sort((a, b) => a.depart.localeCompare(b.depart));
}

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k.startsWith('--')) {
      const key = k.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      out[key] = val;
    }
  }
  return out;
}

function loadConfig(args) {
  let cfg = { ...args };
  if (args.config) {
    const raw = fs.readFileSync(args.config, 'utf8');
    cfg = { ...JSON.parse(raw), ...args };
    delete cfg.config;
  }
  cfg.time        = cfg.time        ?? '06:00';
  cfg.passengers  = 1;  // 測試模式:每次只訂 1 張
  cfg.retry       = parseInt(cfg.retry      ?? 12);
  cfg.interval    = parseInt(cfg.interval   ?? 5000);
  cfg.train       = cfg.train ? String(cfg.train) : 'all';
  cfg.trainNo     = cfg['train-no'] ? String(cfg['train-no']) : (cfg.trainNo ? String(cfg.trainNo) : null);
  return cfg;
}

function validate(cfg) {
  const errs = [];
  if (!cfg.from || !STATIONS.includes(cfg.from)) errs.push(`from 必填且需為合法車站,例:--from 台北`);
  if (!cfg.to   || !STATIONS.includes(cfg.to))   errs.push(`to 必填且需為合法車站,例:--to 高雄`);
  if (cfg.from === cfg.to) errs.push('from 與 to 不可相同');
  if (!cfg.date || !/^\d{4}-\d{2}-\d{2}$/.test(cfg.date)) errs.push('date 必填,格式 YYYY-MM-DD');
  if (cfg.train !== 'all' && !['1','2'].includes(cfg.train)) errs.push('train 僅支援對號車種:1=自強類 2=莒光');
  return errs;
}

function log(msg) {
  const line = `[${new Date().toLocaleString('zh-TW')}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function seededRng(parts) {
  const s = parts.join('|');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  let a = h >>> 0;
  return function() {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function generateTrains(cfg) {
  const { from, to, time: startTime, train: filterType, date } = cfg;
  const rng = seededRng([from, to, date, startTime, filterType]);
  const dist = Math.abs(STATION_KM[to] - STATION_KM[from]);
  const [sh] = startTime.split(':').map(Number);
  const trains = [];
  const base = 100 + Math.floor(rng() * 50);

  for (let i = 0; i < 18; i++) {
    const tt = TRAIN_TYPES[Math.floor(rng() * TRAIN_TYPES.length)];
    if (filterType !== 'all' && String(tt.id) !== filterType) continue;
    const dh = sh + Math.floor(i / 2);
    if (dh >= 24) break;
    const dm = Math.floor(rng() * 60);
    const dur = Math.floor(dist * tt.speed * 0.6) + 10;
    const arr = dh * 60 + dm + dur;
    const fare = Math.max(20, Math.round(dist * tt.rate));
    const seats = Math.floor(rng() * 220);
    const fmt = (h, m) => `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
    trains.push({
      no: base + i * 7,
      type: tt.name,
      depart: fmt(dh, dm),
      arrive: fmt(Math.floor(arr / 60) % 24, arr % 60),
      duration: `${Math.floor(dur / 60)}h${dur % 60}m`,
      fare,
      seats
    });
  }
  return trains.sort((a, b) => a.depart.localeCompare(b.depart));
}

function attemptBook(cfg) {
  const trains = generateTrains(cfg);
  let train;
  if (cfg.trainNo) {
    train = trains.find(t => String(t.no) === String(cfg.trainNo));
    if (!train) return { ok: false, reason: `查無 ${cfg.trainNo} 次車` };
    if (train.seats < 1) return { ok: false, reason: `${train.no}(${train.type}) 已售完`, train };
  } else {
    const available = trains.filter(t => t.seats >= 1);
    if (available.length === 0) return { ok: false, reason: '無可用車次' };
    train = available[0];
  }

  // 模擬:訂位有 60% 成功(模擬同時段搶票競爭)
  const success = Math.random() < 0.6;
  if (!success) return { ok: false, reason: `${train.no}(${train.type}) 訂位失敗`, train };

  const code = Math.random().toString(36).slice(2, 8).toUpperCase();
  return {
    ok: true,
    ticket: {
      code,
      from: cfg.from,
      to: cfg.to,
      date: cfg.date,
      train: { no: train.no, type: train.type, depart: train.depart, arrive: train.arrive },
      passengers: 1,
      fare: train.fare,
      paid: false,
      mode: 'test',
      bookedAt: new Date().toISOString()
    }
  };
}

function saveTicket(ticket) {
  let tickets = [];
  if (fs.existsSync(TICKETS_FILE)) {
    tickets = JSON.parse(fs.readFileSync(TICKETS_FILE, 'utf8'));
  }
  tickets.push(ticket);
  fs.writeFileSync(TICKETS_FILE, JSON.stringify(tickets, null, 2));
}

async function waitUntil(ts) {
  while (true) {
    const diff = ts - Date.now();
    if (diff <= 0) return;
    const wait = Math.min(diff, 60_000);
    if (diff > 60_000 && diff % 60_000 < 1000) {
      log(`距離排程時間還有 ${Math.ceil(diff / 1000)} 秒`);
    }
    await sleep(wait);
  }
}

async function run() {
  const args = parseArgs(process.argv);
  if (args.help || args.h) {
    console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0] + '*/');
    return;
  }

  const cfg = loadConfig(args);
  const errs = validate(cfg);
  if (errs.length) {
    console.error('參數錯誤:\n  - ' + errs.join('\n  - '));
    process.exit(1);
  }

  log(`[測試模式 / 不付款] 任務啟動:${cfg.from} → ${cfg.to}　${cfg.date} ${cfg.time} 之後　1 張`);

  if (cfg.query) {
    let trains = [], source = 'mock';
    if (process.env.TDX_CLIENT_ID && process.env.TDX_CLIENT_SECRET) {
      try {
        trains = await tdxQueryTrains(cfg);
        source = 'TDX';
      } catch (e) {
        log(`TDX 查詢失敗,退回模擬資料:${e.message}`);
        trains = generateTrains(cfg);
      }
    } else {
      log('未設定 TDX_CLIENT_ID / TDX_CLIENT_SECRET,使用模擬資料(註冊:https://tdx.transportdata.tw/)');
      trains = generateTrains(cfg);
    }

    if (trains.length === 0) { log('查無符合條件的對號車次'); process.exit(0); }
    console.log(`\n${cfg.from} → ${cfg.to}　${cfg.date}　${cfg.time} 之後可訂對號車　[來源: ${source}]`);
    console.log('車次   車種        出發    到達    行車      票價');
    console.log('─'.repeat(58));
    for (const t of trains) {
      const fare = t.fare != null ? `$${t.fare}` : '—';
      console.log(
        `${String(t.no).padEnd(6)} ${String(t.type).padEnd(10)} ${t.depart}   ${t.arrive}   ${(t.duration || '').padEnd(8)} ${fare}`
      );
    }
    if (source === 'TDX') console.log('\n備註:即時剩餘座位請至台鐵官網或 e 訂通 App 查詢。');
    console.log('');
    process.exit(0);
  }

  if (cfg.at) {
    const at = new Date(cfg.at.replace(' ', 'T'));
    if (isNaN(at)) { console.error(`--at 時間格式錯誤:${cfg.at}`); process.exit(1); }
    if (at.getTime() <= Date.now()) {
      log(`排程時間 ${cfg.at} 已過,立即執行`);
    } else {
      log(`排程於 ${at.toLocaleString('zh-TW')} 執行,等待中…`);
      await waitUntil(at.getTime());
    }
  }

  for (let i = 1; i <= cfg.retry; i++) {
    log(`第 ${i}/${cfg.retry} 次嘗試訂票…`);
    const r = attemptBook(cfg);
    if (r.ok) {
      saveTicket(r.ticket);
      log(`訂位成功 [測試模式 / 未付款]:代號 ${r.ticket.code}　${r.ticket.train.type} ${r.ticket.train.no} 次　${r.ticket.train.depart}-${r.ticket.train.arrive}　票價 $${r.ticket.fare}(請至超商或官網於期限內付款)`);
      process.exit(0);
    }
    log(`失敗:${r.reason}`);
    if (i < cfg.retry) await sleep(cfg.interval);
  }

  log(`已達最大重試次數 ${cfg.retry},放棄`);
  process.exit(2);
}

run().catch(e => {
  log(`錯誤:${e.message}`);
  process.exit(1);
});
