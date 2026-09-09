/****************************************************
 * Registration.gs
 *
 * 核心规则：
 *
 * ContactValue = 「我的报名」唯一检索键
 *
 * 规则：
 *
 * 1. 优先使用当前参加人的 ContactValue
 * 2. 多人报名时，每个人使用自己的 ContactValue
 * 3. 单人报名兼容 data.contactValue
 * 4. 兼容 searchKey / retrievalKey / 检索键
 * 5. 如果完全没有填写，后端自动生成 CV...
 * 6. 写入 Registration Sheet 时根据 Header 定位 ContactValue
 * 7. 写入后验证 ContactValue，确保不会写错列
 ****************************************************/

/****************************************************
 * ==================================================
 * 1. ContactValue 工具
 * ==================================================
 ****************************************************/

/**
 * 从对象中读取第一个有效值
 *
 * 用于兼容不同版本前端字段名称。
 */
function firstNonEmptyValue(values) {
  if (!Array.isArray(values)) {
    return "";
  }

  for (let i = 0; i < values.length; i++) {
    const value = normalizeString(values[i]);

    if (value !== "") {
      return value;
    }
  }

  return "";
}

/**
 * 从参加人对象中读取 ContactValue
 *
 * 优先级：
 *
 * participant.contactValue
 * participant.ContactValue
 * participant.searchKey
 * participant.retrievalKey
 * participant.检索键
 */
function getParticipantContactValue(participant) {
  if (!participant) {
    return "";
  }

  return firstNonEmptyValue([
    participant.contactValue,

    participant.ContactValue,

    participant.searchKey,

    participant.SearchKey,

    participant.retrievalKey,

    participant.RetrievalKey,

    participant["检索键"],
  ]);
}

/**
 * 从顶层 data 中读取 ContactValue
 *
 * 用于兼容旧版单人报名。
 */
function getRootContactValue(data) {
  if (!data) {
    return "";
  }

  return firstNonEmptyValue([
    data.contactValue,

    data.ContactValue,

    data.searchKey,

    data.SearchKey,

    data.retrievalKey,

    data.RetrievalKey,

    data["检索键"],
  ]);
}

/**
 * 自动生成 ContactValue
 *
 * 只有用户没有填写检索键时才使用。
 *
 * 格式：
 *
 * CV + 年月日时分秒 + 随机数字
 */
function generateContactValue() {
  const now = new Date();

  const year = now.getFullYear();

  const month = String(now.getMonth() + 1).padStart(2, "0");

  const day = String(now.getDate()).padStart(2, "0");

  const hour = String(now.getHours()).padStart(2, "0");

  const minute = String(now.getMinutes()).padStart(2, "0");

  const second = String(now.getSeconds()).padStart(2, "0");

  const random = String(Math.floor(Math.random() * 1000000000)).padStart(
    9,
    "0",
  );

  return "CV" + year + month + day + hour + minute + second + random;
}

/**
 * 最终确定 ContactValue
 *
 * 非常重要：
 *
 * participantValue 优先。
 *
 * 如果 participant 没有：
 *
 * 单人时才使用 rootValue。
 *
 * 如果仍然没有：
 *
 * 自动生成。
 */
function resolveContactValue(participantValue, rootValue, participantCount) {
  const participantContact = normalizeString(participantValue);

  if (participantContact) {
    return participantContact;
  }

  /*
   * 只有单人报名才允许使用
   * 顶层 ContactValue。
   *
   * 这样可以避免多人报名时
   * 把第一个人的检索键复制给所有人。
   */
  if (participantCount === 1) {
    const rootContact = normalizeString(rootValue);

    if (rootContact) {
      return rootContact;
    }
  }

  /*
   * 完全没有填写。
   *
   * 后端自动生成。
   */
  return generateContactValue();
}

/****************************************************
 * ==================================================
 * 2. 单活动报名 API
 * ==================================================
 ****************************************************/

function registerActivity(data) {
  return withLock(function () {
    return registerActivityCore(data);
  });
}

/****************************************************
 * 单活动报名 Core
 ****************************************************/

function registerActivityCore(data) {
  if (!data) {
    return {
      success: false,

      message: "没有收到报名资料",
    };
  }

  const activityID = normalizeString(data.activityID);

  const name = normalizeString(data.name);

  if (!activityID) {
    return {
      success: false,

      message: "请选择活动",
    };
  }

  if (!name) {
    return {
      success: false,

      message: "请输入姓名",
    };
  }

  const registrationGroupID = generateUniqueRegistrationGroupID();

  const bookerName = normalizeString(data.bookerName) || name;

  /*
   * 单人报名：
   *
   * 这里直接解析 ContactValue。
   */
  const contactValue = resolveContactValue(
    getParticipantContactValue(data),

    getRootContactValue(data),

    1,
  );

  return registerOneActivityCore({
    registrationGroupID: registrationGroupID,

    bookerName: bookerName,

    activityID: activityID,

    name: name,

    contactType: normalizeString(data.contactType) || "NONE",

    contactValue: contactValue,

    level: normalizeString(data.level),

    parking: data.parking === true,

    message: normalizeString(data.message),
  });
}

/****************************************************
 * ==================================================
 * 3. 多活动 / 多人报名 API
 * ==================================================
 ****************************************************/

function registerActivities(data) {
  return withLock(function () {
    return registerActivitiesCore(data);
  });
}

/****************************************************
 * 多活动 / 多人报名 Core
 ****************************************************/

function registerActivitiesCore(data) {
  if (!data) {
    return {
      success: false,

      message: "没有收到报名资料",

      data: [],
    };
  }

  /**************************************************
   * Activity IDs
   **************************************************/

  let activityIDs = data.activityIDs;

  /*
   * 兼容旧版 activityID
   */
  if (!Array.isArray(activityIDs) && data.activityID) {
    activityIDs = [data.activityID];
  }

  if (!Array.isArray(activityIDs)) {
    activityIDs = [];
  }

  activityIDs = activityIDs
    .map(function (id) {
      return normalizeString(id);
    })
    .filter(function (id) {
      return id !== "";
    });

  /*
   * 去重
   */
  activityIDs = Array.from(new Set(activityIDs));

  if (activityIDs.length === 0) {
    return {
      success: false,

      message: "请选择至少一个活动",

      data: [],
    };
  }

  /**************************************************
   * Participants
   **************************************************/

  let participants = data.participants;

  /*
   * 兼容旧版：
   *
   * 没有 participants 数组时，
   * 使用 data.name。
   */
  if (!Array.isArray(participants)) {
    const name = normalizeString(data.name);

    participants = [
      {
        name: name,

        contactType: normalizeString(data.contactType) || "NONE",

        contactValue: getRootContactValue(data),

        level: normalizeString(data.level),

        parking: data.parking === true,
      },
    ];
  }

  /**************************************************
   * 顶层 ContactValue
   *
   * 兼容：
   *
   * {
   *   contactValue: "6666",
   *   participants: [...]
   * }
   *
   * 这种前端结构。
   **************************************************/

  const rootContactValue = getRootContactValue(data);

  /**************************************************
   * 标准化 Participants
   **************************************************/

  participants = participants
    .map(function (participant) {
      if (!participant) {
        return null;
      }

      /*
       * 读取当前参加人自己的 ContactValue。
       */
      const participantContactValue = getParticipantContactValue(participant);

      return {
        name: normalizeString(participant.name || participant.Name),

        contactType:
          normalizeString(participant.contactType || participant.ContactType) ||
          "NONE",

        contactValue: participantContactValue,

        level: normalizeString(participant.level || participant.Level),

        parking: participant.parking === true,
      };
    })
    .filter(function (participant) {
      return participant && participant.name !== "";
    });

  if (participants.length === 0) {
    return {
      success: false,

      message: "至少需要一名参加者",

      data: [],
    };
  }

  /**************************************************
   * 同一报名单内禁止重复姓名
   **************************************************/

  const participantNames = {};

  participants = participants.filter(function (participant) {
    const key = normalizeName(participant.name);

    if (!key) {
      return false;
    }

    if (participantNames[key]) {
      return false;
    }

    participantNames[key] = true;

    return true;
  });

  if (participants.length === 0) {
    return {
      success: false,

      message: "至少需要一名有效参加者",

      data: [],
    };
  }

  /**************************************************
   * 最终确定每个人的 ContactValue
   *
   * 这是本次修改最重要的部分。
   *
   * 单人：
   *
   * participant.contactValue
   *      ↓
   * data.contactValue
   *      ↓
   * 自动生成
   *
   * 多人：
   *
   * participant[0].contactValue
   * participant[1].contactValue
   * participant[2].contactValue
   *
   * 每个人完全独立。
   **************************************************/

  participants = participants.map(function (participant) {
    const finalContactValue = resolveContactValue(
      participant.contactValue,

      rootContactValue,

      participants.length,
    );

    return {
      name: participant.name,

      contactType: participant.contactType,

      contactValue: finalContactValue,

      level: participant.level,

      parking: participant.parking,
    };
  });

  /**************************************************
   * Booker
   **************************************************/

  const firstParticipantName = participants[0].name;

  const bookerName = normalizeString(data.bookerName) || firstParticipantName;

  /**************************************************
   * Message
   **************************************************/

  const message = normalizeString(data.message);

  /**************************************************
   * Registration Group
   **************************************************/

  const registrationGroupID = generateUniqueRegistrationGroupID();

  /**************************************************
   * 执行报名
   *
   * participants × activities
   **************************************************/

  const results = [];

  participants.forEach(function (participant) {
    activityIDs.forEach(function (activityID) {
      let result;

      try {
        /*
         * 这里传入的 contactValue
         *
         * 一定是当前 participant 自己的。
         */
        result = registerOneActivityCore({
          registrationGroupID: registrationGroupID,

          bookerName: bookerName,

          activityID: activityID,

          name: participant.name,

          contactType: participant.contactType,

          contactValue: participant.contactValue,

          level: participant.level,

          parking: participant.parking,

          message: message,
        });
      } catch (error) {
        result = {
          success: false,

          activityID: activityID,

          participantName: participant.name,

          contactValue: participant.contactValue,

          message: error.message || "报名处理失败",
        };
      }

      results.push({
        participantName: participant.name,

        contactValue: participant.contactValue,

        activityID: activityID,

        result: result,
      });
    });
  });

  /**************************************************
   * Statistics
   **************************************************/

  const successResults = results.filter(function (item) {
    return item.result && item.result.success === true;
  });

  const failedResults = results.filter(function (item) {
    return !item.result || item.result.success !== true;
  });

  /**************************************************
   * 全部失败
   **************************************************/

  if (successResults.length === 0) {
    return {
      success: false,

      partial: false,

      message: "没有成功报名任何活动",

      registrationGroupID: registrationGroupID,

      bookerName: bookerName,

      total: results.length,

      successCount: 0,

      failedCount: failedResults.length,

      data: results,
    };
  }

  /**************************************************
   * 部分成功
   **************************************************/

  if (failedResults.length > 0) {
    return {
      success: true,

      partial: true,

      message: "部分报名成功",

      registrationGroupID: registrationGroupID,

      bookerName: bookerName,

      total: results.length,

      successCount: successResults.length,

      failedCount: failedResults.length,

      data: results,
    };
  }

  /**************************************************
   * 全部成功
   **************************************************/

  return {
    success: true,

    partial: false,

    message: "全部报名成功",

    registrationGroupID: registrationGroupID,

    bookerName: bookerName,

    total: results.length,

    successCount: successResults.length,

    failedCount: 0,

    data: results,
  };
}

/****************************************************
 * ==================================================
 * 4. 单个 Activity 实际报名 Core
 * ==================================================
 ****************************************************/

function registerOneActivityCore(data) {
  if (!data) {
    return {
      success: false,

      message: "没有收到报名资料",
    };
  }

  const registrationGroupID = normalizeString(data.registrationGroupID);

  const bookerName = normalizeString(data.bookerName);

  const activityID = normalizeString(data.activityID);

  const name = normalizeString(data.name);

  const contactType = normalizeString(data.contactType) || "NONE";

  /*
   * 最终 ContactValue。
   *
   * 到这里绝对不能再从 BookerName
   * 获取任何东西。
   */
  let contactValue = normalizeString(data.contactValue);

  /*
   * 如果 Core 被其他旧代码直接调用，
   * 也兼容其他字段名称。
   */
  if (!contactValue) {
    contactValue = firstNonEmptyValue([
      data.ContactValue,

      data.searchKey,

      data.SearchKey,

      data.retrievalKey,

      data.RetrievalKey,

      data["检索键"],
    ]);
  }

  /*
   * 最终仍然没有：
   *
   * 自动生成。
   */
  if (!contactValue) {
    contactValue = generateContactValue();
  }

  const level = normalizeString(data.level);

  const parking = data.parking === true;

  /**************************************************
   * 基础验证
   **************************************************/

  if (!activityID) {
    return {
      success: false,

      activityID: activityID,

      participantName: name,

      contactValue: contactValue,

      message: "活动编号为空",
    };
  }

  if (!name) {
    return {
      success: false,

      activityID: activityID,

      participantName: name,

      contactValue: contactValue,

      message: "姓名不能为空",
    };
  }

  if (!contactValue) {
    return {
      success: false,

      activityID: activityID,

      participantName: name,

      message: "无法生成 ContactValue",
    };
  }

  /**************************************************
   * 读取活动
   **************************************************/

  const activities = sheetToJson(CONFIG.SHEETS.ACTIVITIES);

  const activity = activities.find(function (a) {
    return normalizeString(a.ActivityID) === activityID;
  });

  if (!activity) {
    return {
      success: false,

      activityID: activityID,

      participantName: name,

      contactValue: contactValue,

      message: "活动不存在：" + activityID,
    };
  }

  /**************************************************
   * 活动状态
   **************************************************/

  const activityStatus = normalizeString(activity.Status).toUpperCase();

  if (activityStatus !== CONFIG.STATUS.ACTIVITY_OPEN) {
    let message = "报名关闭";

    if (activityStatus === CONFIG.STATUS.ACTIVITY_PAUSED) {
      message = "活动暂时暂停报名";
    }

    if (activityStatus === CONFIG.STATUS.ACTIVITY_CLOSED) {
      message = "活动已经关闭报名";
    }

    return {
      success: false,

      activityID: activityID,

      participantName: name,

      contactValue: contactValue,

      title: activity.Title || "",

      message: message,
    };
  }

  /**************************************************
   * 读取报名记录
   **************************************************/

  const registrations = sheetToJson(CONFIG.SHEETS.REGISTRATIONS);

  /**************************************************
   * 重复报名检查
   *
   * 同一个活动 + 同一个姓名
   *
   * CONFIRMED / WAITLIST
   **************************************************/

  const duplicate = registrations.some(function (r) {
    const sameActivity = normalizeString(r.ActivityID) === activityID;

    const sameName = normalizeName(r.Name) === normalizeName(name);

    const status = normalizeString(r.Status);

    const activeStatus =
      status === CONFIG.STATUS.CONFIRMED || status === CONFIG.STATUS.WAITLIST;

    return sameActivity && sameName && activeStatus;
  });

  if (duplicate) {
    return {
      success: false,

      activityID: activityID,

      participantName: name,

      contactValue: contactValue,

      title: activity.Title || "",

      message: "您已经报名这个活动",
    };
  }

  /**************************************************
   * 当前正式报名人数
   **************************************************/

  const confirmedCount = registrations.filter(function (r) {
    return (
      normalizeString(r.ActivityID) === activityID &&
      normalizeString(r.Status) === CONFIG.STATUS.CONFIRMED
    );
  }).length;

  /**************************************************
   * 活动容量
   **************************************************/

  let capacity = Number(activity.Capacity);

  if (isNaN(capacity) || capacity < 0) {
    capacity = 0;
  }

  /**************************************************
   * 判断报名状态
   **************************************************/

  let status;

  if (confirmedCount < capacity) {
    status = CONFIG.STATUS.CONFIRMED;
  } else {
    status = CONFIG.STATUS.WAITLIST;
  }

  /**************************************************
   * Registration ID
   **************************************************/

  const registrationID = generateUniqueRegistrationID();

  /**************************************************
   * 写入 Registration Sheet
   *
   * 这里不再假设 ContactValue 是第 5 列。
   *
   * 根据 Sheet Header 写入。
   **************************************************/

  const sheet = getSheet(CONFIG.SHEETS.REGISTRATIONS);

  if (!sheet) {
    throw new Error("Missing Sheet: " + CONFIG.SHEETS.REGISTRATIONS);
  }

  const lastColumn = sheet.getLastColumn();

  if (lastColumn <= 0) {
    throw new Error("Registrations Sheet 没有 Header");
  }

  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];

  const contactValueIndex = headers.indexOf("ContactValue");

  if (contactValueIndex === -1) {
    throw new Error("Registrations 表缺少 ContactValue 字段");
  }

  const now = new Date();

  /**************************************************
   * rowData
   **************************************************/

  const rowData = {
    RegistrationID: registrationID,

    ActivityID: activityID,

    Name: name,

    ContactType: contactType,

    /*
     * ★★★ 最重要 ★★★
     *
     * 这里写入当前参加人的 ContactValue。
     */
    ContactValue: contactValue,

    Level: level,

    Parking: parking,

    Status: status,

    FeeAmount: Number(activity.Fee) || 0,

    PaymentStatus: "UNPAID",

    PaymentMethod: "NONE",

    PaidAt: "",

    PaymentNote: "",

    Message: normalizeString(data.message),

    CreatedAt: now,

    UpdatedAt: now,

    RegistrationGroupID: registrationGroupID,

    BookerName: bookerName,

    CheckinStatus: "NOT_CHECKED_IN",
  };

  /**************************************************
   * 根据 Header 创建完整 row
   **************************************************/

  const row = headers.map(function (header) {
    if (Object.prototype.hasOwnProperty.call(rowData, header)) {
      return rowData[header];
    }

    return "";
  });

  /*
   * 写入前最后一次保护：
   *
   * 强制把 ContactValue 放到
   * Sheet Header 找到的位置。
   */
  row[contactValueIndex] = contactValue;

  /**************************************************
   * 追加
   **************************************************/

  appendRow(CONFIG.SHEETS.REGISTRATIONS, row);

  /**************************************************
   * 写入后验证
   *
   * 防止：
   *
   * Header 顺序变化
   * appendRow 异常
   * ContactValue 写错列
   **************************************************/

  const writtenLastRow = sheet.getLastRow();

  const savedContactValue = normalizeString(
    sheet.getRange(writtenLastRow, contactValueIndex + 1).getValue(),
  );

  if (savedContactValue !== contactValue) {
    /*
     * 再次直接写入正确 ContactValue。
     */
    sheet
      .getRange(writtenLastRow, contactValueIndex + 1)
      .setValue(contactValue);

    SpreadsheetApp.flush();

    /*
     * 再检查一次。
     */
    const verifyContactValue = normalizeString(
      sheet.getRange(writtenLastRow, contactValueIndex + 1).getValue(),
    );

    if (verifyContactValue !== contactValue) {
      throw new Error(
        "ContactValue 写入失败：应为 [" +
          contactValue +
          "]，实际为 [" +
          verifyContactValue +
          "]",
      );
    }
  }

  /**************************************************
   * 管理员 FCM 通知
   **************************************************/

  try {
    sendAdminFCMNotification(
      "🏸 新しい参加申込み",

      "新しい参加申込みがあります。\n" +
        "报名单：" +
        registrationGroupID +
        "\n" +
        "活动：" +
        (activity.Title || "") +
        "\n" +
        "报名者：" +
        (bookerName || "") +
        "\n" +
        "参加者：" +
        (name || "") +
        "\n" +
        "检索键：" +
        contactValue +
        "\n" +
        "日期：" +
        (activity.ActivityDate || "") +
        " " +
        (activity.StartTime || "") +
        "\n" +
        "状態：" +
        (status || ""),
    );
  } catch (error) {
    Logger.log("参加申込みFCM通知送信失败: " + error.message);
  }

  /**************************************************
   * V1 → V2
   * REGISTRATION_OK
   *
   * 只有正式报名 CONFIRMED 才发送。
   **************************************************/

  if (status === CONFIG.STATUS.CONFIRMED) {
    try {
      sendRegistrationOkNotificationToV2_({
        activityID: activityID,

        activityTitle: activity.Title || "",

        activityDate: activity.ActivityDate || "",

        startTime: activity.StartTime || "",

        participantName: name || "",

        confirmedCount: confirmedCount + 1,

        capacity: capacity,
      });
    } catch (error) {
      Logger.log(
        "V1 → V2 REGISTRATION_OK 通知失败: " + (error.message || error),
      );
    }
  }

  /**************************************************
   * 返回
   **************************************************/

  return {
    success: true,

    registrationGroupID: registrationGroupID,

    registrationID: registrationID,

    bookerName: bookerName,

    participantName: name,

    contactType: contactType,

    /*
     * 返回真正写入 Sheet 的值。
     */
    contactValue: contactValue,

    activityID: activityID,

    title: activity.Title || "",

    date: activity.ActivityDate || "",

    startTime: activity.StartTime || "",

    endTime: activity.EndTime || "",

    capacity: capacity,

    confirmedCount:
      confirmedCount + (status === CONFIG.STATUS.CONFIRMED ? 1 : 0),

    status: status,

    fee: Number(activity.Fee) || 0,

    message: status === CONFIG.STATUS.CONFIRMED ? "报名成功" : "候补成功",
  };
}

/****************************************************
 * ==================================================
 * 5. Generate Unique Registration ID
 * ==================================================
 ****************************************************/

function generateUniqueRegistrationID() {
  const sheet = getSheet(CONFIG.SHEETS.REGISTRATIONS);

  if (!sheet) {
    throw new Error("Missing Sheet: " + CONFIG.SHEETS.REGISTRATIONS);
  }

  const lastRow = sheet.getLastRow();

  if (lastRow <= 1) {
    return generateID("REG");
  }

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  const idIndex = headers.indexOf("RegistrationID");

  if (idIndex === -1) {
    throw new Error("Registrations 表缺少 RegistrationID 字段");
  }

  const ids = sheet.getRange(2, idIndex + 1, lastRow - 1, 1).getValues();

  const existing = {};

  ids.forEach(function (row) {
    const id = normalizeString(row[0]);

    if (id) {
      existing[id] = true;
    }
  });

  for (let i = 0; i < 20; i++) {
    const id = generateID("REG");

    if (!existing[id]) {
      return id;
    }
  }

  throw new Error("无法生成唯一报名编号，请稍后再试");
}

/****************************************************
 * ==================================================
 * 6. Generate Unique Registration Group ID
 * ==================================================
 ****************************************************/

function generateUniqueRegistrationGroupID() {
  const sheet = getSheet(CONFIG.SHEETS.REGISTRATIONS);

  if (!sheet) {
    throw new Error("Missing Sheet: " + CONFIG.SHEETS.REGISTRATIONS);
  }

  const lastRow = sheet.getLastRow();

  if (lastRow <= 1) {
    return generateID("GRP");
  }

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  const groupIndex = headers.indexOf("RegistrationGroupID");

  if (groupIndex === -1) {
    throw new Error("Registrations 表缺少 RegistrationGroupID 字段");
  }

  const values = sheet.getRange(2, groupIndex + 1, lastRow - 1, 1).getValues();

  const existing = {};

  values.forEach(function (row) {
    const id = normalizeString(row[0]);

    if (id) {
      existing[id] = true;
    }
  });

  for (let i = 0; i < 20; i++) {
    const id = generateID("GRP");

    if (!existing[id]) {
      return id;
    }
  }

  throw new Error("无法生成唯一报名组编号，请稍后再试");
}

/****************************************************
 * ==================================================
 * 7. Cancel Registration
 * ==================================================
 ****************************************************/

function cancelRegistration(registrationID) {
  return withLock(function () {
    return cancelRegistrationCore(registrationID);
  });
}

function cancelRegistrationCore(registrationID) {
  const targetID = normalizeString(registrationID);

  if (!targetID) {
    return {
      success: false,

      message: "报名编号不能为空",
    };
  }

  const sheet = getSheet(CONFIG.SHEETS.REGISTRATIONS);

  if (!sheet) {
    throw new Error("Missing Sheet: " + CONFIG.SHEETS.REGISTRATIONS);
  }

  const data = sheet.getDataRange().getValues();

  if (data.length <= 1) {
    return {
      success: false,

      message: "报名记录不存在",
    };
  }

  const headers = data[0];

  const idIndex = headers.indexOf("RegistrationID");

  const statusIndex = headers.indexOf("Status");

  const activityIndex = headers.indexOf("ActivityID");

  const updatedIndex = headers.indexOf("UpdatedAt");

  if (idIndex === -1 || statusIndex === -1 || activityIndex === -1) {
    throw new Error("Registrations 表缺少必要字段");
  }

  let targetRow = -1;

  let activityID = "";

  for (let i = 1; i < data.length; i++) {
    if (normalizeString(data[i][idIndex]) === targetID) {
      targetRow = i + 1;

      activityID = normalizeString(data[i][activityIndex]);

      break;
    }
  }

  if (targetRow === -1) {
    return {
      success: false,

      message: "报名记录不存在",
    };
  }

  const currentStatus = normalizeString(data[targetRow - 1][statusIndex]);

  if (
    currentStatus !== CONFIG.STATUS.CONFIRMED &&
    currentStatus !== CONFIG.STATUS.WAITLIST
  ) {
    return {
      success: false,

      message: "该报名已经取消",
    };
  }

  sheet.getRange(targetRow, statusIndex + 1).setValue(CONFIG.STATUS.CANCELLED);

  if (updatedIndex !== -1) {
    sheet.getRange(targetRow, updatedIndex + 1).setValue(new Date());
  }

  SpreadsheetApp.flush();

  /**************************************************
   * 读取取消报名者资料
   **************************************************/

  const cancelNameIndex = headers.indexOf("Name");

  const cancelContactValueIndex = headers.indexOf("ContactValue");

  let cancelParticipantName = "";

  let cancelContactValue = "";

  if (cancelNameIndex !== -1) {
    cancelParticipantName = normalizeString(
      data[targetRow - 1][cancelNameIndex],
    );
  }

  if (cancelContactValueIndex !== -1) {
    cancelContactValue = normalizeString(
      data[targetRow - 1][cancelContactValueIndex],
    );
  }

  /**************************************************
   * 读取活动资料
   **************************************************/

  const cancelActivities = sheetToJson(CONFIG.SHEETS.ACTIVITIES);

  const cancelActivity =
    cancelActivities.find(function (activity) {
      return normalizeString(activity.ActivityID) === activityID;
    }) || {};

  /**************************************************
   * V2 → REGISTRATION_CANCELLED
   **************************************************/

  try {
    Logger.log("===== 开始发送取消报名通知 =====");

    Logger.log("registrationID = " + targetID);

    Logger.log("activityID = " + activityID);

    Logger.log("participantName = " + cancelParticipantName);

    Logger.log("contactValue = " + cancelContactValue);

    const notificationResult = sendRegistrationCancelledNotificationToV2_({
      activityID: activityID,

      activityTitle: cancelActivity.Title || "",

      activityDate: cancelActivity.ActivityDate || "",

      startTime: cancelActivity.StartTime || "",

      participantName: cancelParticipantName,

      contactValue: cancelContactValue,

      registrationID: targetID,
    });

    Logger.log("取消报名通知函数返回 = " + JSON.stringify(notificationResult));

    Logger.log("===== 取消报名通知函数执行结束 =====");
  } catch (error) {
    Logger.log("取消报名 V2 通知失败: " + (error.message || error));

    Logger.log("错误堆栈 = " + (error.stack || ""));
  }

  let promoted = null;

  if (currentStatus === CONFIG.STATUS.CONFIRMED) {
    promoted = promoteWaitlistCore(activityID);
  }

  return {
    success: true,

    message: "取消成功",

    registrationID: targetID,

    activityID: activityID,

    previousStatus: currentStatus,

    promoted: promoted,
  };
}

/****************************************************
 * ==================================================
 * 8. Cancel Registration Group
 * ==================================================
 ****************************************************/

function cancelRegistrationGroup(registrationGroupID) {
  return withLock(function () {
    return cancelRegistrationGroupCore(registrationGroupID);
  });
}

function cancelRegistrationGroupCore(registrationGroupID) {
  const targetGroupID = normalizeString(registrationGroupID);

  if (!targetGroupID) {
    return {
      success: false,

      message: "报名组编号不能为空",
    };
  }

  const sheet = getSheet(CONFIG.SHEETS.REGISTRATIONS);

  if (!sheet) {
    throw new Error("Missing Sheet: " + CONFIG.SHEETS.REGISTRATIONS);
  }

  const data = sheet.getDataRange().getValues();

  if (data.length <= 1) {
    return {
      success: false,

      message: "报名记录不存在",
    };
  }

  const headers = data[0];

  const groupIndex = headers.indexOf("RegistrationGroupID");

  const idIndex = headers.indexOf("RegistrationID");

  const activityIndex = headers.indexOf("ActivityID");

  const statusIndex = headers.indexOf("Status");

  const updatedIndex = headers.indexOf("UpdatedAt");

  const nameIndex = headers.indexOf("Name");

  const contactValueIndex = headers.indexOf("ContactValue");

  if (
    groupIndex === -1 ||
    idIndex === -1 ||
    activityIndex === -1 ||
    statusIndex === -1
  ) {
    throw new Error("Registrations 表缺少取消报名所需字段");
  }

  const rows = [];

  for (let i = 1; i < data.length; i++) {
    const rowGroupID = normalizeString(data[i][groupIndex]);

    if (rowGroupID === targetGroupID) {
      rows.push({
        row: i + 1,

        registrationID: normalizeString(data[i][idIndex]),

        activityID: normalizeString(data[i][activityIndex]),

        status: normalizeString(data[i][statusIndex]),

        participantName:
          nameIndex !== -1 ? normalizeString(data[i][nameIndex]) : "",

        contactValue:
          contactValueIndex !== -1
            ? normalizeString(data[i][contactValueIndex])
            : "",
      });
    }
  }

  if (rows.length === 0) {
    return {
      success: false,

      message: "报名组不存在：" + targetGroupID,
    };
  }

  const cancelled = [];

  const activitiesToPromote = {};

  /**************************************************
   * 第一阶段：全部取消
   **************************************************/

  rows.forEach(function (item) {
    if (
      item.status !== CONFIG.STATUS.CONFIRMED &&
      item.status !== CONFIG.STATUS.WAITLIST
    ) {
      return;
    }

    sheet.getRange(item.row, statusIndex + 1).setValue(CONFIG.STATUS.CANCELLED);

    if (updatedIndex !== -1) {
      sheet.getRange(item.row, updatedIndex + 1).setValue(new Date());
    }

    cancelled.push({
      registrationID: item.registrationID,

      activityID: item.activityID,

      previousStatus: item.status,
    });

    if (item.status === CONFIG.STATUS.CONFIRMED) {
      activitiesToPromote[item.activityID] = true;
    }
  });

  SpreadsheetApp.flush();

  /**************************************************
   * 第二阶段：发送取消报名通知
   **************************************************/

  cancelled.forEach(function (item) {
    try {
      const activities = sheetToJson(CONFIG.SHEETS.ACTIVITIES);

      const activity = activities.find(function (a) {
        return normalizeString(a.ActivityID) === item.activityID;
      });

      if (!activity) {
        Logger.log("取消报名通知：找不到活动 " + item.activityID);
        return;
      }

      Logger.log("===== 开始发送取消报名通知 =====");

      Logger.log("registrationID = " + item.registrationID);

      Logger.log("activityID = " + item.activityID);

      Logger.log("participantName = " + item.participantName);

      Logger.log("contactValue = " + item.contactValue);

      const notificationResult = sendRegistrationCancelledNotificationToV2_({
        activityID: item.activityID,

        activityTitle: activity.Title || "",

        activityDate: activity.ActivityDate || "",

        startTime: activity.StartTime || "",

        participantName: item.participantName || "",

        contactValue: item.contactValue || "",

        registrationID: item.registrationID,

        registrationGroupID: targetGroupID,
      });

      Logger.log(
        "取消报名通知函数返回 = " + JSON.stringify(notificationResult),
      );

      Logger.log("===== 取消报名通知函数执行结束 =====");
    } catch (error) {
      Logger.log("取消报名 V2 通知失败: " + (error.message || error));

      Logger.log("错误堆栈 = " + (error.stack || ""));
    }
  });

  /**************************************************
   * 第三阶段：统一补位
   **************************************************/

  const promoted = [];

  Object.keys(activitiesToPromote).forEach(function (activityID) {
    const result = promoteWaitlistCore(activityID);

    if (result) {
      promoted.push(result);
    }
  });

  Object.keys(activitiesToPromote).forEach(function (activityID) {
    const result = promoteWaitlistCore(activityID);

    if (result) {
      promoted.push(result);
    }
  });

  return {
    success: true,

    message: "报名单取消成功",

    registrationGroupID: targetGroupID,

    total: rows.length,

    cancelledCount: cancelled.length,

    cancelled: cancelled,

    promoted: promoted,
  };
}

/****************************************************
 * ==================================================
 * 9. Registration Detail
 * ==================================================
 ****************************************************/

function getRegistrationDetail(registrationID) {
  const targetID = normalizeString(registrationID);

  if (!targetID) {
    return {
      success: false,

      message: "没有收到报名编号",
    };
  }

  const registrations = sheetToJson(CONFIG.SHEETS.REGISTRATIONS);

  const registration = registrations.find(function (r) {
    return normalizeString(r.RegistrationID) === targetID;
  });

  if (!registration) {
    return {
      success: false,

      message: "报名记录不存在：" + targetID,
    };
  }

  const activities = sheetToJson(CONFIG.SHEETS.ACTIVITIES);

  const activity =
    activities.find(function (a) {
      return (
        normalizeString(a.ActivityID) ===
        normalizeString(registration.ActivityID)
      );
    }) || {};

  const venues = sheetToJson(CONFIG.SHEETS.VENUES);

  const venue =
    venues.find(function (v) {
      return normalizeString(v.VenueID) === normalizeString(activity.VenueID);
    }) || {};

  return {
    success: true,

    Registration: {
      RegistrationID: registration.RegistrationID || "",

      RegistrationGroupID: registration.RegistrationGroupID || "",

      ActivityID: registration.ActivityID || "",

      BookerName: registration.BookerName || "",

      Name: registration.Name || "",

      ContactType: registration.ContactType || "",

      /*
       * ★ ContactValue
       */
      ContactValue: registration.ContactValue || "",

      Level: registration.Level || "",

      Parking: registration.Parking === true,

      Status: registration.Status || "",

      Fee: Number(registration.FeeAmount || 0),

      PaymentStatus: registration.PaymentStatus || "",

      PaymentMethod: registration.PaymentMethod || "",

      PaidAt: registration.PaidAt || "",

      PaymentNote: registration.PaymentNote || "",

      CheckinStatus: registration.CheckinStatus || "",

      Message: registration.Message || "",

      CreatedAt: registration.CreatedAt || "",

      UpdatedAt: registration.UpdatedAt || "",
    },

    Activity: {
      ActivityID: activity.ActivityID || "",

      Title: activity.Title || "",

      Date: activity.ActivityDate || "",

      StartTime: activity.StartTime || "",

      EndTime: activity.EndTime || "",

      Capacity: Number(activity.Capacity || 0),

      Fee: Number(activity.Fee || 0),
    },

    Venue: {
      Name: venue.VenueName || "",

      Address: venue.Address || "",
    },
  };
}

/****************************************************
 * ==================================================
 * 10. Registration Group Detail
 * ==================================================
 ****************************************************/

function getRegistrationGroupDetail(registrationGroupID) {
  const targetGroupID = normalizeString(registrationGroupID);

  if (!targetGroupID) {
    return {
      success: false,

      message: "没有收到报名组编号",
    };
  }

  const registrations = sheetToJson(CONFIG.SHEETS.REGISTRATIONS);

  const groupRegistrations = registrations.filter(function (r) {
    return normalizeString(r.RegistrationGroupID) === targetGroupID;
  });

  if (groupRegistrations.length === 0) {
    return {
      success: false,

      message: "报名组不存在：" + targetGroupID,
    };
  }

  const activities = sheetToJson(CONFIG.SHEETS.ACTIVITIES);

  const venues = sheetToJson(CONFIG.SHEETS.VENUES);

  const bookerName = normalizeString(groupRegistrations[0].BookerName);

  const participantMap = {};

  groupRegistrations.forEach(function (r) {
    const participantName = normalizeString(r.Name);

    const participantKey = normalizeName(participantName);

    if (!participantMap[participantKey]) {
      participantMap[participantKey] = {
        name: participantName,

        contactType: r.ContactType || "",

        /*
         * ★ 每个人自己的 ContactValue
         */
        contactValue: r.ContactValue || "",

        level: r.Level || "",

        parking: r.Parking === true,

        registrations: [],
      };
    }

    const activity =
      activities.find(function (a) {
        return normalizeString(a.ActivityID) === normalizeString(r.ActivityID);
      }) || {};

    const venue =
      venues.find(function (v) {
        return normalizeString(v.VenueID) === normalizeString(activity.VenueID);
      }) || {};

    participantMap[participantKey].registrations.push({
      registrationID: r.RegistrationID || "",

      activityID: r.ActivityID || "",

      title: activity.Title || "",

      date: activity.ActivityDate || "",

      startTime: activity.StartTime || "",

      endTime: activity.EndTime || "",

      venueName: venue.VenueName || "",

      status: r.Status || "",

      fee: Number(r.FeeAmount || 0),

      paymentStatus: r.PaymentStatus || "",

      checkinStatus: r.CheckinStatus || "",

      createdAt: r.CreatedAt || "",

      updatedAt: r.UpdatedAt || "",
    });
  });

  const participants = Object.keys(participantMap).map(function (key) {
    return participantMap[key];
  });

  return {
    success: true,

    registrationGroupID: targetGroupID,

    bookerName: bookerName,

    total: groupRegistrations.length,

    participants: participants,
  };
}

/****************************************************
 * ==================================================
 * 11. My Registration API
 * ==================================================
 ****************************************************/

function getMyRegistrations(contactValue) {
  const targetContact = normalizeString(contactValue).toLowerCase();

  if (!targetContact) {
    return {
      success: true,

      count: 0,

      data: [],
    };
  }

  const registrations = sheetToJson(CONFIG.SHEETS.REGISTRATIONS);

  const myRegistrations = registrations.filter(function (r) {
    const savedContact = normalizeString(r.ContactValue).toLowerCase();

    return savedContact === targetContact;
  });

  if (myRegistrations.length === 0) {
    return {
      success: true,

      count: 0,

      data: [],
    };
  }

  const activities = sheetToJson(CONFIG.SHEETS.ACTIVITIES);

  const venues = sheetToJson(CONFIG.SHEETS.VENUES);

  const result = myRegistrations.map(function (r) {
    const activity =
      activities.find(function (a) {
        return normalizeString(a.ActivityID) === normalizeString(r.ActivityID);
      }) || {};

    const venue =
      venues.find(function (v) {
        return normalizeString(v.VenueID) === normalizeString(activity.VenueID);
      }) || {};

    return {
      RegistrationID: r.RegistrationID || "",

      RegistrationGroupID: r.RegistrationGroupID || "",

      BookerName: r.BookerName || "",

      ActivityID: r.ActivityID || "",

      Name: r.Name || "",

      /*
       * 返回 ContactValue，
       * 方便前端确认检索键。
       */
      ContactValue: r.ContactValue || "",

      Title: activity.Title || "",

      Date: activity.ActivityDate || "",

      StartTime: activity.StartTime || "",

      EndTime: activity.EndTime || "",

      VenueName: venue.VenueName || "",

      Status: r.Status || "",

      Fee: Number(r.FeeAmount || 0),

      PaymentStatus: r.PaymentStatus || "",

      CheckinStatus: r.CheckinStatus || "",

      CreatedAt: r.CreatedAt || "",

      UpdatedAt: r.UpdatedAt || "",
    };
  });

  return {
    success: true,

    count: result.length,

    data: result,
  };
}

/****************************************************
 * ==================================================
 * 12. Promote Waitlist
 * ==================================================
 ****************************************************/

function promoteWaitlist(activityID) {
  return withLock(function () {
    return promoteWaitlistCore(normalizeString(activityID));
  });
}

function promoteWaitlistCore(activityID) {
  const targetActivityID = normalizeString(activityID);

  if (!targetActivityID) {
    return null;
  }

  const sheet = getSheet(CONFIG.SHEETS.REGISTRATIONS);

  if (!sheet) {
    throw new Error("Missing Sheet: " + CONFIG.SHEETS.REGISTRATIONS);
  }

  /**************************************************
   * Activity
   **************************************************/

  const activities = sheetToJson(CONFIG.SHEETS.ACTIVITIES);

  const activity = activities.find(function (a) {
    return normalizeString(a.ActivityID) === targetActivityID;
  });

  if (!activity) {
    return null;
  }

  let capacity = Number(activity.Capacity);

  if (isNaN(capacity) || capacity < 0) {
    capacity = 0;
  }

  /**************************************************
   * Registration Data
   **************************************************/

  const data = sheet.getDataRange().getValues();

  if (data.length <= 1) {
    return null;
  }

  const headers = data[0];

  const activityIndex = headers.indexOf("ActivityID");

  const statusIndex = headers.indexOf("Status");

  const updatedIndex = headers.indexOf("UpdatedAt");

  const createdIndex = headers.indexOf("CreatedAt");

  const idIndex = headers.indexOf("RegistrationID");

  if (
    activityIndex === -1 ||
    statusIndex === -1 ||
    createdIndex === -1 ||
    idIndex === -1
  ) {
    throw new Error("Registrations 表缺少候补所需字段");
  }

  /**************************************************
   * 当前正式人数
   **************************************************/

  let confirmedCount = 0;

  for (let i = 1; i < data.length; i++) {
    if (
      normalizeString(data[i][activityIndex]) === targetActivityID &&
      normalizeString(data[i][statusIndex]) === CONFIG.STATUS.CONFIRMED
    ) {
      confirmedCount++;
    }
  }

  if (confirmedCount >= capacity) {
    return null;
  }

  /**************************************************
   * 找候补
   **************************************************/

  const candidates = [];

  for (let i = 1; i < data.length; i++) {
    const rowActivityID = normalizeString(data[i][activityIndex]);

    const rowStatus = normalizeString(data[i][statusIndex]);

    if (
      rowActivityID === targetActivityID &&
      rowStatus === CONFIG.STATUS.WAITLIST
    ) {
      let createdAt = data[i][createdIndex];

      if (!(createdAt instanceof Date)) {
        createdAt = new Date(createdAt);
      }

      if (isNaN(createdAt.getTime())) {
        createdAt = new Date(0);
      }

      candidates.push({
        row: i + 1,

        createdAt: createdAt,
      });
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  /**************************************************
   * 最早报名优先
   **************************************************/

  candidates.sort(function (a, b) {
    return a.createdAt - b.createdAt;
  });

  const candidateRow = candidates[0].row;

  /**************************************************
   * 转正式
   **************************************************/

  sheet
    .getRange(candidateRow, statusIndex + 1)
    .setValue(CONFIG.STATUS.CONFIRMED);

  if (updatedIndex !== -1) {
    sheet.getRange(candidateRow, updatedIndex + 1).setValue(new Date());
  }

  SpreadsheetApp.flush();

  /**************************************************
   * Registration ID
   **************************************************/

  const registrationID = sheet.getRange(candidateRow, idIndex + 1).getValue();

  /**************************************************
   * Group ID
   **************************************************/

  const groupIndex = headers.indexOf("RegistrationGroupID");

  let registrationGroupID = "";

  if (groupIndex !== -1) {
    registrationGroupID = sheet
      .getRange(candidateRow, groupIndex + 1)
      .getValue();
  }

  /**************************************************
   * Booker
   **************************************************/

  const bookerIndex = headers.indexOf("BookerName");

  let bookerName = "";

  if (bookerIndex !== -1) {
    bookerName = sheet.getRange(candidateRow, bookerIndex + 1).getValue();
  }

  /**************************************************
   * Participant
   **************************************************/

  const nameIndex = headers.indexOf("Name");

  let participantName = "";

  if (nameIndex !== -1) {
    participantName = sheet.getRange(candidateRow, nameIndex + 1).getValue();
  }

  /**************************************************
   * ContactValue
   **************************************************/

  const contactValueIndex = headers.indexOf("ContactValue");

  let contactValue = "";

  if (contactValueIndex !== -1) {
    contactValue = normalizeString(
      sheet.getRange(candidateRow, contactValueIndex + 1).getValue(),
    );
  }

  /**************************************************
   * 通知
   **************************************************/

  /**************************************************
   * 自动转正通知
   *
   * WAITLIST → CONFIRMED
   *
   * ContactValue 必须使用当前被转正参加人的
   * ContactValue。
   **************************************************/

  try {
    createNotification({
      type: "WAITLIST_PROMOTED",

      message: "候补自动转正成功",

      registrationID: registrationID,

      registrationGroupID: registrationGroupID,

      activityID: targetActivityID,

      contactValue: contactValue,

      participantName: participantName,

      bookerName: bookerName,

      status: CONFIG.STATUS.CONFIRMED,
    });
  } catch (error) {
    Logger.log("候补自动转正通知创建失败: " + (error.message || error));
  }

  /**************************************************
   * V2 → REGISTRATION_OK
   *
   * 候补转正后，也视为正式报名成功。
   **************************************************/

  try {
    sendRegistrationOkNotificationToV2_({
      activityID: targetActivityID,

      activityTitle: activity.Title || "",

      activityDate: activity.ActivityDate || "",

      startTime: activity.StartTime || "",

      participantName: participantName || "",

      confirmedCount: confirmedCount + 1,

      capacity: capacity,
    });
  } catch (error) {
    Logger.log(
      "候补自动转正 REGISTRATION_OK 通知失败: " + (error.message || error),
    );
  }

  /**************************************************
   * 管理员 FCM
   **************************************************/

  try {
    sendAdminFCMNotification(
      "🏸 候补自动转正",

      "候补参加者已自动转正。\n" +
        "报名单：" +
        (registrationGroupID || "") +
        "\n" +
        "活动：" +
        (activity.Title || "") +
        "\n" +
        "报名者：" +
        (bookerName || "") +
        "\n" +
        "参加者：" +
        (participantName || "") +
        "\n" +
        "检索键：" +
        (contactValue || "") +
        "\n" +
        "状态：CONFIRMED",
    );
  } catch (error) {
    Logger.log("候补自动转正管理员 FCM 通知失败: " + (error.message || error));
  }

  return {
    registrationID: registrationID,

    registrationGroupID: registrationGroupID,

    bookerName: bookerName,

    participantName: participantName,

    contactValue: contactValue,

    activityID: targetActivityID,

    status: CONFIG.STATUS.CONFIRMED,
  };
}

/****************************************************
 * ==================================================
 * 13. Normalize String
 * ==================================================
 ****************************************************/

function normalizeString(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

/****************************************************
 * ==================================================
 * 14. Normalize Name
 * ==================================================
 ****************************************************/

function normalizeName(value) {
  return normalizeString(value).replace(/\s+/g, "");
}

/****************************************************
 * ==================================================
 * 15. Tests
 * ==================================================
 ****************************************************/

/**
 * 单人测试
 *
 * 预期：
 *
 * ContactValue = 6666
 */
function testRegisterContactValue() {
  const result = registerActivities({
    activityIDs: ["ACT260825092719011"],

    bookerName: "中",

    participants: [
      {
        name: "中",

        contactType: "NONE",

        contactValue: "6666",

        level: "L1",

        parking: false,
      },
    ],

    message: "ContactValue 测试",
  });

  Logger.log(JSON.stringify(result, null, 2));
}

/**
 * 兼容前端把 ContactValue
 * 放在 data 顶层的测试。
 *
 * 预期：
 *
 * ContactValue = 6666
 */
function testRegisterRootContactValue() {
  const result = registerActivities({
    activityIDs: ["ACT260825092719011"],

    bookerName: "中",

    contactValue: "6666",

    participants: [
      {
        name: "中",

        level: "L1",

        parking: false,
      },
    ],
  });

  Logger.log(JSON.stringify(result, null, 2));
}

/**
 * 多人测试
 *
 * 预期：
 *
 * 中   → 6666
 * 李   → 7777
 * 王   → 8888
 */
function testRegisterMultipleContactValues() {
  const result = registerActivities({
    activityIDs: ["ACT260825092719011"],

    bookerName: "中",

    participants: [
      {
        name: "中",

        contactValue: "6666",

        level: "L1",

        parking: false,
      },

      {
        name: "李",

        contactValue: "7777",

        level: "L2",

        parking: false,
      },

      {
        name: "王",

        contactValue: "8888",

        level: "L3",

        parking: false,
      },
    ],
  });

  Logger.log(JSON.stringify(result, null, 2));
}

/**
 * 我的报名测试
 */
function testGetMyRegistrations6666() {
  const result = getMyRegistrations("6666");

  Logger.log(JSON.stringify(result, null, 2));
}

/**
 * Detail 测试
 */
function testGetRegistrationDetail() {
  const result = getRegistrationDetail("REG260825093012566");

  Logger.log(JSON.stringify(result, null, 2));
}

/**
 * Group Detail 测试
 */
function testGetRegistrationGroupDetail() {
  const result = getRegistrationGroupDetail("GRP260825093011756");

  Logger.log(JSON.stringify(result, null, 2));
}
