/**
 * Shadowrocket / Surge / Quantumult X
 * 机场流量查询
 *
 * 功能：
 * 1. 查询机场订阅流量
 * 2. 查询到期时间
 * 3. 支持多个订阅
 * 4. 所有机场汇总成一条通知
 * 5. 适合 Cron 每小时执行
 */

const $utils = (() => {

  const notify = (title, message) => {
    try {
      // Shadowrocket / Surge
      if (typeof $notification !== "undefined") {
        $notification.post(title, "", message);
        return;
      }

      // Quantumult X
      if (typeof $notify !== "undefined") {
        $notify(title, "", message);
        return;
      }

      console.log(`通知 API 不存在: ${title} - ${message}`);

    } catch (e) {
      console.log(`通知发送失败: ${e}`);
    }
  };

  const done = () => {
    try {
      $done();
    } catch (e) {
      console.log(`脚本结束失败: ${e}`);
    }
  };

  return {
    notify,
    done
  };
})();


// ============================================================
// 获取参数
// ============================================================

const rawArgument = $argument || "";
let subListRaw = "";

try {

  const match = rawArgument.match(/机场订阅链接=(.+)/);

  if (match) {
    subListRaw = decodeURIComponent(match[1]);
  }

  console.log(`提取的原始链接串: ${subListRaw}`);

} catch (e) {

  $utils.notify(
    "❗️参数解析失败",
    `错误: ${e}`
  );

  $utils.done();
}


if (!subListRaw) {

  $utils.notify(
    "❗️未填写机场订阅链接",
    "请检查 Shadowrocket 模块参数"
  );

  $utils.done();
}


// ============================================================
// 提取订阅 URL
// ============================================================

let subList = subListRaw.match(
  /https?:\/\/[^\s@&]+/g
) || [];


if (subList.length === 0) {

  $utils.notify(
    "⚠️ 无有效链接",
    "请检查机场订阅链接格式"
  );

  $utils.done();
}


console.log(`发现 ${subList.length} 个机场订阅`);


// ============================================================
// Base64 解码
// ============================================================

function base64Decode(str) {

  try {

    str = str.replace(
      /[-_]/g,
      m => m === "-" ? "+" : "/"
    );

    while (str.length % 4 !== 0) {
      str += "=";
    }

    const b64 =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";

    let output = "";
    let buffer;
    let bc = 0;
    let bs;
    let idx = 0;

    for (
      ;
      (buffer = str.charAt(idx++));
      ~buffer &&
      (
        bs = bc % 4
          ? bs * 64 + buffer
          : buffer,
        bc++
      ) % 4
        ? output += String.fromCharCode(
            255 & bs >> (-2 * bc & 6)
          )
        : 0
    ) {

      buffer = b64.indexOf(buffer);
    }

    return output;

  } catch (e) {

    return "";
  }
}


// ============================================================
// 流量格式化
// ============================================================

function formatBytes(bytes) {

  if (
    bytes === undefined ||
    bytes === null ||
    isNaN(bytes)
  ) {
    return "未知";
  }

  bytes = Number(bytes);

  const units = [
    "B",
    "KB",
    "MB",
    "GB",
    "TB"
  ];

  let i = 0;

  while (
    bytes >= 1024 &&
    i < units.length - 1
  ) {

    bytes /= 1024;
    i++;
  }

  return bytes.toFixed(2) + units[i];
}


// ============================================================
// 计算剩余流量
// ============================================================

function getRemaining(total, upload, download) {

  if (
    isNaN(total) ||
    isNaN(upload) ||
    isNaN(download)
  ) {
    return "未知";
  }

  const remaining =
    total - upload - download;

  if (remaining < 0) {
    return "0 B";
  }

  return formatBytes(remaining);
}


// ============================================================
// 格式化到期时间
// ============================================================

function formatExpire(timestamp) {

  if (
    !timestamp ||
    isNaN(timestamp)
  ) {
    return "未知";
  }

  timestamp = Number(timestamp);

  if (
    timestamp <= 0 ||
    timestamp >= 9999999999
  ) {
    return "未知";
  }

  const d = new Date(timestamp * 1000);

  const y = d.getFullYear();

  const m = String(
    d.getMonth() + 1
  ).padStart(2, "0");

  const day = String(
    d.getDate()
  ).padStart(2, "0");

  return `${y}-${m}-${day}`;
}


// ============================================================
// 查询单个机场
// ============================================================

function requestSubscription(url, index) {

  return new Promise((resolve) => {

    const headers = {

      "cache-control": "no-cache",

      "accept-language":
        "zh-CN,zh-Hans;q=0.9",

      "accept": "*/*",

      "accept-encoding":
        "gzip, deflate, br",

      "user-agent":
        "Shadowrocket/2615 CFNetwork/3826.500.131 Darwin/24.5.0 iPhone14,3"
    };


    const params = {

      url: url,

      headers: headers,

      timeout: 5000,

      alpn: "h2"
    };


    $httpClient.get(
      params,
      function(error, response, data) {

        // ====================================================
        // 请求失败
        // ====================================================

        if (
          error ||
          !response ||
          response.status !== 200
        ) {

          const msg =
            error ||
            (
              response
                ? `HTTP ${response.status}`
                : "无响应"
            );

          resolve({

            index: index,

            success: false,

            error: msg

          });

          return;
        }


        // ====================================================
        // 默认数据
        // ====================================================

        let info = {

          upload: 0,

          download: 0,

          total: 0,

          expire: "未知",

          hasTraffic: false

        };


        // ====================================================
        // 读取 subscription-userinfo
        // ====================================================

        const userinfo =
          response.headers[
            "subscription-userinfo"
          ] ||
          response.headers[
            "Subscription-Userinfo"
          ];


        if (userinfo) {

          console.log(
            `机场${index + 1} subscription-userinfo: ${userinfo}`
          );


          const upload =
            userinfo.match(
              /upload=(\d+)/
            );

          const download =
            userinfo.match(
              /download=(\d+)/
            );

          const total =
            userinfo.match(
              /total=(\d+)/
            );

          const expire =
            userinfo.match(
              /expire=(\d+)/
            );


          if (upload) {

            info.upload =
              parseInt(upload[1]);

            info.hasTraffic = true;
          }


          if (download) {

            info.download =
              parseInt(download[1]);

            info.hasTraffic = true;
          }


          if (total) {

            info.total =
              parseInt(total[1]);

            info.hasTraffic = true;
          }


          if (expire) {

            info.expire =
              formatExpire(
                expire[1]
              );
          }

        } else {

          // ==================================================
          // 尝试解析 Base64 Body
          // ==================================================

          const decoded =
            base64Decode(
              (data || "").slice(0, 500)
            );


          const firstLine =
            decoded.split("\n")[0] || "";


          const trafficMatch =
            firstLine.match(
              /(\d+(?:\.\d+)?[KMGTP]B)/gi
            );


          if (
            trafficMatch &&
            trafficMatch.length >= 2
          ) {

            info.upload =
              trafficMatch[0];

            info.download =
              trafficMatch[1];
          }


          const totalMatch =
            firstLine.match(
              /TOT:? *(\d+(?:\.\d+)?[KMGTP]B)/i
            );


          if (totalMatch) {

            info.total =
              totalMatch[1];
          }


          const expireMatch =
            firstLine.match(
              /Expires:? *([0-9\-]+)/i
            );


          if (expireMatch) {

            info.expire =
              expireMatch[1];
          }
        }


        resolve({

          index: index,

          success: true,

          info: info

        });

      }
    );

  });
}


// ============================================================
// 主程序
// ============================================================

(async () => {

  const results = [];


  // ----------------------------------------------------------
  // 按顺序查询所有机场
  // ----------------------------------------------------------

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

    results.push(result);
  }


  // ==========================================================
  // 生成汇总通知
  // ==========================================================

  let message = "";


  for (const result of results) {

    if (!result.success) {

      message +=
        `❌ 机场${result.index + 1}\n` +
        `请求失败：${result.error}\n\n`;

      continue;
    }


    const info = result.info;


    let upload;
    let download;
    let total;
    let remaining;


    if (
      typeof info.upload === "number"
    ) {

      upload =
        formatBytes(info.upload);

    } else {

      upload =
        info.upload;
    }


    if (
      typeof info.download === "number"
    ) {

      download =
        formatBytes(info.download);

    } else {

      download =
        info.download;
    }


    if (
      typeof info.total === "number"
    ) {

      total =
        formatBytes(info.total);

    } else {

      total =
        info.total;
    }


    if (
      typeof info.total === "number" &&
      typeof info.upload === "number" &&
      typeof info.download === "number"
    ) {

      remaining =
        getRemaining(
          info.total,
          info.upload,
          info.download
        );

    } else {

      remaining = "未知";
    }


    message +=
      `📡 机场 ${result.index + 1}\n` +
      `⬆️ 上传：${upload}\n` +
      `⬇️ 下载：${download}\n` +
      `🚀 总量：${total}\n` +
      `📦 剩余：${remaining}\n` +
      `⏰ 到期：${info.expire}\n\n`;
  }


  // ----------------------------------------------------------
  // 查询时间
  // ----------------------------------------------------------

  const now = new Date();

  const time =
    `${now.getFullYear()}-` +
    `${String(now.getMonth() + 1).padStart(2, "0")}-` +
    `${String(now.getDate()).padStart(2, "0")} ` +
    `${String(now.getHours()).padStart(2, "0")}:` +
    `${String(now.getMinutes()).padStart(2, "0")}`;


  message +=
    `🕐 查询时间：${time}`;


  // ==========================================================
  // 发送一条汇总通知
  // ==========================================================

  $utils.notify(
    "📊 机场流量查询",
    message
  );


  $utils.done();

})();
