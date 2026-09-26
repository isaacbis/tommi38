import { createHash, randomBytes } from 'node:crypto';
export const REWARDED_UNIT = 'ca-app-pub-5793073160443124/7248847275';
export const INTERSTITIAL_UNIT = 'ca-app-pub-5793073160443124/2680912264';
const hasEarned = progress => progress?.earned === true || Number(progress?.videos || 0) >= 2;
const hash = value => createHash('sha256').update(value).digest('hex');
export const rewardDay = time => new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(time));
export function createRewardStore(root, now = () => Date.now()) {
  const users = venue => venue === 'tommi38' ? root.collection('users') : root.collection('establishments').doc(venue).collection('users');
  const daily = (venue,user,day) => root.collection('admobDaily').doc(hash(venue+'\0'+user+'\0'+day));
  const status = async (venue,user) => {
    const snap = await daily(venue,user,rewardDay(now())).get();
    const videos = Math.min(2,Number(snap.data()?.videos || 0));
    const earned = hasEarned(snap.data());
    return {videos,remainingVideos:earned?0:1,earned};
  };
  async function start(venue,user) {
    if (venue.startsWith('demo-')) throw Error('DEMO_UNSUPPORTED');
    const token = randomBytes(32).toString('hex');
    const tokenRef = root.collection('admobAttempts').doc(hash(token));
    const day = rewardDay(now());
    await root.runTransaction(async tx => {
      const account = await tx.get(users(venue).doc(user));
      const progress = await tx.get(daily(venue,user,day));
      if (!account.exists || account.data().disabled || account.data().deletionPending) throw Error('ACCOUNT_CHANGED');
      if (hasEarned(progress.data())) throw Error('DAILY_REWARD_LIMIT');
      // Reuse an in-flight slot only after its one-hour expiry; no unbounded attempts.
      if (progress.data()?.pendingUntil > now()) throw Error('REWARD_PENDING');
      tx.set(tokenRef,{venue,user,day,createdAt:now(),expiresAt:now()+3600000,sessionVersion:Number(account.data().sessionVersion || 0),ownerKey:venue+":"+user,used:false});
      tx.set(daily(venue,user,day),{...progress.data(),ownerKey:venue+":"+user,videos:Number(progress.data()?.videos || 0),pendingUntil:now()+3600000,attempt:hash(token)});
    });
    return token;
  }
  async function cancel(venue,user,token) {
    if (!/^[a-f0-9]{64}$/.test(token || '')) return;
    const ref=root.collection('admobAttempts').doc(hash(token));
    await root.runTransaction(async tx=>{
      const attempt=await tx.get(ref);const a=attempt.data();
      if(!a || a.venue!==venue || a.user!==user || a.used)return;
      const d=daily(venue,user,a.day);const progress=await tx.get(d);
      // Release the slot but keep the attempt valid for a delayed signed reward.
      if(progress.data()?.attempt===ref.id)tx.update(d,{pendingUntil:0});
    });
  }
  async function fulfill(event) {
    if (![REWARDED_UNIT,REWARDED_UNIT.split('/')[1]].includes(event.ad_unit) || event.reward_amount!=='1' || !/^[a-f0-9]{64}$/.test(event.custom_data || '')) throw Error('INVALID_REWARD');
    const ref=root.collection('admobAttempts').doc(hash(event.custom_data));
    const eventRef=root.collection('admobTransactions').doc(hash(event.transaction_id));
    return root.runTransaction(async tx=>{
      const previous=await tx.get(eventRef);
      if(previous.exists)return {duplicate:true};
      const attempt=await tx.get(ref);const a=attempt.data();
      if(!a || a.used || a.venue.startsWith('demo-'))return {ignored:true};
      const timestamp=Number(event.timestamp);
      if(timestamp<a.createdAt-60000 || timestamp>a.expiresAt || rewardDay(timestamp)!==a.day)return {ignored:true};
      const userRef=users(a.venue).doc(a.user);
      const dayRef=daily(a.venue,a.user,a.day);
      const account=await tx.get(userRef);
      const progress=await tx.get(dayRef);
      const venue=await tx.get(root.collection('establishments').doc(a.venue));
      if(!account.exists || account.data().disabled || account.data().deletionPending || Number(account.data().sessionVersion||0)!==a.sessionVersion || (venue.exists && venue.data().enabled===false))return {ignored:true};
      const videos=Math.min(2,Number(progress.data()?.videos||0)+1);
      const grant=!hasEarned(progress.data());
      tx.set(eventRef,{attempt:ref.id,at:now()});
      tx.update(ref,{used:true});
      tx.set(dayRef,{ownerKey:a.venue+":"+a.user,videos,earned:true,pendingUntil:0,attempt:null});
      if(grant){
        tx.update(userRef,{credits:Number(account.data().credits||0)+1});
        const ledger=a.venue==='tommi38'?root.collection('creditLedger'):root.collection('establishments').doc(a.venue).collection('creditLedger');
        tx.set(ledger.doc('admob-'+dayRef.id),{user:a.user,delta:1,reason:'Premio: 1 video verificato',createdAt:new Date(now())});
      }
      return {granted:grant,videos};
    });
  }
  return {status,start,cancel,fulfill};
}
