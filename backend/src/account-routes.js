import express from 'express';
import bcrypt from 'bcrypt';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { db } from './tenancy.js';
import { FieldValue } from './db.js';
import { requireAuth, requireAdmin } from './permissions.js';

const router=express.Router();
const safe=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const usernameSchema=z.string().regex(/^[a-zA-Z0-9._-]{3,40}$/);
const passwordSchema=z.string().min(12).refine(value=>Buffer.byteLength(value,'utf8')<=72);
const signupLimiter=rateLimit({windowMs:60*60*1000,max:8});
const recoveryLimiter=rateLimit({windowMs:60*60*1000,max:5});
router.post('/register',signupLimiter,safe(async(req,res)=>{
  const parsed=z.object({username:usernameSchema,password:passwordSchema}).strict().safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:'BAD_BODY'});
  const config=await db.collection('admin').doc('config').get();
  if(config.data()?.registrationEnabled!==true)return res.status(403).json({error:'REGISTRATION_CLOSED'});
  const passwordHash=await bcrypt.hash(parsed.data.password,12);
  const ref=db.collection('users').doc(parsed.data.username);
  const created=await db.runTransaction(async tx=>{
    if((await tx.get(ref)).exists)return false;
    tx.set(ref,{passwordHash,role:'user',credits:0,disabled:true,pendingApproval:true,sessionVersion:0,createdAt:FieldValue.serverTimestamp()});return true;
  });
  if(!created)return res.status(409).json({error:'USERNAME_UNAVAILABLE'});
  res.status(201).json({ok:true,pendingApproval:true});
}));
router.post('/password',requireAuth,safe(async(req,res)=>{
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
  if(nextVersion===null)return res.status(409).json({error:'ACCOUNT_CHANGED'});
  req.session.user.sessionVersion=nextVersion;
  res.json({ok:true});
}));
router.post('/recovery-request',recoveryLimiter,safe(async(req,res)=>{
  const parsed=z.object({username:usernameSchema}).strict().safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:'BAD_BODY'});
  const user=await db.collection('users').doc(parsed.data.username).get();
  if(user.exists) await db.collection('recoveryRequests').doc(parsed.data.username).set({username:parsed.data.username,status:'pending',createdAt:FieldValue.serverTimestamp()});
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
router.post('/credit-requests',requireAuth,safe(async(req,res)=>{
  const parsed=z.object({packageId:z.string().min(1).max(40)}).strict().safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:'BAD_BODY'});
  const ref=db.collection('creditRequests').doc(req.session.user.username);
  const error=await db.runTransaction(async tx=>{
    const [packages,current]=await Promise.all([tx.get(db.collection('admin').doc('creditPackages')),tx.get(ref)]);
    const pack=(packages.data()?.items || []).find(p=>p.id===parsed.data.packageId);
    if(!pack)return 'PACKAGE_NOT_FOUND';
    if(current.data()?.status==='pending')return 'REQUEST_PENDING';
    tx.set(ref,{user:req.session.user.username,packageTitle:pack.title,credits:pack.credits,status:'pending',createdAt:FieldValue.serverTimestamp()});return null;
  });
  if(error)return res.status(409).json({error});res.json({ok:true});
}));
router.get('/credit-requests',requireAuth,safe(async(req,res)=>{
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
  if(!parsed.success || typeof req.params.username!=='string' || !req.params.username || req.params.username.includes('/') || Buffer.byteLength(req.params.username,'utf8')>1500)return res.status(400).json({error:'BAD_BODY'});
  if(!z.string().min(1).max(80).refine(value=>!value.includes('/')).safeParse(req.params.username).success)return res.status(400).json({error:'BAD_BODY'});
  const ref=db.collection('creditRequests').doc(req.params.username);
  const userRef=db.collection('users').doc(req.params.username);
  const error=await db.runTransaction(async tx=>{
    const [request,user]=await Promise.all([tx.get(ref),tx.get(userRef)]);
    if(!request.exists || request.data().status!=='pending')return 'REQUEST_ALREADY_HANDLED';
    if(!user.exists)return 'USER_NOT_FOUND';
    if(parsed.data.status==='approved'){
      const credits=request.data().credits;
      const balance=user.data().credits ?? 0;
      if(!Number.isSafeInteger(credits) || credits<=0 || !Number.isSafeInteger(balance) || balance<0 || !Number.isSafeInteger(balance+credits))return 'INVALID_CREDITS';
      tx.update(userRef,{credits:FieldValue.increment(credits)});
      tx.set(db.collection('creditLedger').doc(),{user:req.params.username,delta:credits,reason:'Ricarica: '+request.data().packageTitle,actor:req.session.user.username,createdAt:FieldValue.serverTimestamp()});
    }
    tx.update(ref,{status:parsed.data.status,handledBy:req.session.user.username,handledAt:FieldValue.serverTimestamp()});return null;
  });
  if(error)return res.status(409).json({error});res.json({ok:true});
}));
export default router;
