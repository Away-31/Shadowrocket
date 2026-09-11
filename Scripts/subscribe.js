/**
 * ============================================================
 * 📊 Shadowrocket 机场流量查询 Pro v2.1
 * ============================================================
 *
 * 专门针对机场订阅流量信息设计
 *
 * 支持：
 *
 * 1. subscription-userinfo 响应头
 *
 *    upload=xxx; download=xxx; total=xxx; expire=xxx
 *    也支持带单位：upload=5.2GB; download=120.5GB; total=500GB
 *    分隔符兼容 ; , & | 空格
 *
 * 2. STATUS 格式
 *
 *    STATUS=🚀↑:8.57GB,↓:48.69GB,TOT:100GB💡Expires:2026-09-28
 *    也支持中文标签：上传、下载、总量、到期
 *
 * 3. 多机场
 *
 * 4. 汇总通知
 *
 * 5. 自动计算：
 *
 *    已用 = 上传 + 下载
 *    剩余 = 总量 - 已用
 *    使用率 = 已用 / 总量
 *
 * 重要：
 *
 * ❌ 不再从普通 Base64 节点数据中猜测流量
 *
 * ============================================================
 */


/**
 * ============================================================
 * Shadowrocket / Surge / QuanX 环境
 * ============================================================
 */

const isSurge =
  typeof $httpClient !== "undefined";

const isQuanX =
  typeof $task !== "undefined";


/**
 * ============================================================
 * 通知
 * ============================================================
 */

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


/**
 * ============================================================
 * 结束
 * ============================================================
 */

function done() {
  try {
    if (typeof $done === "function") {
      $done();
    }
  } catch (e) {
    console.log(`脚本结束失败：${e}`);
  }
}


/**
 * ============================================================
 * 参数
 * ============================================================
 */

const rawArgument =
  typeof $argument !== "undefined"
    ? ($argument || "")
    : "";


function getArgument(name) {
  if (!rawArgument) return "";

  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp("(?:^|&)" + escaped + "=([^&]*)");
  const match = rawArgument.match(regex);

  if (!match) return "";

  try {
    return decodeURIComponent(match[1]);
  } catch (e) {
    return match[1];
  }
}


/**
 * ============================================================
 * 订阅地址
 * ============================================================
 */

const subListRaw = getArgument("机场订阅链接");

let timeoutSeconds = parseInt(getArgument("请求超时时间") || "10");
if (isNaN(timeoutSeconds) || timeoutSeconds <= 0) timeoutSeconds = 10;
timeoutSeconds = Math.min(timeoutSeconds, 60);


/**
 * ============================================================
 * 解析多个订阅 URL
 * ============================================================
 */

function parseUrls(text) {
  if (!text) return [];

  const parts = text
    .split(/[|\r\n]+/)
    .map(x => x.trim())
    .filter(Boolean);

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


/**
 * ============================================================
 * 字节格式化
 * ============================================================
 */

function formatBytes(bytes) {
  if (bytes === null || bytes === undefined || isNaN(bytes)) return "未知";

  bytes = Number(bytes);
  if (bytes < 0) return "未知";

  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let i = 0;

  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }

  if (i === 0) return Math.round(bytes) + units[i];
  return bytes.toFixed(2) + units[i];
}


/**
 * ============================================================
 * 解析带单位的流量
 * ============================================================
 */

function parseTraffic(value) {
  if (!value) return null;

  const match = String(value)
    .trim()
    .match(/^([\d.]+)\s*(B|KB|MB|GB|TB|PB)$/i);

  if (!match) return null;

  const number = parseFloat(match[1]);
  if (isNaN(number)) return null;

  const unit = match[2].toUpperCase();
  const multiplier = {
    B: 1,
    KB: 1024,
    MB: 1024 * 1024,
    GB: 1024 * 1024 * 1024,
    TB: 1024 * 1024 * 1024 * 1024,
    PB: 1024 * 1024 * 1024 * 1024 * 1024
  };

  return number * multiplier[unit];
}


/**
 * ============================================================
 * 解析 STATUS
 * ============================================================
 */

function parseStatus(text) {
  const result = {
    upload: null,
    download: null,
    total: null,
    expire: null
  };

  if (!text) return result;

  // 上传：支持 ↑:8.57GB、上传:8.57GB、Upload:8.57GB
  let match = text.match(/(?:↑|上传|Upload)\s*[:=]\s*([\d.]+\s*(?:B|KB|MB|GB|TB|PB))/i);
  if (match) result.upload = parseTraffic(match[1]);

  // 下载：支持 ↓:8.57GB、下载:8.57GB、Download:8.57GB
  match = text.match(/(?:↓|下载|Download)\s*[:=]\s*([\d.]+\s*(?:B|KB|MB|GB|TB|PB))/i);
  if (match) result.download = parseTraffic(match[1]);

  // 总量：支持 TOT:100GB、TOTAL:100GB、总量:100GB
  match = text.match(/(?:TOT|TOTAL|总量)\s*[:=]\s*([\d.]+\s*(?:B|KB|MB|GB|TB|PB))/i);
  if (match) result.total = parseTraffic(match[1]);

  // 到期：支持 Expires:2026-09-28、到期:2026-09-28
  match = text.match(/(?:Expires?|到期)\s*[:=]\s*(\d{4}[-\/]\d{1,2}[-\/]\d{1,2})/i);
  if (match) result.expire = normalizeDate(match[1]);

  return result;
}


/**
 * ============================================================
 * subscription-userinfo 解析（增强版）
 * ============================================================
 */

function parseUserinfo(header) {
  const result = {
    upload: null,
    download: null,
    total: null,
    expire: null
  };

  if (!header) return result;

  console.log(`subscription-userinfo: ${header}`);

  // 将 header 拆分为键值对，支持 ; , & | 空格 分隔
  const pairs = header.split(/[;,&|\s]+/).filter(Boolean);

  const rawValues = {
    upload: null,
    download: null,
    total: null,
    expire: null
  };

  for (const pair of pairs) {
    const kv = pair.split("=");
    if (kv.length !== 2) continue;

    const key = kv[0].trim().toLowerCase();
    const value = kv[1].trim();

    if (!["upload", "download", "total", "expire"].includes(key)) continue;

    // 尝试带单位解析
    const traffic = parseTraffic(value);
    if (traffic !== null) {
      rawValues[key] = traffic;
    } else {
      // 无单位，记录原始数字，稍后判断单位
      const num = parseFloat(value);
      if (!isNaN(num)) {
        rawValues[key] = { num, hasUnit: false };
      }
    }
  }

  // 智能判断无单位数值的单位
  // 如果 total 存在且无单位，且数值较小（< 10000）或为小数，则认为是 GB
  let assumeGB = false;
  if (rawValues.total && typeof rawValues.total === "object" && !rawValues.total.hasUnit) {
    const totalNum = rawValues.total.num;
    if (totalNum < 10000 || totalNum % 1 !== 0) {
      assumeGB = true;
    }
  }

  // 转换所有无单位的值
  const convert = (val) => {
    if (val === null) return null;
    if (typeof val === "object" && !val.hasUnit) {
      return assumeGB ? val.num * 1024 * 1024 * 1024 : val.num;
    }
    return val;
  };

  result.upload = convert(rawValues.upload);
  result.download = convert(rawValues.download);
  result.total = convert(rawValues.total);

  // expire 处理：可能是时间戳或日期字符串
  if (rawValues.expire !== null) {
    if (typeof rawValues.expire === "object" && !rawValues.expire.hasUnit) {
      // 纯数字，可能是时间戳
      const ts = rawValues.expire.num;
      if (ts > 1000000000) {
        result.expire = formatTimestamp(ts);
      } else {
        result.expire = "未知";
      }
    } else if (typeof rawValues.expire === "string") {
      // 带单位？不太可能，但尝试解析日期
      result.expire = normalizeDate(rawValues.expire);
    }
  }

  // 如果 expire 还是 null，尝试从原始 header 中直接匹配日期
  if (!result.expire) {
    const dateMatch = header.match(/(\d{4}[-\/]\d{1,2}[-\/]\d{1,2})/);
    if (dateMatch) {
      result.expire = normalizeDate(dateMatch[1]);
    }
  }

  return result;
}


/**
 * ============================================================
 * 日期
 * ============================================================
 */

function normalizeDate(value) {
  if (!value) return "未知";

  const match = String(value).match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (!match) return value;

  return `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}`;
}


/**
 * ============================================================
 * Unix 时间戳
 * ============================================================
 */

function formatTimestamp(ts) {
  if (!ts) return "未知";

  ts = Number(ts);
  if (isNaN(ts)) return "未知";

  if (ts > 9999999999) ts = Math.floor(ts / 1000);

  const date = new Date(ts * 1000);
  if (isNaN(date.getTime())) return "未知";

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}


/**
 * ============================================================
 * 获取响应头
 * ============================================================
 */

function getSubscriptionUserinfo(headers) {
  if (!headers) return null;

  if (headers["subscription-userinfo"]) return headers["subscription-userinfo"];
  if (headers["Subscription-Userinfo"]) return headers["Subscription-Userinfo"];

  for (const key in headers) {
    if (key.toLowerCase() === "subscription-userinfo") {
      return headers[key];
    }
  }

  return null;
}


/**
 * ============================================================
 * 获取机场名称
 * ============================================================
 */

function getAirportName(url, index) {
  try {
    const match = url.match(/^https?:\/\/([^\/]+)/i);
    if (match) return match[1].replace(/^www\./i, "");
  } catch (e) {}

  return `机场${index + 1}`;
}


/**
 * ============================================================
 * 查询单个机场
 * ============================================================
 */

function requestAirport(url, index) {
  return new Promise(resolve => {
    const name = getAirportName(url, index);

    console.log(`\n========== ${name} ==========`);

    const params = {
      url: url,
      headers: {
        "User-Agent": "Shadowrocket",
        "Accept": "*/*",
        "Accept-Language": "zh-CN,zh-Hans;q=0.9",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache"
      },
      timeout: timeoutSeconds,
      alpn: "h2"
    };

    try {
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

        let info = {
          upload: null,
          download: null,
          total: null,
          expire: null
        };

        // 第一优先级：subscription-userinfo
        const userinfo = getSubscriptionUserinfo(response.headers);
        if (userinfo) {
          const parsed = parseUserinfo(userinfo);
          info.upload = parsed.upload;
          info.download = parsed.download;
          info.total = parsed.total;
          info.expire = parsed.expire;
        }

        // 第二优先级：STATUS（用于补充或纠正）
        const statusInfo = parseStatus(data || "");

        // 如果 userinfo 缺失或明显异常，则使用 STATUS 数据
        // 异常判断：total 存在但小于 1MB，而 STATUS 的 total 更大
        if (
          info.total !== null &&
          statusInfo.total !== null &&
          info.total < 1024 * 1024 &&
          statusInfo.total > info.total
        ) {
          info.total = statusInfo.total;
          info.upload = statusInfo.upload;
          info.download = statusInfo.download;
          info.expire = statusInfo.expire || info.expire;
        } else {
          // 正常补充缺失字段
          if (info.upload === null && statusInfo.upload !== null) info.upload = statusInfo.upload;
          if (info.download === null && statusInfo.download !== null) info.download = statusInfo.download;
          if (info.total === null && statusInfo.total !== null) info.total = statusInfo.total;
          if (!info.expire && statusInfo.expire) info.expire = statusInfo.expire;
        }

        // 计算已用
        let used = null;
        if (info.upload !== null && info.download !== null) {
          used = info.upload + info.download;
        }

        // 计算剩余
        let remain = null;
        if (info.total !== null && used !== null) {
          remain = Math.max(0, info.total - used);
        }

        // 使用率
        let percent = null;
        if (used !== null && info.total !== null && info.total > 0) {
          percent = (used / info.total) * 100;
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
    } catch (e) {
      resolve({ success: false, name, error: String(e) });
    }
  });
}


/**
 * ============================================================
 * 到期剩余天数
 * ============================================================
 */

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
  } catch (e) {
    return expire;
  }
}


/**
 * ============================================================
 * 格式化结果
 * ============================================================
 */

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


/**
 * ============================================================
 * 主程序
 * ============================================================
 */

(async () => {
  console.log("================================");
  console.log("📊 机场流量查询 Pro v2.1");
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
