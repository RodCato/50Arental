#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import Backup from '../backup-utils.js';
const path=process.argv[2];
if(!path){console.error('Usage: node scripts/validate-backup.mjs /path/to/backup.json');process.exit(2)}
try{
  if((await stat(path)).size>Backup.MAX_BYTES)throw Error('$: file exceeds 128 MiB limit');
  const bytes=await readFile(path);console.log('50A BACKUP VALIDATION\n\nFile SHA-256:\n'+await Backup.sha256(bytes));
  let backup;try{backup=JSON.parse(bytes.toString('utf8'))}catch{throw Error('$: invalid JSON')}
  if(backup?.format===Backup.FORMAT&&backup.version===2){console.log('\nFormat: 50a-ledger-backup\nVersion: 2 (LEGACY)\nV3 integrity unavailable. Use explicit legacy import and export a verified v3.\nBACKUP INTEGRITY: REVIEW — not certified');process.exitCode=2}
  else{
    const {summary:s,restoreEquivalent}=await Backup.validate(backup);if(!restoreEquivalent)throw Error('$: restore-equivalence failed');
    console.log(`\nFormat: ${Backup.FORMAT}\nVersion: 3\nExported: ${backup.exportedAt}\nTransactions: ${s.transactions}\nLine items: ${s.lineItems}\nRecurring bills: ${s.recurringBills} total / ${s.activeBills} active / ${s.inactiveBills} inactive\nProperty records: ${s.propertyRecords}\nWater events: ${s.waterEvents}\nAttachment references: ${s.attachmentReferences} (${s.uniqueAttachmentReferences} unique)\nEmbedded attachments: ${s.embeddedAttachments}\nInline evidence: ${s.inlineEvidence}\nMissing attachments: 0\nDuplicate IDs: 0\nDangling recurring-charge references: 0\nDangling attachment references: 0\nStructured-state hash: PASS\nAttachment hashes: PASS\nRestore-equivalence preflight: PASS`);
    const money=n=>n.toFixed(2);console.log(`\nAll-period actual expenses (not gross cash outflow): $${money(s.actualExpenses)}\nActive recurring run-rate: $${money(s.recurringRunRate)}\nJosh effective benchmark: $${money(s.benchmark)}\nProjected recurring monthly savings: $${money(s.monthlySavings)}\nProjected annual savings: $${money(s.annual)}`);
    for(const [month,v] of Object.entries(s.months))console.log(`${month}: expenses $${money(v.expenses)} / housing $${money(v.housing)} / utilities $${money(v.utilities)}`);
    console.log('\nBACKUP INTEGRITY: PASS');
  }
}catch(error){console.error('BACKUP INTEGRITY: FAIL\n'+(error.message.startsWith('$')?error.message:'Unable to read or validate backup'));process.exitCode=1}
