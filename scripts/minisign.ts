/**
 * Reading the trusted comment out of a Tauri updater signature.
 *
 * A Tauri `.sig` file is a minisign signature file, base64-encoded once more.
 * Decoded, it looks like:
 *
 *   untrusted comment: signature from tauri secret key
 *   RUT...                              (the signature)
 *   trusted comment: timestamp:1727303955\tfile:PlugSight_0.4.1_x64-setup.exe\tversion:0.4.1
 *   ...                                 (the signature over the trusted comment)
 *
 * The trusted comment is covered by the signature, so its fields are a
 * reliable record of what was signed. It's a tab-separated list of
 * `key:value` fields. Older Tauri CLIs wrote only `timestamp` and `file`;
 * 2.11 added `version`, which is why a parser that took everything after
 * `file:` started reading "name.exe\tversion:0.4.1" as the filename.
 */

/**
 * The trusted comment's fields (`timestamp`, `file`, `version`, ...), or
 * null if the signature doesn't decode to a minisign file with one.
 */
export function trustedCommentFields(signatureBase64: string): Record<string, string> | null {
  const text = Buffer.from(signatureBase64.trim(), 'base64').toString('utf8');
  const line = text.split(/\r?\n/).find(l => l.startsWith('trusted comment:'));
  if (!line) return null;

  const fields: Record<string, string> = {};
  for (const field of line.slice('trusted comment:'.length).trim().split('\t')) {
    const colon = field.indexOf(':');
    if (colon > 0) fields[field.slice(0, colon).trim()] = field.slice(colon + 1).trim();
  }
  return fields;
}
