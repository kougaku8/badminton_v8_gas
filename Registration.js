/****************************************************
 * Registration.gs
 *
 * 核心规则：
 *
 * ContactValue = 「我的报名」唯一检索键
 *
 * 性能目标：
 *
 * 报名请求：
 *     1～3 秒优先
 *
 * FCM 通知：
 *     异步 Queue
 *     延迟没关系
 *
 * 流程：
 *
 * Registration
 *      ↓
 * Registration Sheet
 *      ↓
 * NotificationQueue
 *      ↓
 * 立即返回报名成功
 *
 * Time-driven Trigger
 *      ↓
 * processNotificationQueue()
 *      ↓
 * V2
 *      ↓
 * FCM
 ****************************************************/

/****************************************************
 * ==================================================
 * 1. ContactValue
 * ==================================================
 ****************************************************/

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

function resolveContactValue(participantValue, rootValue, participantCount) {
  const participantContact = normalizeString(participantValue);

  if (participantContact) {
    return participantContact;
  }

  if (participantCount === 1) {
    const rootContact = normalizeString(rootValue);

    if (rootContact) {
      return rootContact;
    }
  }

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
 * 3. 多活动 / 多人报名
 * ==================================================
 ****************************************************/

function registerActivities(data) {
  return withLock(function () {
    return registerActivitiesCore(data);
  });
}

function registerActivitiesCore(data) {
  if (!data) {
    return {
      success: false,
      message: "没有收到报名资料",
      data: [],
    };
  }

  /**************************************************
   * Idempotency
   **************************************************/

  const clientRequestID = normalizeString(data.clientRequestID);

  if (clientRequestID) {
    const duplicateResult = checkProcessedRequest(clientRequestID);

    if (duplicateResult) {
      return {
        success: true,

        duplicate: true,

        message: "该请求已经处理",

        clientRequestID: clientRequestID,

        data: [],
      };
    }
  }

  /**************************************************
   * Activity IDs
   **************************************************/

  let activityIDs = data.activityIDs;

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

  const rootContactValue = getRootContactValue(data);

  /**************************************************
   * 标准化 Participants
   **************************************************/

  participants = participants
    .map(function (participant) {
      if (!participant) {
        return null;
      }

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
   * 每个人独立 ContactValue
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

  const message = normalizeString(data.message);

  const registrationGroupID = generateUniqueRegistrationGroupID();

  /**************************************************
   * 执行报名
   **************************************************/

  const results = [];

  participants.forEach(function (participant) {
    activityIDs.forEach(function (activityID) {
      let result;

      try {
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

  if (clientRequestID) {
    saveProcessedRequest(clientRequestID);
  }

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
 * 4. 单个 Activity 实际报名
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

  let contactValue = normalizeString(data.contactValue);

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
   * Activity
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
   * Activity Status
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
   * Registrations
   **************************************************/

  const registrations = sheetToJson(CONFIG.SHEETS.REGISTRATIONS);

  /**************************************************
   * Duplicate
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
   * Confirmed Count
   **************************************************/

  const confirmedCount = registrations.filter(function (r) {
    return (
      normalizeString(r.ActivityID) === activityID &&
      normalizeString(r.Status) === CONFIG.STATUS.CONFIRMED
    );
  }).length;

  /**************************************************
   * Capacity
   **************************************************/

  let capacity = Number(activity.Capacity);

  if (isNaN(capacity) || capacity < 0) {
    capacity = 0;
  }

  /**************************************************
   * Status
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
   * Registration Sheet
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
   * 根据 Header 创建 row
   **************************************************/

  const row = headers.map(function (header) {
    if (Object.prototype.hasOwnProperty.call(rowData, header)) {
      return rowData[header];
    }

    return "";
  });

  /*
   * 最后一次保护：
   * ContactValue 一定写入 Header 对应列。
   */
  row[contactValueIndex] = contactValue;

  /**************************************************
   * 写入
   *
   * ★ 不再 flush
   * ★ 不再写入后重新读取验证
   *
   * 这是报名速度优化的关键。
   **************************************************/

  appendRow(CONFIG.SHEETS.REGISTRATIONS, row);

  /**************************************************
   * 管理员通知
   *
   * 只写 Queue。
   * 不发送 FCM。
   **************************************************/

  try {
    enqueueAdminRegistrationNotification({
      title: "🏸 新しい参加申込み",

      message:
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
    });
  } catch (error) {
    Logger.log("管理员通知 Queue 写入失败：" + (error.message || error));
  }

  /**************************************************
   * REGISTRATION_OK Queue
   *
   * ★ CONFIRMED / WAITLIST 都发送
   * ★ 只要报名记录成功写入，就发送
   * ★ 不发送 V2
   * ★ 不发送 FCM
   * ★ 不等待通知
   **************************************************/

  try {
    enqueueRegistrationOkNotification({
      activityID: activityID,

      activityTitle: activity.Title || "",

      activityDate: activity.ActivityDate || "",

      startTime: activity.StartTime || "",

      participantName: name || "",

      status: status,

      confirmedCount:
        confirmedCount + (status === CONFIG.STATUS.CONFIRMED ? 1 : 0),

      capacity: capacity,
    });
  } catch (error) {
    Logger.log("REGISTRATION_OK Queue 写入失败：" + (error.message || error));
  }

  /**************************************************
   * Return
   **************************************************/

  return {
    success: true,

    registrationGroupID: registrationGroupID,

    registrationID: registrationID,

    bookerName: bookerName,

    participantName: name,

    contactType: contactType,

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
 * 5. Registration ID
 * ==================================================
 ****************************************************/

function generateUniqueRegistrationID() {
  return generateID("REG");
}

/****************************************************
 * ==================================================
 * 6. Registration Group ID
 * ==================================================
 ****************************************************/

function generateUniqueRegistrationGroupID() {
  return generateID("GRP");
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

  /**************************************************
   * 读取取消报名者
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
   * Activity
   **************************************************/

  const cancelActivities = sheetToJson(CONFIG.SHEETS.ACTIVITIES);

  const cancelActivity =
    cancelActivities.find(function (activity) {
      return normalizeString(activity.ActivityID) === activityID;
    }) || {};

  /**************************************************
   * Cancel Notification
   *
   * 取消报名暂时继续直接 V2，
   * 不影响本次报名成功速度。
   **************************************************/

  try {
    sendRegistrationCancelledNotificationToV2_({
      activityID: activityID,

      activityTitle: cancelActivity.Title || "",

      activityDate: cancelActivity.ActivityDate || "",

      startTime: cancelActivity.StartTime || "",

      participantName: cancelParticipantName,

      contactValue: cancelContactValue,

      registrationID: targetID,
    });
  } catch (error) {
    Logger.log("取消报名 V2 通知失败：" + (error.message || error));
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
   * 第一阶段：取消
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

      participantName: item.participantName,

      contactValue: item.contactValue,
    });

    if (item.status === CONFIG.STATUS.CONFIRMED) {
      activitiesToPromote[item.activityID] = true;
    }
  });

  /**************************************************
   * 第二阶段：取消通知
   **************************************************/

  const activities = sheetToJson(CONFIG.SHEETS.ACTIVITIES);

  cancelled.forEach(function (item) {
    try {
      const activity = activities.find(function (a) {
        return normalizeString(a.ActivityID) === item.activityID;
      });

      if (!activity) {
        return;
      }

      sendRegistrationCancelledNotificationToV2_({
        activityID: item.activityID,

        activityTitle: activity.Title || "",

        activityDate: activity.ActivityDate || "",

        startTime: activity.StartTime || "",

        participantName: item.participantName || "",

        contactValue: item.contactValue || "",

        registrationID: item.registrationID,

        registrationGroupID: targetGroupID,
      });
    } catch (error) {
      Logger.log("取消报名 V2 通知失败：" + (error.message || error));
    }
  });

  /**************************************************
   * 第三阶段：统一补位
   *
   * ★ 修复原代码重复执行两次的问题
   **************************************************/

  const promoted = [];

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
 * 11. My Registration
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
   * Confirmed Count
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
   * Waitlist Candidates
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
   * WAITLIST_PROMOTED
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
    Logger.log("候补自动转正通知创建失败：" + (error.message || error));
  }

  /**************************************************
   * REGISTRATION_OK Queue
   **************************************************/

  try {
    enqueueRegistrationOkNotification({
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
      "候补转正 REGISTRATION_OK Queue 写入失败：" + (error.message || error),
    );
  }

  /**************************************************
   * Admin Queue
   *
   * 修复原代码：
   *
   * 原来这里使用了不存在的：
   *
   * name
   * status
   *
   * 现在使用：
   *
   * participantName
   * CONFIG.STATUS.CONFIRMED
   **************************************************/

  try {
    enqueueAdminRegistrationNotification({
      title: "🏸 新しい参加申込み",

      message:
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
        (participantName || "") +
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
        CONFIG.STATUS.CONFIRMED,
    });
  } catch (error) {
    Logger.log("管理员通知 Queue 写入失败：" + (error.message || error));
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
 * 13. Normalize
 * ==================================================
 ****************************************************/

function normalizeString(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

function normalizeName(value) {
  return normalizeString(value).replace(/\s+/g, "");
}

/****************************************************
 * ==================================================
 * 14. Processed Request
 * ==================================================
 ****************************************************/

function getProcessedRequestType(clientRequestID) {
  const id = normalizeString(clientRequestID).toUpperCase();

  if (!id) {
    return "";
  }

  if (id.indexOf("REQ-") === 0) {
    return "REGISTRATION";
  }

  if (id.indexOf("CHECKIN-") === 0) {
    return "CHECKIN";
  }

  return "";
}

function checkProcessedRequest(clientRequestID) {
  const requestID = normalizeString(clientRequestID);

  if (!requestID) {
    return false;
  }

  const requestType = getProcessedRequestType(requestID);

  if (!requestType) {
    return false;
  }

  const ss = SpreadsheetApp.getActive();

  const sheet = ss.getSheetByName("ProcessedRequests");

  if (!sheet) {
    return false;
  }

  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return false;
  }

  const lastColumn = Math.max(sheet.getLastColumn(), 3);

  const values = sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues();

  return values.some(function (row) {
    const savedRequestID = normalizeString(row[0]);

    const savedRequestType = normalizeString(row[1]);

    return savedRequestID === requestID && savedRequestType === requestType;
  });
}

function saveProcessedRequest(clientRequestID) {
  const requestID = normalizeString(clientRequestID);

  if (!requestID) {
    return;
  }

  const requestType = getProcessedRequestType(requestID);

  if (!requestType) {
    Logger.log("ProcessedRequests：未知 ClientRequestID 类型：" + requestID);

    return;
  }

  const ss = SpreadsheetApp.getActive();

  let sheet = ss.getSheetByName("ProcessedRequests");

  if (!sheet) {
    sheet = ss.insertSheet("ProcessedRequests");

    sheet
      .getRange(1, 1, 1, 3)
      .setValues([["ClientRequestID", "RequestType", "CreatedAt"]]);
  }

  if (checkProcessedRequest(requestID)) {
    return;
  }

  sheet.appendRow([requestID, requestType, new Date()]);
}

/****************************************************
 * ==================================================
 * 15. Notification Queue
 * ==================================================
 ****************************************************/

function getNotificationQueueSheet() {
  const ss = SpreadsheetApp.getActive();

  let sheet = ss.getSheetByName("NotificationQueue");

  if (!sheet) {
    sheet = ss.insertSheet("NotificationQueue");

    sheet
      .getRange(1, 1, 1, 7)
      .setValues([
        [
          "QueueID",
          "Type",
          "Status",
          "CreatedAt",
          "ProcessedAt",
          "Payload",
          "ErrorMessage",
        ],
      ]);
  }

  return sheet;
}

function generateNotificationQueueID() {
  return generateID("Q");
}

/****************************************************
 * REGISTRATION_OK Queue
 *
 * ★ 重要：
 *
 * 不再 SpreadsheetApp.flush()
 ****************************************************/

function enqueueRegistrationOkNotification(payload) {
  if (!payload) {
    throw new Error("Notification Queue Payload 为空");
  }

  const sheet = getNotificationQueueSheet();

  const queueID = generateNotificationQueueID();

  sheet.appendRow([
    queueID,

    "REGISTRATION_OK",

    "PENDING",

    new Date(),

    "",

    JSON.stringify(payload),

    "",
  ]);

  return {
    success: true,

    queueID: queueID,

    status: "PENDING",
  };
}

/****************************************************
 * ADMIN Queue
 *
 * ★ 只有这一份
 ****************************************************/

function enqueueAdminRegistrationNotification(data) {
  if (!data) {
    throw new Error("管理员通知资料为空");
  }

  const title = normalizeString(data.title) || "🏸 新しい参加申込み";

  const message = normalizeString(data.message);

  if (!message) {
    throw new Error("管理员通知 Message 为空");
  }

  const sheet = getNotificationQueueSheet();

  const queueID = generateNotificationQueueID();

  sheet.appendRow([
    queueID,

    "ADMIN_REGISTRATION",

    "PENDING",

    new Date(),

    "",

    JSON.stringify({
      title: title,

      message: message,
    }),

    "",
  ]);

  return {
    success: true,

    queueID: queueID,

    status: "PENDING",
  };
}

/****************************************************
 * ==================================================
 * 16. Process Notification Queue
 * ==================================================
 *
 * Time-driven Trigger：
 *
 * 每分钟一次
 *
 * 这个函数不参与用户报名响应。
 ****************************************************/

function processNotificationQueue() {
  const sheet = getNotificationQueueSheet();

  const lastRow = sheet.getLastRow();

  if (lastRow <= 1) {
    return {
      success: true,

      processed: 0,

      message: "没有待处理通知",
    };
  }

  const lastColumn = Math.max(sheet.getLastColumn(), 7);

  const values = sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues();

  const processed = [];

  for (let i = 0; i < values.length; i++) {
    const rowNumber = i + 2;

    const queueID = normalizeString(values[i][0]);

    const type = normalizeString(values[i][1]);

    const status = normalizeString(values[i][2]);

    const payloadString = normalizeString(values[i][5]);

    if (status !== "PENDING") {
      continue;
    }

    if (type !== "REGISTRATION_OK" && type !== "ADMIN_REGISTRATION") {
      continue;
    }

    if (!payloadString) {
      sheet.getRange(rowNumber, 3).setValue("FAILED");

      sheet.getRange(rowNumber, 5).setValue(new Date());

      sheet.getRange(rowNumber, 7).setValue("Payload 为空");

      continue;
    }

    let payload;

    try {
      payload = JSON.parse(payloadString);
    } catch (error) {
      sheet.getRange(rowNumber, 3).setValue("FAILED");

      sheet.getRange(rowNumber, 5).setValue(new Date());

      sheet
        .getRange(rowNumber, 7)
        .setValue("Payload JSON 解析失败：" + (error.message || error));

      continue;
    }

    try {
      let result;

      /**********************************************
       * REGISTRATION_OK
       **********************************************/

      if (type === "REGISTRATION_OK") {
        Logger.log("NotificationQueue → REGISTRATION_OK → " + queueID);

        result = sendRegistrationOkNotificationToV2_(payload);
      } else if (type === "ADMIN_REGISTRATION") {
        /**********************************************
         * ADMIN_REGISTRATION
         **********************************************/
        Logger.log("NotificationQueue → ADMIN_REGISTRATION → " + queueID);

        result = sendAdminFCMNotification(payload.title, payload.message);
      }

      Logger.log("NotificationQueue 发送结果：" + JSON.stringify(result));

      sheet.getRange(rowNumber, 3).setValue("SENT");

      sheet.getRange(rowNumber, 5).setValue(new Date());

      sheet.getRange(rowNumber, 7).setValue("");

      processed.push({
        queueID: queueID,

        type: type,

        status: "SENT",
      });
    } catch (error) {
      sheet.getRange(rowNumber, 3).setValue("FAILED");

      sheet.getRange(rowNumber, 5).setValue(new Date());

      sheet.getRange(rowNumber, 7).setValue(error.message || String(error));

      Logger.log(
        "NotificationQueue 发送失败：" +
          queueID +
          " / " +
          type +
          " / " +
          (error.message || error),
      );
    }
  }

  /*
   * 这里 flush 没问题。
   *
   * 因为这是后台 Trigger，
   * 不影响用户报名接口。
   */
  SpreadsheetApp.flush();

  return {
    success: true,

    processed: processed.length,

    data: processed,
  };
}

/****************************************************
 * ==================================================
 * 17. Tests
 * ==================================================
 ****************************************************/

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

function testGetMyRegistrations6666() {
  const result = getMyRegistrations("6666");

  Logger.log(JSON.stringify(result, null, 2));
}

function testGetRegistrationDetail() {
  const result = getRegistrationDetail("REG260825093012566");

  Logger.log(JSON.stringify(result, null, 2));
}

function testGetRegistrationGroupDetail() {
  const result = getRegistrationGroupDetail("GRP260825093011756");

  Logger.log(JSON.stringify(result, null, 2));
}
