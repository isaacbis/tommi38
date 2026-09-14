import express from 'express';
import { createHash } from 'node:crypto';
import { db } from './db.js';
import { validEstablishmentId, readSessionIdentity } from './authorization.js';

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
  if(req.body.copySettings!==undefined && typeof req.body.copySettings!=='boolean')return res.status(400).json({error:'BAD_BODY'});
  if(req.body.copySettings && req.body.reset!==true)return res.status(400).json({error:'BAD_BODY'});
  let copiedConfig=null,copiedFields=null;
  if(req.body.copySettings){
    const original=req.session.demoOriginal || req.session;
    const source=identity.platformAdmin?(original.managementEstablishment || identity.origin):identity.origin;
    if(!validEstablishmentId(source))return res.status(400).json({error:'BAD_BODY'});
    const sourceDb=source==='tommi38'?db:db.collection('establishments').doc(source);
    const [config,fields]=await Promise.all([sourceDb.collection('admin').doc('config').get(),sourceDb.collection('admin').doc('fields').get()]);
    copiedConfig={};
    for(const key of ['slotMinutes','dayStart','dayEnd','maxBookingsPerUserPerDay','maxActiveBookingsPerUser'])if(config.data()?.[key]!==undefined)copiedConfig[key]=config.data()[key];
    if(Array.isArray(fields.data()?.fields))copiedFields={fields:fields.data().fields.map(({id,name})=>({id,name}))};
  }
  const base='demo-'+createHash('sha256').update(identity.origin+'\0'+identity.username).digest('hex').slice(0,40);
  const pointer=db.collection('demoWorkspaces').doc(base);
  const id=await db.runTransaction(async tx=>{
    const current=await tx.get(pointer);
    const generation=Number(current.data()?.generation || 0)+(req.body.reset===true?1:0);
    const id=generation?base+'-r'+generation:base;
    const ref=db.collection('establishments').doc(id);
    const snap=await tx.get(ref);
    const previous=req.body.reset===true?await tx.get(db.collection('establishments').doc(current.data()?.id || base)):null;
    if(snap.exists){
      if(snap.data().demoOwner!==identity.origin+':'+identity.username)throw Error('Demo ownership mismatch');
      return id;
    }
    if(previous?.exists)tx.update(previous.ref,{enabled:false});
    tx.set(pointer,{id,generation});
    tx.create(ref,{name:'La tua demo',enabled:true,visibility:'private',demoOwner:identity.origin+':'+identity.username});
    tx.create(ref.collection('admin').doc('config'),{slotMinutes:45,dayStart:'09:00',dayEnd:'20:00',maxBookingsPerUserPerDay:3,maxActiveBookingsPerUser:5,...copiedConfig});
    tx.create(ref.collection('admin').doc('fields'),copiedFields || {fields:[{id:'volley-demo',name:'Volley demo'},{id:'tennis-demo',name:'Tennis demo'}]});
    for(const [username,userRole]of [['demo-manager','admin'],['demo-user','user']])tx.create(ref.collection('users').doc(username),{role:userRole,credits:100,disabled:false,platformAdmin:false,sessionVersion:0});
    return id;
  });
  if(!req.session.demoOriginal)req.session.demoOriginal={user:{...req.session.user},managementEstablishment:req.session.managementEstablishment || null};
  req.session.user={username:role==='admin'?'demo-manager':'demo-user',role,establishment:id,sessionVersion:0};
  delete req.session.managementEstablishment;
  res.json({ok:true,establishmentId:id});
}));
// Demo actions never accept a target venue or username from the client.
router.post('/simulate',safe(async(req,res)=>{
  const identity=await owner(req);
  if(!identity || !req.session.demoOriginal)return res.status(403).json({error:'NOT_AUTHORIZED'});
  const {action,requestId}=req.body;
  if(!['purchase','video'].includes(action) || typeof requestId!=='string' || !/^[a-zA-Z0-9-]{8,80}$/.test(requestId))return res.status(400).json({error:'BAD_BODY'});
  const ref=db.collection('establishments').doc(req.session.user.establishment);
  const result=await db.runTransaction(async tx=>{
    const venue=await tx.get(ref);
    if(!venue.exists || !venue.data().enabled || venue.data().demoOwner!==identity.origin+':'+identity.username)return null;
    const receiptRef=ref.collection('demoOperations').doc(requestId);
    const receipt=await tx.get(receiptRef);
    if(receipt.exists)return receipt.data();
    const userRef=ref.collection('users').doc('demo-user');
    const user=await tx.get(userRef);
    const pending=Number(user.data().demoPendingVideos || 0);
    const added=action==='purchase'?5:(pending===1?1:0);
    const credits=Number(user.data().credits || 0)+added;
    const pendingVideos=action==='video'?(pending===1?0:1):pending;
    const result={action,credits,added,pendingVideos,simulation:true};
    tx.update(userRef,{credits,demoPendingVideos:pendingVideos});
    tx.create(receiptRef,result);
    return result;
  });
  if(!result)return res.status(403).json({error:'NOT_AUTHORIZED'});
  res.json(result);
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
