import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const repoRoot = join(__dirname, '../../..');

function read(path: string) {
  return readFileSync(join(repoRoot, path), 'utf8');
}

describe('MVP UI polish source checks', () => {
  it('explains the production-ready MVP story on the landing page', () => {
    const home = read('apps/web/app/page.tsx');
    for (const copy of ['Production-ready MVP', 'Customer portal', 'Admin ops', 'AI Studio handoff']) {
      expect(home).toContain(copy);
    }
  });

  it('shows operational guidance in customer dashboard and admin readiness views', () => {
    const dashboard = read('apps/web/app/dashboard/page.tsx');
    const admin = read('apps/web/app/admin/page.tsx');
    expect(dashboard).toContain('MVP launch checklist');
    expect(dashboard).toContain('Next best action');
    expect(dashboard).toContain('progress-bar');
    expect(dashboard).toContain('/receipt.html');
    expect(dashboard).toContain('Print receipt');
    expect(admin).toContain('Ops command center');
    expect(admin).toContain('Production readiness');
    expect(admin).toContain('status-pill');
    for (const copy of ['Admin cockpit', 'Revenue reviewed', 'Provisioning SLA', 'Live risk monitor']) {
      expect(admin).toContain(copy);
    }
    for (const implementation of ['reviewFilter', 'filteredApprovals', 'admin-dashboard-grid', 'ops-checklist']) {
      expect(admin).toContain(implementation);
    }
  });

  it('has a Meta-ready data deletion instructions page for app review', () => {
    const page = read('apps/web/app/data-deletion/page.tsx');
    expect(page).toContain('Data Deletion');
    expect(page).toContain('confirmation_code');
    expect(page).toContain('Meta');
    expect(page).toContain('حذف البيانات');
  });

  it('has shared polished visual primitives without secrets', () => {
    const styles = read('apps/web/app/styles.css');
    for (const klass of ['status-pill', 'progress-bar', 'metric', 'glass', 'section-title']) {
      expect(styles).toContain(klass);
    }
    expect(styles).not.toMatch(/admin123456|devsecret|dify-secret-token/);
  });
});
