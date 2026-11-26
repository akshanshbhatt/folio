import { createHash, randomUUID } from 'node:crypto';
import { closeSync, fstatSync, openSync, readSync, realpathSync, statSync, readFileSync, renameSync, rmSync, writeFileSync, fchmodSync } from 'node:fs';
import { isAbsolute, join, relative, sep, win32 } from 'node:path';

const need = (ok, message) => { if (!ok) throw Error(message); };

export function localPath(value, label) {
  need(typeof value === 'string' && value && !isAbsolute(value) && !win32.isAbsolute(value)
    && !value.includes('\\') && !value.includes('\0') && value.split('/').every(part => part && part !== '.' && part !== '..'),
  label + ' needs a relative path without traversal');
  return value;
}

export function realFile(root, relativePath) {
  const base = realpathSync(root), name = join(base, relativePath), file = realpathSync(name);
  const rel = relative(base, file);
  need(rel && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel), 'File outside its directory: ' + name);
  need(statSync(file).isFile(), 'Expected a regular file: ' + name);
  return file;
}

export function stamp(file) {
  const hash = createHash('sha256'), buffer = Buffer.allocUnsafe(128 * 1024);
  const fd = openSync(file, 'r');
  try {
    need(fstatSync(fd).isFile(), 'Expected a regular file: ' + file);
    let size = 0, count;
    while ((count = readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, count)); size += count;
    }
    return { bytes: size, sha256: hash.digest('hex') };
  } finally { closeSync(fd); }
}

// Callers serialize Folio writers with the series lock. Recheck external edits
// before publishing a complete sibling file and keep the creator's permissions.
export function replaceJson(file, before, value) {
  const temp = file + '.' + randomUUID() + '.tmp';
  const mode = statSync(file).mode & 0o777;
  const fd = openSync(temp,'wx',0o600);
  try {
    try {
      writeFileSync(fd,JSON.stringify(value,null,2) + '\n');
      fchmodSync(fd,mode);
    } finally { closeSync(fd); }
    need(readFileSync(file).equals(before),'File changed during edit: ' + file);
    renameSync(temp,file);
  } finally { rmSync(temp,{force:true}); }
}
