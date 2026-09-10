/****************************************************
 * HTML Include
 *
 * index.html
 * style.html
 * script.html
 ****************************************************/

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/****************************************************
 * App Icon
 ****************************************************/

function setAppIcon(output) {
  return output.setFaviconUrl(
    "https://raw.githubusercontent.com/kougaku8/badminton-icon/main/heian-bado-yoyaku-icon_512.png",
  );
}

/****************************************************
 * Web App Entry
 ****************************************************/

function doGet(e) {
  e = e || {};

  const page = e.parameter.page || "index";

  // =========================
  // 首页
  // =========================

  if (page === "index") {
    return setAppIcon(
      HtmlService.createTemplateFromFile("index")
        .evaluate()
        .setTitle("🏸 羽球活动")
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL),
    );
  }

  // =========================
  // Dashboard
  // =========================

  if (page === "dashboard") {
    return HtmlService.createTemplateFromFile("dashboard")
      .evaluate()
      .setTitle("管理 Dashboard")
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  // =========================
  // 活动详情
  // =========================

  if (page === "activity") {
    const t = HtmlService.createTemplateFromFile("activity");

    t.activityID = e.parameter.id || "";

    return t
      .evaluate()
      .setTitle("活动详情")
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  // =========================
  // 创建活动
  // =========================

  if (page === "createActivity") {
    return HtmlService.createHtmlOutputFromFile("createActivity")
      .setTitle("发起新活动")
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  // =========================
  // 修改活动
  // =========================

  if (page === "editActivity") {
    return HtmlService.createHtmlOutputFromFile("editActivity")
      .setTitle("修改活动")
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  // =========================
  // 报名页面
  // =========================

  if (page === "register") {
    const t = HtmlService.createTemplateFromFile("register");

    // 接收 URL：
    // ?page=register&activityID=ACT000001

    t.activityID = e.parameter.activityID || "";

    return t
      .evaluate()
      .setTitle("羽球活动报名")
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  // =========================
  // 复制活动
  // =========================

  if (page === "copyActivity") {
    return HtmlService.createHtmlOutputFromFile("copyActivity")
      .setTitle("复制活动")
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  // =========================
  // 签到页面
  // =========================

  if (page === "checkin") {
    const t = HtmlService.createTemplateFromFile("checkin");

    t.reg = e.parameter.reg || "";

    // 提供 Web App URL 给 checkin.html
    t.webAppUrl = ScriptApp.getService().getUrl();

    return t
      .evaluate()
      .setTitle("签到管理")
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  // =========================
  // 我的报名
  // =========================

  if (page === "myRegistration") {
    return HtmlService.createHtmlOutputFromFile("myRegistration")
      .setTitle("我的报名 / 申込み履歴")
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  // =========================
  // 找不到页面 → 首页
  // =========================

  return setAppIcon(
    HtmlService.createTemplateFromFile("index")
      .evaluate()
      .setTitle("🏸 羽球活动")
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL),
  );
}

function getActivityDetail(id) {
  // =========================
  // Debug
  // =========================

  console.log("===== WEB APP TEST V20260821 =====");

  console.log("ActivityID = " + id);

  const ss = getSpreadsheet();

  console.log("Spreadsheet ID = " + ss.getId());

  console.log("Spreadsheet Name = " + ss.getName());

  // =========================
  // 读取资料
  // =========================

  const activities = sheetToJson(CONFIG.SHEETS.ACTIVITIES);

  const venues = sheetToJson(CONFIG.SHEETS.VENUES);

  const registrations = sheetToJson(CONFIG.SHEETS.REGISTRATIONS);

  // =========================
  // 找活动
  // =========================

  const activity = activities.find(function (a) {
    return String(a.ActivityID).trim() === String(id).trim();
  });

  if (!activity) {
    throw new Error("找不到活动:" + id);
  }

  // =========================
  // 找场地
  // =========================

  const venue =
    venues.find(function (v) {
      return String(v.VenueID).trim() === String(activity.VenueID).trim();
    }) || {};

  // =========================
  // 报名人员
  // =========================

  const participants = registrations

    .filter(function (r) {
      return (
        String(r.ActivityID).trim() === String(id).trim() &&
        String(r.Status).toUpperCase() !== "CANCELLED"
      );
    })

    .map(function (r) {
      return {
        Name: r.Name || "",

        Level: r.Level || "",

        Status: r.Status || "",

        Message: r.Message || "",
      };
    });

  // =========================
  // Debug
  // =========================

  console.log("Activity FOUND = " + JSON.stringify(activity));

  console.log("Venue FOUND = " + JSON.stringify(venue));

  console.log("Participants = " + participants.length);

  // =========================
  // 返回
  // =========================

  return {
    Activity: {
      ActivityID: activity.ActivityID,

      Title: activity.Title,

      Date: activity.ActivityDate,

      StartTime: activity.StartTime,

      EndTime: activity.EndTime,

      Capacity: Number(activity.Capacity || 0),

      Fee: Number(activity.Fee || 0),

      Description: activity.Description || "",
    },

    Venue: {
      Name: venue.VenueName || "",

      Address: venue.Address || "",

      Description: venue.Description || "",

      Access: venue.Access || "",

      Parking: venue.Parking || "",
    },

    Count: {
      Joined: participants.length,

      Remaining: Number(activity.Capacity || 0) - participants.length,
    },

    Participants: participants,
  };
}

function createActivity(data) {
  return withLock(function () {
    return createActivityCore(data);
  });
}

function createActivityCore(data) {
  if (!data) {
    throw new Error("没有收到活动资料");
  }

  // =========================
  // 基本检查
  // =========================

  if (!data.title) {
    throw new Error("活动名称不能为空");
  }

  if (!data.venueID) {
    throw new Error("VenueID 不能为空");
  }

  if (!data.activityDate) {
    throw new Error("活动日期不能为空");
  }

  if (!data.startTime) {
    throw new Error("开始时间不能为空");
  }

  if (!data.endTime) {
    throw new Error("结束时间不能为空");
  }

  const courtCount = Number(data.courtCount);

  const capacity = Number(data.capacity);

  const fee = Number(data.fee || 0);

  if (courtCount <= 0) {
    throw new Error("球场数量必须大于 0");
  }

  if (capacity <= 0) {
    throw new Error("报名人数上限必须大于 0");
  }

  if (fee < 0) {
    throw new Error("活动费用不能小于 0");
  }

  // =========================
  // 读取 Activities
  // =========================

  const activities = sheetToJson(CONFIG.SHEETS.ACTIVITIES);

  // =========================
  // 生成 ActivityID
  // =========================

  const activityID = generateID("ACT");

  const now = new Date();

  // =========================
  // Status
  // =========================

  const status = CONFIG.STATUS.ACTIVITY_OPEN;

  // =========================
  // 写入 Activities
  // =========================

  const row = [
    activityID,

    data.title || "",

    data.venueID || "",

    data.activityDate || "",

    data.startTime || "",

    data.endTime || "",

    courtCount,

    capacity,

    fee,

    status,

    data.description || "",

    data.registrationDeadline || "",

    now,

    now,
  ];

  appendRow(CONFIG.SHEETS.ACTIVITIES, row);

  // =========================
  // V2へ「新しい活動」通知
  // =========================

  try {
    sendActivityNewNotificationToV2_(data);
  } catch (error) {
    console.error("V2 ACTIVITY_NEW 通知送信失敗:", error);
  }

  // =========================
  // 管理者へFCM通知
  // =========================

  try {
    sendAdminFCMNotification(
      "🏸 新しい羽球活动",
      "新しい活动が作成されました：\n" +
        (data.title || "") +
        "\n" +
        (data.activityDate || "") +
        " " +
        (data.startTime || ""),
    );
  } catch (error) {
    console.error("FCM通知送信失敗:", error);
  }

  // =========================
  // 返回结果
  // =========================

  return {
    success: true,

    activityID: activityID,

    status: status,

    message: "活动创建成功",
  };
}

function getActiveVenues() {
  const venues = sheetToJson(CONFIG.SHEETS.VENUES);

  return venues
    .filter(function (v) {
      return (
        String(v.Active).toUpperCase() === "TRUE" ||
        String(v.Active) === "1" ||
        String(v.Active).toUpperCase() === "YES"
      );
    })
    .map(function (v) {
      return {
        VenueID: v.VenueID,
        VenueName: v.VenueName,
        Address: v.Address || "",
        Description: v.Description || "",
        Access: v.Access || "",
        Parking: v.Parking || "",
      };
    });
}

function testGetActivityDetail() {
  const result = getActivityDetail("ACT260821002115171");

  Logger.log(JSON.stringify(result, null, 2));
}

function checkAdminPassword(inputPwd) {
  const props = PropertiesService.getScriptProperties();
  const realPwd = props.getProperty("ADMIN_PASSWORD");

  if (!realPwd) {
    throw new Error("管理员密码未设置（Script Properties）");
  }

  return inputPwd === realPwd;
}

function getWebAppUrl() {
  return ScriptApp.getService().getUrl();
}

function getActivitiesForCopy() {
  const activities = sheetToJson(CONFIG.SHEETS.ACTIVITIES);

  const venues = sheetToJson(CONFIG.SHEETS.VENUES);

  const venueMap = {};

  venues.forEach(function (v) {
    venueMap[String(v.VenueID)] = v.VenueName || "";
  });

  return activities
    .filter(function (a) {
      return String(a.Status).toUpperCase() !== "CANCELLED";
    })
    .map(function (a) {
      return {
        ActivityID: a.ActivityID || "",

        Title: a.Title || "",

        VenueID: a.VenueID || "",

        VenueName: venueMap[String(a.VenueID)] || "",

        Date: a.ActivityDate || "",

        StartTime: a.StartTime || "",

        EndTime: a.EndTime || "",

        CourtCount: Number(a.CourtCount || 0),

        Capacity: Number(a.Capacity || 0),

        Fee: Number(a.Fee || 0),

        Status: a.Status || "",

        Description: a.Description || "",
      };
    });
}

function getActivityForCopy(activityID) {
  if (!activityID) {
    throw new Error("ActivityID 不能为空");
  }

  const activities = sheetToJson(CONFIG.SHEETS.ACTIVITIES);

  const venues = sheetToJson(CONFIG.SHEETS.VENUES);

  const activity = activities.find(function (a) {
    return String(a.ActivityID) === String(activityID);
  });

  if (!activity) {
    throw new Error("找不到活动：" + activityID);
  }

  const venue =
    venues.find(function (v) {
      return String(v.VenueID) === String(activity.VenueID);
    }) || {};

  return {
    success: true,

    activity: {
      ActivityID: activity.ActivityID,

      Title: activity.Title || "",

      VenueID: activity.VenueID || "",

      VenueName: venue.VenueName || "",

      Date: activity.ActivityDate || "",

      StartTime: activity.StartTime || "",

      EndTime: activity.EndTime || "",

      CourtCount: Number(activity.CourtCount || 0),

      Capacity: Number(activity.Capacity || 0),

      Fee: Number(activity.Fee || 0),

      Status: activity.Status || "",

      Description: activity.Description || "",

      RegistrationDeadline: activity.RegistrationDeadline || "",
    },
  };
}

// ==================================================
// 复制活动
// ==================================================

function copyActivity(sourceActivityID, newDate, newTitle) {
  return withLock(function () {
    if (!sourceActivityID) {
      throw new Error("原活动 ActivityID 不能为空");
    }

    if (!newDate) {
      throw new Error("新活动日期不能为空");
    }

    const activities = sheetToJson(CONFIG.SHEETS.ACTIVITIES);

    const source = activities.find(function (a) {
      return String(a.ActivityID) === String(sourceActivityID);
    });

    if (!source) {
      throw new Error("找不到原活动：" + sourceActivityID);
    }

    // ==================================================
    // 新日期不能和原日期相同
    // ==================================================

    if (String(source.ActivityDate) === String(newDate)) {
      throw new Error("新日期不能与原活动相同");
    }

    // ==================================================
    // 如果前端没有传 newTitle，
    // 后端自动根据新日期生成
    // ==================================================

    if (!newTitle) {
      const parts = String(newDate).split("-");

      const month = Number(parts[1]);

      const day = Number(parts[2]);

      const originalTitle = String(source.Title || "").trim();

      // 去掉原活动名称开头已有的 M/D
      const cleanTitle = originalTitle
        .replace(/^\d{1,2}\/\d{1,2}\s*/, "")
        .trim();

      newTitle = month + "/" + day + " " + cleanTitle;
    }

    // ==================================================
    // 生成新的 ActivityID
    // ==================================================

    const newActivityID = generateID("ACT");

    const now = new Date();

    const status = CONFIG.STATUS.ACTIVITY_OPEN;

    // ==================================================
    // 新活动
    //
    // 只改变：
    // ActivityID
    // ActivityDate
    // Title
    // CreatedAt
    // UpdatedAt
    //
    // 其他资料全部复制
    // ==================================================

    const row = [
      newActivityID,

      newTitle,

      source.VenueID || "",

      newDate,

      source.StartTime || "",

      source.EndTime || "",

      Number(source.CourtCount || 0),

      Number(source.Capacity || 0),

      Number(source.Fee || 0),

      status,

      source.Description || "",

      source.RegistrationDeadline || "",

      now,

      now,
    ];

    appendRow(CONFIG.SHEETS.ACTIVITIES, row);

    try {
      sendActivityNewNotificationToV2_({
        title: newTitle || "",
        activityDate: newDate || "",
        startTime: source.StartTime || "",
        endTime: source.EndTime || "",
      });
    } catch (error) {
      console.error("V2 ACTIVITY_NEW 通知送信失败:", error);
    }

    // ==================================================
    // 返回新活动
    // ==================================================

    return {
      success: true,

      status: status,

      message: "活动创建成功",

      activity: {
        ActivityID: newActivityID,

        Title: newTitle,

        VenueID: source.VenueID || "",

        Date: newDate,

        StartTime: source.StartTime || "",

        EndTime: source.EndTime || "",

        CourtCount: Number(source.CourtCount || 0),

        Capacity: Number(source.Capacity || 0),

        Fee: Number(source.Fee || 0),

        Description: source.Description || "",
      },
    };
  });
}

function saveAdminFCMToken(token) {
  if (!token) {
    throw new Error("FCM Tokenがありません");
  }

  PropertiesService.getScriptProperties().setProperty("ADMIN_FCM_TOKEN", token);

  return {
    success: true,
  };
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    // =====================================================
    // PWA 管理员登录
    // =====================================================

    if (data.action === "checkAdminPassword") {
      const success = checkAdminPassword(data.password);

      return ContentService.createTextOutput(
        JSON.stringify({
          success: success,
        }),
      ).setMimeType(ContentService.MimeType.JSON);
    }

    // =====================================================
    // PWA 保存管理员 FCM Token
    // =====================================================

    if (data.action === "saveAdminFCMToken") {
      const result = saveAdminFCMToken(data.token);

      return ContentService.createTextOutput(
        JSON.stringify(result),
      ).setMimeType(ContentService.MimeType.JSON);
    }

    // =====================================================
    // PWA Check-in API
    // =====================================================
    if (data.action === "pwaCheckin") {
      // 获取活动列表
      if (data.type === "getActivities") {
        return ContentService.createTextOutput(
          JSON.stringify(apiGetPWAActivities()),
        ).setMimeType(ContentService.MimeType.JSON);
      }

      // 获取签到名单
      if (data.type === "getCheckinList") {
        return ContentService.createTextOutput(
          JSON.stringify(apiGetCheckinList(data.activityID)),
        ).setMimeType(ContentService.MimeType.JSON);
      }

      // 执行签到
      if (data.type === "checkin") {
        return ContentService.createTextOutput(
          JSON.stringify(
            apiCheckinRegistration(data.registrationID, data.paymentMethod),
          ),
        ).setMimeType(ContentService.MimeType.JSON);
      }

      return ContentService.createTextOutput(
        JSON.stringify({
          success: false,
          message: "未知的 PWA API type",
        }),
      ).setMimeType(ContentService.MimeType.JSON);
    }

    // =====================================================
    // 原来的管理员 FCM Token 功能
    // =====================================================

    if (!data.token) {
      throw new Error("FCM Tokenがありません");
    }

    saveAdminFCMToken(data.token);

    return ContentService.createTextOutput(
      JSON.stringify({
        success: true,
      }),
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

function sendAdminFCMNotification(title, body) {
  const props = PropertiesService.getScriptProperties();

  const token = props.getProperty("ADMIN_FCM_TOKEN");

  const serviceAccountJson = props.getProperty("FCM_SERVICE_ACCOUNT");

  if (!token) {
    throw new Error("ADMIN_FCM_TOKENがありません");
  }

  if (!serviceAccountJson) {
    throw new Error("FCM_SERVICE_ACCOUNTがありません");
  }

  const serviceAccount = JSON.parse(serviceAccountJson);

  const accessToken = getFCMAccessToken(serviceAccount);

  const url =
    "https://fcm.googleapis.com/v1/projects/" +
    serviceAccount.project_id +
    "/messages:send";

  const payload = {
    message: {
      token: token,

      notification: {
        title: title || "🏸 羽球活动",

        body: body || "新しい通知があります",
      },
    },
  };

  const response = UrlFetchApp.fetch(url, {
    method: "post",

    contentType: "application/json",

    headers: {
      Authorization: "Bearer " + accessToken,
    },

    payload: JSON.stringify(payload),

    muteHttpExceptions: true,
  });

  const responseText = response.getContentText();

  if (response.getResponseCode() >= 300) {
    throw new Error("FCM送信失敗: " + responseText);
  }

  return {
    success: true,
    response: responseText,
  };
}

function getFCMAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);

  const header = {
    alg: "RS256",
    typ: "JWT",
  };

  const claimSet = {
    iss: serviceAccount.client_email,

    scope: "https://www.googleapis.com/auth/firebase.messaging",

    aud: "https://oauth2.googleapis.com/token",

    iat: now,

    exp: now + 3600,
  };

  function base64UrlEncode(obj) {
    const json = JSON.stringify(obj);

    return Utilities.base64EncodeWebSafe(json).replace(/=+$/, "");
  }

  const encodedHeader = base64UrlEncode(header);

  const encodedClaimSet = base64UrlEncode(claimSet);

  const unsignedJwt = encodedHeader + "." + encodedClaimSet;

  const signature = Utilities.computeRsaSha256Signature(
    unsignedJwt,
    serviceAccount.private_key,
  );

  const encodedSignature = Utilities.base64EncodeWebSafe(signature).replace(
    /=+$/,
    "",
  );

  const jwt = unsignedJwt + "." + encodedSignature;

  const response = UrlFetchApp.fetch("https://oauth2.googleapis.com/token", {
    method: "post",

    payload: {
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",

      assertion: jwt,
    },

    muteHttpExceptions: true,
  });

  const code = response.getResponseCode();

  const text = response.getContentText();

  if (code !== 200) {
    throw new Error("Google OAuth Token取得失敗: " + text);
  }

  const result = JSON.parse(text);

  if (!result.access_token) {
    throw new Error("access_tokenを取得できませんでした");
  }

  return result.access_token;
}

function testSendAdminFCMNotification() {
  const result = sendAdminFCMNotification("🏸 羽球活动", "FCM通知テストです");

  Logger.log(JSON.stringify(result, null, 2));
}

/**
 * 搜索成员姓名
 * 用于「一人可报名多人」
 */
/**
 * 搜索历史成员
 *
 * 从 Registrations 中读取：
 * Name
 * Level
 *
 * 返回：
 * [
 *   {
 *     name: "王先生",
 *     level: "L3"
 *   }
 * ]
 */
function searchMembers(keyword) {
  keyword = normalizeString(keyword);

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const sheet = ss.getSheetByName("Registrations");

  if (!sheet) {
    throw new Error("找不到 Registrations 工作表");
  }

  const values = sheet.getDataRange().getValues();

  if (values.length <= 1) {
    return [];
  }

  const headers = values[0];

  const nameIndex = headers.indexOf("Name");

  const levelIndex = headers.indexOf("Level");

  if (nameIndex < 0) {
    throw new Error("Registrations 中找不到 Name 列");
  }

  if (levelIndex < 0) {
    throw new Error("Registrations 中找不到 Level 列");
  }

  /*
   * 用对象去重
   *
   * 同一个人可能报名很多次，
   * 只显示一次。
   */
  const members = {};

  for (let i = 1; i < values.length; i++) {
    const name = normalizeString(values[i][nameIndex]);

    if (!name) {
      continue;
    }

    const level = normalizeString(values[i][levelIndex]);

    /*
     * 如果这个人第一次出现，
     * 记录他的 Level
     */
    if (!members[name]) {
      members[name] = {
        name: name,

        level: level || "",
      };
    } else if (!members[name].level && level) {
      /*
       * 如果之前没有 Level，
       * 后面找到有 Level 的记录就补上
       */
      members[name].level = level;
    }
  }

  let result = Object.keys(members).map(function (name) {
    return members[name];
  });

  /*
   * 搜索姓名
   */
  if (keyword) {
    const search = keyword.toLowerCase();

    result = result.filter(function (member) {
      return member.name.toLowerCase().includes(search);
    });
  }

  /*
   * 最多返回 30 人
   */
  result = result.slice(0, 30);

  return result;
}

function getActivitiesForEdit() {
  const activities = sheetToJson(CONFIG.SHEETS.ACTIVITIES);

  const venues = sheetToJson(CONFIG.SHEETS.VENUES);

  const venueMap = {};

  venues.forEach(function (v) {
    venueMap[String(v.VenueID).trim()] = v.VenueName || "";
  });

  return activities

    .filter(function (a) {
      return String(a.Status || "").toUpperCase() !== "CANCELLED";
    })

    .map(function (a) {
      return {
        ActivityID: a.ActivityID || "",

        Title: a.Title || "",

        VenueID: a.VenueID || "",

        VenueName: venueMap[String(a.VenueID).trim()] || "",

        Date: formatSheetDateForInput(a.ActivityDate),

        StartTime: formatSheetTimeForInput(a.StartTime),

        EndTime: formatSheetTimeForInput(a.EndTime),

        CourtCount: Number(a.CourtCount || 0),

        Capacity: Number(a.Capacity || 0),

        Fee: Number(a.Fee || 0),

        Status: a.Status || "",

        Description: a.Description || "",

        RegistrationDeadline: formatSheetDateTimeForInput(
          a.RegistrationDeadline,
        ),
      };
    });
}

function formatSheetDateForInput(value) {
  if (!value) {
    return "";
  }

  if (Object.prototype.toString.call(value) === "[object Date]") {
    return Utilities.formatDate(
      value,
      Session.getScriptTimeZone(),
      "yyyy-MM-dd",
    );
  }

  const str = String(value).trim();

  const match = str.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);

  if (!match) {
    return str.substring(0, 10);
  }

  return (
    match[1] +
    "-" +
    String(match[2]).padStart(2, "0") +
    "-" +
    String(match[3]).padStart(2, "0")
  );
}

function formatSheetTimeForInput(value) {
  if (!value) {
    return "";
  }

  if (Object.prototype.toString.call(value) === "[object Date]") {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "HH:mm");
  }

  const str = String(value).trim();

  const match = str.match(/(?:T|\s)?(\d{1,2}):(\d{2})/);

  if (!match) {
    return "";
  }

  return String(match[1]).padStart(2, "0") + ":" + match[2];
}

function formatSheetDateTimeForInput(value) {
  if (!value) {
    return "";
  }

  // Google Sheets 日期时间对象
  if (Object.prototype.toString.call(value) === "[object Date]") {
    return Utilities.formatDate(
      value,
      Session.getScriptTimeZone(),
      "yyyy-MM-dd'T'HH:mm",
    );
  }

  // 转成字符串
  const str = String(value).trim();

  // 解析：
  // 2026-08-30 18:30
  // 2026-08-30T18:30
  // 2026/08/30 18:30
  const match = str.match(
    /^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})[T\s]+(\d{1,2}):(\d{2})/,
  );

  if (!match) {
    return "";
  }

  return (
    match[1] +
    "-" +
    String(match[2]).padStart(2, "0") +
    "-" +
    String(match[3]).padStart(2, "0") +
    "T" +
    String(match[4]).padStart(2, "0") +
    ":" +
    match[5]
  );
}

function updateActivity(data) {
  return withLock(function () {
    if (!data) {
      throw new Error("没有收到活动资料");
    }

    if (!data.activityID) {
      throw new Error("ActivityID 不能为空");
    }

    if (!data.title) {
      throw new Error("活动名称不能为空");
    }

    if (!data.venueID) {
      throw new Error("VenueID 不能为空");
    }

    if (!data.activityDate) {
      throw new Error("活动日期不能为空");
    }

    if (!data.startTime) {
      throw new Error("开始时间不能为空");
    }

    if (!data.endTime) {
      throw new Error("结束时间不能为空");
    }

    if (String(data.startTime) >= String(data.endTime)) {
      throw new Error("结束时间必须晚于开始时间");
    }

    const courtCount = Number(data.courtCount);

    const capacity = Number(data.capacity);

    const fee = Number(data.fee || 0);

    if (!Number.isInteger(courtCount) || courtCount <= 0) {
      throw new Error("球场数量必须大于 0");
    }

    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error("报名人数上限必须大于 0");
    }

    if (isNaN(fee) || fee < 0) {
      throw new Error("活动费用不能小于 0");
    }

    const sheet = getSpreadsheet().getSheetByName(CONFIG.SHEETS.ACTIVITIES);

    if (!sheet) {
      throw new Error("找不到 Activities 工作表");
    }

    const values = sheet.getDataRange().getValues();

    if (values.length < 2) {
      throw new Error("Activities 工作表没有活动资料");
    }

    const headers = values[0];

    const activityIDIndex = headers.indexOf("ActivityID");

    if (activityIDIndex < 0) {
      throw new Error("Activities 中找不到 ActivityID 列");
    }

    // =========================
    // 找到 ActivityID 对应行
    // =========================

    let rowNumber = -1;

    let rowData = null;

    for (let i = 1; i < values.length; i++) {
      if (
        String(values[i][activityIDIndex]).trim() ===
        String(data.activityID).trim()
      ) {
        rowNumber = i + 1;

        rowData = values[i];

        break;
      }
    }

    if (rowNumber < 0) {
      throw new Error("找不到活动：" + data.activityID);
    }

    // =========================
    // 找列
    // =========================

    function column(name) {
      const index = headers.indexOf(name);

      if (index < 0) {
        throw new Error("Activities 中找不到 " + name + " 列");
      }

      return index;
    }

    const titleCol = column("Title");

    const venueCol = column("VenueID");

    const dateCol = column("ActivityDate");

    const startCol = column("StartTime");

    const endCol = column("EndTime");

    const courtCol = column("CourtCount");

    const capacityCol = column("Capacity");

    const feeCol = column("Fee");

    const descriptionCol = column("Description");

    const deadlineCol = column("RegistrationDeadline");

    const updatedCol = column("UpdatedAt");

    // =========================
    // 标题
    //
    // 避免：
    // 8/30 8/30 活动
    // =========================

    let title = String(data.title).trim();

    const cleanTitle = title.replace(/^\d{1,2}\/\d{1,2}\s*/, "").trim();

    const dateParts = String(data.activityDate).split("-");

    if (dateParts.length === 3) {
      const month = Number(dateParts[1]);

      const day = Number(dateParts[2]);

      title = month + "/" + day + " " + cleanTitle;
    }

    // =========================
    // 保持 Status 不变
    // =========================

    // 不修改：
    // ActivityID
    // Status
    // CreatedAt

    // =========================
    // 写入修改内容
    // =========================

    sheet.getRange(rowNumber, titleCol + 1).setValue(title);

    sheet.getRange(rowNumber, venueCol + 1).setValue(data.venueID);

    sheet.getRange(rowNumber, dateCol + 1).setValue(data.activityDate);

    sheet.getRange(rowNumber, startCol + 1).setValue(data.startTime);

    sheet.getRange(rowNumber, endCol + 1).setValue(data.endTime);

    sheet.getRange(rowNumber, courtCol + 1).setValue(courtCount);

    sheet.getRange(rowNumber, capacityCol + 1).setValue(capacity);

    sheet.getRange(rowNumber, feeCol + 1).setValue(fee);

    sheet
      .getRange(rowNumber, descriptionCol + 1)
      .setValue(data.description || "");

    sheet
      .getRange(rowNumber, deadlineCol + 1)
      .setValue(data.registrationDeadline || "");

    sheet.getRange(rowNumber, updatedCol + 1).setValue(new Date());

    // =========================
    // V2へ「活动修改」通知
    // =========================

    try {
      sendActivityUpdateNotificationToV2_({
        activityDate: data.activityDate,
        title: title,
      });
    } catch (error) {
      console.error("V2 ACTIVITY_UPDATE 通知送信失敗:", error);
    }

    // =========================
    // 返回
    // =========================

    return {
      success: true,

      activityID: data.activityID,

      title: title,

      message: "活动修改成功",
    };
  });
}

function testCheckAdminFCMToken() {
  const token =
    PropertiesService.getScriptProperties().getProperty("ADMIN_FCM_TOKEN");

  Logger.log("ADMIN_FCM_TOKEN:");
  Logger.log(token);

  Logger.log("Token length = " + (token ? token.length : 0));
}

function testScriptInfo() {
  Logger.log("===== SCRIPT INFO =====");

  Logger.log("Script ID = " + ScriptApp.getScriptId());

  Logger.log("Web App URL = " + ScriptApp.getService().getUrl());

  Logger.log(
    "ADMIN_FCM_TOKEN = " +
      PropertiesService.getScriptProperties().getProperty("ADMIN_FCM_TOKEN"),
  );
}

function getV1ApiKey_() {
  const apiKey =
    PropertiesService.getScriptProperties().getProperty("V1_API_KEY");

  if (!apiKey) {
    throw new Error("V1_API_KEY が Script Properties に設定されていません。");
  }

  return String(apiKey).trim();
}

function sendActivityNewNotificationToV2_(data) {
  const v2Url = PropertiesService.getScriptProperties().getProperty(
    "V2_NOTIFICATION_API_URL",
  );

  if (!v2Url) {
    throw new Error(
      "V2_NOTIFICATION_API_URL が Script Properties に設定されていません。",
    );
  }

  const payload = {
    action: "sendNotificationEvent",

    data: {
      apiKey: getV1ApiKey_(),

      eventType: "ACTIVITY_NEW",

      titleZh: "羽毛球活动通知",

      bodyZh:
        (data.activityDate || "") + " " + (data.title || "") + " 开始报名。",

      titleJa: "バドミントン活動のお知らせ",

      bodyJa:
        (data.activityDate || "") +
        "の" +
        (data.title || "") +
        "の申込みを開始しました。",
    },
  };

  const response = UrlFetchApp.fetch(v2Url, {
    method: "post",

    contentType: "application/json",

    payload: JSON.stringify(payload),

    muteHttpExceptions: true,
  });

  const statusCode = response.getResponseCode();

  const responseText = response.getContentText();

  console.log("V2 Notification API HTTP: " + statusCode);

  console.log("V2 Notification API response: " + responseText);

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(
      "V2 Notification API HTTP error: " + statusCode + " / " + responseText,
    );
  }

  let result;

  try {
    result = JSON.parse(responseText);
  } catch (error) {
    throw new Error("V2 Notification API 返回的 JSON 无法解析。");
  }

  if (!result.success) {
    throw new Error(
      "V2 Notification API failed: " + (result.message || "Unknown error"),
    );
  }

  return result;
}

function testSendActivityNewNotificationToV2() {
  const testData = {
    title: "V1→V2 测试活动",
    activityDate: "9月5日",
    startTime: "18:00",
    endTime: "20:00",
  };

  const result = sendActivityNewNotificationToV2_(testData);

  console.log("===== V1 → V2 ACTIVITY_NEW TEST =====");

  console.log(JSON.stringify(result, null, 2));
}

function sendActivityUpdateNotificationToV2_(data) {
  const v2Url = PropertiesService.getScriptProperties().getProperty(
    "V2_NOTIFICATION_API_URL",
  );

  if (!v2Url) {
    throw new Error(
      "V2_NOTIFICATION_API_URL が Script Properties に設定されていません。",
    );
  }

  const payload = {
    action: "sendNotificationEvent",

    data: {
      apiKey: getV1ApiKey_(),

      eventType: "ACTIVITY_UPDATE",

      titleZh: "羽毛球活动变更通知",

      bodyZh:
        (data.activityDate || "") +
        " " +
        (data.title || "") +
        " 的活动内容已变更，请查看最新活动信息。",

      titleJa: "バドミントン活動変更のお知らせ",

      bodyJa:
        (data.activityDate || "") +
        "の" +
        (data.title || "") +
        "の内容が変更されました。最新情報をご確認ください。",
    },
  };

  const response = UrlFetchApp.fetch(v2Url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  const statusCode = response.getResponseCode();

  const responseText = response.getContentText();

  console.log("V2 ACTIVITY_UPDATE HTTP: " + statusCode);

  console.log("V2 ACTIVITY_UPDATE response: " + responseText);

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(
      "V2 ACTIVITY_UPDATE HTTP error: " + statusCode + " / " + responseText,
    );
  }

  let result;

  try {
    result = JSON.parse(responseText);
  } catch (error) {
    throw new Error("V2 ACTIVITY_UPDATE 返回的 JSON 无法解析。");
  }

  if (!result.success) {
    throw new Error(
      "V2 ACTIVITY_UPDATE failed: " + (result.message || "Unknown error"),
    );
  }

  return result;
}

function sendRegistrationOkNotificationToV2_(data) {
  const v2Url = PropertiesService.getScriptProperties().getProperty(
    "V2_NOTIFICATION_API_URL",
  );

  if (!v2Url) {
    throw new Error(
      "V2_NOTIFICATION_API_URL が Script Properties に設定されていません。",
    );
  }

  const participantName = String(data.participantName || "").trim();

  const activityTitle = String(data.activityTitle || "").trim();

  const activityDate = String(data.activityDate || "").trim();

  const startTime = String(data.startTime || "").trim();

  const confirmedCount = Number(data.confirmedCount || 0);

  const capacity = Number(data.capacity || 0);

  const payload = {
    action: "sendNotificationEvent",

    data: {
      apiKey: getV1ApiKey_(),

      eventType: "REGISTRATION_OK",

      titleZh: "🏸 新报名通知",

      bodyZh:
        participantName +
        " 已报名 " +
        activityTitle +
        "。\n" +
        activityDate +
        " " +
        startTime +
        "\n" +
        "目前报名人数：" +
        confirmedCount +
        " / " +
        capacity,

      titleJa: "🏸 新しい参加申込み",

      bodyJa:
        participantName +
        "さんが" +
        activityTitle +
        "に申し込みました。\n" +
        activityDate +
        " " +
        startTime +
        "\n" +
        "現在の参加人数：" +
        confirmedCount +
        " / " +
        capacity,
    },
  };

  const response = UrlFetchApp.fetch(v2Url, {
    method: "post",

    contentType: "application/json",

    payload: JSON.stringify(payload),

    muteHttpExceptions: true,
  });

  const statusCode = response.getResponseCode();

  const responseText = response.getContentText();

  console.log("V2 REGISTRATION_OK HTTP: " + statusCode);

  console.log("V2 REGISTRATION_OK response: " + responseText);

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(
      "V2 REGISTRATION_OK HTTP error: " + statusCode + " / " + responseText,
    );
  }

  let result;

  try {
    result = JSON.parse(responseText);
  } catch (error) {
    throw new Error("V2 REGISTRATION_OK 返回的 JSON 无法解析。");
  }

  if (!result.success) {
    throw new Error(
      "V2 REGISTRATION_OK failed: " + (result.message || "Unknown error"),
    );
  }

  return result;
}

/****************************************************
 * V2 → REGISTRATION_CANCELLED
 *
 * 取消报名通知
 ****************************************************/

function sendRegistrationCancelledNotificationToV2_(data) {
  const v2Url = PropertiesService.getScriptProperties().getProperty(
    "V2_NOTIFICATION_API_URL",
  );

  if (!v2Url) {
    throw new Error(
      "V2_NOTIFICATION_API_URL が Script Properties に設定されていません。",
    );
  }

  const participantName = String(data.participantName || "").trim();

  const activityTitle = String(data.activityTitle || "").trim();

  const activityDate = String(data.activityDate || "").trim();

  const startTime = String(data.startTime || "").trim();

  const payload = {
    action: "sendNotificationEvent",

    data: {
      apiKey: getV1ApiKey_(),

      eventType: "REGISTRATION_CANCELLED",

      titleZh: "🏸 报名已取消",

      bodyZh:
        participantName +
        " 已取消报名 " +
        activityTitle +
        "。\n" +
        activityDate +
        " " +
        startTime,

      titleJa: "🏸 参加申込みをキャンセルしました",

      bodyJa:
        participantName +
        "さんが" +
        activityTitle +
        "の参加申込みをキャンセルしました。\n" +
        activityDate +
        " " +
        startTime,
    },
  };

  const response = UrlFetchApp.fetch(v2Url, {
    method: "post",

    contentType: "application/json",

    payload: JSON.stringify(payload),

    muteHttpExceptions: true,
  });

  const statusCode = response.getResponseCode();

  const responseText = response.getContentText();

  console.log("V2 REGISTRATION_CANCELLED HTTP: " + statusCode);

  console.log("V2 REGISTRATION_CANCELLED response: " + responseText);

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(
      "V2 REGISTRATION_CANCELLED HTTP error: " +
        statusCode +
        " / " +
        responseText,
    );
  }

  let result;

  try {
    result = JSON.parse(responseText);
  } catch (error) {
    throw new Error("V2 REGISTRATION_CANCELLED 返回的 JSON 无法解析。");
  }

  if (!result.success) {
    throw new Error(
      "V2 REGISTRATION_CANCELLED failed: " +
        (result.message || "Unknown error"),
    );
  }

  return result;
}

/**
 * =====================================================
 * PWA Check-in API
 * =====================================================
 */

/**
 * PWA 获取活动列表
 */
function apiGetDashboardActivities() {
  return getDashboardActivities();
}

/**
 * PWA 获取活动列表
 */
function apiGetPWAActivities() {
  return getActivities();
}

/**
 * PWA 获取指定活动签到名单
 */
function apiGetCheckinList(activityID) {
  if (!activityID) {
    return {
      success: false,
      message: "ActivityID不能为空",
    };
  }

  return getCheckinList(activityID);
}

/**
 * PWA 执行签到
 */
function apiCheckinRegistration(registrationID, paymentMethod) {
  if (!registrationID) {
    return {
      success: false,
      message: "RegistrationID不能为空",
    };
  }

  return checkinRegistration(registrationID, paymentMethod || "UNPAID");
}
