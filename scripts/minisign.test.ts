/**
 * Tests for reading Tauri signature trusted comments. Run with `bun test`.
 */

import { describe, expect, test } from 'bun:test';
import { trustedCommentFields } from './minisign';

/** A Tauri-style `.sig`: a minisign file with this trusted comment, base64-encoded. */
function sig(trustedComment: string): string {
  const minisign = [
    'untrusted comment: signature from tauri secret key',
    'RUTfakeSignatureBytesThatAreNotCheckedHere==',
    `trusted comment: ${trustedComment}`,
    'fakeGlobalSignature==',
    '',
  ].join('\n');
  return Buffer.from(minisign, 'utf8').toString('base64');
}

describe('trustedCommentFields', () => {
  test('reads the fields Tauri 2.11+ writes, with the version after the file', () => {
    // The v0.4.1 release failed on exactly this shape.
    const fields = trustedCommentFields(sig('timestamp:1727303955\tfile:PlugSight_0.4.1_x64-setup.exe\tversion:0.4.1'));
    expect(fields?.file).toBe('PlugSight_0.4.1_x64-setup.exe');
    expect(fields?.version).toBe('0.4.1');
    expect(fields?.timestamp).toBe('1727303955');
  });

  test('still reads the older two-field form', () => {
    const fields = trustedCommentFields(sig('timestamp:1722748800\tfile:PlugSight_0.3.0_x64-setup.exe'));
    expect(fields?.file).toBe('PlugSight_0.3.0_x64-setup.exe');
    expect(fields?.version).toBeUndefined();
  });

  test('keeps colons inside a value', () => {
    expect(trustedCommentFields(sig('file:C:odd:name.exe'))?.file).toBe('C:odd:name.exe');
  });

  test('tolerates CRLF line endings and surrounding whitespace', () => {
    const minisign = 'untrusted comment: x\r\nRUTsig\r\ntrusted comment: file:a.exe\tversion:1.2.3\r\nglobal\r\n';
    const fields = trustedCommentFields(`  ${Buffer.from(minisign).toString('base64')}\n`);
    expect(fields).toEqual({ file: 'a.exe', version: '1.2.3' });
  });

  test('is null for something that is not a minisign signature', () => {
    expect(trustedCommentFields(Buffer.from('hello').toString('base64'))).toBeNull();
    expect(trustedCommentFields('')).toBeNull();
  });
});
