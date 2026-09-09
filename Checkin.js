/****************************************************
 * Check-in API
 *
 * 用户签到
 *
 * Input:
 * registrationID
 *
 ****************************************************/

function checkinRegistration(registrationID, paymentMethod) {
  return withLock(function () {
    return checkinRegistrationCore(registrationID, paymentMethod);
  });
}

function checkinRegistrationCore(registrationID, paymentMethod) {
  const registrations = sheetToJson(CONFIG.SHEETS.REGISTRATIONS);

  const registration = registrations.find(
    (r) => r.RegistrationID === registrationID,
  );

  if (!registration) {
    return {
      success: false,

      message: "报名记录不存在",
    };
  }

  // 必须正式报名

  if (registration.Status !== CONFIG.STATUS.CONFIRMED) {
    return {
      success: false,

      message: "当前状态不能签到",
    };
  }

  // 检查是否已经签到

  const checkins = sheetToJson(CONFIG.SHEETS.CHECKINS);

  const exists = checkins.some(
    (c) =>
      c.RegistrationID === registrationID &&
      c.CheckinStatus === CONFIG.STATUS.CHECKED_IN,
  );

  if (exists) {
    return {
      success: false,

      message: "已经签到",
    };
  }

  // 写入签到记录

  const row = [
    generateID("CHK"),

    registration.ActivityID,

    registration.RegistrationID,

    registration.Name,

    CONFIG.STATUS.CHECKED_IN,

    new Date(),

    "ADMIN",

    paymentMethod || "UNPAID",
  ];

  appendRow(
    CONFIG.SHEETS.CHECKINS,

    row,
  );

  return {
    success: true,

    message: "签到成功",

    checkinID: row[0],
  };
}

function testCheckin() {
  const result = checkinRegistration("REG260806113712347");

  Logger.log(JSON.stringify(result, null, 2));
}

function testCheckinNew() {
  const result = checkinRegistration("REG260806113712347");

  Logger.log(JSON.stringify(result, null, 2));
}

/****************************************************
 * Check-in Management API
 *
 * 获取签到名单
 *
 * Input:
 * activityID
 *
 ****************************************************/

function getCheckinList(activityID) {
  const registrations = sheetToJson(CONFIG.SHEETS.REGISTRATIONS);

  const checkins = sheetToJson(CONFIG.SHEETS.CHECKINS);

  const list = registrations
    .filter(
      (r) =>
        r.ActivityID === activityID && r.Status === CONFIG.STATUS.CONFIRMED,
    )
    .map((r) => {
      const checkin = checkins.find(
        (c) =>
          c.RegistrationID === r.RegistrationID &&
          c.CheckinStatus === CONFIG.STATUS.CHECKED_IN,
      );

      return {
        RegistrationID: r.RegistrationID,

        Name: r.Name,

        ContactValue: r.ContactValue,

        Level: r.Level,

        Fee: Number(r.FeeAmount),

        CheckedIn: !!checkin,

        CheckinTime: checkin ? checkin.CheckinTime : "",

        PaymentMethod: checkin ? checkin.PaymentMethod : "",
      };
    });

  return {
    success: true,

    count: list.length,

    data: list,
  };
}

function testGetCheckinList() {
  const result = getCheckinList("ACT000001");

  Logger.log(JSON.stringify(result, null, 2));
}

/****************************************************
 * Search Registration For Check-in
 *
 * keyword:
 * Name / ContactValue
 *
 ****************************************************/

function searchRegistrationForCheckin(keyword) {
  const registrations = sheetToJson(CONFIG.SHEETS.REGISTRATIONS);

  const result = registrations
    .filter(
      (r) =>
        r.Status === CONFIG.STATUS.CONFIRMED &&
        (r.Name.toLowerCase().includes(keyword.toLowerCase()) ||
          r.ContactValue.toLowerCase().includes(keyword.toLowerCase())),
    )
    .map((r) => {
      return {
        RegistrationID: r.RegistrationID,

        ActivityID: r.ActivityID,

        Name: r.Name,

        ContactValue: r.ContactValue,

        Level: r.Level,

        Fee: Number(r.FeeAmount),
      };
    });

  return {
    success: true,

    count: result.length,

    data: result,
  };
}

function testSearchCheckin() {
  const result = searchRegistrationForCheckin("樱花");

  Logger.log(JSON.stringify(result, null, 2));
}

function getCheckinSummary(activityID) {
  const registrations = sheetToJson(CONFIG.SHEETS.REGISTRATIONS);

  const checkins = sheetToJson(CONFIG.SHEETS.CHECKINS);

  const members = registrations.filter(
    (r) => r.ActivityID === activityID && r.Status === CONFIG.STATUS.CONFIRMED,
  );

  const activityCheckins = checkins.filter(
    (c) =>
      c.ActivityID === activityID &&
      c.CheckinStatus === CONFIG.STATUS.CHECKED_IN,
  );

  const payment = {
    CASH: 0,

    PAYPAY: 0,

    UNPAID: 0,

    FREE: 0,
  };

  activityCheckins.forEach((c) => {
    payment[c.PaymentMethod] = (payment[c.PaymentMethod] || 0) + 1;
  });

  return {
    success: true,

    total: members.length,

    checkedIn: activityCheckins.length,

    notCheckedIn: members.length - activityCheckins.length,

    payment: payment,
  };
}

function getCheckinStatus(registrationID) {
  const checkins = sheetToJson(CONFIG.SHEETS.CHECKINS);

  const checkin = checkins.find((c) => c.RegistrationID === registrationID);

  if (!checkin) {
    return {
      success: true,

      checkedIn: false,
    };
  }

  return {
    success: true,

    checkedIn: true,

    data: checkin,
  };
}

function getCheckinsByActivity(activityID) {
  const checkins = sheetToJson(CONFIG.SHEETS.CHECKINS);

  return {
    success: true,

    count: checkins.filter((c) => c.ActivityID === activityID).length,

    data: checkins.filter((c) => c.ActivityID === activityID),
  };
}

function testGetCheckins() {
  const result = getCheckinsByActivity("ACT000001");

  Logger.log(JSON.stringify(result, null, 2));
}

/****************************************************
 * Check-in API
 *
 * CONFIRMED → CHECKED_IN
 *
 * Input:
 * registrationID
 *
 ****************************************************/

function testListRegistrations() {
  const data = sheetToJson(CONFIG.SHEETS.REGISTRATIONS);

  Logger.log(JSON.stringify(data, null, 2));
}

function testCheckinsSheet() {
  const sheet = getSheet(CONFIG.SHEETS.CHECKINS);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  Logger.log(JSON.stringify(headers));
}

function testCheckinPayment() {
  const result = checkinRegistration("REG260806114300477", "CASH");

  Logger.log(JSON.stringify(result, null, 2));
}
