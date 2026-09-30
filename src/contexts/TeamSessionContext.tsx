import React, { createContext, useContext, useState, useCallback } from 'react';
import type { TeamSession } from '@/lib/types';
import { generateSessionToken } from '@/lib/utils';

interface TeamSessionContextType {
  session: TeamSession | null;
  setTeamSession: (teamId: string, teamName: string, quizId?: string) => void;
  setAttemptId: (attemptId: string) => void;
  clearSession: () => void;
}

const STORAGE_KEY = 'dejavu_team_session';

const TeamSessionContext = createContext<TeamSessionContextType | undefined>(undefined);

function loadSession(): TeamSession | null {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return null;
}

function saveSession(session: TeamSession | null) {
  if (session) {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } else {
    sessionStorage.removeItem(STORAGE_KEY);
  }
}

export function TeamSessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<TeamSession | null>(loadSession);

  const setTeamSession = useCallback((teamId: string, teamName: string, quizId?: string) => {
    const newSession: TeamSession = {
      teamId,
      teamName,
      quizId,
      sessionToken: generateSessionToken(),
    };
    setSession(newSession);
    saveSession(newSession);
  }, []);

  const setAttemptId = useCallback((attemptId: string) => {
    setSession(prev => {
      if (!prev) return prev;
      const updated = { ...prev, attemptId };
      saveSession(updated);
      return updated;
    });
  }, []);

  const clearSession = useCallback(() => {
    setSession(null);
    saveSession(null);
  }, []);

  return (
    <TeamSessionContext.Provider value={{ session, setTeamSession, setAttemptId, clearSession }}>
      {children}
    </TeamSessionContext.Provider>
  );
}

export function useTeamSession() {
  const context = useContext(TeamSessionContext);
  if (context === undefined) {
    throw new Error('useTeamSession must be used within a TeamSessionProvider');
  }
  return context;
}
