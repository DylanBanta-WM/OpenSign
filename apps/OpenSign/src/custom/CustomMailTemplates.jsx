// West Muskingum: editors for the Setup and Reminder email templates, shown on
// Preferences > Email below upstream's request/completion editors.
// Saved on the tenant via the custom `updatecustomemailtemplates` cloud function.
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import Parse from "parse";
import { useDispatch } from "react-redux";
import Tooltip from "../primitives/Tooltip";
import Alert from "../primitives/Alert";
import Loader from "../primitives/Loader";
import EmailBodyEditor from "../components/EmailBodyEditor";
import { withSessionValidation } from "../utils";
import { setTenantInfo } from "../redux/reducers/userReducer";

const appName = localStorage.getItem("appname") || "OpenSign™";
const reminderVariables =
  "{{document_title}}, {{sender_name}}, {{sender_mail}}, {{sender_phone}}, {{receiver_name}}, {{receiver_email}}, {{receiver_phone}}, {{expiry_date}}, {{company_name}}, {{signing_url}}";

const templates = [
  {
    key: "setup",
    title: "Setup Email",
    bodyField: "SetupEmailBody",
    subjectField: "SetupEmailSubject",
    defaultSubject: `Welcome to ${appName} - Set Your Password`,
    defaultBody: `<p>Welcome to ${appName}!</p><br><p>Your account has been created by your administration. Click the button below to set your password and get started.</p><br><p><a href='{{link}}' rel='noopener noreferrer' target='_blank'>Set Your Password</a></p><br><p>If you did not expect this email, please contact your system administrator.</p>`,
    subjectHelp:
      "Sent when a new user account is created. Use {{link}} as the password setup link placeholder.",
    bodyHelp: "Use {{link}} where the password setup button/link should appear.",
    placeholder: "Welcome to OpenSign - Set Your Password"
  },
  {
    key: "reminder",
    title: "Reminder Email",
    bodyField: "ReminderEmailBody",
    subjectField: "ReminderEmailSubject",
    defaultSubject: `Reminder: Your signature is needed on {{document_title}}`,
    defaultBody: `<p>Hi {{receiver_name}},</p><br><p>This is a friendly reminder that <strong>{{sender_name}}</strong> has requested your signature on <strong>{{document_title}}</strong>.</p><p>This document is still awaiting your review and signature. Please take a moment to complete the signing process.</p><br><p><a href='{{signing_url}}' rel='noopener noreferrer' target='_blank'>Sign Document</a></p><br><p>If you have already signed this document, please disregard this reminder.</p>`,
    variables: reminderVariables,
    placeholder: "Reminder: Your signature is needed on {{document_title}}"
  }
];

const TemplateSection = ({ template, info, tenantId, showAlert }) => {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const { key, bodyField, subjectField, defaultBody, defaultSubject } = template;
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isTemplateLoaded, setIsTemplateLoaded] = useState(false);

  useEffect(() => {
    if (!info || info === "user does not exist!") return;
    if (info?.[bodyField]) {
      setBody(info[bodyField]);
      setSubject(info[subjectField]);
      setIsDefault(false);
    } else {
      setBody(defaultBody);
      setSubject(defaultSubject);
      setIsDefault(true);
    }
    setIsTemplateLoaded((p) => !p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info]);

  const saveToTenant = async (newBody, newSubject) => {
    const res = await Parse.Cloud.run("updatecustomemailtemplates", {
      tenantId,
      details: { [bodyField]: newBody, [subjectField]: newSubject }
    });
    const updateRes = JSON.parse(JSON.stringify(res));
    dispatch(
      setTenantInfo({
        ...info,
        [bodyField]: updateRes?.[bodyField] ?? "",
        [subjectField]: updateRes?.[subjectField] ?? ""
      })
    );
    return updateRes;
  };

  const handleSave = withSessionValidation(async (e) => {
    e.preventDefault();
    try {
      const replacedHtmlBody = body.replace(/"/g, "'");
      const htmlBody = `<html><head><meta http-equiv='Content-Type' content='text/html; charset=UTF-8' /></head><body>${replacedHtmlBody}</body></html>`;
      const updateRes = await saveToTenant(htmlBody, subject);
      setBody(updateRes?.[bodyField]);
      setSubject(updateRes?.[subjectField]);
      showAlert("success", t("saved-successfully"));
    } catch (err) {
      console.error(`Error while saving ${key} email template: `, err);
      showAlert("danger", t("something-went-wrong-mssg"));
    }
  });

  const handleReset = withSessionValidation(async () => {
    if (isDefault) return;
    setIsDefault(true);
    setBody(defaultBody);
    setSubject(defaultSubject);
    setIsLoading(true);
    try {
      await saveToTenant("", "");
    } catch (err) {
      console.error(`Error while resetting ${key} email: `, err);
    } finally {
      setIsLoading(false);
    }
  });

  const subjectHelp =
    template.subjectHelp || `${t("variables-use")}: ${template.variables}`;
  const bodyHelp = template.bodyHelp || `${t("variables-use")}: ${template.variables}`;

  return (
    <>
      <h1 className="text-[14px] mb-[0.7rem] font-medium">{template.title}</h1>
      <div className="relative my-2">
        {isLoading && (
          <div className="flex z-[100] justify-center items-center absolute w-full h-full rounded-box bg-black/30">
            <Loader />
          </div>
        )}
        {isDefault && (
          <div className="absolute backdrop-blur-[2px] flex w-full h-full justify-center items-center bg-black/10 rounded-box select-none z-20">
            <button
              onClick={() => setIsDefault(false)}
              className="op-btn op-btn-primary shadow-lg"
            >
              {t("modify")}
            </button>
          </div>
        )}
        <form
          onSubmit={handleSave}
          className="p-3 border-[1px] border-base-content rounded-box"
        >
          <div className="text-lg font-normal">
            <label className="text-sm">
              {t("subject")}{" "}
              <Tooltip id={`${key}-sub-tooltip`} message={subjectHelp} />
            </label>
            <input
              required
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={template.placeholder}
              className="w-full op-input op-input-bordered op-input-sm focus:outline-none hover:border-base-content text-xs"
            />
          </div>
          <div className="text-lg font-normal py-2">
            <label className="text-sm mt-3">
              {t("body")} <Tooltip id={`${key}-body-tooltip`} message={bodyHelp} />
            </label>
            <EmailBodyEditor
              value={body}
              onChange={(html) => html && setBody(html)}
              bodyName={key}
              isReset={isLoading}
              isTemplateLoaded={isTemplateLoaded}
            />
          </div>
          <div className="flex items-center mt-3 gap-2">
            <button
              disabled={!body || !subject}
              className="op-btn op-btn-primary"
              type="submit"
            >
              {t("save")}
            </button>
            <button
              type="button"
              className="op-btn op-btn-secondary"
              onClick={handleReset}
            >
              {t("reset")}
            </button>
          </div>
        </form>
      </div>
    </>
  );
};

const CustomMailTemplates = ({ info, tenantId }) => {
  const [isalert, setIsAlert] = useState({ type: "success", msg: "" });
  const showAlert = (type, msg) => {
    setIsAlert({ type, msg });
    setTimeout(() => setIsAlert({ type: "", msg: "" }), 1500);
  };
  return (
    <div className="flex flex-col mb-4">
      {isalert.msg && <Alert type={isalert.type}>{isalert.msg}</Alert>}
      {templates.map((template) => (
        <TemplateSection
          key={template.key}
          template={template}
          info={info}
          tenantId={tenantId}
          showAlert={showAlert}
        />
      ))}
    </div>
  );
};

export default CustomMailTemplates;
