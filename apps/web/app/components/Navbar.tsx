'use client';

import { useAuth } from '../auth';
import { useI18n, LangToggle } from '../i18n';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect } from 'react';

export function Navbar() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useI18n();

  function handleLogout() {
    logout();
    router.push('/login');
  }

  // Public pages that don't need nav
  const publicPages = ['/', '/login', '/signup', '/data-deletion'];
  const isPublic = publicPages.includes(pathname);
  if (isPublic) return null;

  if (loading) return <nav className="nav"><span className="brand">{t('nav.brand')}</span></nav>;

  if (!user) return (
    <nav className="nav">
      <a href="/" className="brand">{t('nav.brand')}</a>
      <div className="links">
        <a href="/login">{t('nav.login')}</a>
        <a href="/signup">{t('nav.signup')}</a>
        <LangToggle />
      </div>
    </nav>
  );

  const isAdmin = user.role === 'admin';
  const links = isAdmin
    ? [
        { href: '/admin', label: t('nav.admin') },
      ]
    : [
        { href: '/dashboard', label: t('nav.dashboard') },
        { href: '/integrations', label: t('nav.channels') },
        { href: '/team', label: t('nav.team') },
      ];

  return (
    <nav className="nav">
      <a href="/" className="brand">{t('nav.brand')}</a>
      <div className="links">
        {links.map(l => (
          <a key={l.href} href={l.href} style={pathname === l.href ? { color: 'var(--brand)' } : {}}>{l.label}</a>
        ))}
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>
          {user.name} <span style={{ opacity: 0.5 }}>· {user.role === 'admin' ? t('nav.role.admin') : t('nav.role.customer')}</span>
        </span>
        <button onClick={handleLogout} style={{ background: 'none', border: '1px solid var(--line)', color: 'var(--muted)', padding: '6px 14px', borderRadius: 10, cursor: 'pointer', fontSize: 13 }}>{t('nav.logout')}</button>
        <LangToggle />
      </div>
    </nav>
  );
}

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useI18n();

  useEffect(() => {
    if (!loading && !user) {
      router.replace(`/login?redirect=${encodeURIComponent(pathname)}`);
    }
  }, [loading, user, router, pathname]);

  if (loading) return <main className="shell"><p>{t('auth.verifying_session')}</p></main>;
  if (!user) return null;
  return <>{children}</>;
}

export function RedirectIfAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const { t } = useI18n();

  useEffect(() => {
    if (!loading && user) {
      router.replace(user.role === 'admin' ? '/admin' : '/dashboard');
    }
  }, [loading, user, router]);

  if (loading) return <main className="shell"><p>{t('auth.verifying')}</p></main>;
  if (user) return null;
  return <>{children}</>;
}
