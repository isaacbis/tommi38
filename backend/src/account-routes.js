import express from 'express';
import bcrypt from 'bcrypt';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { randomInt } from 'node:crypto';
import { db, tenantId } from './tenancy.js';
import { FieldValue } from './db.js';
import { requireAuth, requireAdmin } from './permissions.js';
import { requirePersonalAccount } from './management-guards.js';

const router=express.Router();
const safe=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const usernameSchema=z.string().regex(/^[a-zA-Z0-9._-]{3,40}$/);
const passwordSchema=z.string().min(12).refine(value=>Buffer.byteLength(value,'utf8')<=72);
const signupLimiter=rateLimit({windowMs:60*60*1000,max:8});
const recoveryLimiter=rateLimit({windowMs:60*60*1000,max:5});
const deletionLimiter=rateLimit({windowMs:60*60*1000,max:8});
router.post('/register',signupLimiter,safe(async(req,res)=>{
  const parsed=z.object({username:usernameSchema,password:passwordSchema}).strict().safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:'BAD_BODY'});
  const config=await db.collection('admin').doc('config').get();
  if(config.data()?.registrationEnabled!==true)return res.status(403).json({error:'REGISTRATION_CLOSED'});
  const passwordHash=await bcrypt.hash(parsed.data.password,12);
  const ref=db.collection('users').doc(parsed.data.username);
  const created=await db.runTransaction(async tx=>{
    if((await tx.get(ref)).exists)return false;
    tx.set(ref,{passwordHash,role:'user',credits:0,disabled:true,pendingApproval:true,sessionVersion:randomInt(1,2**48-1),createdAt:FieldValue.serverTimestamp()});return true;
  });
  if(!created)return res.status(409).json({error:'USERNAME_UNAVAILABLE'});
  res.status(201).json({ok:true,pendingApproval:true});
}));
router.post('/password',requireAuth,requirePersonalAccount,safe(async(req,res)=>{
  const parsed=z.object({currentPassword:z.string().min(1).max(100),newPassword:passwordSchema}).strict().safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:'BAD_BODY'});
  const ref=db.collection('users').doc(req.session.user.username);
  const account=await ref.get();
  if(!account.exists || account.data().disabled || typeof account.data().passwordHash!=='string')return res.status(409).json({error:'ACCOUNT_CHANGED'});
  if(!await bcrypt.compare(parsed.data.currentPassword,account.data().passwordHash))return res.status(403).json({error:'WRONG_PASSWORD'});
  const passwordHash=await bcrypt.hash(parsed.data.newPassword,12);
  const nextVersion=await db.runTransaction(async tx=>{
    const fresh=await tx.get(ref);
    if(!fresh.exists || fresh.data().disabled || fresh.data().passwordHash!==account.data().passwordHash ||
      Number(fresh.data().sessionVersion || 0)!==Number(req.session.user.sessionVersion || 0))return null;
    const version=Number(fresh.data().sessionVersion || 0)+1;
    tx.update(ref,{passwordHash,sessionVersion:version});return version;
  });
  if(nextVersion===null)return res.status(409).json({error:'ACCOUNT_CHANGED'});
  req.session.user.sessionVersion=nextVersion;
  res.json({ok:true});
}));
router.post('/recovery-request',recoveryLimiter,safe(async(req,res)=>{
  const parsed=z.object({username:usernameSchema}).strict().safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:'BAD_BODY'});
  await db.runTransaction(async tx=>{
    const user=await tx.get(db.collection('users').doc(parsed.data.username));
    if(user.exists && !user.data().deletionPending)tx.set(db.collection('recoveryRequests').doc(parsed.data.username),{username:parsed.data.username,status:'pending',createdAt:FieldValue.serverTimestamp()});
  });
  res.json({ok:true});
}));
router.get('/admin/recovery-requests',requireAdmin,safe(async(req,res)=>{
  const snap=await db.collection('recoveryRequests').where('status','==','pending').get();
  res.json({items:snap.docs.map(d=>({username:d.id}))});
}));
const packageSchema=z.object({id:z.string().regex(/^[a-z0-9-]{1,40}$/),title:z.string().trim().min(1).max(60),credits:z.number().int().min(1).max(10000)}).strict();
router.get('/credit-packages',requireAuth,safe(async(req,res)=>{
  const snap=await db.collection('admin').doc('creditPackages').get();
  res.json({items:snap.data()?.items || []});
}));
router.put('/admin/credit-packages',requireAdmin,safe(async(req,res)=>{
  const parsed=z.object({items:z.array(packageSchema).max(12)}).strict().safeParse(req.body);
  if(!parsed.success || new Set(parsed.data.items.map(p=>p.id)).size!==parsed.data.items.length)return res.status(400).json({error:'BAD_BODY'});
  await db.collection('admin').doc('creditPackages').set(parsed.data);res.json({ok:true});
}));
router.post('/credit-requests',requireAuth,requirePersonalAccount,safe(async(req,res)=>{
  const parsed=z.object({packageId:z.string().min(1).max(40)}).strict().safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:'BAD_BODY'});
  const ref=db.collection('creditRequests').doc(req.session.user.username);
  const error=await db.runTransaction(async tx=>{
    const [packages,current,account]=await Promise.all([tx.get(db.collection('admin').doc('creditPackages')),tx.get(ref),tx.get(db.collection('users').doc(req.session.user.username))]);
    if(!account.exists || account.data().disabled || account.data().deletionPending)return 'ACCOUNT_CHANGED';
    const pack=(packages.data()?.items || []).find(p=>p.id===parsed.data.packageId);
    if(!pack)return 'PACKAGE_NOT_FOUND';
    if(current.data()?.status==='pending')return 'REQUEST_PENDING';
    tx.set(ref,{user:req.session.user.username,packageTitle:pack.title,credits:pack.credits,status:'pending',createdAt:FieldValue.serverTimestamp()});return null;
  });
  if(error)return res.status(409).json({error});res.json({ok:true});
}));
router.get('/credit-requests',requireAuth,requirePersonalAccount,safe(async(req,res)=>{
  const snap=await db.collection('creditRequests').doc(req.session.user.username).get();
  const value=snap.data();
  res.json({item:value ? {packageTitle:value.packageTitle,credits:value.credits,status:value.status}:null});
}));
router.get('/admin/credit-requests',requireAdmin,safe(async(req,res)=>{
  const snap=await db.collection('creditRequests').where('status','==','pending').get();
  res.json({items:snap.docs.map(d=>({username:d.id,packageTitle:d.data().packageTitle,credits:d.data().credits}))});
}));
router.patch('/admin/credit-requests/:username',requireAdmin,safe(async(req,res)=>{
  const parsed=z.object({status:z.enum(['approved','rejected'])}).strict().safeParse(req.body);
  if(!parsed.success || !z.string().min(1).max(80).refine(value=>!value.includes('/')).safeParse(req.params.username).success)return res.status(400).json({error:'BAD_BODY'});
  const ref=db.collection('creditRequests').doc(req.params.username);
  const userRef=db.collection('users').doc(req.params.username);
  const error=await db.runTransaction(async tx=>{
    const [request,user]=await Promise.all([tx.get(ref),tx.get(userRef)]);
    if(!request.exists || request.data().status!=='pending')return 'REQUEST_ALREADY_HANDLED';
    if(!user.exists)return 'USER_NOT_FOUND';
    if(user.data().deletionPending)return 'ACCOUNT_CHANGED';
    if(parsed.data.status==='approved'){
      const credits=request.data().credits;
      const balance=user.data().credits ?? 0;
      if(!Number.isSafeInteger(credits) || credits<=0 || credits>10000 || !Number.isSafeInteger(balance) || balance<0 || !Number.isSafeInteger(balance+credits))return 'INVALID_CREDITS';
      tx.update(userRef,{credits:FieldValue.increment(credits)});
      tx.set(db.collection('creditLedger').doc(),{user:req.params.username,delta:credits,reason:'Ricarica: '+request.data().packageTitle,actor:req.actorId || req.session.user.username,createdAt:FieldValue.serverTimestamp()});
    }
    tx.update(ref,{status:parsed.data.status,handledBy:req.actorId || req.session.user.username,handledAt:FieldValue.serverTimestamp()});return null;
  });
  if(error)return res.status(409).json({error});res.json({ok:true});
}));

const deletionError=code=>Object.assign(new Error(code),{code});
async function assertDeletionOwner(tx,userRef,token){
  const account=await tx.get(userRef);
  if(!account.exists)throw deletionError('ACCOUNT_ALREADY_DELETED');
  if(!account.data().deletionPending || account.data().deletionToken!==token)throw deletionError('DELETION_CONTEXT_CHANGED');
}

// Each batch rechecks the locked identity. A retry cannot erase a newly created
// account with the same username, and completed batches can safely run again.
async function deleteAccountQuery(userRef,token,query,field){
  let count;
  do{
    count=await db.runTransaction(async tx=>{
      await assertDeletionOwner(tx,userRef,token);
      const snap=await tx.get(query.limit(100));
      for(const doc of snap.docs){
        if(field)tx.update(doc.ref,{[field]:null});
        else tx.delete(doc.ref);
      }
      return snap.size;
    });
  }while(count===100);
}

async function removeAccountSearch(userRef,token,searchRef,username){
  const owned=await db.runTransaction(async tx=>{
    await assertDeletionOwner(tx,userRef,token);
    const search=await tx.get(searchRef);
    if(!search.exists || search.data().ownerUser!==username)return false;
    // New participation requests must stop before removing the children.
    tx.update(searchRef,{status:'account_deleting'});
    return true;
  });
  if(!owned)return;
  let removed=false;
  while(!removed){
    await deleteAccountQuery(userRef,token,searchRef.collection('requests'));
    removed=await db.runTransaction(async tx=>{
      await assertDeletionOwner(tx,userRef,token);
      const [search,requests]=await Promise.all([tx.get(searchRef),tx.get(searchRef.collection('requests').limit(1))]);
      if(!search.exists)return true;
      if(search.data().ownerUser!==username)throw deletionError('DELETION_CONTEXT_CHANGED');
      if(!requests.empty)return false;
      tx.delete(searchRef);return true;
    });
  }
}

async function removeAccountParticipation(userRef,token,searchRef,username){
  let count;
  do{
    count=await db.runTransaction(async tx=>{
      await assertDeletionOwner(tx,userRef,token);
      const [search,requests]=await Promise.all([
        tx.get(searchRef),tx.get(searchRef.collection('requests').where('requesterUser','==',username).limit(100))
      ]);
      const released=requests.docs.reduce((sum,doc)=>sum+(doc.data().status==='accepted'?Number(doc.data().count || 0):0),0);
      for(const doc of requests.docs)tx.delete(doc.ref);
      if(search.exists && released){
        const value=search.data(),spotsFilled=Math.max(0,Number(value.spotsFilled || 0)-released);
        tx.update(searchRef,{spotsFilled,status:value.status==='full' && spotsFilled<Number(value.spotsNeeded || 0)?'open':value.status || 'open'});
      }
      return requests.size;
    });
  }while(count===100);
}

async function finishAccountDeletion(userRef,token,username){
  const ownSearches=await db.collection('playerSearches').where('ownerUser','==',username).get();
  for(const search of ownSearches.docs)await removeAccountSearch(userRef,token,search.ref,username);
  const remainingSearches=await db.collection('playerSearches').get();
  for(const search of remainingSearches.docs)await removeAccountParticipation(userRef,token,search.ref,username);
  for(const collection of ['reservations','reservationHistory','creditLedger','waitlist']){
    await deleteAccountQuery(userRef,token,db.collection(collection).where('user','==',username));
  }
  for(const [collection,field] of [
    ['communityBlocks','firstUser'],['communityBlocks','secondUser'],
    ['communityReports','reporterUser'],['communityReports','reportedUser']
  ])await deleteAccountQuery(userRef,token,db.collection(collection).where(field,'==',username));

  // Preserve other people's records while removing attribution to this account.
  for(const [collection,field] of [
    ['users','createdBy'],['reservations','createdBy'],['reservationHistory','createdBy'],
    ['reservationHistory','cancelledBy'],['creditLedger','actor'],['creditRequests','handledBy'],
    ['adminAudit','actor'],['adminAudit','user'],['communityReports','resolvedBy']
  ]){
    for(const actor of [username,'platform:'+username]){
      await deleteAccountQuery(userRef,token,db.collection(collection).where(field,'==',actor),field);
    }
  }
  await db.runTransaction(async tx=>{
    await assertDeletionOwner(tx,userRef,token);
    for(const collection of ['creditRequests','recoveryRequests','accountDeletionRequests'])tx.delete(db.collection(collection).doc(username));
    tx.delete(userRef);
  });
}

router.delete('/account',deletionLimiter,safe(async(req,res)=>{
  const parsed=z.object({
    username:z.string().min(1).max(80).refine(value=>!value.includes('/')),
    currentPassword:z.string().min(1).max(100),confirm:z.literal(true)
  }).strict().safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:'BAD_BODY'});
  if(req.session?.managementEstablishment)return res.status(403).json({error:'MANAGEMENT_CONTEXT_ONLY'});
  const {username,currentPassword}=parsed.data;
  const sessionUser=req.session?.user;
  if(sessionUser && (sessionUser.username!==username || (sessionUser.establishment || 'tommi38')!==tenantId()))return res.status(403).json({error:'NOT_AUTHORIZED'});
  const userRef=db.collection('users').doc(username);
  const account=await userRef.get();
  if(!account.exists || typeof account.data().passwordHash!=='string' || !await bcrypt.compare(currentPassword,account.data().passwordHash))return res.status(403).json({error:'WRONG_PASSWORD'});
  const requestRef=db.collection('accountDeletionRequests').doc(username);
  const locked=await db.runTransaction(async tx=>{
    const fresh=await tx.get(userRef);
    if(!fresh.exists)return {deleted:true};
    if(fresh.data().passwordHash!==account.data().passwordHash)return {error:'ACCOUNT_CHANGED'};
    const user=fresh.data();
    if(user.deletionPending && user.deletionToken)return {token:user.deletionToken};
    if(user.platformAdmin===true && tenantId()==='tommi38'){
      tx.set(requestRef,{username,status:'platform_handoff_required',createdAt:FieldValue.serverTimestamp()});
      return {error:'PLATFORM_HANDOFF_REQUIRED',requested:true};
    }
    if(user.role==='admin'){
      const managers=await tx.get(db.collection('users').where('role','==','admin'));
      if(!managers.docs.some(doc=>doc.id!==username && !doc.data().disabled && !doc.data().deletionPending)){
        tx.set(requestRef,{username,status:'manager_handoff_required',createdAt:FieldValue.serverTimestamp()});
        return {error:'MANAGER_HANDOFF_REQUIRED',requested:true};
      }
    }
    const token=String(randomInt(1,2**48-1));
    tx.update(userRef,{deletionPending:true,deletionToken:token,disabled:true,sessionVersion:FieldValue.increment(1)});
    tx.set(requestRef,{username,status:'processing',createdAt:FieldValue.serverTimestamp()});
    return {token};
  });
  if(locked.error)return res.status(locked.requested?409:400).json(locked);
  try{if(!locked.deleted)await finishAccountDeletion(userRef,locked.token,username);}
  catch(error){
    if(error.code!=='ACCOUNT_ALREADY_DELETED'){
      if(error.code==='DELETION_CONTEXT_CHANGED')return res.status(409).json({error:error.code});
      return res.status(503).json({error:'DELETION_RETRY_REQUIRED',pending:true});
    }
  }
  if(req.session?.user)delete req.session.user;
  if(typeof req.session?.destroy==='function')await new Promise(resolve=>req.session.destroy(()=>resolve()));
  res.clearCookie?.(process.env.SESSION_COOKIE_NAME || 'tommi38sid',{path:'/'});
  res.json({ok:true,deleted:true});
}));
export default router;
