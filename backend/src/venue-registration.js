import bcrypt from 'bcrypt';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { db as root, FieldValue } from './db.js';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const minute = value => Number(value.slice(0,2))*60+Number(value.slice(3));
export const venueRegistrationSchema = z.object({
  requestId:z.string().uuid(),name:z.string().trim().min(2).max(80),city:z.string().trim().max(100),
  managerUsername:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{2,39}$/),
  managerPassword:z.string().min(12).max(72).refine(value=>Buffer.byteLength(value,'utf8')<=72),
  fields:z.array(z.string().trim().min(1).max(80)).min(1).max(6),
  dayStart:time,dayEnd:time,slotMinutes:z.union([z.literal(15),z.literal(30),z.literal(40),z.literal(45),z.literal(60),z.literal(90)]),
  userCount:z.number().int().min(1).max(100),userPrefix:z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,19}$/)
}).strict().superRefine((value,ctx)=>{
  if(minute(value.dayEnd)-minute(value.dayStart)<value.slotMinutes)ctx.addIssue({code:'custom',message:'Invalid opening interval'});
  if(new Set(value.fields.map(f=>f.toLowerCase())).size!==value.fields.length)ctx.addIssue({code:'custom',message:'Duplicate court'});
  const names=Array.from({length:value.userCount},(_,i)=>value.userPrefix+String(i+1).padStart(3,'0'));
  if(names.includes(value.managerUsername))ctx.addIssue({code:'custom',message:'Manager username conflicts with users'});
});

// Passwords are returned once to the creator for a local PDF; only hashes are stored.
export async function createVenueRegistration(input,db=root,hash=(value,cost)=>bcrypt.hash(value,cost)){
  const value=venueRegistrationSchema.parse(input);
  const id='cp-'+value.requestId.toLowerCase();
  const ref=db.collection('establishments').doc(id);
  if((await ref.get()).exists)throw Error('REGISTRATION_ALREADY_CREATED');
  const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const credentials=Array.from({length:value.userCount},(_,i)=>({username:value.userPrefix+String(i+1).padStart(3,'0'),password:Array.from({length:6},()=>alphabet[randomInt(alphabet.length)]).join('')}));
  const managerHash=await hash(value.managerPassword,12);
  const hashes=[];
  for(let i=0;i<credentials.length;i+=4)hashes.push(...await Promise.all(credentials.slice(i,i+4).map(c=>hash(c.password,10))));
  await db.runTransaction(async tx=>{
    if((await tx.get(ref)).exists)throw Error('REGISTRATION_ALREADY_CREATED');
    const createdAt=FieldValue.serverTimestamp();
    tx.create(ref,{name:value.name,city:value.city,enabled:true,visibility:'public',registrationStatus:'active',createdAt,createdBy:'self-registration',requestedUserCount:value.userCount});
    tx.create(ref.collection('admin').doc('config'),{dayStart:value.dayStart,dayEnd:value.dayEnd,slotMinutes:value.slotMinutes,maxBookingsPerUserPerDay:1,maxActiveBookingsPerUser:1,registrationEnabled:false});
    tx.create(ref.collection('admin').doc('fields'),{fields:value.fields.map((name,i)=>({id:'campo-'+(i+1),name}))});
    tx.create(ref.collection('users').doc(value.managerUsername),{passwordHash:managerHash,role:'admin',platformAdmin:false,credits:0,disabled:false,createdAt});
    credentials.forEach((c,i)=>tx.create(ref.collection('users').doc(c.username),{passwordHash:hashes[i],role:'user',platformAdmin:false,credits:0,disabled:false,createdAt}));
  });
  return {ok:true,establishmentId:id,name:value.name,status:'active',manager:{username:value.managerUsername,password:value.managerPassword},credentials};
}
