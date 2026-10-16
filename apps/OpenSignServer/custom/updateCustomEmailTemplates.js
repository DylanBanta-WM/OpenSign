const validKeys = ['SetupEmailBody', 'SetupEmailSubject', 'ReminderEmailBody', 'ReminderEmailSubject'];

/**
 * Saves the West Muskingum-specific email templates (setup + reminder) on the tenant.
 * Kept separate from upstream's updatetenant so upstream can change that function freely.
 *
 * Params: tenantId, details: { SetupEmailBody?, SetupEmailSubject?, ReminderEmailBody?, ReminderEmailSubject? }
 * Only admins of the tenant may call it.
 */
export default async function updateCustomEmailTemplates(request) {
  const { tenantId, details } = request.params;

  if (!tenantId || !details) {
    throw new Parse.Error(400, 'Missing tenantId or details.');
  }
  if (!request.user) {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'unauthorized');
  }

  // Derive the caller's tenant and role server-side; never trust the client-supplied tenantId.
  const callerQuery = new Parse.Query('contracts_Users');
  callerQuery.equalTo('UserId', { __type: 'Pointer', className: '_User', objectId: request.user.id });
  callerQuery.notEqualTo('IsDisabled', true);
  const callerExtUser = await callerQuery.first({ useMasterKey: true });
  if (!callerExtUser) {
    throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'User not found.');
  }
  const callerRole = callerExtUser.get('UserRole');
  if (callerRole !== 'contracts_Admin' && callerRole !== 'contracts_OrgAdmin') {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Unauthorized.');
  }
  if (callerExtUser.get('TenantId')?.id !== tenantId) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Unauthorized.');
  }

  const tenant = new Parse.Object('partners_Tenant');
  tenant.id = tenantId;
  Object.keys(details).forEach(key => {
    if (validKeys.includes(key)) {
      if (details[key] !== undefined) {
        tenant.set(key, details[key]);
      } else {
        tenant.unset(key);
      }
    }
  });
  const tenantRes = await tenant.save(null, { useMasterKey: true });
  return JSON.parse(JSON.stringify(tenantRes));
}
