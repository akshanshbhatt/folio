import {createHash, randomUUID} from 'node:crypto';
import {existsSync, readFileSync, readdirSync, statSync, mkdirSync, writeFileSync, renameSync} from 'node:fs';
import {dirname, join, resolve, relative, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const json = file => JSON.parse(readFileSync(file, 'utf8'));
export const digest = (...values) => {
  const hash = createHash('sha256');
  for (const value of values) {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
    hash.update(String(bytes.length) + ':').update(bytes);
  }
  return hash.digest('hex');
};
export const treeHash = dir => digest(...readdirSync(dir).sort().map(name => {
  const file = join(dir, name);
  return [name, statSync(file).isDirectory() ? treeHash(file) : digest(readFileSync(file))];
}));
export function write(file, value) {
  mkdirSync(dirname(file), {recursive:true});
  const tmp = file + '.' + randomUUID() + '.tmp';
  writeFileSync(tmp, typeof value === 'string' ? value : JSON.stringify(value,null,2) + '\n');
  renameSync(tmp,file);
}
export function inside(base, name) {
  const path = resolve(base, name);
  const rel = relative(base,path);
  if (rel === '..' || rel.startsWith('..' + sep)) throw Error('Asset outside channel: ' + name);
  return path;
}
export function run(cmd,args,options={}) {
  try {return execFileSync(cmd,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:32*1024*1024,...options});}
  catch(e){throw Error(cmd + ' failed: ' + String(e.stderr || e.message).slice(-2200));}
}
export const ff = args => run('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-y',...args]);
export const probe = file => JSON.parse(run('ffprobe',['-v','error','-show_format','-show_streams','-of','json',file]));
export const safeId = value => typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
export const exists = existsSync;
