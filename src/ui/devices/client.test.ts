import { describe, expect, it } from 'vitest';
import { initials, linkText, shortModel } from './client';

describe('initials', () => {
  it.each([
    ['OnePlus-Ace-6', 'On'],
    ['客厅电视', '客'],
    ['192.168.8.221', '221'],
    ['10.0.0.5', '5'],
  ])('%s → %s', (name, out) => {
    expect(initials(name)).toBe(out);
  });
});

describe('shortModel', () => {
  it.each([
    ['Cudy TR3000 256MB v1', 'TR3000'],
    ['GL.iNet GL-MT3000', 'GL-MT3000'],
    ['F50', 'F50'],
    ['Xiaomi AX3000T rev 2', 'AX3000T'],
  ])('%s → %s', (m, out) => {
    expect(shortModel(m)).toBe(out);
  });
});

describe('linkText', () => {
  const base = { mac: '02:00:00:00:00:01', ip: '', name: '', kind: 'other', rate: { up: 0, down: 0 }, staticLease: false, online: true } as const;
  it('有线没有网口速率时只写有线', () => {
    expect(linkText({ ...base, link: 'wired' })).toBe('有线');
    expect(linkText({ ...base, link: 'wired', linkSpeedMbps: 1000 })).toBe('有线 1000M');
  });
});
