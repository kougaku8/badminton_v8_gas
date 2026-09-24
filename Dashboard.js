/****************************************************
 * Dashboard API
 ****************************************************/

/****************************************************
 * Dashboard API
 ****************************************************/

function getDashboard(activityID) {
  const detail = getDashboardDetail(activityID);

  const activities = sheetToJson(CONFIG.SHEETS.ACTIVITIES);

  const activity = activities.find((a) => a.ActivityID === activityID) || {};

  const venues = sheetToJson(CONFIG.SHEETS.VENUES);

  const venue = venues.find((v) => v.VenueID === activity.VenueID) || {};

  return {
    success: true,

    activity: {
      ActivityID: activity.ActivityID,

      Title: activity.Title,

      Date: activity.ActivityDate,

      StartTime: activity.StartTime,

      EndTime: activity.EndTime,

      VenueID: activity.VenueID,

      VenueName: venue.VenueName || "",

      CourtCount: Number(activity.CourtCount),

      Capacity: Number(activity.Capacity),

      Fee: Number(activity.Fee),

      Status: activity.Status,

      Description: activity.Description || "",
    },

    summary: {
      total: detail.memberCount,

      checkedIn: detail.checkedIn,

      notCheckedIn: detail.notCheckedIn,

      checkinRate: detail.checkinRate,

      payment: detail.payment,
    },
  };
}

function testDashboard() {
  const result = getDashboard("ACT000001");

  Logger.log(JSON.stringify(result, null, 2));
}

/****************************************************
 * 批量复制活动
 *
 * 功能：
 * 选择一个活动作为模板，
 * 一次传入多个日期，
 * 创建多个新的活动。
 *
 * 不复制：
 * - Registration
 * - Checkin
 * - Payment
 *
 * 只复制活动本身的设置。
 ****************************************************/

function batchCopyActivities(activityID, targetDates) {
  if (!activityID) {
    return {
      success: false,
      message: "缺少 ActivityID",
    };
  }

  if (!Array.isArray(targetDates) || targetDates.length === 0) {
    return {
      success: false,
      message: "没有选择复制日期",
    };
  }

  /****************************************************
   * 读取活动
   ****************************************************/

  const activitiesSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(
    CONFIG.SHEETS.ACTIVITIES,
  );

  if (!activitiesSheet) {
    throw new Error("找不到 ACTIVITIES Sheet");
  }

  const activities = sheetToJson(CONFIG.SHEETS.ACTIVITIES);

  const sourceActivity = activities.find(function (a) {
    return String(a.ActivityID) === String(activityID);
  });

  if (!sourceActivity) {
    return {
      success: false,
      message: "找不到要复制的活动",
    };
  }

  /****************************************************
   * 检查日期
   ****************************************************/

  const normalizedDates = [];

  targetDates.forEach(function (dateValue) {
    const date = parseBatchCopyDate(dateValue);

    if (!date) {
      return;
    }

    const dateKey = formatDateKey(date);

    if (!normalizedDates.includes(dateKey)) {
      normalizedDates.push(dateKey);
    }
  });

  if (normalizedDates.length === 0) {
    return {
      success: false,
      message: "没有有效的复制日期",
    };
  }

  /****************************************************
   * 防止复制到已经存在的日期
   *
   * 同一个 Title + VenueID + ActivityDate
   * 如果已经存在，就跳过。
   ****************************************************/

  const existingKeys = new Set();

  activities.forEach(function (a) {
    if (!a.ActivityID) {
      return;
    }

    const date = parseBatchCopyDate(a.ActivityDate);

    if (!date) {
      return;
    }

    const dateKey = formatDateKey(date);

    const key =
      String(a.Title || "").trim() +
      "|" +
      String(a.VenueID || "").trim() +
      "|" +
      dateKey;

    existingKeys.add(key);
  });

  /****************************************************
   * 找到 ActivityID 最大编号
   ****************************************************/

  let maxNumber = 0;

  activities.forEach(function (a) {
    const id = String(a.ActivityID || "");

    const match = id.match(/^ACT(\d+)$/);

    if (match) {
      const number = Number(match[1]);

      if (number > maxNumber) {
        maxNumber = number;
      }
    }
  });

  /****************************************************
   * Header
   ****************************************************/

  const data = activitiesSheet.getDataRange().getValues();

  if (!data || data.length === 0) {
    throw new Error("ACTIVITIES Sheet 没有 Header");
  }

  const headers = data[0];

  /****************************************************
   * 创建新活动
   ****************************************************/

  const rowsToAppend = [];

  const createdActivities = [];

  const skippedDates = [];

  normalizedDates.forEach(function (dateKey) {
    const existingKey =
      String(sourceActivity.Title || "").trim() +
      "|" +
      String(sourceActivity.VenueID || "").trim() +
      "|" +
      dateKey;

    if (existingKeys.has(existingKey)) {
      skippedDates.push(dateKey);
      return;
    }

    maxNumber++;

    const newActivityID = "ACT" + String(maxNumber).padStart(6, "0");

    const now = new Date();

    const row = headers.map(function (header) {
      switch (header) {
        case "ActivityID":
          return newActivityID;

        case "Title":
          return buildCopiedActivityTitle(
            sourceActivity.Title,
            sourceActivity.ActivityDate,
            dateKey,
          );

        case "VenueID":
          return sourceActivity.VenueID || "";

        case "ActivityDate":
          return parseBatchCopyDate(dateKey);

        case "StartTime":
          return sourceActivity.StartTime || "";

        case "EndTime":
          return sourceActivity.EndTime || "";

        case "CourtCount":
          return sourceActivity.CourtCount || "";

        case "Capacity":
          return sourceActivity.Capacity || "";

        case "Fee":
          return sourceActivity.Fee || "";

        case "Status":
          return CONFIG.STATUS.ACTIVITY_OPEN;

        case "Description":
          return sourceActivity.Description || "";

        case "RegistrationDeadline":
          return copyRegistrationDeadline(sourceActivity, dateKey);

        case "CreatedAt":
          return now;

        case "UpdatedAt":
          return now;

        default:
          return "";
      }
    });

    rowsToAppend.push(row);

    createdActivities.push({
      ActivityID: newActivityID,
      Title: sourceActivity.Title || "",
      Date: dateKey,
      StartTime: sourceActivity.StartTime || "",
      EndTime: sourceActivity.EndTime || "",
      VenueID: sourceActivity.VenueID || "",
    });
  });

  /****************************************************
   * 一次性写入
   ****************************************************/

  if (rowsToAppend.length > 0) {
    const startRow = activitiesSheet.getLastRow() + 1;

    activitiesSheet
      .getRange(startRow, 1, rowsToAppend.length, headers.length)
      .setValues(rowsToAppend);
  }

  /****************************************************
   * 返回结果
   ****************************************************/

  return {
    success: true,

    sourceActivityID: sourceActivity.ActivityID,

    createdCount: createdActivities.length,

    skippedCount: skippedDates.length,

    created: createdActivities,

    skippedDates: skippedDates,
  };
}

/****************************************************
 * 批量复制时自动更新活动标题日期
 *
 * 例如：
 *
 * 8/30 川崎中バドミントン
 *
 * 复制到 9/9
 *
 * → 9/9 川崎中バドミントン
 ****************************************************/

function buildCopiedActivityTitle(originalTitle, originalDate, targetDateKey) {
  const title = String(originalTitle || "").trim();

  const targetDate = parseBatchCopyDate(targetDateKey);

  if (!title || !targetDate) {
    return title;
  }

  /*
   * 尝试从原标题开头删除日期。
   *
   * 支持：
   * 8/30 川崎中バドミントン
   * 08/30 川崎中バドミントン
   * 8-30 川崎中バドミントン
   * 8月30日 川崎中バドミントン
   */

  const titleWithoutDate = title
    .replace(/^\d{1,2}[\/\-]\d{1,2}\s*/, "")
    .replace(/^\d{1,2}月\d{1,2}日?\s*/, "")
    .trim();

  /*
   * 如果标题本身没有日期，
   * 就直接使用原标题。
   */

  if (titleWithoutDate === title) {
    return title;
  }

  /*
   * 生成新的 M/D
   */

  const newDateText = targetDate.getMonth() + 1 + "/" + targetDate.getDate();

  return newDateText + " " + titleWithoutDate;
}

/****************************************************
 * 批量复制日期解析
 ****************************************************/

function parseBatchCopyDate(value) {
  if (!value) {
    return null;
  }

  if (Object.prototype.toString.call(value) === "[object Date]") {
    if (isNaN(value.getTime())) {
      return null;
    }

    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  const text = String(value).trim();

  /*
   * YYYY-MM-DD
   */

  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);

  if (match) {
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }

  /*
   * YYYY/MM/DD
   */

  match = text.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);

  if (match) {
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }

  /*
   * 其他 Google Sheets / JavaScript 日期格式
   */

  const date = new Date(text);

  if (isNaN(date.getTime())) {
    return null;
  }

  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/****************************************************
 * 日期 → YYYY-MM-DD
 ****************************************************/

function formatDateKey(date) {
  if (!date) {
    return "";
  }

  return (
    date.getFullYear() +
    "-" +
    String(date.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(date.getDate()).padStart(2, "0")
  );
}

/****************************************************
 * 复制报名截止时间
 *
 * 如果原活动有 RegistrationDeadline，
 * 则保持“距离活动日期的时间”。
 *
 * 例如：
 *
 * 活动日期：9/2
 * 截止时间：9/1 18:00
 *
 * 复制到：
 * 9/9
 *
 * 就会变成：
 * 9/8 18:00
 ****************************************************/

function copyRegistrationDeadline(sourceActivity, targetDateKey) {
  const originalDeadline = sourceActivity.RegistrationDeadline;

  if (!originalDeadline) {
    return "";
  }

  const originalDate = parseBatchCopyDate(sourceActivity.ActivityDate);

  const targetDate = parseBatchCopyDate(targetDateKey);

  if (!originalDate || !targetDate) {
    return "";
  }

  const deadline = new Date(originalDeadline);

  if (isNaN(deadline.getTime())) {
    return "";
  }

  /*
   * 计算原活动日期 → 报名截止日期之间相差多少天
   */

  const dayDifference = Math.round(
    (new Date(
      originalDate.getFullYear(),
      originalDate.getMonth(),
      originalDate.getDate(),
    ).getTime() -
      new Date(
        deadline.getFullYear(),
        deadline.getMonth(),
        deadline.getDate(),
      ).getTime()) /
      (24 * 60 * 60 * 1000),
  );

  /*
   * 新活动日期减去相同天数
   */

  const newDeadline = new Date(
    targetDate.getFullYear(),
    targetDate.getMonth(),
    targetDate.getDate(),
    deadline.getHours(),
    deadline.getMinutes(),
    deadline.getSeconds(),
  );

  newDeadline.setDate(newDeadline.getDate() - dayDifference);

  return newDeadline;
}

function testBatchCopyActivities() {
  const result = batchCopyActivities("ACT260828225357912", [
    "2026-09-30",
    "2026-10-07",
    "2026-10-14",
  ]);

  Logger.log(JSON.stringify(result, null, 2));
}

/****************************************************
 * Dashboard Activity List
 *
 * 规则：
 * 1. OPEN / PAUSED 才进入 Dashboard
 * 2. 尚未结束的活动优先
 * 3. 已结束活动排在后面
 ****************************************************/

function getDashboardActivities() {
  const activities = sheetToJson(CONFIG.SHEETS.ACTIVITIES);

  const now = new Date();

  return activities

    .filter(function (a) {
      return (
        a.Status === CONFIG.STATUS.ACTIVITY_OPEN ||
        a.Status === CONFIG.STATUS.ACTIVITY_PAUSED
      );
    })

    .map(function (a) {
      const endDateTime = parseActivityEndDateTime(a.ActivityDate, a.EndTime);

      const expired = endDateTime && endDateTime < now;

      return {
        ActivityID: a.ActivityID,
        Title: a.Title || "",
        Date: a.ActivityDate || "",
        StartTime: a.StartTime || "",
        EndTime: a.EndTime || "",
        Status: a.Status || "",
        Expired: !!expired,

        // 用于排序
        SortTime: endDateTime ? endDateTime.getTime() : Number.MAX_SAFE_INTEGER,
      };
    })

    .sort(function (a, b) {
      // 未过期优先
      if (a.Expired !== b.Expired) {
        return a.Expired ? 1 : -1;
      }

      // 同类型按照活动结束时间排序
      return a.SortTime - b.SortTime;
    })

    .map(function (a) {
      return {
        ActivityID: a.ActivityID,
        Title: a.Title,
        Date: a.Date,
        StartTime: a.StartTime,
        EndTime: a.EndTime,
        Status: a.Status,
        Expired: a.Expired,
      };
    });
}

/****************************************************
 * Dashboard Detail Summary
 ****************************************************/

function getDashboardDetail(activityID) {
  const registrations = sheetToJson(CONFIG.SHEETS.REGISTRATIONS);

  const checkins = sheetToJson(CONFIG.SHEETS.CHECKINS);

  const members = registrations.filter(
    (r) => r.ActivityID === activityID && r.Status === CONFIG.STATUS.CONFIRMED,
  );

  let totalFee = 0;

  let paidAmount = 0;

  let unpaidAmount = 0;

  const payment = {
    CASH: 0,

    PAYPAY: 0,

    UNPAID: 0,

    FREE: 0,
  };

  // 从 Checkins 表读取实际付款

  const activityCheckins = checkins.filter((c) => c.ActivityID === activityID);

  activityCheckins.forEach((c) => {
    const method = c.PaymentMethod;

    if (method === "CASH") {
      payment.CASH++;
    } else if (method === "PAYPAY") {
      payment.PAYPAY++;
    } else if (method === "FREE") {
      payment.FREE++;
    } else {
      payment.UNPAID++;
    }
  });

  const checkedIn = checkins.filter(
    (c) =>
      c.ActivityID === activityID &&
      c.CheckinStatus === CONFIG.STATUS.CHECKED_IN,
  ).length;

  return {
    success: true,

    memberCount: members.length,

    checkedIn: checkedIn,

    notCheckedIn: members.length - checkedIn,

    checkinRate:
      members.length === 0 ? 0 : Math.round((checkedIn / members.length) * 100),

    payment: payment,
  };
}

function getDashboardMembers(activityID) {
  const registrations = sheetToJson(CONFIG.SHEETS.REGISTRATIONS);

  const checkins = sheetToJson(CONFIG.SHEETS.CHECKINS);

  return registrations

    .filter(
      (r) =>
        r.ActivityID === activityID && r.Status === CONFIG.STATUS.CONFIRMED,
    )

    .map((r) => {
      const checkin = checkins.find(
        (c) => c.RegistrationID === r.RegistrationID,
      );

      return {
        RegistrationID: r.RegistrationID,

        Name: r.Name,

        Contact: r.ContactValue,

        Level: r.Level,

        CheckedIn: !!checkin,

        Payment: checkin ? checkin.PaymentMethod : "UNPAID",
      };
    });
}

function getVenues() {
  const venues = sheetToJson(CONFIG.SHEETS.VENUES);

  return venues.map(function (v) {
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

function testGetVenues() {
  const result = getVenues();

  Logger.log(JSON.stringify(result, null, 2));
}

/****************************************************
 * 手动删除过期活动
 *
 * 规则：
 * 1. 只有活动已经结束才允许删除
 * 2. 不需要等待 30 天
 * 3. 只会由管理员主动调用
 * 4. 删除活动时同时删除：
 *    - ACTIVITIES
 *    - REGISTRATIONS
 *    - CHECKINS
 ****************************************************/

function getExpiredActivities() {
  const activities = sheetToJson(CONFIG.SHEETS.ACTIVITIES);

  const now = new Date();

  return activities

    .filter(function (activity) {
      if (!activity.ActivityID) {
        return false;
      }

      if (!activity.ActivityDate) {
        return false;
      }

      if (!activity.EndTime) {
        return false;
      }

      const endDateTime = parseActivityEndDateTime(
        activity.ActivityDate,
        activity.EndTime,
      );

      if (!endDateTime) {
        return false;
      }

      return endDateTime < now;
    })

    .map(function (activity) {
      return {
        ActivityID: activity.ActivityID,
        Title: activity.Title || "",
        Date: activity.ActivityDate || "",
        StartTime: activity.StartTime || "",
        EndTime: activity.EndTime || "",
        Status: activity.Status || "",
      };
    });
}

function testGetExpiredActivities() {
  const result = getExpiredActivities();

  Logger.log(JSON.stringify(result, null, 2));
}

/****************************************************
 * 获取过期活动的删除预览
 ****************************************************/

function getExpiredActivityPreview(activityID) {
  if (!activityID) {
    return {
      success: false,
      message: "缺少 ActivityID",
    };
  }

  const activities = sheetToJson(CONFIG.SHEETS.ACTIVITIES);

  const registrations = sheetToJson(CONFIG.SHEETS.REGISTRATIONS);

  const checkins = sheetToJson(CONFIG.SHEETS.CHECKINS);

  const activity = activities.find(function (a) {
    return String(a.ActivityID) === String(activityID);
  });

  if (!activity) {
    return {
      success: false,
      message: "找不到这个活动",
    };
  }

  const endDateTime = parseActivityEndDateTime(
    activity.ActivityDate,
    activity.EndTime,
  );

  if (!endDateTime) {
    return {
      success: false,
      message: "无法判断活动结束时间",
    };
  }

  if (endDateTime >= new Date()) {
    return {
      success: false,
      message: "这个活动还没有结束，不能删除",
    };
  }

  const activityRegistrations = registrations.filter(function (r) {
    return String(r.ActivityID) === String(activityID);
  });

  const registrationIDs = new Set(
    activityRegistrations.map(function (r) {
      return String(r.RegistrationID);
    }),
  );

  const activityCheckins = checkins.filter(function (c) {
    return (
      String(c.ActivityID) === String(activityID) ||
      registrationIDs.has(String(c.RegistrationID))
    );
  });

  return {
    success: true,

    activity: {
      ActivityID: activity.ActivityID,

      Title: activity.Title || "",

      Date: activity.ActivityDate || "",

      StartTime: activity.StartTime || "",

      EndTime: activity.EndTime || "",

      Status: activity.Status || "",
    },

    registrationCount: activityRegistrations.length,

    checkinCount: activityCheckins.length,
  };
}

/****************************************************
 * 获取活动删除预览
 *
 * 用于：
 * 1. 删除过期活动
 * 2. 删除管理员当前选定的活动
 *
 * 注意：
 * 不限制活动是否已经结束。
 ****************************************************/

function getActivityDeletePreview(activityID) {
  if (!activityID) {
    return {
      success: false,
      message: "缺少 ActivityID",
    };
  }

  const activities = sheetToJson(CONFIG.SHEETS.ACTIVITIES);

  const registrations = sheetToJson(CONFIG.SHEETS.REGISTRATIONS);

  const checkins = sheetToJson(CONFIG.SHEETS.CHECKINS);

  const activity = activities.find(function (a) {
    return String(a.ActivityID) === String(activityID);
  });

  if (!activity) {
    return {
      success: false,
      message: "找不到这个活动",
    };
  }

  const activityRegistrations = registrations.filter(function (r) {
    return String(r.ActivityID) === String(activityID);
  });

  const registrationIDs = new Set(
    activityRegistrations.map(function (r) {
      return String(r.RegistrationID);
    }),
  );

  const activityCheckins = checkins.filter(function (c) {
    return (
      String(c.ActivityID) === String(activityID) ||
      registrationIDs.has(String(c.RegistrationID))
    );
  });

  const endDateTime = parseActivityEndDateTime(
    activity.ActivityDate,
    activity.EndTime,
  );

  const expired = endDateTime ? endDateTime < new Date() : false;

  return {
    success: true,

    activity: {
      ActivityID: activity.ActivityID,

      Title: activity.Title || "",

      Date: activity.ActivityDate || "",

      StartTime: activity.StartTime || "",

      EndTime: activity.EndTime || "",

      Status: activity.Status || "",
    },

    expired: expired,

    registrationCount: activityRegistrations.length,

    checkinCount: activityCheckins.length,

    /*
     * 你的付款目前是在 CHECKINS
     * 的 PaymentMethod 中统计。
     *
     * 所以这里也把付款记录数量统计出来。
     */

    paymentCount: activityCheckins.filter(function (c) {
      return c.PaymentMethod && String(c.PaymentMethod).trim() !== "";
    }).length,
  };
}

/****************************************************
 * 删除指定的过期活动
 ****************************************************/
/****************************************************
 * 删除指定活动
 *
 * 功能：
 * 1. 可以删除任何管理员选定的活动
 * 2. 不限制活动是否已经结束
 * 3. 删除 ACTIVITIES
 * 4. 删除 REGISTRATIONS
 * 5. 删除 CHECKINS
 *
 * 注意：
 * 前端必须先进行二次确认。
 ****************************************************/

function deleteActivity(activityID) {
  if (!activityID) {
    return {
      success: false,
      message: "缺少 ActivityID",
    };
  }

  /****************************************************
   * 读取活动
   ****************************************************/

  const activities = sheetToJson(CONFIG.SHEETS.ACTIVITIES);

  const activity = activities.find(function (a) {
    return String(a.ActivityID) === String(activityID);
  });

  if (!activity) {
    return {
      success: false,
      message: "找不到这个活动",
    };
  }

  /****************************************************
   * 读取报名
   ****************************************************/

  const registrations = sheetToJson(CONFIG.SHEETS.REGISTRATIONS);

  const activityRegistrations = registrations.filter(function (r) {
    return String(r.ActivityID) === String(activityID);
  });

  const registrationIDs = new Set(
    activityRegistrations.map(function (r) {
      return String(r.RegistrationID);
    }),
  );

  /****************************************************
   * 读取签到
   ****************************************************/

  const checkins = sheetToJson(CONFIG.SHEETS.CHECKINS);

  const activityCheckins = checkins.filter(function (c) {
    return (
      String(c.ActivityID) === String(activityID) ||
      registrationIDs.has(String(c.RegistrationID))
    );
  });

  /****************************************************
   * 获取 Sheet
   ****************************************************/

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const activitiesSheet = ss.getSheetByName(CONFIG.SHEETS.ACTIVITIES);

  const registrationsSheet = ss.getSheetByName(CONFIG.SHEETS.REGISTRATIONS);

  const checkinsSheet = ss.getSheetByName(CONFIG.SHEETS.CHECKINS);

  if (!activitiesSheet) {
    throw new Error("找不到 ACTIVITIES Sheet");
  }

  if (!registrationsSheet) {
    throw new Error("找不到 REGISTRATIONS Sheet");
  }

  if (!checkinsSheet) {
    throw new Error("找不到 CHECKINS Sheet");
  }

  /****************************************************
   * 删除 CHECKINS
   ****************************************************/

  const deletedCheckins = deleteRowsByCondition(
    checkinsSheet,
    function (row, headers) {
      const activityIndex = headers.indexOf("ActivityID");

      const registrationIndex = headers.indexOf("RegistrationID");

      const rowActivityID =
        activityIndex >= 0 ? String(row[activityIndex]) : "";

      const rowRegistrationID =
        registrationIndex >= 0 ? String(row[registrationIndex]) : "";

      return (
        rowActivityID === String(activityID) ||
        registrationIDs.has(rowRegistrationID)
      );
    },
  );

  /****************************************************
   * 删除 REGISTRATIONS
   ****************************************************/

  const deletedRegistrations = deleteRowsByCondition(
    registrationsSheet,
    function (row, headers) {
      const activityIndex = headers.indexOf("ActivityID");

      if (activityIndex === -1) {
        return false;
      }

      return String(row[activityIndex]) === String(activityID);
    },
  );

  /****************************************************
   * 删除 ACTIVITIES
   ****************************************************/

  const deletedActivities = deleteRowsByCondition(
    activitiesSheet,
    function (row, headers) {
      const activityIndex = headers.indexOf("ActivityID");

      if (activityIndex === -1) {
        return false;
      }

      return String(row[activityIndex]) === String(activityID);
    },
  );

  /****************************************************
   * 最终确认
   ****************************************************/

  if (deletedActivities === 0) {
    return {
      success: false,
      message: "活动删除失败：没有找到对应的活动记录",
    };
  }

  /****************************************************
   * 返回结果
   ****************************************************/

  return {
    success: true,

    ActivityID: activity.ActivityID,

    Title: activity.Title || "",

    deletedActivities: deletedActivities,

    deletedRegistrations: deletedRegistrations,

    deletedCheckins: deletedCheckins,

    deletedPayments: activityCheckins.filter(function (c) {
      return c.PaymentMethod && String(c.PaymentMethod).trim() !== "";
    }).length,
  };
}

/****************************************************
 * 根据条件删除 Sheet 行
 *
 * 第一行默认为 Header
 ****************************************************/

function deleteRowsByCondition(sheet, condition) {
  const values = sheet.getDataRange().getValues();

  if (!values || values.length <= 1) {
    return 0;
  }

  const headers = values[0];

  const rowsToKeep = [headers];

  let deletedCount = 0;

  for (let i = 1; i < values.length; i++) {
    const row = values[i];

    if (condition(row, headers)) {
      deletedCount++;
    } else {
      rowsToKeep.push(row);
    }
  }

  /*
   * 没有需要删除的记录
   */

  if (deletedCount === 0) {
    return 0;
  }

  /*
   * 清除原来的数据区域
   *
   * 保留 Header
   */

  if (values.length > 1) {
    sheet.getRange(2, 1, values.length - 1, headers.length).clearContent();
  }

  /*
   * 一次性写回需要保留的数据
   */

  if (rowsToKeep.length > 1) {
    sheet
      .getRange(2, 1, rowsToKeep.length - 1, headers.length)
      .setValues(rowsToKeep.slice(1));
  }

  return deletedCount;
}

/****************************************************
 * ActivityDate + EndTime
 ****************************************************/

function parseActivityEndDateTime(activityDate, endTime) {
  try {
    const date = new Date(activityDate);

    if (isNaN(date.getTime())) {
      return null;
    }

    /*
     * Google Sheets 时间字段
     * 可能会以 Date 对象返回。
     */

    if (Object.prototype.toString.call(endTime) === "[object Date]") {
      date.setHours(endTime.getHours());

      date.setMinutes(endTime.getMinutes());

      date.setSeconds(0);

      date.setMilliseconds(0);

      return date;
    }

    /*
     * 普通字符串：
     * 19:00
     * 19:30
     * 19:00:00
     */

    const timeString = String(endTime).trim();

    const match = timeString.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);

    if (!match) {
      return null;
    }

    const hours = Number(match[1]);

    const minutes = Number(match[2]);

    const seconds = Number(match[3] || 0);

    if (
      hours < 0 ||
      hours > 23 ||
      minutes < 0 ||
      minutes > 59 ||
      seconds < 0 ||
      seconds > 59
    ) {
      return null;
    }

    date.setHours(hours);

    date.setMinutes(minutes);

    date.setSeconds(seconds);

    date.setMilliseconds(0);

    return date;
  } catch (error) {
    Logger.log("parseActivityEndDateTime error: " + error);

    return null;
  }
}

function getHomeUrl() {
  return ScriptApp.getService().getUrl();
}
