/**
 * Shadowrocket / Surge / Quantumult X
 * 机场流量查询 (Cron 每小时)
 *
 * 适配实测格式:
 *   nowjiasu (hi.nowjiasu.com) 订阅返回的是 base64 body,
 *   解码后第一行为:
 *     STATUS=🚀↑:8.55GB,↓:48.56GB,TOT:100GB💡Expires:2026-09-28
 *   注意: 该机场响应头 **不含** subscription-userinfo, 必须解析 body!
 *
 * 同时兼容标准 subscription-userinfo 头的机场 (多数机场走这条)。
 */

// ============================================================
// 通知 / 结束
// ============================================================

const notify = (title, message) => {
  try {
    if (typeof $notification !== "undefined" && $notification.post) {
      $notification.post(title, "", message);
      return;
    }
    if (typeof $notify !== "undefined") {
      $notify(title, "", message);
      return;
    }
    console.log("通知 API 不存在: " + title + " - " + message);
  } catch (e) {
    console.log("通知发送失败: " + e);
  }
};

const done = () => {
  try {
    $done();
  } catch (e) {
    console.log("脚本结束失败: " + e);
  }
};

const bail = (title, msg) => {
  notify(title, msg);
  done();
};

// ============================================================
// 读取参数 (兼容多种写法)
// ============================================================

function readSubLinks() {
  const raw = (typeof $argument !== "undefined" && $argument) ? String($argument) : "";
  console.log("原始参数: " + raw);

  if (!raw) {
    return { error: "❗️未填写机场订阅链接\n请在模块参数中填写" };
  }

  // 取等号右边的全部内容 (不再用 \S+ 粗暴截断, 保留 ? & 等 query)
  let payload = raw;
  const m = raw.match(/机场订阅链接\s*=\s*([\s\S]+)/);
  if (m) {
    payload = m[1];
  } else {
    // 也支持直接写链接(无 key)
    const k = raw.match(/^\s*[^=]*=\s*([\s\S]+)$/);
    if (k) payload = k[1];
  }

  // URL 解码 (容错: 未编码时 decodeURIComponent 会抛错)
  try {
    payload = decodeURIComponent(payload);
  } catch (e) {
    console.log("URL 解码跳过: " + e);
  }

  // URL 解码后可能 base64 编码了, 尝试解开
  // 仅在整体看起来像 base64 且解出来含 http 时才用
  const b64try = base64Decode(payload.trim());
  if (b64try && /https?:\/\//.test(b64try) && !/https?:\/\//.test(payload)) {
    console.log("参数为 base64, 已解码");
    payload = b64try;
  }

  // 分割多个订阅: 支持换行 / 逗号 / 分号 / 中文顿号 / 竖线 / 空格
  const parts = payload
    .split(/[\r\n,;、|]+/)
    .map(s => s.trim())
    .filter(Boolean);

  const links = [];
  for (const p of parts) {
    // 一条里可能含多个链接(用户把两条贴一起)
    const found = p.match(/https?:\/\/[^\s,;、|]+/g);
    if (found) {
      for (const f of found) links.push(f);
    } else if (p) {
      console.log("忽略非链接项: " + p.slice(0, 60));
    }
  }

  // 去重
  const uniq = [];
  for (const l of links) {
    if (uniq.indexOf(l) === -1) uniq.push(l);
  }

  if (uniq.length === 0) {
    return { error: "⚠️ 无有效链接\n请检查订阅链接格式" };
  }

  return { links: uniq };
}

// ============================================================
// Base64 解码 (标准实现, 兼容 URL-safe / 缺 padding / 多字节)
// ============================================================

const B64CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64Decode(input) {
  try {
    if (!input) return "";

    let str = String(input).replace(/[\r\n\t ]+/g, "");
    str = str.replace(/-/g, "+").replace(/_/g, "/");
    // 去掉非法字符
    str = str.replace(/[^A-Za-z0-9+/=]/g, "");
    // 补齐 padding
    while (str.length % 4 !== 0) str += "=";

    // 优先用标准 API
    if (typeof atob !== "undefined") {
      try {
        const bin = atob(str.replace(/=+$/, ""));
        // UTF-8 还原
        let out = "";
        for (let i = 0; i < bin.length; i++) {
          const c = bin.charCodeAt(i);
          if (c < 0x80) {
            out += String.fromCharCode(c);
          } else if (c < 0xE0) {
            out += String.fromCharCode(((c & 0x1F) << 6) | (bin.charCodeAt(++i) & 0x3F));
          } else if (c < 0xF0) {
            out += String.fromCharCode(
              ((c & 0x0F) << 12) |
              ((bin.charCodeAt(++i) & 0x3F) << 6) |
              (bin.charCodeAt(++i) & 0x3F)
            );
          } else {
            const cp =
              ((c & 0x07) << 18) |
              ((bin.charCodeAt(++i) & 0x3F) << 12) |
              ((bin.charCodeAt(++i) & 0x3F) << 6) |
              (bin.charCodeAt(++i) & 0x3F);
            const off = cp - 0x10000;
            out += String.fromCharCode(0xD800 + (off >> 10), 0xDC00 + (off & 0x3FF));
          }
        }
        return out;
      } catch (e) {
        // 落到手写实现
      }
    }

    // 手写实现 (无 atob 环境, 如部分 Shadowrocket 版本)
    let output = "";
    let i = 0;
    while (i < str.length) {
      const e1 = B64CHARS.indexOf(str.charAt(i++));
      const e2 = B64CHARS.indexOf(str.charAt(i++));
      const e3 = B64CHARS.indexOf(str.charAt(i++));
      const e4 = B64CHARS.indexOf(str.charAt(i++));
      if (e1 < 0 || e2 < 0) break;
      const c1 = (e1 << 2) | (e2 >> 4);
      const c2 = ((e2 & 15) << 4) | (e3 >> 2);
      const c3 = ((e3 & 3) << 6) | e4;
      output += String.fromCharCode(c1);
      if (e3 >= 0 && str.charAt(i - 2) !== "=") output += String.fromCharCode(c2);
      if (e4 >= 0 && str.charAt(i - 1) !== "=") output += String.fromCharCode(c3);
    }

    // UTF-8 还原
    try {
      let out = "";
      for (let k = 0; k < output.length; k++) {
        const c = output.charCodeAt(k);
        if (c < 0x80) out += String.fromCharCode(c);
        else if (c < 0xE0) out += String.fromCharCode(((c & 0x1F) << 6) | (output.charCodeAt(++k) & 0x3F));
        else out += String.fromCharCode(((c & 0x0F) << 12) | ((output.charCodeAt(++k) & 0x3F) << 6) | (output.charCodeAt(++k) & 0x3F));
      }
      return out;
    } catch (e) {
      return output;
    }
  } catch (e) {
    console.log("base64 解码异常: " + e);
    return "";
  }
}

// ============================================================
// 流量单位 -> 字节
// ============================================================

const UNIT = {
  B: 1, KB: 1024, MB: 1024 * 1024, GB: 1024 * 1024 * 1024,
  TB: 1024 * 1024 * 1024 * 1024, PB: 1024 * 1024 * 1024 * 1024 * 1024,
  K: 1024, M: 1024 * 1024, G: 1024 * 1024 * 1024, T: 1024 * 1024 * 1024 * 1024
};

function toBytes(val) {
  if (val === undefined || val === null || val === "") return NaN;
  if (typeof val === "number") return isNaN(val) ? NaN : val;
  const m = String(val).replace(/,/g, "").match(/(-?\d+(?:\.\d+)?)\s*([KMGTP]?B?)/i);
  if (!m) return NaN;
  const num = parseFloat(m[1]);
  const unit = (m[2] || "B").toUpperCase();
  const mul = UNIT[unit] || UNIT[unit.replace(/B$/, "")] || 1;
  return num * mul;
}

// ============================================================
// 字节 -> 可读
// ============================================================

function formatBytes(bytes) {
  const n = toBytes(bytes);
  if (isNaN(n)) return "未知";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return v.toFixed(2) + units[i];
}

// ============================================================
// 解析 nowjiasu 风格 STATUS 行
//   STATUS=🚀↑:8.55GB,↓:48.56GB,TOT:100GB💡Expires:2026-09-28
// ============================================================

function parseStatusLine(line) {
  if (!line) return null;

  // 必须含 STATUS= 或同时有 ↑↓TOT 才认
  const looksLike =
    /STATUS\s*=/i.test(line) ||
    (/[↑⬆]/.test(line) && /[↓⬇]/.test(line) && /TOT/i.test(line));
  if (!looksLike) return null;

  const info = { upload: NaN, download: NaN, total: NaN, expire: "未知", used: NaN };

  // 上传: ↑ 或 ⬆ 或 Upload 后面的数值
  let m = line.match(/[↑⬆]\s*[:：]?\s*([\d.]+\s*[KMGTP]?B?)/i) ||
          line.match(/(?:上传|Upload)\s*[:：]?\s*([\d.]+\s*[KMGTP]?B?)/i);
  if (m) info.upload = toBytes(m[1]);

  // 下载
  m = line.match(/[↓⬇]\s*[:：]?\s*([\d.]+\s*[KMGTP]?B?)/i) ||
      line.match(/(?:下载|Download)\s*[:：]?\s*([\d.]+\s*[KMGTP]?B?)/i);
  if (m) info.download = toBytes(m[1]);

  // 总量
  m = line.match(/TOT(?:AL)?\s*[:：]?\s*([\d.]+\s*[KMGTP]?B?)/i) ||
      line.match(/(?:总量|流量)\s*[:：]?\s*([\d.]+\s*[KMGTP]?B?)/i);
  if (m) info.total = toBytes(m[1]);

  // 到期
  m = line.match(/(?:Expires?|到期(?:时间)?)\s*[:：]?\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)/i);
  if (m) info.expire = m[1].replace(/\//g, "-");

  // 剩余(有些机场直接给)
  m = line.match(/(?:剩余|Remaining|Left)\s*[:：]?\s*([\d.]+\s*[KMGTP]?B?)/i);
  if (m) info.remainRaw = toBytes(m[1]);

  // 已用
  m = line.match(/(?:已用|Used)\s*[:：]?\s*([\d.]+\s*[KMGTP]?B?)/i);
  if (m) info.used = toBytes(m[1]);

  if (isNaN(info.total) && isNaN(info.upload) && isNaN(info.download)) return null;
  return info;
}

// ============================================================
// 解析标准 subscription-userinfo 头
// ============================================================

function parseUserinfo(header) {
  if (!header) return null;
  const info = { upload: NaN, download: NaN, total: NaN, expire: "未知" };

  let m = header.match(/upload\s*=\s*(\d+)/i);   if (m) info.upload = parseInt(m[1], 10);
  m = header.match(/download\s*=\s*(\d+)/i);     if (m) info.download = parseInt(m[1], 10);
  m = header.match(/total\s*=\s*(\d+)/i);        if (m) info.total = parseInt(m[1], 10);
  m = header.match(/expire\s*=\s*(\d+)/i);
  if (m) info.expire = formatExpire(parseInt(m[1], 10));

  if (isNaN(info.total) && isNaN(info.upload) && isNaN(info.download)) return null;
  return info;
}

function formatExpire(ts) {
  const n = Number(ts);
  if (!n || isNaN(n) || n <= 0 || n > 4102444800) return "未知"; // >2100 视为无效
  // 秒级时间戳
  const d = new Date(n * 1000);
  if (isNaN(d.getTime())) return "未知";
  const p = x => String(x).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

// ============================================================
// 剩余流量
// ============================================================

function calcRemain(info) {
  if (info.remainRaw !== undefined && !isNaN(info.remainRaw)) {
    return formatBytes(info.remainRaw);
  }
  let used = NaN;
  if (!isNaN(info.upload) && !isNaN(info.download)) used = info.upload + info.download;
  else if (!isNaN(info.used)) used = info.used;

  if (!isNaN(info.total) && !isNaN(used)) {
    const r = info.total - used;
    return r <= 0 ? "0 B（已用尽）" : formatBytes(r);
  }
  return "未知";
}

// ============================================================
// 查询单个机场 (单次请求, 不重试)
// ============================================================

function queryOne(url, index) {
  return new Promise((resolve) => {
    const headers = {
      "cache-control": "no-cache",
      "accept": "*/*",
      "accept-language": "zh-CN,zh-Hans;q=0.9",
      "user-agent": "Shadowrocket/2615 CFNetwork/3826.500.131 Darwin/24.5.0 iPhone14,3"
    };

    $httpClient.get({ url: url, headers: headers, timeout: 20 }, function (error, response, data) {
      if (error || !response || (response.status && response.status !== 200)) {
        const msg = error || (response ? "HTTP " + response.status : "无响应");
        resolve({ index: index, ok: false, name: "机场 " + (index + 1), error: String(msg) });
        return;
      }

      const H = response.headers || {};
      const body = (data === undefined || data === null) ? "" : String(data);

      const result = {
        index: index,
        ok: true,
        name: "机场 " + (index + 1),
        info: { upload: NaN, download: NaN, total: NaN, expire: "未知" },
        source: "无"
      };

      // ---- 1) 标准响应头 ----
      const uiHeader = H["subscription-userinfo"] || H["Subscription-Userinfo"] || H["SUBSCRIPTION-USERINFO"];
      if (uiHeader) {
        const p = parseUserinfo(uiHeader);
        if (p) {
          result.info = p;
          result.source = "响应头";
          console.log("[" + (index + 1) + "] 命中 subscription-userinfo: " + uiHeader);
        }
      }

      // ---- 2) body 第一行 STATUS (nowjiasu 等) ----
      if (result.source === "无") {
        // 先试明文第一行, 再试 base64 解码
        const candidates = [];
        const headText = body.slice(0, 2000);
        const firstPlain = headText.split(/\r?\n/)[0] || "";
        if (/STATUS\s*=/i.test(firstPlain) || /[↑⬆]/.test(firstPlain)) {
          candidates.push(firstPlain);
        }

        const dec = base64Decode(body.slice(0, 4000));
        if (dec) {
          const lines = dec.split(/\r?\n/);
          for (let i = 0; i < Math.min(lines.length, 3); i++) {
            if (lines[i] && lines[i].trim()) candidates.push(lines[i]);
          }
        }

        for (const c of candidates) {
          const p = parseStatusLine(c);
          if (p) {
            result.info = p;
            result.source = "响应体";
            console.log("[" + (index + 1) + "] 命中 body STATUS: " + c);
            break;
          }
        }
      }

      // ---- 3) 兜底: 全 body base64 解码后全文扫描 ----
      if (result.source === "无") {
        const full = base64Decode(body) || body;
        const m = full.match(/STATUS\s*=[^\r\n]+/i);
        if (m) {
          const p = parseStatusLine(m[0]);
          if (p) { result.info = p; result.source = "响应体(全文扫描)"; }
        }
      }

      // ---- 4) 从节点 remark 里抠 "剩余流量：42.89 GB" ----
      if (result.source === "无" || isNaN(result.info.total)) {
        const full = base64Decode(body) || body;
        const nodeLine = full.split(/\r?\n/).find(l => /^[a-z0-9]+:\/\//i.test(l) && l.indexOf("remark=") !== -1);
        if (nodeLine) {
          // 节点的 base64 userinfo 段里可能藏流量
          const rm = nodeLine.match(/remark=([^&]+)/);
          if (rm) {
            let txt = rm[1];
            try { txt = decodeURIComponent(txt); } catch (e) {}
            let mm = txt.match(/(?:剩余流量|剩余)\s*[:：]?\s*([\d.]+\s*[KMGTP]?B?)/i);
            if (mm) {
              result.info.remainRaw = toBytes(mm[1]);
              if (result.source === "无") result.source = "节点备注";
            }
            mm = txt.match(/(?:到期|Expires?)\s*[:：]?\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2})/i);
            if (mm && result.info.expire === "未知") {
              result.info.expire = mm[1].replace(/\//g, "-");
              if (result.source === "无") result.source = "节点备注";
            }
          }
        }
      }

      if (result.source === "无") {
        result.ok = false;
        result.error = "未识别到流量信息\n(响应头与响应体均无有效字段)";
      }

      resolve(result);
    });
  });
}

// ============================================================
// 组装单机场文本
// ============================================================

function renderOne(r) {
  if (!r.ok) {
    return "❌ " + r.name + "\n   请求失败：" + r.error + "\n";
  }
  const i = r.info;
  const up = formatBytes(i.upload);
  const dn = formatBytes(i.download);
  const tot = formatBytes(i.total);
  const rem = calcRemain(i);

  let s = "🌐 " + r.name + "\n";
  s += "   ⬆️ 上传：" + up + "\n";
  s += "   ⬇️ 下载：" + dn + "\n";
  s += "   📊 总量：" + tot + "\n";
  s += "   💚 剩余：" + rem + "\n";
  s += "   ⏰ 到期：" + i.expire + "\n";
  return s;
}

// ============================================================
// 主流程
// ============================================================

(async () => {
  const parsed = readSubLinks();
  if (parsed.error) return bail("❗️参数错误", parsed.error);

  const links = parsed.links;
  console.log("共 " + links.length + " 个机场订阅, 顺序查询");

  const results = [];
  // 顺序执行, 每个之间留间隔, 避免被机场封锁
  for (let i = 0; i < links.length; i++) {
    if (i > 0) {
      await new Promise(res => {
        if (typeof setTimeout !== "undefined") {
          setTimeout(res, 1500);
        } else if (typeof $wait !== "undefined") {
          $wait(1500);
          res();
        } else {
          res();
        }
      });
    }
    const r = await queryOne(links[i], i);
    results.push(r);
  }

  // ---- 汇总 ----
  let msg = "";
  for (const r of results) {
    msg += renderOne(r);
    if (r.ok) msg += "   ━━━━━━━━━━━━━\n";
  }

  if (results.length > 1) {
    const bad = results.filter(r => !r.ok).length;
    msg += bad === 0
      ? "✅ " + results.length + " 个机场全部查询成功\n"
      : "⚠️ " + results.length + " 个机场, " + bad + " 个失败\n";
  }

  const now = new Date();
  const p = x => String(x).padStart(2, "0");
  msg += "🕐 " + now.getFullYear() + "-" + p(now.getMonth() + 1) + "-" + p(now.getDate()) +
         " " + p(now.getHours()) + ":" + p(now.getMinutes());

  notify("📡 机场流量汇总", msg);
  done();
})();
