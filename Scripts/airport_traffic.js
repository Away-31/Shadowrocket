/**
 * Shadowrocket / Surge / Quantumult X
 * 机场流量查询 v2.0
 *
 * 功能：
 * 1. 支持 subscription-userinfo 响应头
 * 2. 支持 Base64 订阅 Body
 * 3. 支持 nowjiasu STATUS 格式
 * 4. 自动识别上传 / 下载 / 总量 / 剩余 / 到期时间
 * 5. 自动计算剩余流量
 * 6. 自动计算使用率
 * 7. 自动识别机场名称
 * 8. 支持多个机场
 * 9. 支持 URL 内部包含 &
 * 10. 支持 Shadowrocket Cron
 *
 * 多机场格式：
 *
 * https://sub1.com/xxx|https://sub2.com/xxx
 *
 * 注意：
 * | 是多个机场之间的分隔符
 * URL 内部的 & 不会被拆分
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
// 读取参数
// ============================================================

function readSubLinks() {

  const raw =
    (typeof $argument !== "undefined" && $argument)
      ? String($argument)
      : "";

  console.log("原始参数: " + raw);

  if (!raw) {
    return {
      error: "❗️未填写机场订阅链接\n请在模块参数中填写"
    };
  }

  let payload = raw;

  // ----------------------------------------------------------
  // 支持：
  //
  // 机场订阅链接=https://xxx
  // ----------------------------------------------------------

  let m = raw.match(/机场订阅链接\s*=\s*([\s\S]+)/);

  if (m) {
    payload = m[1];
  } else {

    // 兼容：
    //
    // xxx=https://xxx
    //

    const k = raw.match(/^\s*[^=]*=\s*([\s\S]+)$/);

    if (k) {
      payload = k[1];
    }
  }

  // ----------------------------------------------------------
  // URL decode
  // ----------------------------------------------------------

  try {
    payload = decodeURIComponent(payload);
  } catch (e) {
    console.log("URL 解码跳过: " + e);
  }

  payload = payload.trim();

  // ----------------------------------------------------------
  // 如果整个参数本身是 Base64
  // ----------------------------------------------------------

  const b64try = base64Decode(payload);

  if (
    b64try &&
    /https?:\/\//i.test(b64try) &&
    !/https?:\/\//i.test(payload)
  ) {
    console.log("参数为 Base64，已解码");
    payload = b64try;
  }

  // ----------------------------------------------------------
  // 多机场分隔符
  //
  // 支持：
  // 换行
  // ,
  // ;
  // 、 
  // |
  //
  // 不使用 &，因为 & 可能属于 URL Query 参数
  // ----------------------------------------------------------

  const parts = payload
    .split(/[\r\n,;、|]+/)
    .map(s => s.trim())
    .filter(Boolean);

  const links = [];

  for (const p of parts) {

    // 一条内容里面可能直接粘贴了多个 URL
    const found = p.match(
      /https?:\/\/[^\s,;、|]+/gi
    );

    if (found) {

      for (const f of found) {
        links.push(f);
      }

    } else if (p) {

      console.log(
        "忽略非链接项: " +
        p.slice(0, 100)
      );
    }
  }

  // ----------------------------------------------------------
  // 去重
  // ----------------------------------------------------------

  const uniq = [];

  for (const link of links) {

    if (uniq.indexOf(link) === -1) {
      uniq.push(link);
    }
  }

  if (uniq.length === 0) {

    return {
      error:
        "⚠️ 无有效订阅链接\n\n" +
        "请检查模块中的「机场订阅链接地址」"
    };
  }

  return {
    links: uniq
  };
}


// ============================================================
// Base64
// ============================================================

const B64CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";


function base64Decode(input) {

  try {

    if (!input) {
      return "";
    }

    let str = String(input)
      .replace(/[\r\n\t ]+/g, "")
      .replace(/-/g, "+")
      .replace(/_/g, "/");

    str = str.replace(
      /[^A-Za-z0-9+/=]/g,
      ""
    );

    while (str.length % 4 !== 0) {
      str += "=";
    }

    // --------------------------------------------------------
    // atob
    // --------------------------------------------------------

    if (typeof atob !== "undefined") {

      try {

        const bin = atob(str);

        let out = "";

        for (let i = 0; i < bin.length; i++) {

          const c = bin.charCodeAt(i);

          if (c < 0x80) {

            out += String.fromCharCode(c);

          } else if (c < 0xE0) {

            out += String.fromCharCode(
              ((c & 0x1F) << 6) |
              (bin.charCodeAt(++i) & 0x3F)
            );

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

            out += String.fromCharCode(
              0xD800 + (off >> 10),
              0xDC00 + (off & 0x3FF)
            );
          }
        }

        return out;

      } catch (e) {

        console.log(
          "atob 解码失败，尝试备用 Base64 解码"
        );
      }
    }

    // --------------------------------------------------------
    // 手动 Base64
    // --------------------------------------------------------

    let output = "";
    let i = 0;

    while (i < str.length) {

      const e1 =
        B64CHARS.indexOf(str.charAt(i++));

      const e2 =
        B64CHARS.indexOf(str.charAt(i++));

      const e3 =
        B64CHARS.indexOf(str.charAt(i++));

      const e4 =
        B64CHARS.indexOf(str.charAt(i++));

      if (e1 < 0 || e2 < 0) {
        break;
      }

      const c1 =
        (e1 << 2) |
        (e2 >> 4);

      output +=
        String.fromCharCode(c1);

      if (e3 >= 0) {

        const c2 =
          ((e2 & 15) << 4) |
          (e3 >> 2);

        output +=
          String.fromCharCode(c2);
      }

      if (e4 >= 0) {

        const c3 =
          ((e3 & 3) << 6) |
          e4;

        output +=
          String.fromCharCode(c3);
      }
    }

    return utf8Decode(output);

  } catch (e) {

    console.log(
      "Base64 解码异常: " + e
    );

    return "";
  }
}


// ============================================================
// UTF-8 解码
// ============================================================

function utf8Decode(str) {

  try {

    let out = "";

    for (
      let i = 0;
      i < str.length;
      i++
    ) {

      const c =
        str.charCodeAt(i);

      if (c < 0x80) {

        out +=
          String.fromCharCode(c);

      } else if (c < 0xE0) {

        out += String.fromCharCode(
          ((c & 0x1F) << 6) |
          (str.charCodeAt(++i) & 0x3F)
        );

      } else if (c < 0xF0) {

        out += String.fromCharCode(
          ((c & 0x0F) << 12) |
          ((str.charCodeAt(++i) & 0x3F) << 6) |
          (str.charCodeAt(++i) & 0x3F)
        );

      } else {

        const cp =
          ((c & 0x07) << 18) |
          ((str.charCodeAt(++i) & 0x3F) << 12) |
          ((str.charCodeAt(++i) & 0x3F) << 6) |
          (str.charCodeAt(++i) & 0x3F);

        const off = cp - 0x10000;

        out += String.fromCharCode(
          0xD800 + (off >> 10),
          0xDC00 + (off & 0x3FF)
        );
      }
    }

    return out;

  } catch (e) {

    return str;
  }
}


// ============================================================
// 流量单位
// ============================================================

const UNIT = {

  B: 1,

  KB: 1024,
  MB: 1024 * 1024,
  GB: 1024 * 1024 * 1024,
  TB: 1024 * 1024 * 1024 * 1024,
  PB: 1024 * 1024 * 1024 * 1024 * 1024,

  K: 1024,
  M: 1024 * 1024,
  G: 1024 * 1024 * 1024,
  T: 1024 * 1024 * 1024 * 1024
};


function toBytes(val) {

  if (
    val === undefined ||
    val === null ||
    val === ""
  ) {
    return NaN;
  }

  if (typeof val === "number") {

    return isNaN(val)
      ? NaN
      : val;
  }

  const m =
    String(val)
      .replace(/,/g, "")
      .trim()
      .match(
        /(-?\d+(?:\.\d+)?)\s*([KMGTP]?B?)/i
      );

  if (!m) {
    return NaN;
  }

  const num =
    parseFloat(m[1]);

  const unit =
    (m[2] || "B").toUpperCase();

  const mul =
    UNIT[unit] ||
    UNIT[unit.replace(/B$/, "")] ||
    1;

  return num * mul;
}


// ============================================================
// 字节 -> 可读
// ============================================================

function formatBytes(bytes) {

  const n =
    toBytes(bytes);

  if (isNaN(n)) {
    return "未知";
  }

  const units =
    ["B", "KB", "MB", "GB", "TB"];

  let value = n;
  let index = 0;

  while (
    value >= 1024 &&
    index < units.length - 1
  ) {

    value /= 1024;
    index++;
  }

  return (
    value.toFixed(2) +
    units[index]
  );
}


// ============================================================
// 百分比
// ============================================================

function formatPercent(used, total) {

  if (
    isNaN(used) ||
    isNaN(total) ||
    total <= 0
  ) {
    return "未知";
  }

  let percent =
    used / total * 100;

  if (percent < 0) {
    percent = 0;
  }

  if (percent > 100) {
    percent = 100;
  }

  return percent.toFixed(2) + "%";
}


// ============================================================
// 日期格式
// ============================================================

function formatExpire(ts) {

  if (
    ts === undefined ||
    ts === null ||
    ts === ""
  ) {
    return "未知";
  }

  // ----------------------------------------------------------
  // 已经是日期
  // ----------------------------------------------------------

  if (
    typeof ts === "string" &&
    /\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(ts)
  ) {

    const m =
      ts.match(
        /(\d{4})[-/](\d{1,2})[-/](\d{1,2})/
      );

    if (m) {

      return (
        m[1] +
        "-" +
        String(m[2]).padStart(2, "0") +
        "-" +
        String(m[3]).padStart(2, "0")
      );
    }
  }

  const n =
    Number(ts);

  if (
    !n ||
    isNaN(n)
  ) {
    return "未知";
  }

  // 允许毫秒时间戳
  const millis =
    n > 4102444800
      ? n
      : n * 1000;

  const d =
    new Date(millis);

  if (
    isNaN(d.getTime())
  ) {
    return "未知";
  }

  const p =
    x => String(x).padStart(2, "0");

  return (
    d.getFullYear() +
    "-" +
    p(d.getMonth() + 1) +
    "-" +
    p(d.getDate())
  );
}


// ============================================================
// 提取日期
// ============================================================

function extractExpire(text) {

  if (!text) {
    return "未知";
  }

  // ----------------------------------------------------------
  // 2026-09-28
  // 2026/09/28
  // ----------------------------------------------------------

  let m =
    text.match(
      /(?:Expires?|Expire|到期(?:时间)?|过期(?:时间)?)\s*[:：=]?\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?)/i
    );

  if (m) {
    return formatExpire(m[1]);
  }

  // ----------------------------------------------------------
  // expire=1234567890
  // ----------------------------------------------------------

  m =
    text.match(
      /(?:expire|expires|expiry|expired_at)\s*[:：=]?\s*(\d{10,13})/i
    );

  if (m) {
    return formatExpire(m[1]);
  }

  return "未知";
}


// ============================================================
// 解析 nowjiasu STATUS
//
// 示例:
//
// STATUS=🚀↑:8.55GB,↓:48.56GB,TOT:100GB💡Expires:2026-09-28
// ============================================================

function parseStatusLine(line) {

  if (!line) {
    return null;
  }

  const text =
    String(line).trim();

  const info = {

    upload: NaN,
    download: NaN,
    total: NaN,
    used: NaN,
    remainRaw: NaN,
    expire: "未知"
  };

  // ----------------------------------------------------------
  // 上传
  // ----------------------------------------------------------

  let m =
    text.match(
      /(?:↑|⬆️|⬆|Upload|upload|上传)\s*[:：=]?\s*([\d.,]+\s*[KMGTP]?B?)/i
    );

  if (m) {
    info.upload =
      toBytes(m[1]);
  }

  // ----------------------------------------------------------
  // 下载
  // ----------------------------------------------------------

  m =
    text.match(
      /(?:↓|⬇️|⬇|Download|download|下载)\s*[:：=]?\s*([\d.,]+\s*[KMGTP]?B?)/i
    );

  if (m) {
    info.download =
      toBytes(m[1]);
  }

  // ----------------------------------------------------------
  // 总量
  // ----------------------------------------------------------

  m =
    text.match(
      /(?:TOT|TOTAL|Total|总量|流量|Traffic)\s*[:：=]?\s*([\d.,]+\s*[KMGTP]?B?)/i
    );

  if (m) {
    info.total =
      toBytes(m[1]);
  }

  // ----------------------------------------------------------
  // 剩余
  // ----------------------------------------------------------

  m =
    text.match(
      /(?:剩余流量|剩余|Remaining|Remain|Left)\s*[:：=]?\s*([\d.,]+\s*[KMGTP]?B?)/i
    );

  if (m) {
    info.remainRaw =
      toBytes(m[1]);
  }

  // ----------------------------------------------------------
  // 已用
  // ----------------------------------------------------------

  m =
    text.match(
      /(?:已用流量|已用|Used)\s*[:：=]?\s*([\d.,]+\s*[KMGTP]?B?)/i
    );

  if (m) {
    info.used =
      toBytes(m[1]);
  }

  // ----------------------------------------------------------
  // 到期
  // ----------------------------------------------------------

  info.expire =
    extractExpire(text);

  // ----------------------------------------------------------
  // 判断是否有效
  // ----------------------------------------------------------

  if (
    isNaN(info.upload) &&
    isNaN(info.download) &&
    isNaN(info.total) &&
    isNaN(info.remainRaw)
  ) {
    return null;
  }

  return info;
}


// ============================================================
// 解析 subscription-userinfo
//
// upload=xxx; download=xxx; total=xxx; expire=xxx
// ============================================================

function parseUserinfo(header) {

  if (!header) {
    return null;
  }

  const text =
    String(header);

  const info = {

    upload: NaN,
    download: NaN,
    total: NaN,
    used: NaN,
    remainRaw: NaN,
    expire: "未知"
  };

  let m =
    text.match(
      /(?:^|[;\s])upload\s*=\s*(\d+(?:\.\d+)?)/i
    );

  if (m) {
    info.upload =
      Number(m[1]);
  }

  m =
    text.match(
      /(?:^|[;\s])download\s*=\s*(\d+(?:\.\d+)?)/i
    );

  if (m) {
    info.download =
      Number(m[1]);
  }

  m =
    text.match(
      /(?:^|[;\s])total\s*=\s*(\d+(?:\.\d+)?)/i
    );

  if (m) {
    info.total =
      Number(m[1]);
  }

  m =
    text.match(
      /(?:^|[;\s])expire\s*=\s*(\d+)/i
    );

  if (m) {
    info.expire =
      formatExpire(m[1]);
  }

  if (
    isNaN(info.upload) &&
    isNaN(info.download) &&
    isNaN(info.total)
  ) {
    return null;
  }

  return info;
}


// ============================================================
// 计算已用
// ============================================================

function calcUsed(info) {

  // 优先使用明确的 Used
  if (
    !isNaN(info.used)
  ) {
    return info.used;
  }

  // 上传 + 下载
  if (
    !isNaN(info.upload) &&
    !isNaN(info.download)
  ) {

    return (
      info.upload +
      info.download
    );
  }

  return NaN;
}


// ============================================================
// 计算剩余
// ============================================================

function calcRemainBytes(info) {

  // ----------------------------------------------------------
  // 机场直接提供剩余
  // ----------------------------------------------------------

  if (
    info.remainRaw !== undefined &&
    !isNaN(info.remainRaw)
  ) {

    return info.remainRaw;
  }

  // ----------------------------------------------------------
  // 总量 - 已用
  // ----------------------------------------------------------

  const used =
    calcUsed(info);

  if (
    !isNaN(info.total) &&
    !isNaN(used)
  ) {

    const remain =
      info.total - used;

    return Math.max(
      0,
      remain
    );
  }

  return NaN;
}


// ============================================================
// 从 URL 提取域名
// ============================================================

function getHost(url) {

  try {

    const m =
      String(url).match(
        /^https?:\/\/([^\/?#]+)/i
      );

    if (!m) {
      return "";
    }

    return m[1]
      .split(":")[0]
      .toLowerCase();

  } catch (e) {

    return "";
  }
}


// ============================================================
// 根据域名识别机场名称
// ============================================================

function getNameFromHost(host) {

  if (!host) {
    return "";
  }

  const known = {

    "hi.nowjiasu.com":
      "NowJiasu",

    "nowjiasu.com":
      "NowJiasu",

    "www.nowjiasu.com":
      "NowJiasu"
  };

  if (known[host]) {
    return known[host];
  }

  // ----------------------------------------------------------
  // 去掉常见前缀
  // ----------------------------------------------------------

  let name =
    host
      .replace(/^www\./i, "")
      .replace(/^sub\./i, "")
      .replace(/^api\./i, "")
      .replace(/^proxy\./i, "")
      .replace(/^subscribe\./i, "")
      .replace(/^hi\./i, "");

  const parts =
    name.split(".");

  if (parts.length >= 2) {

    name =
      parts[parts.length - 2];
  }

  // ----------------------------------------------------------
  // 常见域名名称
  // ----------------------------------------------------------

  const map = {

    nowjiasu:
      "NowJiasu",

    jiasu:
      "Jiasu",

    airport:
      "Airport",

    clash:
      "Clash",

    shadowrocket:
      "Shadowrocket",

    node:
      "Node",

    proxy:
      "Proxy"
  };

  if (map[name.toLowerCase()]) {
    return map[name.toLowerCase()];
  }

  // 首字母大写
  if (name) {

    return name.charAt(0).toUpperCase() +
      name.slice(1);
  }

  return "";
}


// ============================================================
// 从响应头识别机场名称
// ============================================================

function getNameFromHeaders(headers) {

  if (!headers) {
    return "";
  }

  const candidates = [

    "subscription-name",
    "Subscription-Name",

    "subscription-title",
    "Subscription-Title",

    "x-subscription-name",
    "X-Subscription-Name",

    "x-subscription-title",
    "X-Subscription-Title",

    "profile-title",
    "Profile-Title",

    "profile-name",
    "Profile-Name"
  ];

  for (const key of candidates) {

    if (
      headers[key] &&
      String(headers[key]).trim()
    ) {

      let value =
        String(headers[key]).trim();

      try {
        value =
          decodeURIComponent(value);
      } catch (e) {}

      // 去掉 Content-Disposition 类型内容
      value =
        value.replace(
          /^["']|["']$/g,
          ""
        );

      if (value) {
        return value;
      }
    }
  }

  // ----------------------------------------------------------
  // Content-Disposition
  // ----------------------------------------------------------

  const cd =
    headers["content-disposition"] ||
    headers["Content-Disposition"];

  if (cd) {

    let m =
      String(cd).match(
        /filename\*?=(?:UTF-8''|")?([^";]+)/i
      );

    if (m) {

      try {
        return decodeURIComponent(
          m[1]
        );
      } catch (e) {

        return m[1];
      }
    }
  }

  return "";
}


// ============================================================
// 从 Body 中寻找机场名称
// ============================================================

function getNameFromBody(text) {

  if (!text) {
    return "";
  }

  // ----------------------------------------------------------
  // 常见字段
  // ----------------------------------------------------------

  const patterns = [

    /(?:机场名称|机场名|订阅名称|订阅名|站点名称|站点名|名称|Name|Title)\s*[:：=]\s*["']?([^"\r\n,;]+)["']?/i,

    /(?:remark|server_name|site_name)\s*[:：=]\s*["']?([^"\r\n,;]+)["']?/i
  ];

  for (const pattern of patterns) {

    const m =
      text.match(pattern);

    if (m) {

      const name =
        String(m[1]).trim();

      if (
        name &&
        name.length <= 50
      ) {
        return name;
      }
    }
  }

  return "";
}


// ============================================================
// 查询单个机场
// ============================================================

function queryOne(url, index) {

  return new Promise((resolve) => {

    const headers = {

      "cache-control":
        "no-cache",

      "accept":
        "*/*",

      "accept-language":
        "zh-CN,zh-Hans;q=0.9",

      "user-agent":
        "Shadowrocket/2615 CFNetwork/3826.500.131 Darwin/24.5.0 iPhone14,3"
    };

    $httpClient.get(
      {
        url: url,
        headers: headers,
        timeout: 20
      },

      function (
        error,
        response,
        data
      ) {

        // ----------------------------------------------------
        // 请求失败
        // ----------------------------------------------------

        if (
          error ||
          !response ||
          (
            response.status &&
            response.status !== 200
          )
        ) {

          const msg =
            error ||
            (
              response
                ? "HTTP " +
                  response.status
                : "无响应"
            );

          resolve({

            index: index,

            ok: false,

            name:
              getNameFromHost(
                getHost(url)
              ) ||
              "机场 " +
              (index + 1),

            error:
              String(msg),

            url: url
          });

          return;
        }

        const H =
          response.headers ||
          {};

        const body =
          (
            data === undefined ||
            data === null
          )
            ? ""
            : String(data);

        // ----------------------------------------------------
        // 初始化
        // ----------------------------------------------------

        const host =
          getHost(url);

        let name =
          getNameFromHeaders(H);

        if (!name) {
          name =
            getNameFromHost(host);
        }

        if (!name) {
          name =
            "机场 " +
            (index + 1);
        }

        const result = {

          index: index,

          ok: true,

          name: name,

          info: {

            upload: NaN,
            download: NaN,
            total: NaN,
            used: NaN,
            remainRaw: NaN,
            expire: "未知"
          },

          source: "无",

          url: url
        };


        // ====================================================
        // 1. subscription-userinfo
        // ====================================================

        const uiHeader =
          H["subscription-userinfo"] ||
          H["Subscription-Userinfo"] ||
          H["SUBSCRIPTION-USERINFO"];

        if (uiHeader) {

          const p =
            parseUserinfo(
              uiHeader
            );

          if (p) {

            result.info =
              p;

            result.source =
              "响应头";

            console.log(
              "[" +
              (index + 1) +
              "] subscription-userinfo: " +
              uiHeader
            );
          }
        }


        // ====================================================
        // 2. Base64 / 明文 Body
        // ====================================================

        const decoded =
          base64Decode(body);

        console.log(
          "[" +
          (index + 1) +
          "] Body 长度: " +
          body.length
        );

        if (decoded) {

          console.log(
            "[" +
            (index + 1) +
            "] Base64 解码长度: " +
            decoded.length
          );
        }


        // ----------------------------------------------------
        // 创建多个候选文本
        // ----------------------------------------------------

        const candidates = [];

        // 原始 body
        if (body) {
          candidates.push(body);
        }

        // Base64 解码后的 body
        if (
          decoded &&
          decoded !== body
        ) {
          candidates.push(decoded);
        }


        // ====================================================
        // 3. 搜索 STATUS
        // ====================================================

        for (
          const candidate of candidates
        ) {

          if (
            result.source !== "无"
          ) {
            break;
          }

          const statusMatches =
            candidate.match(
              /STATUS\s*=[^\r\n]*/gi
            );

          if (
            statusMatches &&
            statusMatches.length
          ) {

            for (
              const line
              of statusMatches
            ) {

              const p =
                parseStatusLine(
                  line
                );

              if (p) {

                result.info =
                  mergeInfo(
                    result.info,
                    p
                  );

                result.source =
                  "响应体 STATUS";

                console.log(
                  "[" +
                  (index + 1) +
                  "] 命中 STATUS: " +
                  line
                );

                break;
              }
            }
          }
        }


        // ====================================================
        // 4. 全文寻找流量字段
        // ====================================================

        const allText =
          decoded || body;

        const generic =
          parseGenericTraffic(
            allText
          );

        if (generic) {

          result.info =
            mergeInfo(
              result.info,
              generic
            );

          if (
            result.source === "无"
          ) {

            result.source =
              "响应体字段";
          }
        }


        // ====================================================
        // 5. 尝试从正文识别机场名称
        // ====================================================

        if (
          !getNameFromHeaders(H)
        ) {

          const bodyName =
            getNameFromBody(
              allText
            );

          if (bodyName) {
            result.name =
              bodyName;
          }
        }


        // ====================================================
        // 6. 节点备注中寻找信息
        // ====================================================

        parseRemarkInfo(
          allText,
          result
        );


        // ====================================================
        // 7. 到期时间兜底
        // ====================================================

        if (
          result.info.expire ===
          "未知"
        ) {

          result.info.expire =
            extractExpire(
              allText
            );
        }


        // ====================================================
        // 8. 判断结果
        // ====================================================

        if (
          isNaN(result.info.upload) &&
          isNaN(result.info.download) &&
          isNaN(result.info.total) &&
          isNaN(result.info.remainRaw)
        ) {

          result.ok = false;

          result.error =
            "未识别到流量信息\n" +
            "(响应头与响应体均无有效字段)";
        }


        // ----------------------------------------------------
        // 调试日志
        // ----------------------------------------------------

        console.log(
          "[" +
          (index + 1) +
          "] 名称: " +
          result.name
        );

        console.log(
          "[" +
          (index + 1) +
          "] 来源: " +
          result.source
        );

        console.log(
          "[" +
          (index + 1) +
          "] 上传: " +
          formatBytes(
            result.info.upload
          )
        );

        console.log(
          "[" +
          (index + 1) +
          "] 下载: " +
          formatBytes(
            result.info.download
          )
        );

        console.log(
          "[" +
          (index + 1) +
          "] 总量: " +
          formatBytes(
            result.info.total
          )
        );

        resolve(result);
      }
    );
  });
}


// ============================================================
// 合并解析结果
// ============================================================

function mergeInfo(oldInfo, newInfo) {

  const result = {
    upload: oldInfo.upload,
    download: oldInfo.download,
    total: oldInfo.total,
    used: oldInfo.used,
    remainRaw: oldInfo.remainRaw,
    expire: oldInfo.expire
  };

  if (
    newInfo &&
    !isNaN(newInfo.upload)
  ) {
    result.upload =
      newInfo.upload;
  }

  if (
    newInfo &&
    !isNaN(newInfo.download)
  ) {
    result.download =
      newInfo.download;
  }

  if (
    newInfo &&
    !isNaN(newInfo.total)
  ) {
    result.total =
      newInfo.total;
  }

  if (
    newInfo &&
    !isNaN(newInfo.used)
  ) {
    result.used =
      newInfo.used;
  }

  if (
    newInfo &&
    !isNaN(newInfo.remainRaw)
  ) {
    result.remainRaw =
      newInfo.remainRaw;
  }

  if (
    newInfo &&
    newInfo.expire &&
    newInfo.expire !== "未知"
  ) {
    result.expire =
      newInfo.expire;
  }

  return result;
}


// ============================================================
// 通用流量字段解析
// ============================================================

function parseGenericTraffic(text) {

  if (!text) {
    return null;
  }

  const info = {

    upload: NaN,
    download: NaN,
    total: NaN,
    used: NaN,
    remainRaw: NaN,
    expire: "未知"
  };

  // ----------------------------------------------------------
  // 上传
  // ----------------------------------------------------------

  let m =
    text.match(
      /(?:upload|uploaded|upload_traffic|up|上传)\s*[:：=]\s*["']?([\d.,]+\s*[KMGTP]?B?)["']?/i
    );

  if (m) {
    info.upload =
      toBytes(m[1]);
  }

  // ----------------------------------------------------------
  // 下载
  // ----------------------------------------------------------

  m =
    text.match(
      /(?:download|downloaded|download_traffic|down|下载)\s*[:：=]\s*["']?([\d.,]+\s*[KMGTP]?B?)["']?/i
    );

  if (m) {
    info.download =
      toBytes(m[1]);
  }

  // ----------------------------------------------------------
  // 总量
  // ----------------------------------------------------------

  m =
    text.match(
      /(?:transfer_enable|transfer|total|total_traffic|traffic|总量|流量)\s*[:：=]\s*["']?([\d.,]+\s*[KMGTP]?B?)["']?/i
    );

  if (m) {
    info.total =
      toBytes(m[1]);
  }

  // ----------------------------------------------------------
  // 剩余
  // ----------------------------------------------------------

  m =
    text.match(
      /(?:remaining|remain|remaining_traffic|left|剩余流量|剩余)\s*[:：=]\s*["']?([\d.,]+\s*[KMGTP]?B?)["']?/i
    );

  if (m) {
    info.remainRaw =
      toBytes(m[1]);
  }

  // ----------------------------------------------------------
  // 已用
  // ----------------------------------------------------------

  m =
    text.match(
      /(?:used|used_traffic|usage|已用流量|已用)\s*[:：=]\s*["']?([\d.,]+\s*[KMGTP]?B?)["']?/i
    );

  if (m) {
    info.used =
      toBytes(m[1]);
  }

  // ----------------------------------------------------------
  // 到期
  // ----------------------------------------------------------

  info.expire =
    extractExpire(text);

  if (
    isNaN(info.upload) &&
    isNaN(info.download) &&
    isNaN(info.total) &&
    isNaN(info.remainRaw)
  ) {

    return null;
  }

  return info;
}


// ============================================================
// 节点 remark 解析
// ============================================================

function parseRemarkInfo(text, result) {

  if (!text) {
    return;
  }

  // ----------------------------------------------------------
  // 剩余流量
  // ----------------------------------------------------------

  let m =
    text.match(
      /(?:剩余流量|剩余|remaining|remain|left)\s*[:：=]\s*([\d.,]+\s*[KMGTP]?B?)/i
    );

  if (m) {

    result.info.remainRaw =
      toBytes(m[1]);

    if (
      result.source === "无"
    ) {

      result.source =
        "节点备注";
    }
  }

  // ----------------------------------------------------------
  // 到期
  // ----------------------------------------------------------

  if (
    result.info.expire ===
    "未知"
  ) {

    const expire =
      extractExpire(text);

    if (
      expire !== "未知"
    ) {

      result.info.expire =
        expire;

      if (
        result.source === "无"
      ) {

        result.source =
          "节点备注";
      }
    }
  }
}


// ============================================================
// 组装单机场文本
// ============================================================

function renderOne(r) {

  if (!r.ok) {

    return (
      "❌ " +
      r.name +
      "\n" +
      "   请求失败：" +
      r.error +
      "\n"
    );
  }

  const i =
    r.info;

  const up =
    formatBytes(
      i.upload
    );

  const dn =
    formatBytes(
      i.download
    );

  const tot =
    formatBytes(
      i.total
    );

  // ----------------------------------------------------------
  // 已用
  // ----------------------------------------------------------

  const usedBytes =
    calcUsed(i);

  const used =
    formatBytes(
      usedBytes
    );

  // ----------------------------------------------------------
  // 剩余
  // ----------------------------------------------------------

  const remainBytes =
    calcRemainBytes(i);

  const remain =
    formatBytes(
      remainBytes
    );

  // ----------------------------------------------------------
  // 使用率
  // ----------------------------------------------------------

  const percent =
    formatPercent(
      usedBytes,
      i.total
    );

  // ----------------------------------------------------------
  // 输出
  // ----------------------------------------------------------

  let s =
    "🌐 " +
    r.name +
    "\n";

  s +=
    "   ⬆️ 上传：" +
    up +
    "\n";

  s +=
    "   ⬇️ 下载：" +
    dn +
    "\n";

  s +=
    "   📊 已用：" +
    used +
    " / " +
    tot +
    "\n";

  s +=
    "   💚 剩余：" +
    remain +
    "\n";

  s +=
    "   📈 使用率：" +
    percent +
    "\n";

  s +=
    "   ⏰ 到期：" +
    i.expire +
    "\n";

  s +=
    "   🔎 来源：" +
    r.source +
    "\n";

  return s;
}


// ============================================================
// 主流程
// ============================================================

(async () => {

  // ----------------------------------------------------------
  // 读取参数
  // ----------------------------------------------------------

  const parsed =
    readSubLinks();

  if (parsed.error) {

    return bail(
      "❗️参数错误",
      parsed.error
    );
  }

  const links =
    parsed.links;

  console.log(
    "共 " +
    links.length +
    " 个机场订阅"
  );


  // ----------------------------------------------------------
  // 顺序查询
  // ----------------------------------------------------------

  const results = [];

  for (
    let i = 0;
    i < links.length;
    i++
  ) {

    if (i > 0) {

      await new Promise(
        resolve => {

          if (
            typeof setTimeout !==
            "undefined"
          ) {

            setTimeout(
              resolve,
              1500
            );

          } else {

            resolve();
          }
        }
      );
    }

    const result =
      await queryOne(
        links[i],
        i
      );

    results.push(result);
  }


  // ----------------------------------------------------------
  // 汇总
  // ----------------------------------------------------------

  let msg = "";

  for (
    const result of results
  ) {

    msg +=
      renderOne(result);

    msg +=
      "   ━━━━━━━━━━━━━\n";
  }


  // ----------------------------------------------------------
  // 成功 / 失败统计
  // ----------------------------------------------------------

  const failed =
    results.filter(
      r => !r.ok
    ).length;

  if (
    results.length > 1
  ) {

    if (
      failed === 0
    ) {

      msg +=
        "✅ " +
        results.length +
        " 个机场全部查询成功\n";

    } else {

      msg +=
        "⚠️ " +
        results.length +
        " 个机场，" +
        failed +
        " 个失败\n";
    }
  }


  // ----------------------------------------------------------
  // 查询时间
  // ----------------------------------------------------------

  const now =
    new Date();

  const p =
    x =>
      String(x)
        .padStart(2, "0");

  msg +=
    "🕐 " +
    now.getFullYear() +
    "-" +
    p(now.getMonth() + 1) +
    "-" +
    p(now.getDate()) +
    " " +
    p(now.getHours()) +
    ":" +
    p(now.getMinutes());


  // ----------------------------------------------------------
  // 通知
  // ----------------------------------------------------------

  notify(
    "📡 机场流量汇总",
    msg
  );

  done();

})();
