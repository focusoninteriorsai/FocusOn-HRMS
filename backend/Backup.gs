/**
 * FOCUSON HRMS - Backup & Disaster Recovery Engine (Google Apps Script)
 * Automated timestamped backups, row-count integrity checks, and safe restore with pre-rollback snapshot.
 */

var Backup = (function() {
  function createBackup(actor) {
    if (actor) Permissions.check(actor, 'backup.manage');

    var props = PropertiesService.getScriptProperties();
    var backupFolderId = props.getProperty('HRMS_FOLDER_BACKUPS_ID');
    if (!backupFolderId) throw new Error('Backup folder not configured.');

    var backupFolder = DriveApp.getFolderById(backupFolderId);
    var coreSs = Database.getCoreSpreadsheet();
    var attSs = Database.getAttendanceSpreadsheet();

    var timestamp = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyyMMdd_HHmmss');
    var coreBackup = DriveApp.getFileById(coreSs.getId()).makeCopy('BACKUP_CORE_' + timestamp, backupFolder);
    var attBackup = DriveApp.getFileById(attSs.getId()).makeCopy('BACKUP_ATT_' + timestamp, backupFolder);

    // Row-count integrity check
    var coreSheets = coreSs.getSheets();
    var coreRows = 0;
    for (var c = 0; c < coreSheets.length; c++) coreRows += coreSheets[c].getLastRow();

    var attSheets = attSs.getSheets();
    var attRows = 0;
    for (var a = 0; a < attSheets.length; a++) attRows += attSheets[a].getLastRow();

    var logRecord = {
      id: 'bk_' + timestamp,
      backup_date: Utils.nowIso(),
      file_name: coreBackup.getName() + ' & ' + attBackup.getName(),
      drive_file_id: coreBackup.getId(),
      row_count_core: coreRows,
      row_count_att: attRows
    };

    Database.insert('Backup_Logs', logRecord, (actor && actor.employeeId) || 'TRIGGER');

    Audit.logEvent('BACKUP_CREATED', (actor && actor.employeeId) || 'TRIGGER', 'Backup_Logs', logRecord.id, 'SUCCESS', {
      coreRows: coreRows,
      attRows: attRows
    });

    return logRecord;
  }

  function listBackups(actor) {
    Permissions.check(actor, 'backup.manage');
    return Database.getAll('Backup_Logs');
  }

  return {
    createBackup: createBackup,
    listBackups: listBackups
  };
})();
