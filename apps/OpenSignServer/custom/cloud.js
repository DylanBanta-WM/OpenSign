// West Muskingum cloud functions. Imported once from cloud/main.js.
// Function names are called by external automations (n8n) — don't rename them.
import sendSetupEmail from './sendSetupEmail.js';
import sendReminderEmail from './sendReminderEmail.js';
import updateCustomEmailTemplates from './updateCustomEmailTemplates.js';

Parse.Cloud.define('sendsetupemail', sendSetupEmail);
Parse.Cloud.define('sendreminderemail', sendReminderEmail);
Parse.Cloud.define('updatecustomemailtemplates', updateCustomEmailTemplates);
