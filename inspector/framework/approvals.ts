import { createSignal } from 'solid-js';

const STORAGE_KEY = 'inspector-approvals';

export interface ApprovalEntry {
  status: 'approved' | 'unreviewed';
  approvedAt?: string;
}

export type ApprovalMap = Record<string, ApprovalEntry>;

function loadApprovals(): ApprovalMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveApprovals(approvals: ApprovalMap): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(approvals));
}

// Reactive signal for approval state
const [approvals, setApprovals] = createSignal<ApprovalMap>(loadApprovals());

export function getApprovals(): ApprovalMap {
  return approvals();
}

export function isApproved(scenarioId: string): boolean {
  return approvals()[scenarioId]?.status === 'approved';
}

export function toggleApproval(scenarioId: string): void {
  setApprovals(prev => {
    const next = { ...prev };
    if (next[scenarioId]?.status === 'approved') {
      next[scenarioId] = { status: 'unreviewed' };
    } else {
      next[scenarioId] = { status: 'approved', approvedAt: new Date().toISOString() };
    }
    saveApprovals(next);
    return next;
  });
}

export function approveScenario(scenarioId: string): void {
  setApprovals(prev => {
    const next = { ...prev };
    next[scenarioId] = { status: 'approved', approvedAt: new Date().toISOString() };
    saveApprovals(next);
    return next;
  });
}

export function unapproveScenario(scenarioId: string): void {
  setApprovals(prev => {
    const next = { ...prev };
    next[scenarioId] = { status: 'unreviewed' };
    saveApprovals(next);
    return next;
  });
}
