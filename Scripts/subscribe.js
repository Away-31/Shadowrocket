/**
 * ============================================================
 * 📊 Shadowrocket 机场流量查询 Pro v3.0（诊断版）
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

// ---------- 解析 subscription-userinfo（增强） ----------
function parseUserinfo(header) {
  const r = { upload: null, download: null, total: null, expire: null };
  if (!header) return r;
  console.log(`[userinfo 原文] ${header}`);

  const pick = (key) => {
    // 带单位
    let m = header.match(new RegExp(key + "\\s*=\\s*([\\d.]+)\\s*(B|KB|MB|GB|TB|PB)", "i"));
    if (m) return parseTraffic(m[1] + m[2]);
    // 纯数字
    m = header.match(new RegExp(key + "\\s*=\\s*(\\d+)", "i"));
    if (m) return { num: parseInt(m[1]), hasUnit: false };
    return null;
  };

  let up = pick("upload"), dl = pick("download"), tot = pick("total");

  // 判断是否 GB 单位：total 为小数或小于 10000 视为 GB
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

// ---------- 解析 STATUS= ----------
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

// ---------- 解析伪节点名（"剩余流量：100GB"） ----------
function parsePseudo(text) {
  const r = { upload: null, download: null, total: null, expire: null, remain: null };
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

// ---------- 请求 ----------
function requestAirport(url, index) {
  return new Promise(resolve => {
    const name = getAirportName(url, index);
    console.log(`\n========== ${name} ==========`);

    const UAS = ["ClashforWindows/0.20.39", "Shadowrocket/1.0", "Surge/5.0"];
    let uaIdx = 0;

    function attempt() {
      if (uaIdx >= UAS.length) {
        resolve({ success: false, name, error: "所有 UA 均无流量信息", diagnostic: "no-data" });
        return;
      }
      const ua = UAS[uaIdx];
      console.log(`${name} 尝试 UA：${ua}`);

      const params = {
        url: url,
        headers: {
          "User-Agent": ua,
          "Accept": "*/*",
          "Accept-Language": "zh-CN,zh-Hans;q=0.9",
          "Cache-Control": "no-cache",
          "Pragma": "no-cache"
        },
        timeout: timeoutSeconds
      };

      $httpClient.get(params, (error, response, data) => {
        if (error) {
          console.log(`${name} 错误：${error}`);
          resolve({ success: false, name, error: String(error) });
          return;
        }

        const status = response && response.status ? response.status : 0;
        console.log(`${name} HTTP：${status}`);
        console.log(`${name} 响应头：${response && response.headers ? JSON.stringify(response.headers) : "(无 headers)"}`);

        if (status < 200 || status >= 300) {
          resolve({ success: false, name, error: `HTTP ${status}` });
          return;
        }

        // 处理 data：转字符串
        let body = "";
        if (typeof data === "string") body = data;
        else if (data && typeof data.toString === "function") body = data.toString();

        console.log(`${name} Body 前200：${body.substring(0, 200)}`);

        const decoded = tryDecodeBase64(body);
        if (decoded) console.log(`${name} Base64解码前200：${decoded.substring(0, 200)}`);
        else console.log(`${name} 非 Base64`);

        const searchText = (body || "") + "\n" + (decoded || "");

        const info = { upload: null, download: null, total: null, expire: null, remain: null, used: null };

        // 1. subscription-userinfo 头
        let userinfo = null;
        if (response && response.headers) {
          for (const k in response.headers) {
            if (k.toLowerCase() === "subscription-userinfo") { userinfo = response.headers[k]; break; }
          }
        }
        if (userinfo) {
          const p = parseUserinfo(userinfo);
          info.upload = p.upload; info.download = p.download; info.total = p.total; info.expire = p.expire;
        }

        // 2. STATUS 行
        const st = parseStatus(searchText);
        if (info.upload === null && st.upload !== null) info.upload = st.upload;
        if (info.download === null && st.download !== null) info.download = st.download;
        if (info.total === null && st.total !== null) info.total = st.total;
        if (!info.expire && st.expire) info.expire = st.expire;

        // 3. 伪节点
        const ps = parsePseudo(searchText);
        if (info.upload === null && ps.upload !== null) info.upload = ps.upload;
        if (info.download === null && ps.download !== null) info.download = ps.download;
        if (info.total === null && ps.total !== null) info.total = ps.total;
        if (!info.expire && ps.expire) info.expire = ps.expire;
        if (info.remain === null && ps.remain !== null) info.remain = ps.remain;
        if (info.used === null && ps.used !== null) info.used = ps.used;

        // 4. JSON 兜底
        try {
          const m = searchText.match(/\{[^{}]*"(upload|download|total|expire)"[^{}]*\}/);
          if (m) {
            const obj = JSON.parse(m[0]);
            if (info.upload === null && obj.upload != null) info.upload = parseFloat(obj.upload);
            if (info.download === null && obj.download != null) info.download = parseFloat(obj.download);
            if (info.total === null && obj.total != null) info.total = parseFloat(obj.total);
            if (!info.expire && obj.expire != null) info.expire = formatTimestamp(parseInt(obj.expire));
          }
        } catch (e) {}

        // 计算
        let used = info.used;
        if (used === null && info.upload !== null && info.download !== null) used = info.upload + info.download;
        if (used === null && info.total !== null && info.remain !== null) used = info.total - info.remain;

        let remain = info.remain;
        if (remain === null && info.total !== null && used !== null) remain = Math.max(0, info.total - used);

        let percent = null;
        if (used !== null && info.total !== null && info.total > 0) percent = (used / info.total) * 100;

        // 全都为空：换 UA 再试
        if (info.total === null && info.upload === null && info.download === null && !info.expire) {
          console.log(`${name} 该 UA 未获取到数据，换 UA 重试`);
          uaIdx++;
          setTimeout(attempt, 200);
          return;
        }

        console.log(`${name} ✅ 上传=${info.upload} 下载=${info.download} 总量=${info.total} 到期=${info.expire}`);

        resolve({
          success: true, name,
          upload: info.upload, download: info.download, total: info.total,
          used, remain, percent, expire: info.expire,
          uaUsed: ua,
          bodySnippet: body.substring(0, 300),
          decodedSnippet: decoded ? decoded.substring(0, 300) : "",
          userinfoRaw: userinfo || ""
        });
      });
    }

    attempt();
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
    return `❌ ${item.name}\n   失败：${item.error}`;
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
  console.log("📊 机场流量查询 Pro v3.0 诊断版");
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

  // 如果全部失败，把诊断片段塞进通知
  if (success === 0) {
    output.push("━━━━━━━━━━━━━━━━");
    output.push("🔍 诊断片段：");
    const diag = results[0];
    if (diag.bodySnippet) output.push(`Body: ${diag.bodySnippet.substring(0, 120)}`);
    if (diag.decodedSnippet) output.push(`解码: ${diag.decodedSnippet.substring(0, 120)}`);
    if (diag.userinfoRaw) output.push(`Userinfo: ${diag.userinfoRaw.substring(0, 120)}`);
  }

  const message = output.join("\n");
  console.log("\n" + message);
  notify("📊 机场流量查询", message);
  done();
})();
