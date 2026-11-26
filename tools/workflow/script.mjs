// Apply a writer's draft against the same role-scoped context sent to the job.
import {readFileSync,writeFileSync} from 'node:fs';
import {applyDraft,scriptView} from '../../src/series-script.mjs';

const read = file => JSON.parse(readFileSync(file,'utf8'));
const job = read(0);
if (!job.inputs?.seriesContext || !job.outputs?.script)
  throw Error('Declare a stage seriesContext binding and a script output');
const context = read(job.inputs.seriesContext);
const roles = new Set(context.shots.flatMap(s=>Object.keys(s.roles)));
if (roles.size !== 1) throw Error('Bind one role to this script stage');
const [role] = roles;
const draft = job.inputs.draft ? read(job.inputs.draft) : {edits:[]};
const script = scriptView(applyDraft(context,draft,role),role);
writeFileSync(job.outputs.script,JSON.stringify(script,null,2)+'\n');
