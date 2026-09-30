'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { UserProfile, UserPreferencesData } from '@emeradar/services';

interface AuthContextValue {
  user: UserProfile | null;
  preferences: UserPreferencesData | null;
  isLoading: boolean;
  login: (email: string, password?: string) => Promise<UserProfile>;
  register: (data: {
    email: string;
    password: string;
    displayName?: string;
  }) => Promise<UserProfile>;
  logout: () => Promise<void>;
  updatePreferences: (prefs: Partial<UserPreferencesData>) => Promise<UserPreferencesData>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [preferences, setPreferences] = useState<UserPreferencesData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const fetchSession = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/auth/me', {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user || null);
        setPreferences(data.preferences || null);
      } else {
        setUser(null);
        setPreferences(null);
      }
    } catch {
      setUser(null);
      setPreferences(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  const login = async (email: string, password?: string): Promise<UserProfile> => {
    const res = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || data.title || 'Login failed');
    }

    setUser(data.user);
    await fetchSession();
    return data.user;
  };

  const register = async (input: {
    email: string;
    password: string;
    displayName?: string;
  }): Promise<UserProfile> => {
    const res = await fetch('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || data.title || 'Registration failed');
    }

    setUser(data.user);
    await fetchSession();
    return data.user;
  };

  const logout = async (): Promise<void> => {
    try {
      await fetch('/api/v1/auth/logout', { method: 'POST' });
    } finally {
      setUser(null);
      setPreferences(null);
      window.location.href = '/login';
    }
  };

  const updatePreferences = async (prefs: Partial<UserPreferencesData>): Promise<UserPreferencesData> => {
    const res = await fetch('/api/v1/user/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(prefs),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || data.title || 'Failed to update preferences');
    }

    setPreferences(data.preferences);
    return data.preferences;
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        preferences,
        isLoading,
        login,
        register,
        logout,
        updatePreferences,
        refreshUser: fetchSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
