import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join, basename, relative } from "node:path";
import { ensureSparkDir } from "./config.js";
import { logger } from "./logger.js";

export interface FileBackup {
  id: string;
  filePath: string;
  originalContent: string;
  timestamp: string;
  toolName: string;
}

/**
 * Manages file backups for undo support.
 * Each write/edit_file call stores a backup of the original file content
 * before modification, stored in `~/.spark/backups/`.
 */
export class FileBackupManager {
  private sessionId: string;
  private backupsDir: string;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.backupsDir = join(ensureSparkDir(), "backups", sessionId);
    if (!existsSync(this.backupsDir)) {
      mkdirSync(this.backupsDir, { recursive: true });
    }
  }

  /**
   * Before modifying a file, call this to save the original content.
   * Returns a backup record that can be used to restore later.
   */
  backupBeforeWrite(filePath: string, toolName: string): FileBackup | null {
    if (!existsSync(filePath)) return null;

    try {
      const content = readFileSync(filePath, "utf-8");
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const backup: FileBackup = {
        id,
        filePath,
        originalContent: content,
        timestamp: new Date().toISOString(),
        toolName,
      };

      writeFileSync(
        join(this.backupsDir, `${id}.json`),
        JSON.stringify(backup, null, 2),
        "utf-8",
      );
      return backup;
    } catch (err) {
      logger.warn(
        `Failed to backup file ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /** Restore the latest backup. Returns the backup info or null if none. */
  restoreLatest(): { filePath: string; originalContent: string } | null {
    const entries = this.listBackups();
    if (entries.length === 0) return null;

    // Sort by timestamp descending, take the latest
    entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const latest = entries[0];

    try {
      writeFileSync(latest.filePath, latest.originalContent, "utf-8");
      // Remove the backup file after restoring
      const backupFile = join(this.backupsDir, `${latest.id}.json`);
      if (existsSync(backupFile)) unlinkSync(backupFile);
      return { filePath: latest.filePath, originalContent: latest.originalContent };
    } catch (err) {
      logger.warn(
        `Failed to restore ${latest.filePath}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /** List all backups for the current session. */
  listBackups(): FileBackup[] {
    try {
      if (!existsSync(this.backupsDir)) return [];
      const files = readdirSync(this.backupsDir).filter((f) => f.endsWith(".json"));
      return files
        .map((f) => {
          try {
            const raw = readFileSync(join(this.backupsDir, f), "utf-8");
            return JSON.parse(raw) as FileBackup;
          } catch {
            return null;
          }
        })
        .filter((b): b is FileBackup => b !== null);
    } catch {
      return [];
    }
  }

  /** Clean up all backups for the current session. */
  clear(): void {
    try {
      const files = readdirSync(this.backupsDir);
      for (const f of files) {
        unlinkSync(join(this.backupsDir, f));
      }
    } catch {
      // ignore
    }
  }
}
