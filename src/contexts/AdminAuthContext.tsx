import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

interface AdminUser {
  email: string;
  id: string;
}

interface AdminAuthContextType {
  user: AdminUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const ADMIN_STORAGE_KEY = 'dejavu_admin_session';

const AdminAuthContext = createContext<AdminAuthContextType | undefined>(undefined);

function loadAdminSession(): AdminUser | null {
  try {
    const stored = localStorage.getItem(ADMIN_STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return null;
}

function saveAdminSession(user: AdminUser | null) {
  if (user) {
    localStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify(user));
  } else {
    localStorage.removeItem(ADMIN_STORAGE_KEY);
  }
}

export function AdminAuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AdminUser | null>(loadAdminSession);
  const [loading, setLoading] = useState(false);

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      const normalizedEmail = email.trim().toLowerCase();
      const validEmails = ['muralikrishna2444b@gmail.com', 'saivenkat.cherala@gmail.com'];
      
      if (validEmails.includes(normalizedEmail) && password === 'Dejavu2026') {
        const adminUser: AdminUser = {
          email: normalizedEmail,
          id: 'admin-' + normalizedEmail,
        };
        setUser(adminUser);
        saveAdminSession(adminUser);
        return { error: null };
      }

      return { error: 'Invalid email or password.' };
    } catch (err: any) {
      return { error: err.message || 'Login failed.' };
    }
  }, []);

  const signOut = useCallback(async () => {
    setUser(null);
    saveAdminSession(null);
  }, []);

  return (
    <AdminAuthContext.Provider value={{ user, loading, signIn, signOut }}>
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth() {
  const context = useContext(AdminAuthContext);
  if (context === undefined) {
    throw new Error('useAdminAuth must be used within an AdminAuthProvider');
  }
  return context;
}
