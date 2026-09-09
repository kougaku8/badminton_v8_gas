/****************************************************
 * SHEET HELPER
 ****************************************************/

function getSpreadsheet() {
  return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
}

function getSheet(name) {
  return getSpreadsheet().getSheetByName(name);
}

function testActualSpreadsheet() {
  const ss = getSpreadsheet();

  Logger.log("========== Spreadsheet ==========");
  Logger.log("ID: " + ss.getId());
  Logger.log("Name: " + ss.getName());
  Logger.log("URL: " + ss.getUrl());

  Logger.log("========== Sheets ==========");

  ss.getSheets().forEach(function (sheet) {
    Logger.log(sheet.getName() + " | ID=" + sheet.getSheetId());
  });
}

/****************************************************
 * Convert Sheet Data
 *
 * Header row → JSON
 ****************************************************/

function sheetToJson(sheetName) {
  const sheet = getSheet(sheetName);

  if (!sheet) {
    throw new Error("Missing Sheet: " + sheetName);
  }

  const values = sheet.getDataRange().getValues();

  if (values.length <= 1) {
    return [];
  }

  const headers = values[0];

  return values.slice(1).map((row) => {
    let obj = {};

    headers.forEach((header, index) => {
      let value = row[index];

      if (value instanceof Date) {
        if (header === "ActivityDate") {
          value = Utilities.formatDate(
            value,
            Session.getScriptTimeZone(),
            "yyyy-MM-dd",
          );
        } else if (header === "StartTime" || header === "EndTime") {
          value = Utilities.formatDate(
            value,
            Session.getScriptTimeZone(),
            "HH:mm",
          );
        } else {
          value = Utilities.formatDate(
            value,
            Session.getScriptTimeZone(),
            "yyyy-MM-dd HH:mm",
          );
        }
      }

      obj[header] = value;
    });

    return obj;
  });
}

/****************************************************
 * Append Row Helper
 ****************************************************/

function appendRow(sheetName, row) {
  const sheet = getSheet(sheetName);

  sheet.appendRow(row);
}

function testRegister() {
  const result = registerActivity({
    activityID: "ACT000001",

    name: "佐藤太郎",

    contactType: "SECRET",

    contactValue: "樱花羽球",

    level: "L3",

    parking: true,

    message: "第一次参加",
  });

  Logger.log(JSON.stringify(result, null, 2));
}

/****************************************************
 * Generate ID
 *
 * Example:
 * REG000001
 ****************************************************/

function generateID(prefix) {
  const now = new Date();

  const timestamp = Utilities.formatDate(
    now,

    Session.getScriptTimeZone(),

    "yyMMddHHmmss",
  );

  const random = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");

  return prefix + timestamp + random;
}

/****************************************************
 * Lock Helper
 ****************************************************/

function withLock(callback) {
  const lock = LockService.getScriptLock();
  let locked = false;

  try {
    lock.waitLock(10000);
    locked = true;

    return callback();
  } catch (error) {
    //throw new Error('系统繁忙，请稍后再试');
    Logger.log(error.stack);
    throw error;
  } finally {
    if (locked) {
      lock.releaseLock();
    }
  }
}

/****************************************************
 * Create Notification
 ****************************************************/

function createNotification(data) {
  appendRow(
    CONFIG.SHEETS.NOTIFICATIONS,

    [
      generateID("NOT"),

      data.activityID || "",

      data.registrationID || "",

      data.type || "",

      data.message || "",

      "PENDING",

      new Date(),
    ],
  );
}
