const twilio = require("twilio");

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const from = process.env.TWILIO_PHONE_NUMBER;
const to = process.env.TWILIO_TEST_TO;
const publicBaseUrl = process.env.VOICE_AGENT_PUBLIC_BASE_URL;

function assertEnv(name, value) {
  if (!value || !String(value).trim()) {
    throw new Error(`${name} is missing`);
  }
}

async function createCall() {
  assertEnv("TWILIO_ACCOUNT_SID", accountSid);
  assertEnv("TWILIO_AUTH_TOKEN", authToken);
  assertEnv("TWILIO_PHONE_NUMBER", from);
  assertEnv("TWILIO_TEST_TO", to);
  assertEnv("VOICE_AGENT_PUBLIC_BASE_URL", publicBaseUrl);

  const client = twilio(accountSid, authToken);
  const webhookUrl = `${publicBaseUrl.replace(/\/$/, "")}/voice-agent/webhook/incoming?lang=hi`;

  const call = await client.calls.create({
    from,
    to,
    url: webhookUrl,
    method: "POST",
    statusCallback: `${publicBaseUrl.replace(/\/$/, "")}/voice-agent/webhook/status`,
    statusCallbackMethod: "POST",
    statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
  });

  console.log(`CALL_SID=${call.sid}`);
}

createCall().catch((err) => {
  console.error(`TWILIO_CALL_FAILED=${err.message}`);
  process.exit(1);
});
