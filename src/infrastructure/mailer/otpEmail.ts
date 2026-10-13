import type { OtpPurpose } from "../../shared/utils/otp.js";

const copy = {
  en: {
    VERIFY_EMAIL: {
      subject: "Verify your email",
      intro: "Use this code to verify your email address:",
    },
    RESET_PASSWORD: {
      subject: "Reset your password",
      intro: "Use this code to reset your password:",
    },
    validFor: (m: number) => `This code is valid for ${m} minutes.`,
    ignore: "If you did not request this, you can ignore this email.",
  },
  it: {
    VERIFY_EMAIL: {
      subject: "Verifica la tua email",
      intro: "Usa questo codice per verificare il tuo indirizzo email:",
    },
    RESET_PASSWORD: {
      subject: "Reimposta la password",
      intro: "Usa questo codice per reimpostare la password:",
    },
    validFor: (m: number) => `Questo codice è valido per ${m} minuti.`,
    ignore: "Se non hai richiesto questo codice, puoi ignorare questa email.",
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
  const text = `${p.intro} ${otp}\n${c.validFor(ttlMinutes)}\n${c.ignore}`;
  const html = `
<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
  <h2 style="margin:0 0 16px;">${p.subject}</h2>
  <p>${p.intro}</p>
  <p style="font-size:32px;letter-spacing:8px;font-weight:bold;margin:16px 0;">${otp}</p>
  <p>${c.validFor(ttlMinutes)}</p>
  <p style="color:#777;font-size:13px;">${c.ignore}</p>
</div>`;
  return { subject: p.subject, text, html };
};
