/**
 * Shadowrocket
 * 机场流量查询 - nowjump 代理版
 *
 * 功能：
 * 1. 通过 nowjump.tiaotiao.org 访问订阅
 * 2. 获取 subscription-userinfo
 * 3. 获取上传 / 下载 / 总流量 / 剩余流量 / 到期时间
 * 4. 支持多个订阅
 * 5. 汇总成一条通知
 *
 * 参数：
 * 机场订阅链接=https://hi.nowjiasu.com/now/xxxxx
 */

// ============================================================
// 基础工具
// ============================================================

const Utils = {

  notify(title, message) {
    try {
      if (typeof $notification !== "undefined") {
        $notification.post(title, "", message);
        return;
      }

      if (typeof $notify !== "undefined") {
        $notify(title, "", message);
        return;
      }

      console.log(title + "\n" + message);

    } catch (e) {
      console.log("通知失败：" + e);
    }
  },

  done() {
    try {
      $done();
    } catch (e) {
      console.log("脚本结束失败：" + e);
    }
  }

};


// ============================================================
// 配置
// ============================================================

const JUMP_HOST = "https://nowjump.tiaotiao.org/";

const rawArgument =
  typeof $argument !== "undefined"
    ? ($argument || "")
    : "";


// ============================================================
// 获取订阅 URL
// ============================================================

function getSubscriptionUrls(argument) {

  if (!argument) {
    return [];
  }

  let raw = argument;

  /*
   * 支持：
   *
   * 机场订阅链接=https://xxx.com/xxx
   *
   * 以及：
   *
   * 机场订阅链接=url1,url2
   */

  const match =
    raw.match(/机场订阅链接\s*=\s*(.*)/);

  if (match) {
    raw = match[1];
  }

  /*
   * URL 可能经过 encodeURIComponent
   */

  try {
    raw = decodeURIComponent(raw);
  } catch (e) {
    console.log("URL decode 失败：" + e);
  }

  /*
   * 允许：
   *
   * 空格
   * 换行
   * 逗号
   * | 
   */

  const urls = raw
    .split(/[\s,|]+/)
    .map(x => x.trim())
    .filter(x => /^https?:\/\//i.test(x));

  return urls;
}


const subList =
  getSubscriptionUrls(rawArgument);


console.log(
  "发现订阅数量：" + subList.length
);


if (subList.length === 0) {

  Utils.notify(
    "❌ 机场流量查询",
    "没有找到有效的机场订阅链接。\n\n请检查模块参数：\n机场订阅链接=https://..."
  );

  Utils.done();
}


// ============================================================
// 构造 nowjump URL
// ============================================================

function buildJumpUrl(originalUrl) {

  /*
   * nowjump 的格式：
   *
   * https://nowjump.tiaotiao.org/
   * + 原始订阅 URL
   *
   * 例如：
   *
   * https://nowjump.tiaotiao.org/https://hi.nowjiasu.com/now/xxxxx
   */

  return JUMP_HOST + originalUrl;
}


// ============================================================
// 字节格式化
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

  if (bytes <= 0) {
    return "0 B";
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

  return bytes.toFixed(2) + " " + units[i];
}


// ============================================================
// 流量解析
// ============================================================

function parseTrafficValue(value) {

  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  /*
   * subscription-userinfo 一般是纯字节：
   *
   * upload=123456789
   *
   * 但某些机场可能返回：
   *
   * 10.5GB
   */

  if (/^\d+$/.test(String(value))) {
    return Number(value);
  }

  const match =
    String(value).match(
      /^([\d.]+)\s*(B|KB|MB|GB|TB|PB)$/i
    );

  if (!match) {
    return null;
  }

  const number =
    parseFloat(match[1]);

  const unit =
    match[2].toUpperCase();

  const units = {
    B: 0,
    KB: 1,
    MB: 2,
    GB: 3,
    TB: 4,
    PB: 5
  };

  return (
    number *
    Math.pow(1024, units[unit])
  );
}


// ============================================================
// subscription-userinfo 解析
// ============================================================

function parseUserInfo(userinfo) {

  const result = {

    upload: null,

    download: null,

    total: null,

    expire: null

  };


  if (!userinfo) {
    return result;
  }


  console.log(
    "subscription-userinfo = " +
    userinfo
  );


  const upload =
    userinfo.match(
      /(?:^|[;, ])upload\s*=\s*([^;, ]+)/i
    );

  const download =
    userinfo.match(
      /(?:^|[;, ])download\s*=\s*([^;, ]+)/i
    );

  const total =
    userinfo.match(
      /(?:^|[;, ])total\s*=\s*([^;, ]+)/i
    );

  const expire =
    userinfo.match(
      /(?:^|[;, ])expire\s*=\s*([^;, ]+)/i
    );


  if (upload) {

    result.upload =
      parseTrafficValue(upload[1]);

  }


  if (download) {

    result.download =
      parseTrafficValue(download[1]);

  }


  if (total) {

    result.total =
      parseTrafficValue(total[1]);

  }


  if (expire) {

    result.expire =
      parseExpire(expire[1]);

  }


  return result;
}


// ============================================================
// 到期时间
// ============================================================

function parseExpire(value) {

  if (!value) {
    return "未知";
  }

  const timestamp =
    Number(value);


  if (
    !isNaN(timestamp) &&
    timestamp > 0
  ) {

    /*
     * 秒级时间戳
     */

    if (timestamp < 9999999999) {

      const date =
        new Date(timestamp * 1000);

      if (!isNaN(date.getTime())) {
        return formatDate(date);
      }

    }

    /*
     * 毫秒级时间戳
     */

    if (timestamp > 10000000000) {

      const date =
        new Date(timestamp);

      if (!isNaN(date.getTime())) {
        return formatDate(date);
      }

    }

  }


  /*
   * 如果已经是日期字符串
   */

  return String(value);
}


// ============================================================
// 日期格式化
// ============================================================

function formatDate(date) {

  const y =
    date.getFullYear();

  const m =
    String(
      date.getMonth() + 1
    ).padStart(2, "0");

  const d =
    String(
      date.getDate()
    ).padStart(2, "0");


  return `${y}-${m}-${d}`;
}


// ============================================================
// 查询单个机场
// ============================================================

function requestSubscription(originalUrl, index) {

  return new Promise((resolve) => {

    const jumpUrl =
      buildJumpUrl(originalUrl);


    console.log(
      `\n========== 机场 ${index + 1} ==========`
    );

    console.log(
      "原始 URL："
      + originalUrl
    );

    console.log(
      "请求 URL："
      + jumpUrl
    );


    const headers = {

      /*
       * 防止缓存旧订阅
       */

      "Cache-Control":
        "no-cache",

      "Pragma":
        "no-cache",

      "Accept":
        "*/*",

      "Accept-Language":
        "zh-CN,zh-Hans;q=0.9",

      /*
       * 不要主动声明 br。
       *
       * 某些 Shadowrocket 环境对
       * Content-Encoding: br
       * 处理不稳定。
       */

      "Accept-Encoding":
        "gzip, deflate",

      /*
       * 模拟 Shadowrocket
       */

      "User-Agent":
        "Shadowrocket/2615 CFNetwork/3826.500.131 Darwin/24.5.0 iPhone14,3"

    };


    const params = {

      url: jumpUrl,

      headers: headers,

      timeout: 15000,

      alpn: "h2"

    };


    $httpClient.get(
      params,
      function(error, response, body) {

        // ====================================================
        // 请求错误
        // ====================================================

        if (error) {

          console.log(
            "HTTP 请求错误："
            + error
          );

          resolve({

            index,

            success: false,

            error:
              "请求错误：" + error,

            url: jumpUrl

          });

          return;
        }


        if (!response) {

          resolve({

            index,

            success: false,

            error: "无响应",

            url: jumpUrl

          });

          return;
        }


        console.log(
          "HTTP 状态码："
          + response.status
        );


        /*
         * 打印关键响应头
         */

        const responseHeaders =
          response.headers || {};


        console.log(
          "响应 Content-Type："
          +
          (
            responseHeaders["Content-Type"] ||
            responseHeaders["content-type"] ||
            "未知"
          )
        );


        console.log(
          "响应 subscription-userinfo："
          +
          (
            responseHeaders[
              "subscription-userinfo"
            ] ||
            responseHeaders[
              "Subscription-Userinfo"
            ] ||
            responseHeaders[
              "Subscription-UserInfo"
            ] ||
            "不存在"
          )
        );


        /*
         * HTTP 200 才继续
         */

        if (
          response.status < 200 ||
          response.status >= 300
        ) {

          resolve({

            index,

            success: false,

            error:
              `HTTP ${response.status}`,

            url: jumpUrl,

            body:
              body
                ? String(body).slice(0, 300)
                : ""

          });

          return;
        }


        // ====================================================
        // 读取 subscription-userinfo
        // ====================================================

        let userinfo =
          responseHeaders[
            "subscription-userinfo"
          ] ||
          responseHeaders[
            "Subscription-Userinfo"
          ] ||
          responseHeaders[
            "Subscription-UserInfo"
          ];


        /*
         * 某些代理会改变 Header 大小写。
         *
         * 遍历一次所有 header。
         */

        if (!userinfo) {

          Object.keys(
            responseHeaders
          ).forEach((key) => {

            if (
              key.toLowerCase() ===
              "subscription-userinfo"
            ) {

              userinfo =
                responseHeaders[key];

            }

          });

        }


        // ====================================================
        // 解析
        // ====================================================

        const info =
          parseUserInfo(userinfo);


        // ====================================================
        // Body 备用解析
        // ====================================================

        if (
          !userinfo &&
          body
        ) {

          console.log(
            "没有 subscription-userinfo，尝试解析 Body"
          );


          const text =
            String(body);


          /*
           * 尝试直接寻找：
           *
           * upload=
           * download=
           * total=
           * expire=
           */

          const bodyUpload =
            text.match(
              /upload\s*=\s*(\d+)/i
            );

          const bodyDownload =
            text.match(
              /download\s*=\s*(\d+)/i
            );

          const bodyTotal =
            text.match(
              /total\s*=\s*(\d+)/i
            );

          const bodyExpire =
            text.match(
              /expire\s*=\s*(\d+)/i
            );


          if (
            bodyUpload &&
            info.upload === null
          ) {

            info.upload =
              Number(bodyUpload[1]);

          }


          if (
            bodyDownload &&
            info.download === null
          ) {

            info.download =
              Number(bodyDownload[1]);

          }


          if (
            bodyTotal &&
            info.total === null
          ) {

            info.total =
              Number(bodyTotal[1]);

          }


          if (
            bodyExpire &&
            info.expire === null
          ) {

            info.expire =
              parseExpire(
                bodyExpire[1]
              );

          }

        }


        resolve({

          index,

          success: true,

          info,

          url: jumpUrl

        });

      }
    );

  });

}


// ============================================================
// 生成结果
// ============================================================

function buildResultMessage(result) {

  if (!result.success) {

    let message =
      `❌ 机场 ${result.index + 1}\n` +
      `请求失败：${result.error}`;

    /*
     * 如果是非 200，把服务器返回的前 150 个字符
     * 加进日志，不直接放通知，避免通知太长。
     */

    if (result.body) {

      console.log(
        `机场 ${result.index + 1} HTTP Body：`
        + result.body
      );

    }

    return message;
  }


  const info =
    result.info;


  const upload =
    info.upload !== null
      ? formatBytes(info.upload)
      : "未知";


  const download =
    info.download !== null
      ? formatBytes(info.download)
      : "未知";


  const total =
    info.total !== null
      ? formatBytes(info.total)
      : "未知";


  let remaining =
    "未知";


  if (
    info.total !== null &&
    info.upload !== null &&
    info.download !== null
  ) {

    const value =
      info.total -
      info.upload -
      info.download;


    remaining =
      formatBytes(
        Math.max(0, value)
      );

  }


  return (
    `📡 机场 ${result.index + 1}\n` +
    `⬆️ 上传：${upload}\n` +
    `⬇️ 下载：${download}\n` +
    `🚀 总量：${total}\n` +
    `📦 剩余：${remaining}\n` +
    `⏰ 到期：${info.expire || "未知"}`
  );

}


// ============================================================
// 主程序
// ============================================================

(async () => {

  const results = [];


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


  let message = "";


  for (
    let i = 0;
    i < results.length;
    i++
  ) {

    if (i > 0) {
      message += "\n\n";
    }

    message +=
      buildResultMessage(
        results[i]
      );

  }


  // ==========================================================
  // 查询时间
  // ==========================================================

  const now =
    new Date();


  const time =
    `${now.getFullYear()}-` +
    `${String(
      now.getMonth() + 1
    ).padStart(2, "0")}-` +
    `${String(
      now.getDate()
    ).padStart(2, "0")} ` +
    `${String(
      now.getHours()
    ).padStart(2, "0")}:` +
    `${String(
      now.getMinutes()
    ).padStart(2, "0")}`;


  message +=
    `\n\n🕐 查询时间：${time}`;


  // ==========================================================
  // 通知
  // ==========================================================

  Utils.notify(
    "📊 机场流量查询",
    message
  );


  Utils.done();

})();
