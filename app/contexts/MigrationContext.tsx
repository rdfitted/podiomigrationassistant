'use client';

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

export type MigrationTabType = 'flow_clone' | 'item_migration' | 'cleanup';

export type MigrationJobStatus =
  | 'planning'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'paused'
  | 'cancelled'
  | 'detecting'
  | 'waiting_approval'
  | 'deleting';

export interface ActiveMigrationJob {
  jobId: string;
  tabType: MigrationTabType;
  status: MigrationJobStatus;
  startedAt: Date;
  progress?: {
    total: number;
    processed: number;
    successful: number;
    failed: number;
    percent: number;
  };
  description?: string;
}

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  resetAt: string;
  isLimited: boolean;
  timeUntilReset?: number;
}

interface MigrationContextState {
  activeJobs: Map<MigrationTabType, ActiveMigrationJob>;
  currentTab: MigrationTabType | null;
  rateLimitInfo: RateLimitInfo | null;

  // Actions
  registerJob: (job: ActiveMigrationJob) => void;
  unregisterJob: (tabType: MigrationTabType) => void;
  updateJobProgress: (tabType: MigrationTabType, progress: ActiveMigrationJob['progress']) => void;
  updateJobStatus: (tabType: MigrationTabType, status: MigrationJobStatus) => void;
  setCurrentTab: (tabType: MigrationTabType | null) => void;
  updateRateLimitInfo: (info: RateLimitInfo) => void;
  getActiveJob: (tabType: MigrationTabType) => ActiveMigrationJob | undefined;
  hasActiveJobs: () => boolean;
}

const MigrationContext = createContext<MigrationContextState | undefined>(undefined);

const STORAGE_KEY = 'podio-migration-active-jobs';
const STORAGE_TTL = 24 * 60 * 60 * 1000; // 24 hours

interface StoredJob extends Omit<ActiveMigrationJob, 'startedAt'> {
  startedAt: string;
  expiresAt: string;
}

function loadActiveJobsFromStorage(): Map<MigrationTabType, ActiveMigrationJob> {
  if (typeof window === 'undefined') return new Map();

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return new Map();

    const parsed: StoredJob[] = JSON.parse(stored);
    const now = Date.now();
    const activeJobs = new Map<MigrationTabType, ActiveMigrationJob>();

    for (const job of parsed) {
      // Skip expired jobs
      if (new Date(job.expiresAt).getTime() < now) continue;

      // Skip completed/failed/cancelled jobs
      if (['completed', 'failed', 'cancelled'].includes(job.status)) continue;

      activeJobs.set(job.tabType, {
        ...job,
        startedAt: new Date(job.startedAt)
      });
    }

    return activeJobs;
  } catch (error) {
    console.error('Failed to load active jobs from storage:', error);
    return new Map();
  }
}

function saveActiveJobsToStorage(jobs: Map<MigrationTabType, ActiveMigrationJob>): void {
  if (typeof window === 'undefined') return;

  try {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + STORAGE_TTL);

    const toStore: StoredJob[] = Array.from(jobs.values()).map(job => ({
      ...job,
      startedAt: job.startedAt.toISOString(),
      expiresAt: expiresAt.toISOString()
    }));

    localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
  } catch (error) {
    console.error('Failed to save active jobs to storage:', error);
  }
}

export function MigrationProvider({ children }: { children: React.ReactNode }) {
  const [activeJobs, setActiveJobs] = useState<Map<MigrationTabType, ActiveMigrationJob>>(() =>
    loadActiveJobsFromStorage()
  );
  const [currentTab, setCurrentTab] = useState<MigrationTabType | null>(null);
  const [rateLimitInfo, setRateLimitInfo] = useState<RateLimitInfo | null>(null);

  // Persist to localStorage whenever activeJobs changes
  useEffect(() => {
    saveActiveJobsToStorage(activeJobs);
  }, [activeJobs]);

  const registerJob = useCallback((job: ActiveMigrationJob) => {
    setActiveJobs(prev => {
      const next = new Map(prev);
      next.set(job.tabType, job);
      return next;
    });
  }, []);

  const unregisterJob = useCallback((tabType: MigrationTabType) => {
    setActiveJobs(prev => {
      const next = new Map(prev);
      next.delete(tabType);
      return next;
    });
  }, []);

  const updateJobProgress = useCallback((
    tabType: MigrationTabType,
    progress: ActiveMigrationJob['progress']
  ) => {
    setActiveJobs(prev => {
      const job = prev.get(tabType);
      if (!job) return prev;

      const next = new Map(prev);
      next.set(tabType, { ...job, progress });
      return next;
    });
  }, []);

  const updateJobStatus = useCallback((
    tabType: MigrationTabType,
    status: MigrationJobStatus
  ) => {
    setActiveJobs(prev => {
      const job = prev.get(tabType);
      if (!job) return prev;

      const next = new Map(prev);

      // If job is completed/failed/cancelled, remove it after a short delay
      if (['completed', 'failed', 'cancelled'].includes(status)) {
        next.set(tabType, { ...job, status });
        // Auto-remove after 5 seconds to give user time to see the final state
        setTimeout(() => {
          setActiveJobs(current => {
            const updated = new Map(current);
            updated.delete(tabType);
            return updated;
          });
        }, 5000);
      } else {
        next.set(tabType, { ...job, status });
      }

      return next;
    });
  }, []);

  const updateRateLimitInfo = useCallback((info: RateLimitInfo) => {
    setRateLimitInfo(info);
  }, []);

  const getActiveJob = useCallback((tabType: MigrationTabType): ActiveMigrationJob | undefined => {
    return activeJobs.get(tabType);
  }, [activeJobs]);

  const hasActiveJobs = useCallback((): boolean => {
    return activeJobs.size > 0;
  }, [activeJobs]);

  const value: MigrationContextState = {
    activeJobs,
    currentTab,
    rateLimitInfo,
    registerJob,
    unregisterJob,
    updateJobProgress,
    updateJobStatus,
    setCurrentTab,
    updateRateLimitInfo,
    getActiveJob,
    hasActiveJobs
  };

  return (
    <MigrationContext.Provider value={value}>
      {children}
    </MigrationContext.Provider>
  );
}

export function useMigrationContext() {
  const context = useContext(MigrationContext);
  if (context === undefined) {
    throw new Error('useMigrationContext must be used within a MigrationProvider');
  }
  return context;
}
