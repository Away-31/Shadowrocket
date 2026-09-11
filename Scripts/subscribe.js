/**
 * ============================================================
 * 📊 Shadowrocket 机场流量查询 Pro v3.1
 * ============================================================
 * 修复：恢复 alpn=h2（解决 CFNetwork 310）
 *       改进 UA 循环逻辑
 *       增加 flag 参数备用 URL
 * ============================================================
 */

const isSurge = typeof $httpClient !== "undefined";
const isQuanX = typeof $task !== "undefined";

function notify(title, message) {
  try {
    if (isSurge && typeof $notification !== "undefined") { $notification.post(title, "", message); return; }
    if (isQuanX && typeof $notify !== "undefined") { $notify(title, "", message); return; }
    console.log(`[通知] ${title}\n${message}`);
  } catch (e) { console.log(`通知失败：${e}`); }
}
function done() { try { if (typeof $done === "function") $done(); } catch (e) {} }

const rawArgument = typeof $argument !== "undefined" ? ($argument || "") : "";
function getArgument(name) {
  if (!rawArgument) return "";
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp("(?:^|&)" + escaped + "=([^&]*)");
  const match = rawArgument.match(regex);
  if (!match) return "";
  try { return decodeURIComponent(match[1]); } catch (e) { return match[1]; }
}

const subListRaw = getArgument("机场订阅链接");
let timeoutSeconds = parseInt(getArgument("请求超时时间") || "10");
if (isNaN(timeoutSeconds) || timeoutSeconds <= 0) timeoutSeconds = 10;
timeoutSeconds = Math.min(timeoutSeconds, 60);

function parseUrls(text) {
  if (!text) return [];
  const parts = text.split(/[|\r\n]+/).map(x => x.trim()).filter(Boolean);
  const urls = [];
  for (const part of parts) {
    const matches = part.match(/https?:\/\/[^\s|]+/gi);
    if (!matches) continue;
    for (let url of matches) {
      url = url.replace(/[）)\]】>,，。；;]+$/, "").trim();
      if (/^https?:\/\//i.test(url)) urls.push(url);
    }
  }
  return [...new Set(urls)];
}

const subList = parseUrls(subListRaw);
console.log(`找到 ${subList.length} 个机场订阅`);
if (subList.length === 0) { notify("❌ 机场流量查询", "没有找到有效的订阅链接"); done(); }

function formatBytes(bytes) {
  if (bytes === null || bytes === undefined || isNaN(bytes)) return "未知";
  bytes = Number(bytes); if (bytes < 0) return "未知";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
  return i === 0 ? Math.round(bytes) + units[i] : bytes.toFixed(2) + units[i];
}

function parseTraffic(value) {
  if (!value) return null;
  const match = String(value).trim().match(/^([\d.]+)\s*(B|KB|MB|GB|TB|PB)$/i);
  if (!match) return null;
  const n = parseFloat(match[1]); if (isNaN(n)) return null;
  const u = match[2].toUpperCase();
  const mult = { B:1, KB:1024, MB:1024*1024, GB:1024*1024*1024, TB:1024*1024*1024*1024, PB:1024*1024*1024*1024*1024 };
  return n * mult[u];
}

function normalizeDate(value) {
  if (!value) return "未知";
  const match = String(value).match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (!match) return value;
  return `${match[1]}-${String(match[2]).padStart(2,"0")}-${String(match[3]).padStart(2,"0")}`;
}

function formatTimestamp(ts) {
  if (!ts) return "未知";
  ts = Number(ts); if (isNaN(ts)) return "未知";
  if (ts > 9999999999) ts = Math.floor(ts/1000);
  const d = new Date(ts * 1000); if (isNaN(d.getTime())) return "未知";
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function tryDecodeBase64(str) {
  if (!str || typeof str !== "string") return null;
  const cleaned = str.replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/=]+$/.test(cleaned) || cleaned.length < 8) return null;
  try {
    const decoded = atob(cleaned + "===".slice((cleaned.length + 3) % 4));
    if (decoded && decoded.length > 10) return decoded;
  } catch (e) {}
  return null;
}

function parseUserinfo(header) {
  const r = { upload: null, download: null, total: null, expire: null };
  if (!header) return r;

  const pick = (key) => {
    let m = header.match(new RegExp(key + "\\s*=\\s*([\\d.]+)\\s*(B|KB|MB|GB|TB|PB)", "i"));
    if (m) return parseTraffic(m[1] + m[2]);
    m = header.match(new RegExp(key + "\\s*=\\s*(\\d+)", "i"));
    if (m) return { num: parseInt(m[1]), hasUnit: false };
    return null;
  };

  let up = pick("upload"), dl = pick("download"), tot = pick("total");

  let isGB = false;
  if (tot && typeof tot === "object" && !tot.hasUnit) {
    if (tot.num < 10000 || tot.num % 1 !== 0) isGB = true;
  }

  const conv = (v) => {
    if (v === null) return null;
    if (typeof v === "object" && !v.hasUnit) return isGB ? v.num * 1024 * 1024 * 1024 : v.num;
    return v;
  };
  r.upload = conv(up); r.download = conv(dl); r.total = conv(tot);

  const exp = header.match(/expire\s*=\s*(\d+)/i);
  if (exp) r.expire = formatTimestamp(parseInt(exp[1]));
  if (!r.expire) {
    const dm = header.match(/(\d{4}[-\/]\d{1,2}[-\/]\d{1,2})/);
    if (dm) r.expire = normalizeDate(dm[1]);
  }
  return r;
}

function parseStatus(text) {
  const r = { upload: null, download: null, total: null, expire: null };
  if (!text) return r;
  let m = text.match(/(?:↑|上传|Upload)\s*[:=]\s*([\d.]+\s*(?:B|KB|MB|GB|TB|PB))/i);
  if (m) r.upload = parseTraffic(m[1]);
  m = text.match(/(?:↓|下载|Download)\s*[:=]\s*([\d.]+\s*(?:B|KB|MB|GB|TB|PB))/i);
  if (m) r.download = parseTraffic(m[1]);
  m = text.match(/(?:TOT|TOTAL|总量|总流量)\s*[:=]\s*([\d.]+\s*(?:B|KB|MB|GB|TB|PB))/i);
  if (m) r.total = parseTraffic(m[1]);
  m = text.match(/(?:Expires?|到期|套餐到期)\s*[:=]\s*(\d{4}[-\/]\d{1,2}[-\/]\d{1,2})/i);
  if (m) r.expire = normalizeDate(m[1]);
  return r;
}

function parsePseudo(text) {
  const r = { upload: null, download: null, total: null, expire: null, remain: null, used: null };
  if (!text) return r;
  let m = text.match(/剩余流量[：:]\s*([\d.]+\s*(?:B|KB|MB|GB|TB|PB))/i);
  if (m) r.remain = parseTraffic(m[1]);
  m = text.match(/(?:已用|使用|已使用)[：:]\s*([\d.]+\s*(?:B|KB|MB|GB|TB|PB))/i);
  if (m) r.used = parseTraffic(m[1]);
  m = text.match(/(?:总流量|总量)[：:]\s*([\d.]+\s*(?:B|KB|MB|GB|TB|PB))/i);
  if (m) r.total = parseTraffic(m[1]);
  m = text.match(/(?:套餐到期|到期时间|到期)[：:]\s*(\d{4}[-\/]\d{1,2}[-\/]\d{1,2})/i);
  if (m) r.expire = normalizeDate(m[1]);
  return r;
}

function getAirportName(url, index) {
  try { const m = url.match(/^https?:\/\/([^\/]+)/i); if (m) return m[1].replace(/^www\./i,""); } catch(e){}
  return `机场${index + 1}`;
}

// ---------- 一次请求（指定 UA 和 URL） ----------
function doRequest(name, url, ua) {
  return new Promise(resolve => {
    const params = {
      url: url,
      headers: {
        "User-Agent": ua,
        "Accept": "*/*",
        "Accept-Language": "zh-CN,zh-Hans;q=0.9",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache"
      },
      timeout: timeoutSeconds,
      alpn: "h2"
    };

    $httpClient.get(params, (error, response, data) => {
      if (error) { resolve({ error: String(error) }); return; }
      const status = response && response.status ? response.status : 0;
      if (status < 200 || status >= 300) { resolve({ error: `HTTP ${status}` }); return; }
      let body = "";
      if (typeof data === "string") body = data;
      else if (data && typeof data.toString === "function") body = data.toString();
      resolve({ ok: true, headers: response.headers || {}, body });
    });
  });
}

// ---------- 解析一份响应 ----------
function analyzeResponse(name, headers, body) {
  const info = { upload: null, download: null, total: null, expire: null, remain: null, used: null };

  // 1. subscription-userinfo
  let userinfo = null;
  const headerKeys = [];
  for (const k in headers) {
    headerKeys.push(k);
    if (k.toLowerCase() === "subscription-userinfo") userinfo = headers[k];
  }
  console.log(`${name} 响应头 keys：${headerKeys.join(", ") || "(空)"}`);

  if (userinfo) {
    console.log(`${name} ✅ 发现 userinfo：${userinfo}`);
    const p = parseUserinfo(userinfo);
    info.upload = p.upload; info.download = p.download; info.total = p.total; info.expire = p.expire;
  } else {
    console.log(`${name} ⚠️ 未找到 subscription-userinfo 头`);
  }

  // 2. Body / 解码 Body
  const decoded = tryDecodeBase64(body);
  const searchText = (body || "") + "\n" + (decoded || "");

  const st = parseStatus(searchText);
  if (info.upload === null && st.upload !== null) info.upload = st.upload;
  if (info.download === null && st.download !== null) info.download = st.download;
  if (info.total === null && st.total !== null) info.total = st.total;
  if (!info.expire && st.expire) info.expire = st.expire;

  const ps = parsePseudo(searchText);
  if (info.upload === null && ps.upload !== null) info.upload = ps.upload;
  if (info.download === null && ps.download !== null) info.download = ps.download;
  if (info.total === null && ps.total !== null) info.total = ps.total;
  if (!info.expire && ps.expire) info.expire = ps.expire;
  if (info.remain === null && ps.remain !== null) info.remain = ps.remain;
  if (info.used === null && ps.used !== null) info.used = ps.used;

  // 计算
  let used = info.used;
  if (used === null && info.upload !== null && info.download !== null) used = info.upload + info.download;
  if (used === null && info.total !== null && info.remain !== null) used = info.total - info.remain;
  let remain = info.remain;
  if (remain === null && info.total !== null && used !== null) remain = Math.max(0, info.total - used);
  let percent = null;
  if (used !== null && info.total !== null && info.total > 0) percent = (used / info.total) * 100;

  return { info, used, remain, percent, userinfo, hasUserinfo: !!userinfo, headerKeys };
}

// ---------- 单机场：多 UA + 多 URL ----------
function requestAirport(url, index) {
  return new Promise(async resolve => {
    const name = getAirportName(url, index);
    console.log(`\n========== ${name} ==========`);

    // 备用 URL：原 URL 加 flag 参数
    const urls = [url];
    const flag = url.includes("?") ? "&flag=clash" : "?flag=clash";
    urls.push(url + flag);
    const flag2 = url.includes("?") ? "&flag=shadowrocket" : "?flag=shadowrocket";
    urls.push(url + flag2);

    const UAS = ["Shadowrocket/2.2.0", "ClashforWindows/0.20.39", "Surge/5.8.0"];

    let lastDiag = { headerKeys: [], bodySnippet: "", userinfo: "" };

    for (let ui = 0; ui < urls.length; ui++) {
      for (let ai = 0; ai < UAS.length; ai++) {
        const tryUrl = urls[ui];
        const ua = UAS[ai];
        console.log(`${name} [${ui+1}/${urls.length}] UA=${ua}`);

        const res = await doRequest(name, tryUrl, ua);
        if (res.error) {
          console.log(`${name} 请求失败：${res.error}`);
          lastDiag.error = res.error;
          continue;
        }

        const analysis = analyzeResponse(name, res.headers, res.body);

        // 记录诊断信息
        lastDiag.headerKeys = analysis.headerKeys;
        lastDiag.bodySnippet = (res.body || "").substring(0, 300);
        lastDiag.userinfo = analysis.userinfo || "";

        // 判定成功：拿到 userinfo 头，或拿到至少一个流量字段
        if (analysis.hasUserinfo || analysis.info.total !== null || analysis.info.upload !== null || analysis.info.download !== null) {
          console.log(`${name} ✅ 拿到数据：UA=${ua} URL变体=${ui+1}`);
          resolve({
            success: true, name,
            upload: analysis.info.upload,
            download: analysis.info.download,
            total: analysis.info.total,
            used: analysis.used,
            remain: analysis.remain,
            percent: analysis.percent,
            expire: analysis.info.expire,
            uaUsed: ua
          });
          return;
        }
      }
    }

    // 所有组合都没拿到：返回诊断
    console.log(`${name} ❌ 所有组合均未获取到流量信息`);
    resolve({
      success: false,
      name,
      error: "订阅未返回流量信息",
      diagnostic: lastDiag
    });
  });
}

function getExpireText(expire) {
  if (!expire) return "未知";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expire)) return expire;
  try {
    const target = new Date(expire + "T23:59:59");
    const diff = Math.ceil((target.getTime() - Date.now()) / 86400000);
    if (diff < 0) return `${expire}（已过期）`;
    if (diff === 0) return `${expire}（今天到期）`;
    return `${expire}（剩余${diff}天）`;
  } catch (e) { return expire; }
}

function formatResult(item) {
  if (!item.success) {
    let s = `❌ ${item.name}\n   失败：${item.error}`;
    if (item.diagnostic) {
      const d = item.diagnostic;
      if (d.headerKeys && d.headerKeys.length) {
        s += `\n   响应头：${d.headerKeys.slice(0, 6).join(", ")}`;
      }
      if (d.bodySnippet) {
        s += `\n   Body片段：${d.bodySnippet.substring(0, 100).replace(/\n/g, " ")}`;
      }
    }
    return s;
  }
  const f = (v) => v !== null && v !== undefined ? formatBytes(v) : "未获取";
  return (
    `📡 ${item.name}\n` +
    `⬆️ 上传：${f(item.upload)}\n` +
    `⬇️ 下载：${f(item.download)}\n` +
    `📦 已用：${f(item.used)}\n` +
    `📊 总量：${f(item.total)}\n` +
    `📥 剩余：${f(item.remain)}\n` +
    `📈 使用率：${item.percent !== null ? item.percent.toFixed(1) + "%" : "未获取"}\n` +
    `⏰ 到期：${getExpireText(item.expire)}\n` +
    `🔧 UA：${item.uaUsed || "-"}`
  );
}

(async () => {
  console.log("================================");
  console.log("📊 机场流量查询 Pro v3.1");
  console.log(`机场数量：${subList.length}`);
  console.log("================================");

  const results = [];
  for (let i = 0; i < subList.length; i++) {
    results.push(await requestAirport(subList[i], i));
  }

  const success = results.filter(x => x.success).length;
  const failed = results.length - success;

  const output = ["📊 机场流量查询", "━━━━━━━━━━━━━━━━"];
  for (const r of results) { output.push(formatResult(r)); output.push("━━━━━━━━━━━━━━━━"); }
  output.push(`🕐 查询时间：${new Date().toLocaleString("zh-CN",{hour12:false})}`);
  output.push(`✅ 成功：${success}  ❌ 失败：${failed}`);

  const message = output.join("\n");
  console.log("\n" + message);
  notify("📊 机场流量查询", message);
  done();
})();
