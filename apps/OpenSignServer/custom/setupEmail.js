import fs from 'node:fs';

const readTemplate = name => fs.readFileSync(new URL(`./templates/${name}`, import.meta.url), 'utf8');

/**
 * Called from the mail adapter's apiCallback in index.js before every email is sent.
 *
 * When a user was flagged with `isSetupEmail` (see sendSetupEmail.js), the password reset
 * email Parse Server is about to send is swapped for the "Set your password" welcome email.
 * The tenant's custom template (SetupEmailBody/SetupEmailSubject) is used when present,
 * otherwise the default templates in ./templates.
 *
 * Mutates `payload` in place. Never throws, so a failure here can't block outgoing mail.
 */
export async function applyCustomSetupEmail(payload) {
  try {
    const userQuery = new Parse.Query(Parse.User);
    userQuery.equalTo('email', payload.to);
    const user = await userQuery.first({ useMasterKey: true });
    if (!user?.get('isSetupEmail')) {
      return;
    }
    const linkMatch = payload.html.match(/href="([^"]+)"/);
    if (linkMatch) {
      const link = linkMatch[1];
      let customSetupBody = null;
      let customSetupSubject = null;
      try {
        const extUserQuery = new Parse.Query('contracts_Users');
        extUserQuery.equalTo('UserId', { __type: 'Pointer', className: '_User', objectId: user.id });
        extUserQuery.include('TenantId');
        const extUser = await extUserQuery.first({ useMasterKey: true });
        const tenant = extUser?.get('TenantId');
        customSetupBody = tenant?.get('SetupEmailBody');
        customSetupSubject = tenant?.get('SetupEmailSubject');
      } catch (tenantErr) {
        console.error('Error fetching tenant for setup email:', tenantErr);
      }
      if (customSetupBody) {
        payload.html = customSetupBody.replace('{{{link}}}', link).replace('{{link}}', link);
        payload.subject = customSetupSubject || readTemplate('setup_email_subject.txt').trim();
      } else {
        payload.html = readTemplate('setup_email.html').replace('{{{link}}}', link);
        payload.subject = readTemplate('setup_email_subject.txt').trim();
      }
      payload.text = readTemplate('setup_email.txt').replace('{{{link}}}', link);
    }
    user.unset('isSetupEmail');
    await user.save(null, { useMasterKey: true });
  } catch (e) {
    console.error('Error applying setup email template:', e);
  }
}
