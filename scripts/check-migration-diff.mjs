import {execFileSync} from 'node:child_process';
const base=process.argv[2]||'origin/main';
try{const files=execFileSync('git',['diff','--name-only',`${base}...HEAD`,'--','supabase/migrations/'],{encoding:'utf8'}).trim();if(files)console.log('DATABASE MIGRATION PRESENT — production deployment required before dependent frontend rollout.\n'+files);else console.log('No database migration in this diff.');}catch{console.error('Could not inspect migration diff. Fetch the base ref first.');process.exitCode=1;}
