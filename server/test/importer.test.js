import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseFile, parsePasted, buildPreview, guessMapping, parseDate, parseOptIn, sampleWorkbook } from '../src/lib/importer.js';

function xlsxBuffer(rows, bookType = 'xlsx') {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType });
}

describe('CSV import', () => {
  it('reads headers, maps columns and normalises numbers', () => {
    const csv = '﻿Customer Name,Mobile No,City,DOB\nPriya Sharma,98765 43210,Hyderabad,14/02/1992\nRavi,+91 91234 56789,Warangal,1988-07-03\n';
    const table = parseFile(Buffer.from(csv), 'list.csv');
    expect(table.columns).toEqual(['Customer Name', 'Mobile No', 'City', 'DOB']);
    expect(table.mapping).toMatchObject({ name: 0, phone: 1, city: 2, birthday: 3 });
    const { rows, summary } = buildPreview(table);
    expect(summary).toEqual({ total: 2, ok: 2, invalid: 0, duplicate: 0, exists: 0 });
    expect(rows[0]).toMatchObject({ name: 'Priya Sharma', phone: '+919876543210', city: 'Hyderabad', birthday: '1992-02-14' });
    expect(rows[1]).toMatchObject({ phone: '+919123456789', birthday: '1988-07-03' });
  });

  it('handles quoted commas and blank lines', () => {
    const csv = 'name,phone,interests\n"Sharma, Priya",9876543210,"gold, bridal"\n\n,,\n';
    const { rows } = buildPreview(parseFile(Buffer.from(csv), 'x.csv'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'Sharma, Priya', interests: 'gold, bridal' });
  });

  it('flags invalid numbers, repeats in the file and existing customers', () => {
    const csv = 'name,phone\nA,9876543210\nB,12345\nC,098765 43210\nD,9123456789\n';
    const { rows, summary } = buildPreview(parseFile(Buffer.from(csv), 'x.csv'), new Set(['+919123456789']));
    expect(rows.map((r) => r.status)).toEqual(['ok', 'invalid', 'duplicate', 'exists']);
    expect(rows[1].reason).toMatch(/short/i);
    expect(rows[2].reason).toBe('Same number as row 1');
    expect(summary).toEqual({ total: 4, ok: 1, invalid: 1, duplicate: 1, exists: 1 });
  });

  it('finds the phone column when there is no header row', () => {
    const csv = 'Priya,9876543210\nRavi,9123456789\n';
    const table = parseFile(Buffer.from(csv), 'x.csv');
    expect(table.columns).toEqual(['Column A', 'Column B']);
    expect(table.mapping.phone).toBe(1);
    expect(buildPreview(table).summary.ok).toBe(2);
  });

  it('rejects other file types', () => {
    expect(() => parseFile(Buffer.from('x'), 'list.pdf')).toThrow(/Excel/);
  });
});

describe('Excel import', () => {
  it('reads .xlsx with numeric phones and real dates', () => {
    const buf = xlsxBuffer([
      ['Name', 'Phone', 'Birthday', 'WhatsApp opt-in'],
      ['Priya', 9876543210, new Date(1992, 1, 14), 'Yes'],
      ['Ravi', '919123456789', '', 'no'],
    ]);
    const table = parseFile(buf, 'customers.xlsx');
    const { rows } = buildPreview(table);
    expect(rows[0]).toMatchObject({ phone: '+919876543210', birthday: '1992-02-14', opt_in: true });
    expect(rows[1]).toMatchObject({ phone: '+919123456789', birthday: null, opt_in: false });
  });

  it('reads old .xls files', () => {
    const buf = xlsxBuffer([['Mobile', 'Name'], ['98765 43210', 'Priya']], 'biff8');
    const { rows } = buildPreview(parseFile(buf, 'old.xls'));
    expect(rows[0]).toMatchObject({ name: 'Priya', phone: '+919876543210' });
  });

  it('round-trips the downloadable sample file', () => {
    const { rows, summary } = buildPreview(parseFile(sampleWorkbook(), 'customers-sample.xlsx'));
    expect(summary.ok).toBe(2);
    expect(rows[0]).toMatchObject({ name: 'Priya Sharma', city: 'Hyderabad', anniversary: '2016-11-20', opt_in: true });
  });
});

describe('pasted numbers', () => {
  it('reads one per line, with or without names', () => {
    const t = parsePasted('98765 43210\nPriya, 9123456789\n\n9988776655 Kiran\n');
    const { rows } = buildPreview(t);
    expect(rows.map((r) => [r.name, r.phone])).toEqual([
      ['', '+919876543210'],
      ['Priya', '+919123456789'],
      ['', null],
    ]);
  });

  it('splits several numbers on one line', () => {
    const { rows } = buildPreview(parsePasted('9876543210, 9123456789; +91 99887 76655'));
    expect(rows.map((r) => r.phone)).toEqual(['+919876543210', '+919123456789', '+919988776655']);
  });

  it('keeps bad lines so staff can see why', () => {
    const { rows } = buildPreview(parsePasted('Kiran, 12345'));
    expect(rows[0]).toMatchObject({ name: 'Kiran', status: 'invalid' });
  });
});

describe('helpers', () => {
  it('guesses mappings from common Indian sheet headers', () => {
    expect(guessMapping(['S.No', 'Cust Name', 'WhatsApp Number', 'Wedding Date', 'Location'])).toMatchObject({
      name: 1,
      phone: 2,
      anniversary: 3,
      city: 4,
    });
  });

  it.each([
    ['14/02/1992', '1992-02-14'],
    ['3-7-88', '1988-07-03'],
    ['1992-02-14', '1992-02-14'],
    ['14 Feb 1992', '1992-02-14'],
    ['February 14, 1992', '1992-02-14'],
    [33648, '1992-02-14'],
    ['31/02/1992', null],
    ['someday', null],
  ])('parses date %s', (input, expected) => {
    expect(parseDate(input)).toBe(expected);
  });

  it('reads opt-in words', () => {
    expect(parseOptIn('Yes')).toBe(true);
    expect(parseOptIn('n')).toBe(false);
    expect(parseOptIn('')).toBe(null);
  });
});
