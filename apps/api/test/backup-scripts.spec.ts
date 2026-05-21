import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const repoRoot = join(__dirname, '../../..');

describe('backup and restore production runbooks', () => {
  it('ships executable backup and restore scripts without embedded secrets', () => {
    const backupPath = join(repoRoot, 'scripts/backup-sqlite.sh');
    const restorePath = join(repoRoot, 'scripts/restore-sqlite.sh');
    expect(existsSync(backupPath)).toBe(true);
    expect(existsSync(restorePath)).toBe(true);

    const combined = `${readFileSync(backupPath, 'utf8')}\n${readFileSync(restorePath, 'utf8')}`;
    expect(combined).toContain('DATABASE_URL');
    expect(combined).toContain('sqlite');
    expect(combined).not.toMatch(/admin123456|devsecret|DIFY_ADMIN_TOKEN=.*\S|AUTH_TOKEN_SECRET=.*\S/);
  });

  it('documents production env and backup checklist with required operations', () => {
    const checklistPath = join(repoRoot, 'docs/production-checklist.md');
    expect(existsSync(checklistPath)).toBe(true);
    const checklist = readFileSync(checklistPath, 'utf8');
    for (const item of [
      'AUTH_TOKEN_SECRET',
      'DATABASE_URL',
      'PAYMENT_PROOF_UPLOAD_DIR',
      'RATE_LIMIT_STORE=redis',
      'PROVISIONING_WORKER_ENABLED=true',
      'Backup',
      'Restore',
      '/health',
      '/admin/readiness'
    ]) {
      expect(checklist).toContain(item);
    }
    expect(checklist).not.toMatch(/admin123456|devsecret|dify-secret-token/);
  });
});
