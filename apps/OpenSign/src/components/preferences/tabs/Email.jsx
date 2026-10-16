import { useTranslation } from "react-i18next";
import { useSelector } from "react-redux";
import MailTemplateEditor from "../MailTemplateEditor";
import CustomMailTemplates from "../../../custom/CustomMailTemplates"; // West Muskingum

const EmailTab = () => {
  const { t } = useTranslation();
  const {
    tenantInfo
  } = useSelector((state) => state.user);
  return (
    <div className="flex flex-col mb-4">
        <MailTemplateEditor
          info={
                tenantInfo
          }
          tenantId={tenantInfo?.objectId}
        />
        <CustomMailTemplates info={tenantInfo} tenantId={tenantInfo?.objectId} />{/* West Muskingum */}
    </div>
  );
};

export default EmailTab;
