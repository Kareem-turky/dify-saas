'use client';

import { useAuth } from '../auth';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect } from 'react';

export function Navbar() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  function handleLogout() {
    logout();
    router.push('/login');
  }

  // Public pages that don't need nav
  const publicPages = ['/', '/login', '/signup', '/data-deletion'];
  const isPublic = publicPages.includes(pathname);
  if (isPublic) return null;

  if (loading) return <nav className="nav"><span className="brand">Fulfly AI</span></nav>;

  if (!user) return (
    <nav className="nav">
      <a href="/" className="brand">Fulfly AI</a>
      <div className="links">
        <a href="/login">تسجيل الدخول</a>
        <a href="/signup">إنشاء حساب</a>
      </div>
    </nav>
  );

  const isAdmin = user.role === 'admin';
  const links = isAdmin
    ? [
        { href: '/admin', label: 'لوحة الأدمن' },
      ]
    : [
        { href: '/dashboard', label: 'لوحة التحكم' },
        { href: '/integrations', label: 'القنوات' },
        { href: '/team', label: 'الفريق' },
      ];

  return (
    <nav className="nav">
      <a href="/" className="brand">Fulfly AI</a>
      <div className="links">
        {links.map(l => (
          <a key={l.href} href={l.href} style={pathname === l.href ? { color: 'var(--brand)' } : {}}>{l.label}</a>
        ))}
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>
          {user.name} <span style={{ opacity: 0.5 }}>· {user.role}</span>
        </span>
        <button onClick={handleLogout} style={{ background: 'none', border: '1px solid var(--line)', color: 'var(--muted)', padding: '6px 14px', borderRadius: 10, cursor: 'pointer', fontSize: 13 }}>خروج</button>
      </div>
    </nav>
  );
}

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) {
      router.replace(`/login?redirect=${encodeURIComponent(pathname)}`);
    }
  }, [loading, user, router, pathname]);

  if (loading) return <main className="shell"><p>جاري التحقق من الجلسة...</p></main>;
  if (!user) return null;
  return <>{children}</>;
}

export function RedirectIfAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) {
      router.replace(user.role === 'admin' ? '/admin' : '/dashboard');
    }
  }, [loading, user, router]);

  if (loading) return <main className="shell"><p>جاري التحقق...</p></main>;
  if (user) return null;
  return <>{children}</>;
}
