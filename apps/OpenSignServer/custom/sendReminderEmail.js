import fs from 'node:fs';
import { cloudServerUrl, replaceMailVaribles, serverAppId } from '../Utils.js';
import axios from 'axios';
import crypto from 'crypto';

const serverUrl = cloudServerUrl;
const appId = serverAppId;

function toBase64(str) {
  return Buffer.from(str, 'utf8').toString('base64');
}

/**
 * sendReminderEmail - Parse Cloud Function
 *
 * Sends reminder emails to unsigned signers for a given document.
 *
 * Params:
 *   documentId {string}          - Required. The objectId of the contracts_Document.
 *   signerEmails {string[]}      - Optional. Specific signer emails to remind.
 *                                  If omitted, all unsigned signers are reminded.
 *   publicUrl {string}           - Optional. Override for the public app URL used
 *                                  to build signing links (defaults to SERVER_URL env var).
 *
 * Auth:
 *   Accepts either a valid user session OR a master key (for cron job use).
 */
export default async function sendReminderEmail(request) {
  if (!request.user && !request.master) {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'Authentication required.');
  }

  const { documentId, signerEmails, publicUrl: paramPublicUrl } = request.params;
  if (!documentId) {
    throw new Parse.Error(Parse.Error.INVALID_QUERY, 'documentId is required.');
  }

  // Fetch the document with sender/tenant info
  const docQuery = new Parse.Query('contracts_Document');
  docQuery.include('ExtUserPtr');
  docQuery.include('ExtUserPtr.TenantId');
  docQuery.include('Signers');
  const doc = await docQuery.get(documentId, { useMasterKey: true });
  if (!doc) {
    throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Document not found.');
  }

  // Authorise: if called with a user session, verify they own the document
  if (request.user && !request.master) {
    const extUserQuery = new Parse.Query('contracts_Users');
    extUserQuery.equalTo('UserId', request.user);
    const extUser = await extUserQuery.first({ useMasterKey: true });
    if (!extUser || extUser.id !== doc.get('ExtUserPtr')?.id) {
      throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'You do not own this document.');
    }
  }

  const docJson = doc.toJSON();
  const senderObj = doc.get('ExtUserPtr');
  const senderName = senderObj?.get('Name') || '';
  const senderEmail = senderObj?.get('Email') || '';
  const senderPhone = senderObj?.get('Phone') || '';
  const documentTitle = doc.get('Name') || '';
  const orgName = senderObj?.get('Company') || '';

  // Compute expiry date the same way the request email does
  const timeToCompleteDays = doc.get('TimeToCompleteDays') || 15;
  const expireDate = new Date(doc.get('createdAt'));
  expireDate.setDate(expireDate.getDate() + timeToCompleteDays);
  const localExpireDate = expireDate.toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  // Determine which signers need a reminder
  const auditTrail = doc.get('AuditTrail') || [];
  const signedEmails = new Set(
    auditTrail.filter(a => a.Activity === 'Signed').map(a => a.Email?.toLowerCase())
  );
  const placeholders = (doc.get('Placeholders') || []).filter(p => p.Role !== 'prefill');
  const signers = doc.get('Signers') || [];

  // Build the set of unsigned signers to email
  let targets = placeholders
    .map(ph => {
      const objectId = ph.signerObjId;
      // Signers are included Parse.Objects (id / get()); placeholders created by
      // OpenSign v2.41+ no longer carry `email`, so the signer is the source of truth.
      const existSigner = signers.find(s => (s.id || s.objectId) === objectId);
      const email = existSigner?.get?.('Email') || existSigner?.Email || ph.email || '';
      return { ph, existSigner: existSigner || {}, objectId, email };
    })
    .filter(({ email }) => email && !signedEmails.has(email.toLowerCase()));

  if (signerEmails && signerEmails.length > 0) {
    const filterSet = new Set(signerEmails.map(e => e.toLowerCase()));
    targets = targets.filter(t => filterSet.has(t.email.toLowerCase()));
  }

  if (targets.length === 0) {
    return { sent: 0, message: 'No unsigned signers to remind.' };
  }

  // Resolve names for signers not present in the Signers array by looking up the contactbook
  const emailsNeedingLookup = targets
    .filter(t => !(t.existSigner?.Name || t.existSigner?.get?.('Name')))
    .map(t => t.email);

  const contactNameMap = {};
  if (emailsNeedingLookup.length > 0) {
    const contactQuery = new Parse.Query('contracts_Contactbook');
    contactQuery.containedIn('Email', emailsNeedingLookup);
    contactQuery.select('Email', 'Name');
    const contacts = await contactQuery.find({ useMasterKey: true });
    for (const c of contacts) {
      contactNameMap[c.get('Email')?.toLowerCase()] = c.get('Name') || '';
    }
  }

  // Load the tenant's custom reminder template (or fall back to the default files)
  const tenant = senderObj?.get('TenantId');
  const customBody = tenant?.get('ReminderEmailBody') || '';
  const customSubject = tenant?.get('ReminderEmailSubject') || '';

  const defaultSubject = fs
    .readFileSync(new URL('./templates/reminder_email_subject.txt', import.meta.url), 'utf8')
    .trim();
  const defaultHtmlBody = fs.readFileSync(
    new URL('./templates/reminder_email.html', import.meta.url),
    'utf8'
  );

  const baseUrl = paramPublicUrl || process.env.SERVER_URL || serverUrl;
  const hostUrl = (() => {
    try {
      return new URL(baseUrl).origin;
    } catch {
      return baseUrl;
    }
  })();

  const headers = { 'Content-Type': 'application/json', 'X-Parse-Application-Id': appId };
  const mailUrl = `${serverUrl}/functions/sendmailv3`;

  let sentCount = 0;
  const errors = [];

  for (const { existSigner, objectId, email } of targets) {
    try {
      let encodeBase64;
      if (objectId) {
        encodeBase64 = toBase64(`${documentId}/${email}/${objectId}`);
      } else {
        encodeBase64 = toBase64(`${documentId}/${email}`);
      }
      const signingUrl = `${hostUrl}/login/${encodeBase64}`;

      const variables = {
        document_title: documentTitle,
        note: doc.get('Note') || '',
        sender_name: senderName,
        sender_mail: senderEmail,
        sender_phone: senderPhone,
        receiver_name: existSigner.Name || existSigner.get?.('Name') || contactNameMap[email.toLowerCase()] || '',
        receiver_email: email,
        receiver_phone: existSigner.Phone || existSigner.get?.('Phone') || '',
        expiry_date: localExpireDate,
        company_name: orgName,
        signing_url: signingUrl,
      };

      let subjectToUse = customSubject || defaultSubject;
      let bodyToUse;

      if (customBody) {
        const wrapped =
          "<html><head><meta http-equiv='Content-Type' content='text/html; charset=UTF-8' /></head><body>" +
          customBody.replace(/"/g, "'") +
          '</body></html>';
        const replaced = replaceMailVaribles(subjectToUse, wrapped, variables);
        subjectToUse = replaced.subject;
        bodyToUse = replaced.body;
      } else {
        const replaced = replaceMailVaribles(subjectToUse, defaultHtmlBody, variables);
        subjectToUse = replaced.subject;
        bodyToUse = replaced.body;
      }

      await axios.post(
        mailUrl,
        {
          extUserId: senderObj?.id,
          recipient: email,
          subject: subjectToUse,
          from: senderEmail,
          replyto: senderEmail,
          html: bodyToUse,
        },
        { headers }
      );
      sentCount++;
    } catch (err) {
      console.error(`Error sending reminder to ${email}:`, err.message);
      errors.push({ email, error: err.message });
    }
  }

  return {
    sent: sentCount,
    failed: errors.length,
    errors: errors.length > 0 ? errors : undefined,
  };
}
