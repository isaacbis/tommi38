// A central administrator keeps their original identity when managing a venue.
// Personal actions must never act on an unrelated local account with the same name.
export function requirePersonalAccount(req,res,next) {
  if(req.isPlatformManagement)return res.status(403).json({error:'MANAGEMENT_CONTEXT_ONLY'});
  next();
}
