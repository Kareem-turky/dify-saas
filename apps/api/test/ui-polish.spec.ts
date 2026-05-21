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
    expect(admin).toContain('Ops command center');
    expect(admin).toContain('Production readiness');
    expect(admin).toContain('status-pill');
  });

  it('has shared polished visual primitives without secrets', () => {
    const styles = read('apps/web/app/styles.css');
    for (const klass of ['status-pill', 'progress-bar', 'metric', 'glass', 'section-title']) {
      expect(styles).toContain(klass);
    }
    expect(styles).not.toMatch(/admin123456|devsecret|dify-secret-token/);
  });
});
