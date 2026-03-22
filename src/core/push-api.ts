/**
 * Shared logic for pushing scan results to ratchetcli.com.
 */

import type { ScanResult } from '../commands/scan.js';
import type { Credentials } from './credentials.js';

export interface PushPayload {
  owner: string;
  repo: string;
  scan: ScanResult;
  timestamp: string;
}

export interface PushResult {
  ok: boolean;
  error?: string;
  isFirstPush?: boolean;
}

const PUSH_URL = 'https://ratchetcli.com/api/push';

export async function pushScanResult(
  creds: Credentials,
  payload: PushPayload,
): Promise<PushResult> {
  try {
    const response = await fetch(PUSH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${creds.apiKey}`,
        'User-Agent': 'ratchet-run',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      return { ok: false, error: `HTTP ${response.status}: ${text}` };
    }

    const data = await response.json() as { isFirstPush?: boolean };
    return { ok: true, isFirstPush: data.isFirstPush ?? false };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
