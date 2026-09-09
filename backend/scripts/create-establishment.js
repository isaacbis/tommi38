import 'dotenv/config';
import bcrypt from 'bcrypt';
import { db } from '../src/db.js';

// Run only in the trusted backend environment with its existing Firestore access.
const [id, name, username] = process.argv.slice(2);
const password = process.env.INITIAL_ADMIN_PASSWORD;
if (!/^[a-z0-9-]{1,60}$/.test(id || '') || id === 'tommi38' || !name || name.length > 80 || !/^[a-zA-Z0-9._-]{3,40}$/.test(username || '') || !password || password.length < 12) {
  console.error('Usage: INITIAL_ADMIN_PASSWORD=<12+ characters> node scripts/create-establishment.js <id> <name> <admin-username>');
  process.exit(1);
}
const passwordHash = await bcrypt.hash(password,12);
const ref = db.collection('establishments').doc(id);
await db.runTransaction(async tx => {
  if ((await tx.get(ref)).exists) throw new Error('Establishment already exists; no changes made');
  tx.set(ref,{name,enabled:true});
  tx.set(ref.collection('users').doc(username),{passwordHash,role:'admin',credits:0,disabled:false});
  tx.set(ref.collection('admin').doc('config'),{slotMinutes:45,dayStart:'09:00',dayEnd:'20:00',maxBookingsPerUserPerDay:1,maxActiveBookingsPerUser:1});
  tx.set(ref.collection('admin').doc('fields'),{fields:[]});
});
console.log('Establishment created. Configure its fields after signing in.');
