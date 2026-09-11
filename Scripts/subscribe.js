/**
 * ============================================================
 * 📊 Shadowrocket 机场流量查询 Pro v2.2
 * ============================================================
 * 修复：增加 Base64 解码、多 UA 尝试、伪节点解析、详细调试
 * ============================================================
 */

const isSurge = typeof $httpClient !== "undefined";
const isQuanX = typeof $task !== "undefined";

function notify(title, message) {
  try {
    if (isSurge && typeof $notification !== "undefined") {
      $notification.post(title, "", message);
      return;
    }
    if (isQuanX && typeof $notify !== "undefined") {
      $notify(title, "", message);
      return;
    }
    console.log(`[通知] ${title}\n${message}`);
  } catch (e) {
    console.log(`通知失败：${e}`);
  }
}

function done() {
  try {
    if (typeof $done === "function") $done();
  } catch (e) {
    console.log(`脚本结束失败：${e}`);
  }
}

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
if (subList.length === 0) {
  notify("❌ 机场流量查询", "没有找到有效的订阅链接");
  done();
}

function formatBytes(bytes) {
  if (bytes === null || bytes === undefined || isNaN(bytes)) return "未知";
  bytes = Number(bytes);
  if (bytes < 0) return "未知";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
  if (i === 0) return Math.round(bytes) + units[i];
  return bytes.toFixed(2) + units[i];
}

function parseTraffic(value) {
  if (!value) return null;
  const match = String(value).trim().match(/^([\d.]+)\s*(B|KB|MB|GB|TB|PB)$/i);
  if (!match) return null;
  const number = parseFloat(match[1]);
  if (isNaN(number)) return null;
  const unit = match[2].toUpperCase();
  const multiplier = { B: 1, KB: 1024, MB: 1024*1024, GB: 1024*1024*1024, TB: 1024*1024*1024*1024, PB: 1024*1024*1024*1024*1024 };
  return number * multiplier[unit];
}

// ========== 新增：Base64 解码 ==========
function tryDecodeBase64(str) {
  if (!str || typeof str !== "string") return str;
  const cleaned = str.replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/=]+$/.test(cleaned) || cleaned.length % 4 !== 0) return str;
  try {
    const decoded = atob(cleaned);
    if (/ss:\/\/|vmess:\/\/|trojan:\/\/|vless:\/\/|anytls:\/\/|STATUS=|TOT|剩余/i.test(decoded)) {
      console.log(`[Base64] 解码成功，长度 ${decoded.length}`);
      return decoded;
    }
  } catch (e) { /* 忽略 */ }
  return str;
}

// ========== 新增：从伪节点解析流量 ==========
function parsePseudoNode(text) {
  const result = { upload: null, download: null, total: null, expire: null, remain: null };
  if (!text) return result;

  // 剩余流量：1199.23 GB
  let m = text.match(/剩余流量[：:]\s*([\d.]+\s*(?:B|KB|MB|GB|TB|PB))/i);
  if (m) result.remain = parseTraffic(m[1]);

  // 套餐到期：2026-10-04
  m = text.match(/(?:套餐到期|到期时间|Expires?)[：:]\s*(\d{4}[-\/]\d{1,2}[-\/]\d{1,2})/i);
  if (m) result.expire = normalizeDate(m[1]);

  // 已用流量 / 总流量
  m = text.match(/(?:已用|使用|Used)[：:]\s*([\d.]+\s*(?:B|KB|MB|GB|TB|PB))/i);
  if (m) result.used = parseTraffic(m[1]);
  m = text.match(/(?:总流量|总量|TOT)[：:]\s*([\d.]+\s*(?:B|KB|MB|GB|TB|PB))/i);
  if (m) result.total = parseTraffic(m[1]);

  return result;
}

function parseStatus(text) {
  const result = { upload: null, download: null, total: null, expire: null, remain: null };
  if (!text) return result;

  let match = text.match(/(?:↑|上传|Upload)\s*[:=]\s*([\d.]+\s*(?:B|KB|MB|GB|TB|PB))/i);
  if (match) result.upload = parseTraffic(match[1]);

  match = text.match(/(?:↓|下载|Download)\s*[:=]\s*([\d.]+\s*(?:B|KB|MB|GB|TB|PB))/i);
  if (match) result.download = parseTraffic(match[1]);

  match = text.match(/(?:TOT|TOTAL|总量)\s*[:=]\s*([\d.]+\s*(?:B|KB|MB|GB|TB|PB))/i);
  if (match) result.total = parseTraffic(match[1]);

  match = text.match(/(?:Expires?|到期)\s*[:=]\s*(\d{4}[-\/]\d{1,2}[-\/]\d{1,2})/i);
  if (match) result.expire = normalizeDate(match[1]);

  // 尝试解析剩余
  match = text.match(/(?:剩余|Remain)\s*[:=]\s*([\d.]+\s*(?:B|KB|MB|GB|TB|PB))/i);
  if (match) result.remain = parseTraffic(match[1]);

  return result;
}

function parseUserinfo(header) {
  const result = { upload: null, download: null, total: null, expire: null };
  if (!header) return result;

  console.log(`subscription-userinfo: ${header}`);

  // 先尝试带单位解析
  const unitMatch = header.match(/upload\s*=\s*([\d.]+\s*(?:B|KB|MB|GB|TB|PB))/i);
  if (unitMatch) {
    result.upload = parseTraffic(unitMatch[1]);
  } else {
    const m = header.match(/upload\s*=\s*(\d+)/i);
    if (m) result.upload = parseInt(m[1]);
  }

  const dlMatch = header.match(/download\s*=\s*([\d.]+\s*(?:B|KB|MB|GB|TB|PB))/i);
  if (dlMatch) {
    result.download = parseTraffic(dlMatch[1]);
  } else {
    const m = header.match(/download\s*=\s*(\d+)/i);
    if (m) result.download = parseInt(m[1]);
  }

  const totMatch = header.match(/total\s*=\s*([\d.]+\s*(?:B|KB|MB|GB|TB|PB))/i);
  if (totMatch) {
    result.total = parseTraffic(totMatch[1]);
  } else {
    const m = header.match(/total\s*=\s*(\d+)/i);
    if (m) result.total = parseInt(m[1]);
  }

  // 智能判断无单位数值：如果total<10000或为小数，假定为GB
  if (result.total !== null && !totMatch) {
    const rawTotal = parseInt(header.match(/total\s*=\s*(\d+)/i)?.[1] || "0");
    if (rawTotal > 0 && (rawTotal < 10000 || rawTotal % 1 !== 0)) {
      // 看起来是GB，转换为字节
      if (result.upload !== null) result.upload *= 1024 * 1024 * 1024;
      if (result.download !== null) result.download *= 1024 * 1024 * 1024;
      result.total *= 1024 * 1024 * 1024;
    }
  }

  const expMatch = header.match(/expire\s*=\s*(\d+)/i);
  if (expMatch) result.expire = formatTimestamp(parseInt(expMatch[1]));

  if (!result.expire) {
    const dateMatch = header.match(/(\d{4}[-\/]\d{1,2}[-\/]\d{1,2})/);
    if (dateMatch) result.expire = normalizeDate(dateMatch[1]);
  }

  return result;
}

function normalizeDate(value) {
  if (!value) return "未知";
  const match = String(value).match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (!match) return value;
  return `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}`;
}

function formatTimestamp(ts) {
  if (!ts) return "未知";
  ts = Number(ts);
  if (isNaN(ts)) return "未知";
  if (ts > 9999999999) ts = Math.floor(ts / 1000);
  const date = new Date(ts * 1000);
  if (isNaN(date.getTime())) return "未知";
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
}

function getSubscriptionUserinfo(headers) {
  if (!headers) return null;
  if (headers["subscription-userinfo"]) return headers["subscription-userinfo"];
  if (headers["Subscription-Userinfo"]) return headers["Subscription-Userinfo"];
  for (const key in headers) {
    if (key.toLowerCase() === "subscription-userinfo") return headers[key];
  }
  return null;
}

function getAirportName(url, index) {
  try {
    const match = url.match(/^https?:\/\/([^\/]+)/i);
    if (match) return match[1].replace(/^www\./i, "");
  } catch (e) {}
  return `机场${index + 1}`;
}

// ========== 修改：支持多 UA 尝试 ==========
function requestAirport(url, index) {
  return new Promise(resolve => {
    const name = getAirportName(url, index);
    console.log(`\n========== ${name} ==========`);

    const userAgents = ["ClashforWindows/0.20.39", "Shadowrocket", "Clash"];
    let uaIndex = 0;

    function tryRequest() {
      if (uaIndex >= userAgents.length) {
        resolve({ success: false, name, error: "所有 User-Agent 均无法获取流量信息" });
        return;
      }
      const ua = userAgents[uaIndex];
      console.log(`${name} 尝试 UA: ${ua}`);

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
        if (error) {
          console.log(`${name} 请求错误：${error}`);
          resolve({ success: false, name, error: String(error) });
          return;
        }

        const status = response && response.status ? response.status : 0;
        console.log(`${name} HTTP：${status}`);

        if (status < 200 || status >= 300) {
          resolve({ success: false, name, error: `HTTP ${status}` });
          return;
        }

        // 打印响应头用于调试
        if (response && response.headers) {
          console.log(`${name} 响应头:`, JSON.stringify(response.headers, null, 2));
        }

        let info = { upload: null, download: null, total: null, expire: null, remain: null };

        // 第一优先级：subscription-userinfo
        const userinfo = getSubscriptionUserinfo(response.headers);
        if (userinfo) {
          const parsed = parseUserinfo(userinfo);
          info.upload = parsed.upload;
          info.download = parsed.download;
          info.total = parsed.total;
          info.expire = parsed.expire;
        }

        // 解码 Body
        const rawBody = data || "";
        const decodedBody = tryDecodeBase64(rawBody);

        // 第二优先级：STATUS 格式
        const statusInfo = parseStatus(decodedBody);

        // 第三优先级：伪节点解析
        const pseudoInfo = parsePseudoNode(decodedBody);

        // 合并数据
        if (info.upload === null && statusInfo.upload !== null) info.upload = statusInfo.upload;
        if (info.download === null && statusInfo.download !== null) info.download = statusInfo.download;
        if (info.total === null && statusInfo.total !== null) info.total = statusInfo.total;
        if (!info.expire && statusInfo.expire) info.expire = statusInfo.expire;

        if (info.upload === null && pseudoInfo.upload !== null) info.upload = pseudoInfo.upload;
        if (info.download === null && pseudoInfo.download !== null) info.download = pseudoInfo.download;
        if (info.total === null && pseudoInfo.total !== null) info.total = pseudoInfo.total;
        if (!info.expire && pseudoInfo.expire) info.expire = pseudoInfo.expire;
        if (info.remain === null && pseudoInfo.remain !== null) info.remain = pseudoInfo.remain;
        if (info.remain === null && statusInfo.remain !== null) info.remain = statusInfo.remain;

        // 如果只有剩余没有总量，尝试反推
        if (info.remain !== null && info.total === null && info.upload !== null && info.download !== null) {
          info.total = info.remain + info.upload + info.download;
        }

        // 计算已用
        let used = null;
        if (info.upload !== null && info.download !== null) {
          used = info.upload + info.download;
        } else if (info.total !== null && info.remain !== null) {
          used = info.total - info.remain;
        }

        // 计算剩余
        let remain = info.remain;
        if (remain === null && info.total !== null && used !== null) {
          remain = Math.max(0, info.total - used);
        }

        // 使用率
        let percent = null;
        if (used !== null && info.total !== null && info.total > 0) {
          percent = (used / info.total) * 100;
        }

        // 如果所有关键数据都为空，尝试下一个 UA
        if (info.total === null && info.upload === null && info.download === null && info.expire === null) {
          console.log(`${name} 当前 UA 未获取到任何流量信息，尝试下一个`);
          uaIndex++;
          tryRequest();
          return;
        }

        console.log(`${name} 上传：${info.upload}`);
        console.log(`${name} 下载：${info.download}`);
        console.log(`${name} 总量：${info.total}`);
        console.log(`${name} 已用：${used}`);
        console.log(`${name} 剩余：${remain}`);
        console.log(`${name} 使用率：${percent}`);
        console.log(`${name} 到期：${info.expire}`);

        resolve({
          success: true,
          name,
          upload: info.upload,
          download: info.download,
          total: info.total,
          used,
          remain,
          percent,
          expire: info.expire
        });
      });
    }

    tryRequest();
  });
}

function getExpireText(expire) {
  if (!expire) return "未知";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expire)) return expire;
  try {
    const target = new Date(expire + "T23:59:59");
    const now = new Date();
    const diff = Math.ceil((target.getTime() - now.getTime()) / 86400000);
    if (diff < 0) return `${expire}（已过期）`;
    if (diff === 0) return `${expire}（今天到期）`;
    return `${expire}（剩余${diff}天）`;
  } catch (e) { return expire; }
}

function formatResult(item) {
  if (!item.success) {
    return `❌ ${item.name}\n   请求失败：${item.error}`;
  }
  const upload = item.upload !== null ? formatBytes(item.upload) : "未获取";
  const download = item.download !== null ? formatBytes(item.download) : "未获取";
  const used = item.used !== null ? formatBytes(item.used) : "未获取";
  const total = item.total !== null ? formatBytes(item.total) : "未获取";
  const remain = item.remain !== null ? formatBytes(item.remain) : "未获取";
  const usage = item.percent !== null ? `${item.percent.toFixed(1)}%` : "未获取";
  const expire = getExpireText(item.expire);
  return (
    `📡 ${item.name}\n` +
    `⬆️ 上传：${upload}\n` +
    `⬇️ 下载：${download}\n` +
    `📦 已用：${used}\n` +
    `📊 总量：${total}\n` +
    `📥 剩余：${remain}\n` +
    `📈 使用率：${usage}\n` +
    `⏰ 到期：${expire}`
  );
}

(async () => {
  console.log("================================");
  console.log("📊 机场流量查询 Pro v2.2");
  console.log(`机场数量：${subList.length}`);
  console.log("================================");

  const results = [];
  for (let i = 0; i < subList.length; i++) {
    const result = await requestAirport(subList[i], i);
    results.push(result);
  }

  const success = results.filter(x => x.success).length;
  const failed = results.length - success;

  const output = [];
  output.push("📊 机场流量查询");
  output.push("━━━━━━━━━━━━━━━━");
  for (const result of results) {
    output.push(formatResult(result));
    output.push("━━━━━━━━━━━━━━━━");
  }
  const now = new Date();
  output.push(`🕐 查询时间：${now.toLocaleString("zh-CN", { hour12: false })}`);
  output.push(`✅ 成功：${success}  ❌ 失败：${failed}`);

  const message = output.join("\n");
  console.log("\n" + message);
  notify("📊 机场流量查询", message);
  done();
})();
