import Stripe from 'stripe';
import {db} from './db.js';
import {createTestCheckout} from './test-checkout.js';
export function sandbox(){
 const key=process.env.STRIPE_TEST_SECRET_KEY;
 const account=process.env.STRIPE_TEST_CONNECTED_ACCOUNT;
 if(!key?.startsWith('sk_test_') || !account)return null;
 const stripe=new Stripe(key,{timeout:15000,maxNetworkRetries:1});
 return {stripe,account,service:createTestCheckout({stripe,secretKey:key,db,connectedAccount:account,returnUrl:'https://tommi38.onrender.com/'})};
}
