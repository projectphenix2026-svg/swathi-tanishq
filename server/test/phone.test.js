import { describe, it, expect } from 'vitest';
import { normalizePhone, formatPhone } from '../src/lib/phone.js';

const ok = (input) => normalizePhone(input).e164;

describe('normalizePhone', () => {
  it.each([
    ['9876543210', '+919876543210'],
    ['98765 43210', '+919876543210'],
    ['98765-43210', '+919876543210'],
    ['(987) 654-3210', '+919876543210'],
    ['+91 98765 43210', '+919876543210'],
    ['+91-98765-43210', '+919876543210'],
    ['919876543210', '+919876543210'],
    ['09876543210', '+919876543210'],
    ['0091 98765 43210', '+919876543210'],
    ['  6123456789 ', '+916123456789'],
    ['whatsapp:+919876543210', '+919876543210'],
  ])('turns %s into %s', (input, expected) => {
    expect(ok(input)).toBe(expected);
  });

  it('accepts numbers exactly as Excel stores them', () => {
    expect(ok(9876543210)).toBe('+919876543210');
    expect(ok(919876543210)).toBe('+919876543210');
    expect(ok('9.87654321E+09')).toBe('+919876543210');
    expect(ok('9876543210.0')).toBe('+919876543210');
  });

  it('keeps numbers with another country code', () => {
    const r = normalizePhone('+1 737 250 8034');
    expect(r).toMatchObject({ ok: true, e164: '+17372508034', international: true });
  });

  it.each([
    ['', 'empty'],
    [null, 'empty'],
    ['12345', 'Too short'],
    ['5876543210', 'Not a mobile number'],
    ['98765432101234', 'Too long'],
    ['98765abcde', 'Contains letters'],
    ['+91 98765 4321', 'Too short'],
    [98765432.5, 'Not a whole number'],
  ])('rejects %s (%s)', (input, reason) => {
    const r = normalizePhone(input);
    expect(r.ok).toBe(false);
    expect(r.reason.toLowerCase()).toContain(reason.toLowerCase());
  });

  it('formats for display', () => {
    expect(formatPhone('+919876543210')).toBe('+91 98765 43210');
    expect(normalizePhone('9876543210').display).toBe('+91 98765 43210');
  });
});
