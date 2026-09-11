/**
 * ============================================================
 * 📊 Shadowrocket 机场流量查询 Pro
 * ============================================================
 *
 * 支持：
 *
 * 1. Shadowrocket
 * 2. Surge
 * 3. Quantumult X（基础兼容）
 *
 * 功能：
 *
 * - 多机场订阅
 * - subscription-userinfo 响应头解析
 * - Base64 Body 解析
 * - STATUS 格式解析
 * - Clash / V2Ray 常见订阅格式
 * - 上传
 * - 下载
 * - 总流量
 * - 已使用
 * - 剩余
 * - 使用率
 * - 到期时间
 * - Unix 时间戳
 * - GB / TB / MB 等单位
 * - 多机场汇总通知
 * - 单机场失败不影响其他机场
 *
 * 参数：
 *
 * 机场订阅链接=https://xxx.com/link1|https://xxx.com/link2
 * 请求超时时间=10
 *
 * ============================================================
 */

const $utils = (() => {

  const isSurge =
    typeof $httpClient !== "undefined";

  const isQuanX =
    typeof $task !== "undefined";

  /**
   * 通知
   */
  const notify = (title, message) => {

    try {

      if (isSurge && typeof $notification !== "undefined") {

        $notification.post(
          title,
          "",
          message
        );

        return;
      }

      if (isQuanX && typeof $notify !== "undefined") {

        $notify(
          title,
          "",
          message
        );

        return;
      }

      console.log(
        `[通知] ${title}\n${message}`
      );

    } catch (e) {

      console.log(
        `通知发送失败：${e}`
      );

    }

  };


  /**
   * 结束脚本
   */
  const done = () => {

    try {

      if (typeof $done === "function") {

        $done();

      }

    } catch (e) {

      console.log(
        `脚本结束失败：${e}`
      );

    }

  };


  return {
    notify,
    done
  };

})();


/**
 * ============================================================
 * 参数解析
 * ============================================================
 */

const rawArgument =
  typeof $argument !== "undefined"
    ? ($argument || "")
    : "";


/**
 * 获取参数
 */
function getArgument(name) {

  if (!rawArgument) {
    return "";
  }

  const regex =
    new RegExp(
      "(?:^|&)" +
      name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
      "=([^&]*)"
    );

  const match =
    rawArgument.match(regex);

  if (!match) {
    return "";
  }

  try {

    return decodeURIComponent(
      match[1]
    );

  } catch (e) {

    return match[1];

  }

}


/**
 * 机场订阅地址
 */
let subListRaw =
  getArgument("机场订阅链接");


/**
 * 如果是直接脚本运行，也兼容：
 *
 * $argument =
 * 机场订阅链接=https://...
 */
if (!subListRaw) {

  const match =
    rawArgument.match(
      /机场订阅链接=(.+)/
    );

  if (match) {

    try {

      subListRaw =
        decodeURIComponent(
          match[1]
        );

    } catch (e) {

      subListRaw =
        match[1];

    }

  }

}


console.log(
  `原始参数：${rawArgument}`
);

console.log(
  `提取订阅：${subListRaw}`
);


/**
 * 请求超时时间
 */
let timeoutSeconds =
  parseInt(
    getArgument("请求超时时间") || "10"
  );


if (
  isNaN(timeoutSeconds) ||
  timeoutSeconds <= 0
) {

  timeoutSeconds = 10;

}


/**
 * 最大超时时间保护
 */
timeoutSeconds =
  Math.min(
    timeoutSeconds,
    60
  );


/**
 * ============================================================
 * 订阅地址解析
 * ============================================================
 */

function parseSubscriptionUrls(text) {

  if (!text) {
    return [];
  }


  /**
   * 统一处理：
   *
   * | 分隔
   * 换行分隔
   * 空格分隔
   */
  let parts =
    text
      .split(/[|\r\n]+/)
      .map(
        item =>
          item.trim()
      )
      .filter(Boolean);


  /**
   * 如果参数被 URL 编码
   */
  parts =
    parts.map(item => {

      try {

        return decodeURIComponent(item);

      } catch (e) {

        return item;

      }

    });


  /**
   * 提取真正的 HTTP / HTTPS URL
   */
  const result = [];


  for (const item of parts) {

    const matches =
      item.match(
        /https?:\/\/[^\s|]+/gi
      );


    if (!matches) {
      continue;
    }


    for (const url of matches) {

      /**
       * 清理常见尾部字符
       */
      const cleanUrl =
        url
          .replace(
            /[）)】\]>,，。；;]+$/,
            ""
          )
          .trim();


      if (
        /^https?:\/\//i.test(
          cleanUrl
        )
      ) {

        result.push(
          cleanUrl
        );

      }

    }

  }


  /**
   * 去重
   */
  return [
    ...new Set(result)
  ];

}


const subList =
  parseSubscriptionUrls(
    subListRaw
  );


console.log(
  `解析到 ${subList.length} 个订阅`
);


if (subList.length === 0) {

  $utils.notify(
    "❌ 机场流量查询",
    "没有找到有效的机场订阅链接\n\n请检查模块参数：机场订阅链接地址"
  );

  $utils.done();

}


/**
 * ============================================================
 * 工具函数
 * ============================================================
 */


/**
 * Base64 解码
 *
 * 支持：
 *
 * 标准 Base64
 * URL Safe Base64
 */
function base64Decode(str) {

  if (!str) {
    return "";
  }


  try {

    str =
      String(str)
        .replace(/\s/g, "")
        .replace(/-/g, "+")
        .replace(/_/g, "/");


    while (
      str.length % 4 !== 0
    ) {

      str += "=";

    }


    const chars =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";


    let buffer = 0;
    let bits = 0;
    let output = "";


    for (
      let i = 0;
      i < str.length;
      i++
    ) {

      const c =
        str.charAt(i);


      if (c === "=") {
        break;
      }


      const value =
        chars.indexOf(c);


      if (value < 0) {
        continue;
      }


      buffer =
        (buffer << 6) |
        value;


      bits += 6;


      if (bits >= 8) {

        bits -= 8;


        output += String.fromCharCode(
          (buffer >> bits) & 0xff
        );

      }

    }


    return output;

  } catch (e) {

    console.log(
      `Base64 解码失败：${e}`
    );

    return "";

  }

}


/**
 * UTF-8 Base64 解码
 *
 * Shadowrocket JS 环境下尽可能处理中文
 */
function decodeBase64Text(str) {

  const decoded =
    base64Decode(str);


  if (!decoded) {
    return "";
  }


  /**
   * 判断是否包含 UTF-8 BOM
   */
  if (
    decoded.charCodeAt(0) === 0xEF &&
    decoded.charCodeAt(1) === 0xBB &&
    decoded.charCodeAt(2) === 0xBF
  ) {

    return decoded.substring(3);

  }


  return decoded;

}


/**
 * ============================================================
 * 字节格式化
 * ============================================================
 */

function formatBytes(bytes) {

  if (
    bytes === null ||
    bytes === undefined ||
    isNaN(bytes)
  ) {

    return "未知";

  }


  bytes =
    Number(bytes);


  if (bytes < 0) {
    return "未知";
  }


  const units = [
    "B",
    "KB",
    "MB",
    "GB",
    "TB",
    "PB"
  ];


  let i = 0;


  while (
    bytes >= 1024 &&
    i < units.length - 1
  ) {

    bytes /= 1024;
    i++;

  }


  if (i === 0) {

    return (
      Math.round(bytes) +
      units[i]
    );

  }


  return (
    bytes.toFixed(2) +
    units[i]
  );

}


/**
 * ============================================================
 * 解析数字 + 单位
 *
 * 例如：
 *
 * 8.55GB
 * 100 GB
 * 500MB
 * ============================================================
 */

function parseTrafficValue(value) {

  if (!value) {
    return null;
  }


  const match =
    String(value)
      .trim()
      .match(
        /^([\d.]+)\s*(B|KB|K|MB|M|GB|G|TB|T|PB|P)$/i
      );


  if (!match) {
    return null;
  }


  let number =
    parseFloat(match[1]);


  if (isNaN(number)) {
    return null;
  }


  let unit =
    match[2].toUpperCase();


  const multipliers = {

    B: 1,

    K:
      1024,

    KB:
      1024,

    M:
      1024 ** 2,

    MB:
      1024 ** 2,

    G:
      1024 ** 3,

    GB:
      1024 ** 3,

    T:
      1024 ** 4,

    TB:
      1024 ** 4,

    P:
      1024 ** 5,

    PB:
      1024 ** 5

  };


  return (
    number *
    multipliers[unit]
  );

}


/**
 * ============================================================
 * 百分比
 * ============================================================
 */

function calculatePercent(used, total) {

  if (
    used === null ||
    total === null ||
    total <= 0
  ) {

    return null;

  }


  return (
    used /
    total *
    100
  );

}


/**
 * ============================================================
 * Unix 时间戳
 * ============================================================
 */

function formatTimestamp(timestamp) {

  if (!timestamp) {
    return "未知";
  }


  let ts =
    parseInt(timestamp);


  if (isNaN(ts)) {
    return "未知";
  }


  /**
   * 有些机场返回毫秒
   */
  if (ts > 9999999999) {

    ts =
      Math.floor(
        ts / 1000
      );

  }


  /**
   * 明显不合理
   */
  if (
    ts <= 0 ||
    ts > 99999999999
  ) {

    return "未知";

  }


  try {

    const date =
      new Date(
        ts * 1000
      );


    if (
      isNaN(
        date.getTime()
      )
    ) {

      return "未知";

    }


    const year =
      date.getFullYear();


    const month =
      String(
        date.getMonth() + 1
      ).padStart(2, "0");


    const day =
      String(
        date.getDate()
      ).padStart(2, "0");


    return (
      `${year}-${month}-${day}`
    );

  } catch (e) {

    return "未知";

  }

}


/**
 * ============================================================
 * 日期标准化
 * ============================================================
 */

function normalizeExpire(value) {

  if (!value) {
    return "未知";
  }


  value =
    String(value)
      .trim();


  /**
   * Unix 时间戳
   */
  if (/^\d+$/.test(value)) {

    return formatTimestamp(
      value
    );

  }


  /**
   * 2026-09-28
   */
  const dateMatch =
    value.match(
      /(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/
    );


  if (dateMatch) {

    return (
      `${dateMatch[1]}-` +
      `${String(dateMatch[2]).padStart(2, "0")}-` +
      `${String(dateMatch[3]).padStart(2, "0")}`
    );

  }


  return value;

}


/**
 * ============================================================
 * 解析标准 subscription-userinfo
 *
 * 示例：
 *
 * upload=123456;
 * download=123456;
 * total=107374182400;
 * expire=1790553600
 *
 * ============================================================
 */

function parseSubscriptionUserinfo(header) {

  const result = {

    upload: null,

    download: null,

    total: null,

    expire: null

  };


  if (!header) {
    return result;
  }


  /**
   * upload
   */
  let match =
    header.match(
      /(?:^|[;,])\s*upload\s*=\s*(\d+)/i
    );


  if (match) {

    result.upload =
      parseInt(match[1]);

  }


  /**
   * download
   */
  match =
    header.match(
      /(?:^|[;,])\s*download\s*=\s*(\d+)/i
    );


  if (match) {

    result.download =
      parseInt(match[1]);

  }


  /**
   * total
   */
  match =
    header.match(
      /(?:^|[;,])\s*total\s*=\s*(\d+)/i
    );


  if (match) {

    result.total =
      parseInt(match[1]);

  }


  /**
   * expire
   */
  match =
    header.match(
      /(?:^|[;,])\s*expire\s*=\s*(\d+)/i
    );


  if (match) {

    result.expire =
      parseInt(match[1]);

  }


  return result;

}


/**
 * ============================================================
 * 解析 STATUS 格式
 *
 * 例如：
 *
 * STATUS=🚀↑:8.55GB,↓:48.56GB,TOT:100GB💡Expires:2026-09-28
 *
 * ============================================================
 */

function parseStatus(text) {

  const result = {

    upload: null,

    download: null,

    total: null,

    expire: null

  };


  if (!text) {
    return result;
  }


  /**
   * 上传
   *
   * ↑:8.55GB
   * ↑=8.55GB
   * upload:8.55GB
   */
  let match =
    text.match(
      /(?:↑|upload)\s*[:=]\s*([\d.]+\s*(?:B|KB|MB|GB|TB|PB))/i
    );


  if (match) {

    result.upload =
      parseTrafficValue(
        match[1]
      );

  }


  /**
   * 下载
   */
  match =
    text.match(
      /(?:↓|download)\s*[:=]\s*([\d.]+\s*(?:B|KB|MB|GB|TB|PB))/i
    );


  if (match) {

    result.download =
      parseTrafficValue(
        match[1]
      );

  }


  /**
   * 总量
   */
  match =
    text.match(
      /(?:TOT|TOTAL|total)\s*[:=]?\s*([\d.]+\s*(?:B|KB|MB|GB|TB|PB))/i
    );


  if (match) {

    result.total =
      parseTrafficValue(
        match[1]
      );

  }


  /**
   * 到期
   *
   * Expires:2026-09-28
   */
  match =
    text.match(
      /Expires?\s*[:=]\s*([0-9]{4}[-\/][0-9]{1,2}[-\/][0-9]{1,2})/i
    );


  if (match) {

    result.expire =
      normalizeExpire(
        match[1]
      );

  }


  return result;

}


/**
 * ============================================================
 * 从 Body 中解析订阅信息
 * ============================================================
 */

function parseBody(data) {

  const result = {

    upload: null,

    download: null,

    total: null,

    expire: null

  };


  if (!data) {
    return result;
  }


  const body =
    String(data);


  /**
   * ----------------------------------------------------------
   * 第一优先级：
   *
   * STATUS=
   * ----------------------------------------------------------
   */

  if (
    /STATUS\s*=/i.test(body)
  ) {

    const status =
      parseStatus(body);


    if (status.upload !== null) {

      result.upload =
        status.upload;

    }


    if (status.download !== null) {

      result.download =
        status.download;

    }


    if (status.total !== null) {

      result.total =
        status.total;

    }


    if (status.expire) {

      result.expire =
        status.expire;

    }

  }


  /**
   * ----------------------------------------------------------
   * 第二优先级：
   *
   * 尝试 Base64
   * ----------------------------------------------------------
   */

  const decoded =
    decodeBase64Text(
      body
    );


  if (decoded) {

    const status =
      parseStatus(
        decoded
      );


    if (
      result.upload === null &&
      status.upload !== null
    ) {

      result.upload =
        status.upload;

    }


    if (
      result.download === null &&
      status.download !== null
    ) {

      result.download =
        status.download;

    }


    if (
      result.total === null &&
      status.total !== null
    ) {

      result.total =
        status.total;

    }


    if (
      !result.expire &&
      status.expire
    ) {

      result.expire =
        status.expire;

    }

  }


  /**
   * ----------------------------------------------------------
   * 第三优先级：
   *
   * 通用流量匹配
   * ----------------------------------------------------------
   */

  if (
    result.upload === null ||
    result.download === null
  ) {

    const traffic =
      body.match(
        /[\d.]+\s*(?:B|KB|MB|GB|TB|PB)/gi
      ) || [];


    if (
      result.upload === null &&
      traffic.length >= 1
    ) {

      result.upload =
        parseTrafficValue(
          traffic[0]
        );

    }


    if (
      result.download === null &&
      traffic.length >= 2
    ) {

      result.download =
        parseTrafficValue(
          traffic[1]
        );

    }

  }


  /**
   * ----------------------------------------------------------
   * 通用总量
   * ----------------------------------------------------------
   */

  if (
    result.total === null
  ) {

    const totalMatch =
      body.match(
        /(?:TOT|TOTAL|总量)\s*[:=]?\s*([\d.]+\s*(?:B|KB|MB|GB|TB|PB))/i
      );


    if (totalMatch) {

      result.total =
        parseTrafficValue(
          totalMatch[1]
        );

    }

  }


  /**
   * ----------------------------------------------------------
   * 通用日期
   * ----------------------------------------------------------
   */

  if (!result.expire) {

    const expireMatch =
      body.match(
        /(?:Expires?|expire|到期|有效期)\s*[:=：]?\s*([0-9]{4}[-\/][0-9]{1,2}[-\/][0-9]{1,2})/i
      );


    if (expireMatch) {

      result.expire =
        normalizeExpire(
          expireMatch[1]
        );

    }

  }


  return result;

}


/**
 * ============================================================
 * 机场名称
 * ============================================================
 */

function getAirportName(url, index) {

  try {

    const match =
      url.match(
        /^https?:\/\/([^\/]+)/i
      );


    if (match) {

      return (
        match[1]
          .replace(
            /^www\./i,
            ""
          )
      );

    }

  } catch (e) {}


  return (
    `机场${index + 1}`
  );

}


/**
 * ============================================================
 * HTTP 请求
 * ============================================================
 */

function requestSubscription(
  url,
  index
) {

  return new Promise(
    resolve => {

      const name =
        getAirportName(
          url,
          index
        );


      /**
       * Shadowrocket 请求头
       */
      const headers = {

        "User-Agent":
          "Shadowrocket",

        "Accept":
          "*/*",

        "Accept-Language":
          "zh-CN,zh-Hans;q=0.9",

        "Cache-Control":
          "no-cache",

        "Pragma":
          "no-cache"

      };


      const params = {

        url:
          url,

        headers:
          headers,

        timeout:
          timeoutSeconds,

        alpn:
          "h2"

      };


      console.log(
        `正在查询：${name}`
      );


      try {

        $httpClient.get(
          params,
          (
            error,
            response,
            data
          ) => {

            /**
             * 网络错误
             */
            if (error) {

              resolve({

                success:
                  false,

                name:
                  name,

                url:
                  url,

                error:
                  String(error)

              });

              return;

            }


            /**
             * HTTP 状态码
             */
            const statusCode =
              response &&
              response.status
                ? response.status
                : 0;


            if (
              statusCode < 200 ||
              statusCode >= 300
            ) {

              resolve({

                success:
                  false,

                name:
                  name,

                url:
                  url,

                error:
                  `HTTP ${statusCode}`

              });

              return;

            }


            /**
             * 初始化
             */
            let info = {

              upload:
                null,

              download:
                null,

              total:
                null,

              expire:
                null

            };


            /**
             * =================================================
             * 第一优先级：响应头
             * =================================================
             */

            const responseHeaders =
              response.headers || {};


            let userinfo =
              responseHeaders[
                "subscription-userinfo"
              ];


            /**
             * 兼容大小写
             */
            if (!userinfo) {

              for (
                const key in responseHeaders
              ) {

                if (
                  key.toLowerCase() ===
                  "subscription-userinfo"
                ) {

                  userinfo =
                    responseHeaders[key];

                  break;

                }

              }

            }


            if (userinfo) {

              console.log(
                `${name} subscription-userinfo: ${userinfo}`
              );


              const parsed =
                parseSubscriptionUserinfo(
                  userinfo
                );


              info =
                Object.assign(
                  info,
                  parsed
                );

            }


            /**
             * =================================================
             * 第二优先级：Body
             * =================================================
             */

            const bodyInfo =
              parseBody(
                data
              );


            /**
             * 只有响应头没有的数据才使用 Body
             */
            if (
              info.upload === null &&
              bodyInfo.upload !== null
            ) {

              info.upload =
                bodyInfo.upload;

            }


            if (
              info.download === null &&
              bodyInfo.download !== null
            ) {

              info.download =
                bodyInfo.download;

            }


            if (
              info.total === null &&
              bodyInfo.total !== null
            ) {

              info.total =
                bodyInfo.total;

            }


            if (
              !info.expire &&
              bodyInfo.expire
            ) {

              info.expire =
                bodyInfo.expire;

            }


            /**
             * =================================================
             * 已使用流量
             * =================================================
             */

            let used = null;


            if (
              info.upload !== null &&
              info.download !== null
            ) {

              used =
                info.upload +
                info.download;

            }


            /**
             * =================================================
             * 剩余流量
             * =================================================
             */

            let remain = null;


            if (
              info.total !== null &&
              used !== null
            ) {

              remain =
                Math.max(
                  0,
                  info.total - used
                );

            }


            /**
             * =================================================
             * 使用率
             * =================================================
             */

            const percent =
              calculatePercent(
                used,
                info.total
              );


            resolve({

              success:
                true,

              name:
                name,

              url:
                url,

              upload:
                info.upload,

              download:
                info.download,

              total:
                info.total,

              used:
                used,

              remain:
                remain,

              percent:
                percent,

              expire:
                info.expire

            });

          }
        );

      } catch (e) {

        resolve({

          success:
            false,

          name:
            name,

          url:
            url,

          error:
            String(e)

        });

      }

    }
  );

}


/**
 * ============================================================
 * 格式化单个机场
 * ============================================================
 */

function formatResult(item) {

  if (!item.success) {

    return (
      `❌ ${item.name}\n` +
      `   请求失败：${item.error}`
    );

  }


  const upload =
    item.upload !== null
      ? formatBytes(item.upload)
      : "未知";


  const download =
    item.download !== null
      ? formatBytes(item.download)
      : "未知";


  const total =
    item.total !== null
      ? formatBytes(item.total)
      : "未知";


  const used =
    item.used !== null
      ? formatBytes(item.used)
      : "未知";


  const remain =
    item.remain !== null
      ? formatBytes(item.remain)
      : "未知";


  let usage =
    "未知";


  if (
    item.percent !== null
  ) {

    usage =
      `${item.percent.toFixed(1)}%`;

  }


  const expire =
    item.expire ||
    "未知";


  /**
   * 到期状态
   */
  let expireText =
    expire;


  if (
    /^\d{4}-\d{2}-\d{2}$/.test(
      expire
    )
  ) {

    try {

      const expireDate =
        new Date(
          expire +
          "T23:59:59"
        );


      const now =
        new Date();


      const diff =
        Math.ceil(
          (
            expireDate.getTime() -
            now.getTime()
          ) /
          86400000
        );


      if (diff < 0) {

        expireText =
          `${expire}（已过期）`;

      } else if (diff === 0) {

        expireText =
          `${expire}（今天到期）`;

      } else {

        expireText =
          `${expire}（剩余${diff}天）`;

      }

    } catch (e) {}

  }


  return (
    `📡 ${item.name}\n` +
    `⬆️ 上传：${upload}\n` +
    `⬇️ 下载：${download}\n` +
    `📦 已用：${used}\n` +
    `📊 总量：${total}\n` +
    `📥 剩余：${remain}\n` +
    `📈 使用率：${usage}\n` +
    `⏰ 到期：${expireText}`
  );

}


/**
 * ============================================================
 * 主程序
 * ============================================================
 */

(async () => {

  console.log(
    "================================"
  );

  console.log(
    "📊 机场流量查询 Pro"
  );

  console.log(
    `机场数量：${subList.length}`
  );

  console.log(
    `超时时间：${timeoutSeconds}s`
  );

  console.log(
    "================================"
  );


  const results = [];


  /**
   * 顺序请求
   *
   * 避免同时请求多个机场造成：
   *
   * - DNS 瞬时请求过多
   * - 网络连接过多
   * - Shadowrocket 请求异常
   */
  for (
    let i = 0;
    i < subList.length;
    i++
  ) {

    const result =
      await requestSubscription(
        subList[i],
        i
      );


    results.push(
      result
    );

  }


  /**
   * ==========================================================
   * 汇总
   * ==========================================================
   */

  const successCount =
    results.filter(
      item => item.success
    ).length;


  const failedCount =
    results.length -
    successCount;


  const lines = [];


  lines.push(
    `📊 机场流量查询`
  );


  lines.push(
    `━━━━━━━━━━━━━━━━`
  );


  for (
    const item of results
  ) {

    lines.push(
      formatResult(item)
    );


    lines.push(
      `━━━━━━━━━━━━━━━━`
    );

  }


  /**
   * 查询时间
   */
  const now =
    new Date();


  const time =
    now
      .toLocaleString(
        "zh-CN",
        {
          hour12: false
        }
      );


  lines.push(
    `🕐 查询时间：${time}`
  );


  lines.push(
    `✅ 成功：${successCount}  ❌ 失败：${failedCount}`
  );


  const message =
    lines.join("\n");


  console.log(
    message
  );


  /**
   * 最终只通知一次
   */
  $utils.notify(
    "📊 机场流量查询",
    message
  );


  $utils.done();

})();
