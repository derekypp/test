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
 *   --at          排程時間 YYYY-MM-DD HH:MM[:SS](預設立即執行)
 *   --retry       最大重試次數(預設 12)
 *   --interval    重試間隔毫秒(預設 5000)
 *   --query       只查詢車次列表,不訂票
 *   --config      從 JSON 檔讀參數
 *
 * 注意:此程式為模擬器,以隨機邏輯產生車次與訂位結果,不會實際付款。
 *       台鐵官方系統有 CAPTCHA 與 ToS 限制,自動化訂票違反使用條款,
 *       本程式僅作為排程與重試流程的範例。
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

function generateTrains(from, to, startTime, filterType) {
  const dist = Math.abs(STATION_KM[to] - STATION_KM[from]);
  const [sh] = startTime.split(':').map(Number);
  const trains = [];
  let base = 100 + Math.floor(Math.random() * 50);

  for (let i = 0; i < 18; i++) {
    const tt = TRAIN_TYPES[Math.floor(Math.random() * TRAIN_TYPES.length)];
    if (filterType !== 'all' && String(tt.id) !== filterType) continue;
    const dh = sh + Math.floor(i / 2);
    if (dh >= 24) break;
    const dm = Math.floor(Math.random() * 60);
    const dur = Math.floor(dist * tt.speed * 0.6) + 10;
    const arr = dh * 60 + dm + dur;
    const fare = Math.max(20, Math.round(dist * tt.rate));
    const seats = Math.floor(Math.random() * 220);
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
  const trains = generateTrains(cfg.from, cfg.to, cfg.time, cfg.train);
  const available = trains.filter(t => t.seats >= cfg.passengers);
  if (available.length === 0) return { ok: false, reason: '無可用車次' };

  // 模擬:首班可訂車次有 60% 機率成功
  const train = available[0];
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
    const trains = generateTrains(cfg.from, cfg.to, cfg.time, cfg.train);
    if (trains.length === 0) { log('查無車次'); process.exit(0); }
    console.log(`\n${cfg.from} → ${cfg.to}　${cfg.date}　${cfg.time} 之後可訂車次:`);
    console.log('車次   車種      出發    到達    行車      票價    剩餘座位');
    console.log('─'.repeat(60));
    for (const t of trains) {
      const seat = t.seats === 0 ? '已售完'
                 : t.seats < 30  ? `剩 ${t.seats} 位`
                 : `${t.seats} 位`;
      console.log(
        `${String(t.no).padEnd(6)} ${t.type.padEnd(8)} ${t.depart}   ${t.arrive}   ${t.duration.padEnd(8)} $${String(t.fare).padEnd(5)} ${seat}`
      );
    }
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
