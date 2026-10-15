// TEMP: tests the SMTP settings from .env. Delete after use.
import "dotenv/config";
import nodemailer from "nodemailer";

const port = Number(process.env.EMAIL_SERVICE_PROVIDER_SMTP_PORT);
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_SERVICE_PROVIDER_SMTP_HOST,
  port,
  secure: port === 465,
  auth: {
    user: process.env.EMAIL_SENDER_ID,
    pass: process.env.EMAIL_SENDER_PWD,
  },
});

try {
  await transporter.verify();
  console.log("SMTP OK");
} catch (e) {
  console.log(e.code, e.responseCode, e.message);
}
