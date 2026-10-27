// Replays: seed + inputs per tick, run-length encoded and compressed into a
// URL fragment (#replay=...), so a dive can be shared on static hosting.

import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';

export interface ReplayData {
  v: 1;
  code: string;
  height: number;
  zone: number;
  seed: number;
  assist: boolean;
  /** synchro: partner id, HEP time and the partner's inputs */
  partner?: string;
  hep?: number;
  arena?: string;
  inputs: number[];
  partnerInputs?: number[];
  /** score shown with the shared replay */
  score?: number;
  outfit?: number;
}

export function rle(inputs: number[]): string {
  const out: string[] = [];
  let i = 0;
  while (i < inputs.length) {
    const m = inputs[i]!;
    let n = 1;
    while (i + n < inputs.length && inputs[i + n] === m) n++;
    out.push(n === 1 ? m.toString(36) : `${m.toString(36)}*${n.toString(36)}`);
    i += n;
  }
  return out.join('.');
}

export function unrle(s: string): number[] {
  if (!s) return [];
  const out: number[] = [];
  for (const part of s.split('.')) {
    const [m, n] = part.split('*');
    const mask = parseInt(m!, 36);
    const count = n ? parseInt(n, 36) : 1;
    if (!Number.isFinite(mask) || !Number.isFinite(count) || count > 100000) throw new Error('Bad replay');
    for (let k = 0; k < count; k++) out.push(mask);
  }
  return out;
}

export function encodeReplay(r: ReplayData): string {
  const { inputs, partnerInputs, ...rest } = r;
  const payload = { ...rest, i: rle(inputs), p: partnerInputs ? rle(partnerInputs) : undefined };
  return compressToEncodedURIComponent(JSON.stringify(payload));
}

export function decodeReplay(s: string): ReplayData {
  const json = decompressFromEncodedURIComponent(s);
  if (!json) throw new Error('Bad replay');
  const o = JSON.parse(json) as Omit<ReplayData, 'inputs' | 'partnerInputs'> & { i: string; p?: string };
  if (o.v !== 1 || typeof o.code !== 'string') throw new Error('Unsupported replay');
  const { i, p, ...rest } = o;
  const r: ReplayData = { ...rest, inputs: unrle(i) };
  if (p) r.partnerInputs = unrle(p);
  return r;
}

export function replayUrl(r: ReplayData, base = typeof location !== 'undefined' ? location.href : ''): string {
  const u = base.split('#')[0];
  return `${u}#replay=${encodeReplay(r)}`;
}

export function replayFromHash(hash: string): ReplayData | null {
  const m = /[#&]replay=([^&]+)/.exec(hash);
  if (!m) return null;
  try {
    return decodeReplay(m[1]!);
  } catch {
    return null;
  }
}
