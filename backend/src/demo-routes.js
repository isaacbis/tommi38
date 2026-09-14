import express from 'express';
import { createHash } from 'node:crypto';
import { db } from './db.js';
import { readSessionIdentity } from './authorization.js';

const router=express.Router();
const safe=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
async function owner(req){
  const user=req.session.demoOriginal?.user || req.session.user;
  const identity=await readSessionIdentity({session:{user}});
  return identity && (identity.platformAdmin || identity.account.role==='admin') ? identity : null;
}
router.post('/enter',safe(async(req,res)=>{
  const identity=await owner(req);
  if(!identity)return res.status(403).json({error:'NOT_AUTHORIZED'});
  const role=req.body.role;
  if(!['admin','user'].includes(role))return res.status(400).json({error:'BAD_BODY'});
  const id='demo-'+createHash('sha256').update(identity.origin+'\0'+identity.username).digest('hex').slice(0,40);
  const ref=db.collection('establishments').doc(id);
  await db.runTransaction(async tx=>{
    const snap=await tx.get(ref);
    if(snap.exists){
      if(snap.data().demoOwner!==identity.origin+':'+identity.username)throw Error('Demo ownership mismatch');
      return;
    }
    tx.create(ref,{name:'La tua demo',enabled:true,visibility:'private',demoOwner:identity.origin+':'+identity.username});
    tx.create(ref.collection('admin').doc('config'),{slotMinutes:45,dayStart:'09:00',dayEnd:'20:00',maxBookingsPerUserPerDay:3,maxActiveBookingsPerUser:5});
    tx.create(ref.collection('admin').doc('fields'),{fields:[{id:'volley-demo',name:'Volley demo'},{id:'tennis-demo',name:'Tennis demo'}]});
    for(const [username,userRole]of [['demo-manager','admin'],['demo-user','user']])tx.create(ref.collection('users').doc(username),{role:userRole,credits:100,disabled:false,platformAdmin:false,sessionVersion:0});
  });
  if(!req.session.demoOriginal)req.session.demoOriginal={user:{...req.session.user},managementEstablishment:req.session.managementEstablishment || null};
  req.session.user={username:role==='admin'?'demo-manager':'demo-user',role,establishment:id,sessionVersion:0};
  delete req.session.managementEstablishment;
  res.json({ok:true,establishmentId:id});
}));
router.post('/exit',safe(async(req,res)=>{
  if(!req.session.demoOriginal)return res.status(400).json({error:'NO_DEMO_SESSION'});
  if(!await owner(req))return res.status(403).json({error:'NOT_AUTHORIZED'});
  const original=req.session.demoOriginal;
  req.session.user=original.user;
  if(original.managementEstablishment)req.session.managementEstablishment=original.managementEstablishment;
  else delete req.session.managementEstablishment;
  delete req.session.demoOriginal;
  res.json({ok:true,establishmentId:original.managementEstablishment || original.user.establishment || 'tommi38'});
}));
export default router;
