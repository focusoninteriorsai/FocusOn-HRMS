/**
 * FOCUSON HRMS - Time-Driven Triggers (Google Apps Script)
 * Nightly backups, session cleanup, selfie/GPS retention purges, and year rollover.
 */

function triggerDailyMaintenance() {
  Logger.log('Starting daily maintenance trigger...');

  // 1. Daily Backup
  try {
    Backup.createBackup();
  } catch (e) {
    console.error('Backup trigger failed:', e);
  }

  // 2. Clean expired sessions
  try {
    var sessions = Database.getAll('Sessions');
    var nowIso = Utils.nowIso();
    for (var i = 0; i < sessions.length; i++) {
      if (sessions[i].status === 'ACTIVE' && sessions[i].expires_at < nowIso) {
        Database.update('Sessions', sessions[i].id, { status: 'EXPIRED' }, 'TRIGGER');
      }
    }
  } catch (e) {
    console.error('Session cleanup trigger failed:', e);
  }

  // 3. Purge raw GPS older than retention days (e.g. 90 days)
  try {
    var retentionDays = 90;
    var cutoff = new Date(Date.now() - retentionDays * 24 * 3600 * 1000).toISOString().substring(0, 10);
    var attLogs = Database.getAll('Attendance');
    for (var a = 0; a < attLogs.length; a++) {
      if (attLogs[a].date < cutoff && attLogs[a].check_in_lat) {
        Database.update('Attendance', attLogs[a].id, {
          check_in_lat: '[PURGED]',
          check_in_lng: '[PURGED]',
          check_out_lat: '[PURGED]',
          check_out_lng: '[PURGED]'
        }, 'TRIGGER');
      }
    }
  } catch (e) {
    console.error('GPS retention purge trigger failed:', e);
  }

  Logger.log('Daily maintenance completed.');
}
