import { logEmailFailure, sendSmtpTestEmail, verifySmtpConnection } from "./email.js";

const sendTest = process.argv.includes("--send-test");

try {
  const settings = await verifySmtpConnection();
  const tlsMode = settings.secure ? "implicit TLS" : settings.port === 587 ? "required STARTTLS" : "STARTTLS if offered by the provider";
  console.log(`SMTP connection verified: ${settings.host}:${settings.port}, ${tlsMode}.`);
  if (sendTest) {
    const result = await sendSmtpTestEmail();
    if (!result.accepted) throw new Error("SMTP provider did not accept the test message");
    console.log("Test email accepted by the configured SMTP provider. Check the SMTP_USER mailbox.");
  } else {
    console.log("No email was sent. Add --send-test to send a test message to the configured SMTP_USER mailbox.");
  }
} catch (error) {
  logEmailFailure("SMTP verification failed", error);
  console.error("SMTP verification failed. See the sanitized server diagnostic above.");
  process.exitCode = 1;
}
