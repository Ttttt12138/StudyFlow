// Terms of Use and Privacy Notice text. Kept apart from the i18n dictionaries because it is long-form
// prose; describe only what the code actually does (backend/config/settings.py, docs/gemini-ocr.md).
import type { Lang } from "../i18n";

export type LegalKind = "terms" | "privacy";
export type LegalSection = { heading: string; body: string[] };
export type LegalDoc = { title: string; summary: string; sections: LegalSection[] };

export const LEGAL_UPDATED = "2026-10-19";
export const CONTACT_URL = "https://github.com/Ttttt12138/StudyFlow/issues";

const en: Record<LegalKind, LegalDoc> = {
  terms: {
    title: "Terms of Use",
    summary: "StudyFlow is a demonstration prototype for planning the cost of studying abroad. All money in it is simulated, and nothing in it is financial advice or a loan offer.",
    sections: [
      { heading: "1. About these terms", body: [
        "These terms apply when you use the StudyFlow website, its sign-in page, its assistant and its previews (together, the \"Service\"). By creating an account or using the Service you agree to them. If you do not agree, do not use the Service.",
      ] },
      { heading: "2. A demonstration with simulated money", body: [
        "StudyFlow was built as a competition prototype. Every balance, transfer, payment, loan, approval and admission notice in it is simulated. No real money moves, no real loan is offered or granted, and no bank, lender or school takes part.",
        "Do not enter real bank card numbers, account passwords or government identity numbers. Where a form asks for such data, use made-up values.",
      ] },
      { heading: "3. Not financial, legal or admissions advice", body: [
        "Cost estimates, exchange rates, loan figures and suggestions from the assistant are for illustration and planning only. They are not financial, investment, tax, legal, immigration or admissions advice, and they are not an offer of credit.",
        "The AI assistant can be wrong or out of date. Check important figures yourself and talk to a qualified adviser before you make a financial decision.",
      ] },
      { heading: "4. School fees and other source data", body: [
        "School fees and living costs are sample figures taken from public pages on the dates shown next to them. Fees change, so confirm them with the school before you pay.",
        "StudyFlow is not affiliated with or endorsed by any school, government body or financial institution it mentions. Rights in their pages, names and marks stay with their owners. Licences for third-party data are listed in the project's third-party licence notice.",
      ] },
      { heading: "5. Your account", body: [
        "Give accurate sign-up details and keep your password and one-time codes to yourself. You are responsible for activity under your account. Tell us if you think someone else has used it.",
        "The Service is intended for people aged 18 or over.",
      ] },
      { heading: "6. Acceptable use", body: [
        "Do not use the Service to break the law, to upload material you have no right to share, to try to get into other people's accounts or data, to probe or overload the system, or to get around its limits and approval steps.",
        "We may suspend or close an account that breaks these rules or puts the Service or other users at risk.",
      ] },
      { heading: "7. Your content", body: [
        "You keep the rights in what you enter or upload, such as study plans, notes and documents. You let us store and process it only to run the Service for you, as the Privacy Notice describes.",
      ] },
      { heading: "8. Availability and changes", body: [
        "As a prototype, the Service may change, lose data, be reset or go offline at any time without notice. Do not rely on it as your only copy of anything important.",
        "We may update these terms. The date at the top shows the latest version; continuing to use the Service after a change means you accept it.",
      ] },
      { heading: "9. No warranty and limited liability", body: [
        "The Service is provided \"as is\" and \"as available\", without any warranty. To the extent the law allows, the StudyFlow team is not liable for any loss arising from your use of the Service or from relying on its estimates or the assistant's answers. Nothing in these terms limits liability that cannot be limited by law.",
      ] },
      { heading: "10. Contact", body: [
        "Questions about these terms can be raised on the project's GitHub page.",
      ] },
    ],
  },
  privacy: {
    title: "Privacy Notice",
    summary: "We collect only what is needed to run your study plan and account, we never sell it, and a document is sent to Google's Gemini service only after you agree for that file.",
    sections: [
      { heading: "1. Who this notice covers", body: [
        "This notice explains what personal data StudyFlow handles when you use its website and assistant. StudyFlow is a demonstration prototype in which all money is simulated (see the Terms of Use).",
      ] },
      { heading: "2. What we collect", body: [
        "Account details: your full name, email address and username, and your password, which is stored only as a one-way hash.",
        "Sign-in data: one-time email codes and records of failed attempts, used to verify you and to lock out repeated wrong guesses.",
        "What you enter: schools and courses you look at, cost and loan figures, simulated applications and payments, life-plan items, and your conversations with the assistant.",
        "Documents you upload, such as a fee notice, and the text extracted from them.",
        "Technical data: a session cookie and a security (CSRF) cookie that keep you signed in and protect forms, and server logs of requests. Your interface language is saved in your own browser's storage and is not sent to us.",
      ] },
      { heading: "3. How we use it", body: [
        "To create and sign you into your account, to save and show your study plan, to answer your questions in the assistant, to read documents you choose to upload, and to keep the Service secure (for example, rate limits and audit records).",
        "We do not sell your data, we do not use it for advertising, and we do not use tracking or analytics cookies.",
      ] },
      { heading: "4. Services that receive data", body: [
        "Email: one-time codes are sent through the email provider the deployment is configured with.",
        "AI assistant: when the deployment runs a live AI model, the text of your messages and the plan details needed to answer them are sent to that model provider through its API. In the default demo mode, answers are generated locally and nothing is sent.",
        "Document reading (OCR): where automatic reading is offered, a file is sent to Google's Gemini API only after you give separate consent for that file; that consent does not cover later files. You can type the details in by hand instead. Google processes the file under its own terms, and zero data retention on Google's side is not guaranteed.",
        "Exchange rates: rates are fetched from the Frankfurter service. Those requests contain no personal data.",
      ] },
      { heading: "5. How long we keep it", body: [
        "Uploaded source files and OCR caches are purged after 30 days by default. The extracted figures you confirm, and audit records of actions, stay with your plan for as long as the account exists.",
        "On a secured deployment a sign-in session expires after 8 hours.",
        "Because this is a prototype, demo databases may be reset or deleted without notice.",
      ] },
      { heading: "6. How we protect it", body: [
        "Passwords are hashed, forms are protected against cross-site request forgery, account numbers and secrets are masked in audit logs, and access to other users' data is restricted by role. No system is perfectly secure, so please do not upload anything you would not want to share with a demonstration service.",
      ] },
      { heading: "7. Your choices and rights", body: [
        "You can ask to see, correct or delete your account data, or withdraw a consent you gave. Withdrawing consent does not undo processing already done. Depending on where you live, you may also have the right to complain to your data protection authority.",
      ] },
      { heading: "8. Children", body: [
        "The Service is intended for people aged 18 or over and is not directed at children.",
      ] },
      { heading: "9. Changes and contact", body: [
        "We may update this notice; the date at the top shows the latest version. To make a request or ask a question, contact the StudyFlow team through the project's GitHub page.",
      ] },
    ],
  },
};

const zh: Record<LegalKind, LegalDoc> = {
  terms: {
    title: "使用条款",
    summary: "StudyFlow 是用于规划留学费用的演示原型。其中所有资金均为模拟，任何内容都不构成金融建议或贷款要约。",
    sections: [
      { heading: "1. 关于本条款", body: [
        "本条款适用于你使用 StudyFlow 网站、登录页、智能助手及各类预览（统称“本服务”）。创建账户或使用本服务，即表示你同意本条款；如不同意，请勿使用本服务。",
      ] },
      { heading: "2. 使用模拟资金的演示", body: [
        "StudyFlow 是为比赛打造的原型。其中所有余额、转账、付款、贷款、审批及录取通知均为模拟，不涉及真实资金流动，不提供或发放任何真实贷款，也没有任何银行、贷款机构或学校参与。",
        "请勿输入真实的银行卡号、账户密码或身份证件号码。如表单要求填写此类信息，请使用虚构数据。",
      ] },
      { heading: "3. 不构成金融、法律或升学建议", body: [
        "费用估算、汇率、贷款数据及助手给出的建议仅供演示和规划参考，不构成金融、投资、税务、法律、移民或升学建议，也不构成授信要约。",
        "AI 助手可能出错或信息过时。请自行核实重要数据，并在做出财务决定前咨询合格的专业人士。",
      ] },
      { heading: "4. 学费及其他来源数据", body: [
        "学费和生活费为取自公开页面的示例数据，以页面旁标注的日期为准。费用可能调整，付款前请向学校确认。",
        "StudyFlow 与其提及的任何学校、政府机构或金融机构均无隶属或背书关系，相关页面、名称和标识的权利归其所有者。第三方数据的许可信息见项目的第三方许可说明。",
      ] },
      { heading: "5. 你的账户", body: [
        "注册时请提供真实信息，并妥善保管密码和一次性验证码。你需对账户下的操作负责；如怀疑账户被他人使用，请告知我们。",
        "本服务面向年满 18 周岁的用户。",
      ] },
      { heading: "6. 使用规范", body: [
        "不得利用本服务从事违法活动，不得上传你无权分享的内容，不得试图访问他人账户或数据，不得探测系统漏洞或使其过载，也不得绕过系统限制和审批步骤。",
        "对于违反上述规范或危及本服务及其他用户的账户，我们可能暂停或关闭。",
      ] },
      { heading: "7. 你的内容", body: [
        "你对自己输入或上传的内容（如留学计划、备注和文件）保留权利。你仅授权我们按照《隐私声明》所述，为向你提供本服务而存储和处理这些内容。",
      ] },
      { heading: "8. 服务可用性与条款变更", body: [
        "作为原型，本服务可能随时变更、丢失数据、被重置或下线，恕不另行通知。请勿将其作为重要资料的唯一备份。",
        "我们可能更新本条款，页面顶部的日期为最新版本日期。变更后继续使用本服务，即表示你接受更新后的条款。",
      ] },
      { heading: "9. 免责与责任限制", body: [
        "本服务按“现状”和“现有可用状态”提供，不作任何保证。在法律允许的范围内，StudyFlow 团队不对因使用本服务、或依赖其估算及助手回答而产生的任何损失承担责任。本条款不限制依法不得限制的责任。",
      ] },
      { heading: "10. 联系我们", body: [
        "如对本条款有疑问，可在项目的 GitHub 页面提出。",
      ] },
    ],
  },
  privacy: {
    title: "隐私声明",
    summary: "我们只收集运行你的留学计划和账户所需的数据，绝不出售；只有在你针对某个文件单独同意后，该文件才会发送给 Google Gemini 服务。",
    sections: [
      { heading: "1. 适用范围", body: [
        "本声明说明你使用 StudyFlow 网站和智能助手时，我们会处理哪些个人数据。StudyFlow 是演示原型，其中所有资金均为模拟（见《使用条款》）。",
      ] },
      { heading: "2. 我们收集的数据", body: [
        "账户信息：姓名、邮箱地址、用户名，以及密码（仅以单向哈希形式存储）。",
        "登录数据：一次性邮箱验证码及失败尝试记录，用于验证身份并在多次输错后锁定。",
        "你输入的内容：查看过的学校和专业、费用与贷款数据、模拟的申请和付款、生活规划事项，以及你与助手的对话。",
        "你上传的文件（如缴费通知）及从中提取的文字。",
        "技术数据：用于保持登录和保护表单的会话 Cookie 与安全（CSRF）Cookie，以及服务器请求日志。界面语言偏好保存在你自己的浏览器中，不会发送给我们。",
      ] },
      { heading: "3. 我们如何使用", body: [
        "用于创建账户并让你登录、保存和展示你的留学计划、在助手中回答你的问题、读取你选择上传的文件，以及保障服务安全（例如频率限制和审计记录）。",
        "我们不出售你的数据，不将其用于广告，也不使用追踪或分析类 Cookie。",
      ] },
      { heading: "4. 会接收数据的服务", body: [
        "邮件：一次性验证码通过部署时配置的邮件服务商发送。",
        "AI 助手：当部署启用在线 AI 模型时，你的消息内容及回答所需的计划信息会通过 API 发送给该模型服务商。默认演示模式下，回答在本地生成，不会发送任何数据。",
        "文件识别（OCR）：在提供自动识别的场景中，只有在你针对某个文件单独同意后，该文件才会发送到 Google Gemini API；该同意不适用于之后的文件。你也可以选择手动填写。Google 按其自身条款处理文件，且不保证 Google 一方零数据留存。",
        "汇率：汇率数据取自 Frankfurter 服务，相关请求不包含任何个人数据。",
      ] },
      { heading: "5. 保存期限", body: [
        "上传的原始文件和 OCR 缓存默认在 30 天后清除。你确认过的提取数据及操作审计记录会随你的计划保留，直至账户删除。",
        "在启用安全配置的部署中，登录会话 8 小时后失效。",
        "由于本服务是原型，演示数据库可能被重置或删除，恕不另行通知。",
      ] },
      { heading: "6. 安全保护", body: [
        "密码经过哈希处理，表单具备跨站请求伪造防护，审计日志中的账号和密钥会被遮盖，访问他人数据受角色权限限制。没有任何系统绝对安全，因此请勿上传你不愿与演示服务分享的内容。",
      ] },
      { heading: "7. 你的选择与权利", body: [
        "你可以要求查看、更正或删除你的账户数据，或撤回已给出的同意；撤回同意不影响此前已完成的处理。视你所在地区而定，你可能还有权向当地数据保护机构投诉。",
      ] },
      { heading: "8. 未成年人", body: [
        "本服务面向年满 18 周岁的用户，并非为儿童设计。",
      ] },
      { heading: "9. 变更与联系", body: [
        "我们可能更新本声明，页面顶部的日期为最新版本日期。如需提出请求或有任何疑问，请通过项目的 GitHub 页面联系 StudyFlow 团队。",
      ] },
    ],
  },
};

export const legalDocs: Record<Lang, Record<LegalKind, LegalDoc>> = { en, zh };
