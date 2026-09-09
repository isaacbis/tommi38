// One-time appointment explicitly requested by the owner for the legacy account
// "admin". This never creates an account, changes credentials or appoints a tenant
// manager. A completed marker prevents restarts from undoing a later revocation.
export async function appointInitialPlatformAdmin(root, timestamp) {
  return root.runTransaction(async transaction => {
    const marker = root.collection('_migrations').doc('platform-admin-2026-09-09');
    const user = root.collection('users').doc('admin');
    const [completed, account, appointed] = await Promise.all([
      transaction.get(marker), transaction.get(user),
      transaction.get(root.collection('users').where('platformAdmin', '==', true))
    ]);
    if (completed.exists) return 'already_applied';
    if (!account.exists || account.data().disabled || account.data().role !== 'admin') return 'account_not_eligible';
    if (appointed.docs.some(doc => doc.id !== 'admin')) return 'existing_administrator';
    transaction.update(user, { platformAdmin: true });
    transaction.set(marker, { username: 'admin', appliedAt: timestamp() });
    return 'applied';
  });
}
