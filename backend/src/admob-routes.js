import express from 'express';
import rateLimit from 'express-rate-limit';
import { db as root } from './db.js';
import { tenantId } from './tenancy.js';
import { requireAuth } from './permissions.js';
import { createRewardStore, REWARDED_UNIT, INTERSTITIAL_UNIT } from './admob-rewards.js';
import { verifyAdMobQuery, googleKey } from './admob-verification.js';
export const rewardStore=createRewardStore(root);
const router=express.Router();
const safe=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const enabled=()=>process.env.ADMOB_ENABLED==='true';
router.get('/status',requireAuth,safe(async(req,res)=>{
  const available=enabled() && !req.session.demoOriginal && !req.isPlatformManagement;
  res.json({available,rewardedUnit:REWARDED_UNIT,interstitialUnit:INTERSTITIAL_UNIT,...await rewardStore.status(tenantId(),req.session.user.username)});
}));
router.post('/start',rateLimit({windowMs:3600000,max:12}),requireAuth,safe(async(req,res)=>{
  if(!enabled() || req.session.demoOriginal || req.isPlatformManagement)return res.status(409).json({error:'ADS_UNAVAILABLE'});
  try {res.json({token:await rewardStore.start(tenantId(),req.session.user.username)});}
  catch(error){if(['DAILY_REWARD_LIMIT','REWARD_PENDING','ACCOUNT_CHANGED'].includes(error.message))return res.status(409).json({error:error.message});throw error;}
}));
router.post('/cancel',requireAuth,safe(async(req,res)=>{await rewardStore.cancel(tenantId(),req.session.user.username,req.body?.token);res.json({ok:true});}));
export async function admobCallback(req,res,next){
  try{
    const query=req.originalUrl.split('?')[1] || '';
    const event=await verifyAdMobQuery(query,googleKey);
    // AdMob's signed console probe uses a fixed fictitious ad unit. It never grants rewards.
    if(event.ad_unit==='1234567890' && event.custom_data==='0'.repeat(64))return res.status(200).send('Probe OK');
    await rewardStore.fulfill(event);
    res.status(200).send('OK');
  }catch(error){
    console.warn('AdMob verification rejected',error.message,JSON.stringify({unit:req.query.ad_unit,amount:req.query.reward_amount,timestamp:req.query.timestamp,parameters:Object.keys(req.query)}));
    if(['INVALID_CALLBACK','DUPLICATE_PARAMETER','INVALID_SIGNATURE','EXPIRED_CALLBACK','INVALID_TRANSACTION','UNKNOWN_KEY','INVALID_REWARD'].includes(error.message))return res.status(400).send('Invalid callback');
    next(error);
  }
}
export default router;
