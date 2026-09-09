/****************************************************
 * Activities API
 *
 * 首页活动列表
 *
 ****************************************************/

function getActivities() {
  const activities = sheetToJson(CONFIG.SHEETS.ACTIVITIES);

  const venues = sheetToJson(CONFIG.SHEETS.VENUES);

  const venueMap = {};

  venues.forEach((v) => {
    venueMap[v.VenueID] = v;
  });

  return activities

    .filter(
      (a) =>
        a.Status === CONFIG.STATUS.ACTIVITY_OPEN ||
        a.Status === CONFIG.STATUS.ACTIVITY_PAUSED,
    )

    .sort((a, b) => new Date(a.ActivityDate) - new Date(b.ActivityDate))

    .map((a) => {
      const venue = venueMap[a.VenueID] || {};

      return {
        ActivityID: a.ActivityID,

        Title: a.Title,

        VenueName: venue.VenueName,

        Date: a.ActivityDate,

        StartTime: a.StartTime,

        EndTime: a.EndTime,

        CourtCount: Number(a.CourtCount),

        Capacity: Number(a.Capacity),

        Fee: Number(a.Fee),

        Status: a.Status,
      };
    });
}

/****************************************************
 * Test Function
 *
 * GAS编辑器测试用
 ****************************************************/

function testGetActivities() {
  const result = getActivities();

  Logger.log(JSON.stringify(result, null, 2));
}

function debugActivities() {
  const ss = getSpreadsheet();

  Logger.log("========== Spreadsheet ==========");
  Logger.log("ID = " + ss.getId());
  Logger.log("Name = " + ss.getName());

  const sheet = ss.getSheetByName("Activities");

  if (!sheet) {
    throw new Error("找不到 Activities");
  }

  Logger.log("========== Sheet ==========");
  Logger.log("Sheet ID = " + sheet.getSheetId());
  Logger.log("Last Row = " + sheet.getLastRow());
  Logger.log("Last Column = " + sheet.getLastColumn());

  const values = sheet.getDataRange().getValues();

  Logger.log("========== RAW DATA ==========");

  values.forEach(function (row, index) {
    Logger.log("ROW " + index + " = " + JSON.stringify(row));
  });

  Logger.log("========== JSON ==========");

  const activities = sheetToJson("Activities");

  Logger.log("Activity count = " + activities.length);

  activities.forEach(function (a, index) {
    Logger.log(
      "Activity[" +
        index +
        "] ActivityID = [" +
        a.ActivityID +
        "] Title = [" +
        a.Title +
        "]",
    );
  });

  Logger.log("========== TARGET SEARCH ==========");

  const target = "ACT260821002115171";

  const found = activities.find(function (a) {
    return String(a.ActivityID).trim() === target.trim();
  });

  Logger.log("TARGET = [" + target + "]");

  Logger.log("FOUND = " + JSON.stringify(found));
}

function testGetActivityDetailNew() {
  const result = getActivityDetail("ACT260830233041465");

  Logger.log(JSON.stringify(result, null, 2));
}
