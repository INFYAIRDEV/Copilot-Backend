import type { OtpPurpose } from "../../shared/utils/otp.js";

const BRAND = "Copilot Infyair";

const copy = {
  en: {
    VERIFY_EMAIL: {
      subject: "Verify your email",
      title: "Email Verification",
      intro: "Use the verification code below to verify your email address:",
    },
    RESET_PASSWORD: {
      subject: "Reset your password",
      title: "Password Reset Request",
      intro:
        "We received a request to reset your password. Use the password reset code below to set a new password:",
    },
    validTitle: (m: number) => `Code valid for ${m} minutes only!`,
    validBody: "Please use this code immediately.",
    ignore:
      "If you did not request this, please ignore this email or contact support if you have security concerns.",
    footer: `${BRAND}. All rights reserved.`,
  },
  it: {
    VERIFY_EMAIL: {
      subject: "Verifica la tua email",
      title: "Verifica Email",
      intro: "Usa il codice qui sotto per verificare il tuo indirizzo email:",
    },
    RESET_PASSWORD: {
      subject: "Reimposta la password",
      title: "Richiesta di reimpostazione password",
      intro:
        "Abbiamo ricevuto una richiesta di reimpostazione della password. Usa il codice qui sotto per impostarne una nuova:",
    },
    validTitle: (m: number) => `Codice valido solo per ${m} minuti!`,
    validBody: "Usa questo codice subito.",
    ignore:
      "Se non hai richiesto questo codice, ignora questa email o contatta l'assistenza in caso di dubbi sulla sicurezza.",
    footer: `${BRAND}. Tutti i diritti riservati.`,
  },
} as const;

export const buildOtpEmail = (
  purpose: OtpPurpose,
  otp: string,
  lang: string | undefined,
  ttlMinutes: number,
) => {
  const c = copy[lang === "it" ? "it" : "en"];
  const p = c[purpose];

  const text = `${p.intro} ${otp}\n${c.validTitle(ttlMinutes)} ${c.validBody}\n${c.ignore}`;

  const html = `
<div style="background:#f4f6f8;padding:24px 0;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;">
    <div style="background:linear-gradient(135deg,#1976d2,#0d47a1);padding:32px 24px;text-align:center;color:#ffffff;">
      <div style="font-size:28px;font-weight:bold;margin-bottom:12px;">${BRAND}</div>
      <div style="font-size:16px;">${p.title}</div>
    </div>

    <div style="padding:32px 40px;text-align:center;color:#222222;">
      <p style="font-size:16px;line-height:1.5;margin:0 0 24px;">${p.intro}</p>

      <div style="display:inline-block;background:#eef3fb;border:1px dashed #1976d2;border-radius:6px;padding:20px 40px;">
        <span style="font-size:36px;font-weight:bold;letter-spacing:10px;color:#0d47a1;">${otp}</span>
      </div>

      <div style="margin:32px 0 24px;padding:16px 20px;background:#fff8e1;border-left:4px solid #ffc107;text-align:left;">
        <div style="font-weight:bold;color:#e65100;margin-bottom:6px;">&#9200; ${c.validTitle(ttlMinutes)}</div>
        <div style="font-size:14px;color:#333333;">${c.validBody}</div>
      </div>

      <p style="font-size:13px;line-height:1.5;color:#777777;margin:0;">${c.ignore}</p>
    </div>

    <div style="background:#f5f5f5;padding:16px;text-align:center;font-size:13px;color:#888888;">
      ${c.footer}
    </div>
  </div>
</div>`;

  return { subject: p.subject, text, html };
};
