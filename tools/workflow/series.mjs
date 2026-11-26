// Expose the workflow runner's role-filtered series packet as an ordinary handoff.
import { copyFileSync, readFileSync } from 'node:fs';

const job = JSON.parse(readFileSync(0, 'utf8'));
if (!job.inputs?.seriesContext || !job.outputs?.context) {
  throw Error('Declare a stage seriesContext binding and a context output');
}
copyFileSync(job.inputs.seriesContext, job.outputs.context);
