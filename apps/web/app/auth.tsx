'use client';

import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  phone?: string | null;
  preferredLanguage: string;
  organizationId?: string | null;
  organization?: { id: string; name: string; status: string } | null;
};

type AuthState = {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  signup: (data: SignupData) => Promise<{ user: AuthUser; token: string; organizationId: string }>;
  logout: () => void;
  refresh: () => Promise<void>;
};

export type SignupData = {
  name: string;
  email: string;
  password: string;
  phone?: string;
  companyName: string;
  industry?: string;
  planId: string;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const saveToken = useCallback((newToken: string | null) => {
    if (newToken) {
      localStorage.setItem('authToken', newToken);
    } else {
      localStorage.removeItem('authToken');
      localStorage.removeItem('dify_saas_admin_token');
    }
    setToken(newToken);
  }, []);

  const fetchUser = useCallback(async (authToken: string): Promise<AuthUser> => {
    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!res.ok) throw new Error('Session expired');
    const data = await res.json();
    return data.user as AuthUser;
  }, []);

  const refresh = useCallback(async () => {
    const stored = token || localStorage.getItem('authToken');
    if (!stored) { setUser(null); setLoading(false); return; }
    try {
      const u = await fetchUser(stored);
      setUser(u);
      setToken(stored);
    } catch {
      saveToken(null);
      setUser(null);
    }
    setLoading(false);
  }, [token, fetchUser, saveToken]);

  useEffect(() => { refresh(); }, []);

  const loginFn = useCallback(async (email: string, password: string): Promise<AuthUser> => {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'فشل تسجيل الدخول');
    saveToken(data.token);
    const u = data.user as AuthUser;
    setUser(u);
    if (u.organizationId) localStorage.setItem('dify_saas_organization_id', u.organizationId);
    return u;
  }, [saveToken]);

  const signupFn = useCallback(async (input: SignupData): Promise<{ user: AuthUser; token: string; organizationId: string }> => {
    const res = await fetch(`${API_BASE}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...input, preferredLanguage: 'ar' }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'فشل التسجيل');
    saveToken(data.token);
    const u = data.user as AuthUser;
    setUser(u);
    const orgId = data.organization?.id || '';
    if (orgId) localStorage.setItem('dify_saas_organization_id', orgId);
    return { user: u, token: data.token, organizationId: orgId };
  }, [saveToken]);

  const logout = useCallback(() => {
    saveToken(null);
    setUser(null);
  }, [saveToken]);

  return (
    <AuthContext.Provider value={{ user, token, loading, login: loginFn, signup: signupFn, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

// Re-export auth guard components for convenience
export { RequireAuth, RedirectIfAuth } from './components/Navbar';
