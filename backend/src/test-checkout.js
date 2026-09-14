// Sandbox-only payment core. Not mounted in the production application.
// The HTTP integration must authenticate demo ownership and verify Stripe signatures.
export function createTestCheckout({stripe, secretKey, db, connectedAccount, returnUrl}) {
  if (!/^sk_test_/.test(secretKey || '')) throw new Error('TEST_KEY_REQUIRED');
  if (!/^acct_[A-Za-z0-9]+$/.test(connectedAccount || '')) throw new Error('TEST_ACCOUNT_REQUIRED');
  const redirect = new URL(returnUrl);
  if (!['http:', 'https:'].includes(redirect.protocol) || redirect.username || redirect.password) throw new Error('BAD_RETURN_URL');
  function demoRef(venue) {
    if (!/^demo-[a-z0-9-]{1,55}$/.test(venue || '')) throw new Error('DEMO_REQUIRED');
    return db.collection('establishments').doc(venue);
  }
  return {
    async start({venue, owner, packageId, requestId}) {
      if (!/^[a-zA-Z0-9-]{8,80}$/.test(requestId || '')) throw new Error('BAD_REQUEST_ID');
      const ref=demoRef(venue);
      const orderRef=ref.collection('testOrders').doc(requestId);
      const order=await db.runTransaction(async tx=>{
        const [meta, prior, packages]=await Promise.all([tx.get(ref),tx.get(orderRef),tx.get(ref.collection('admin').doc('creditPackages'))]);
        if(!meta.data()?.enabled || meta.data().demoOwner!==owner)throw new Error('NOT_AUTHORIZED');
        if(prior.exists){if(prior.data().packageId!==packageId)throw new Error('REQUEST_CONFLICT');return prior.data();}
        const pack=packages.data()?.items?.find(p=>p.id===packageId);
        if(!pack || !Number.isInteger(pack.priceCents) || pack.priceCents<50 || pack.priceCents>1000000 || !Number.isInteger(pack.credits) || pack.credits<1 || pack.credits>10000)throw new Error('INVALID_PACKAGE');
        const value={packageId,credits:pack.credits,priceCents:pack.priceCents,title:String(pack.title).slice(0,60),status:'pending',account:connectedAccount};
        tx.create(orderRef,value);return value;
      });
      if(order.status==='paid')throw new Error('ALREADY_PAID');
      const session=await stripe.checkout.sessions.create({mode:'payment',payment_method_types:['card'],line_items:[{price_data:{currency:'eur',unit_amount:order.priceCents,product_data:{name:'DEMO · '+order.title}},quantity:1}],payment_intent_data:{application_fee_amount:Math.round(order.priceCents*0.10)},metadata:{demoVenue:venue,testOrder:requestId},success_url:returnUrl,cancel_url:returnUrl},{stripeAccount:order.account,idempotencyKey:venue+':'+requestId});
      if(session.livemode!==false || !session.url?.startsWith('https://checkout.stripe.com/'))throw new Error('INVALID_TEST_SESSION');
      return {url:session.url,id:session.id};
    },
    // Caller passes a signature-verified event, never JSON from the browser.
    async fulfillVerifiedEvent(event) {
      if(event.livemode!==false || !['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type))return false;
      const session=event.data.object;
      if(session.livemode!==false || session.payment_status!=='paid' || session.mode!=='payment')return false;
      const venue=session.metadata?.demoVenue, requestId=session.metadata?.testOrder;
      if(!/^[a-zA-Z0-9-]{8,80}$/.test(requestId || ''))return false;
      const ref=demoRef(venue);
      return db.runTransaction(async tx=>{
        const orderRef=ref.collection('testOrders').doc(requestId),userRef=ref.collection('users').doc('demo-user');
        const [meta,order,user]=await Promise.all([tx.get(ref),tx.get(orderRef),tx.get(userRef)]);
        const value=order.data();
        if(!meta.data()?.enabled || !meta.data()?.demoOwner || !value || !user.exists || user.data().disabled) return false;
        if(event.account!==value.account || session.amount_total!==value.priceCents || session.currency!=='eur')return false;
        if(value.status==='paid')return false;
        tx.update(userRef,{credits:Number(user.data().credits || 0)+value.credits});
        tx.update(orderRef,{status:'paid',sessionId:session.id});
        tx.create(ref.collection('creditLedger').doc('stripe-test-'+requestId),{user:'demo-user',delta:value.credits,reason:'Acquisto Stripe di prova',simulation:true});
        return true;
      });
    }
  };
}
