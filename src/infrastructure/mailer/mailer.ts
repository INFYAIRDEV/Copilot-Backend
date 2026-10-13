import nodemailer, { Transporter } from "nodemailer";

let transporter: Transporter | undefined;

const REQUIRED = [
  "EMAIL_SERVICE_PROVIDER_SMTP_HOST",
  "EMAIL_SERVICE_PROVIDER_SMTP_PORT",
  "EMAIL_SENDER_ID",
  "EMAIL_SENDER_PWD",
] as const;

// Call at startup so the app stops if mail is not configured.
export const assertMailConfig = (): void => {
  const missing = REQUIRED.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing mail configuration: ${missing.join(", ")}`);
  }
};

const getTransporter = (): Transporter => {
  if (!transporter) {
    const port = Number(process.env.EMAIL_SERVICE_PROVIDER_SMTP_PORT);
    transporter = nodemailer.createTransport({
      host: process.env.EMAIL_SERVICE_PROVIDER_SMTP_HOST,
      port,
      secure: port === 465,
      auth: {
        user: process.env.EMAIL_SENDER_ID,
        pass: process.env.EMAIL_SENDER_PWD,
      },
      connectionTimeout: Number(
        process.env.EMAIL_CONNECTION_TIMEOUT_MS || 10_000,
      ),
      greetingTimeout: Number(process.env.EMAIL_GREETING_TIMEOUT_MS || 10_000),
      socketTimeout: Number(process.env.EMAIL_SOCKET_TIMEOUT_MS || 15_000),
    });
  }
  return transporter;
};

export const sendMail = async (
  to: string,
  subject: string,
  text: string,
  html: string,
): Promise<void> => {
  const fromAddress =
    process.env.EMAIL_FROM_ADDRESS || process.env.EMAIL_SENDER_ID;
  await getTransporter().sendMail({
    from: `"${process.env.EMAIL_SENDER_NAME ?? "Copilot"}" <${fromAddress}>`,
    to,
    subject,
    text,
    html,
  });
};
