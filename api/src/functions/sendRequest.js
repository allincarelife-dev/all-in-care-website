const { app } = require('@azure/functions');
const { EmailClient } = require('@azure/communication-email');

// Very small helper to stop obviously fake submissions without adding a
// full CAPTCHA. Not bulletproof, but stops most drive-by bot spam.
function isValidEmail(value) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

app.http('sendRequest', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'send-request',
  handler: async (request, context) => {
    let data;
    try {
      data = await request.json();
    } catch {
      return { status: 400, jsonBody: { error: 'Request body must be JSON.' } };
    }

    const name = (data.name || '').toString().trim();
    const org = (data.org || '').toString().trim();
    const county = (data.county || '').toString().trim();
    const email = (data.email || '').toString().trim();
    const phone = (data.phone || '').toString().trim();
    const interests = Array.isArray(data.interests) ? data.interests.join(', ') : (data.interests || '').toString().trim();
    const message = (data.message || '').toString().trim();

    // Honeypot field: a hidden input real visitors never fill in.
    if (data.website) {
      return { status: 200, jsonBody: { success: true } };
    }

    if (!name || !org || !isValidEmail(email)) {
      return { status: 400, jsonBody: { error: 'Please provide your name, facility, and a valid email address.' } };
    }

    const connectionString = process.env.ACS_CONNECTION_STRING;
    const senderAddress = process.env.ACS_SENDER_ADDRESS;
    const recipient = process.env.CONTACT_RECIPIENT || 'Info@allincare.life';

    if (!connectionString || !senderAddress) {
      context.error('Missing ACS_CONNECTION_STRING or ACS_SENDER_ADDRESS application settings.');
      return { status: 500, jsonBody: { error: 'Email service is not configured yet.' } };
    }

    try {
      const client = new EmailClient(connectionString);

      const plainText =
`New Request Information submission from allincare.life

Name: ${name}
Facility / Organization: ${org}
County: ${county || 'Not provided'}
Email: ${email}
Phone: ${phone || 'Not provided'}
Services of interest: ${interests || 'Not specified'}

Message:
${message || 'None provided'}`;

      const poller = await client.beginSend({
        senderAddress,
        content: {
          subject: `Information Request — ${org}`,
          plainText
        },
        recipients: {
          to: [{ address: recipient }]
        },
        replyTo: [{ address: email, displayName: name }]
      });

      await poller.pollUntilDone();

      return { status: 200, jsonBody: { success: true } };
    } catch (err) {
      context.error('Email send failed:', err);
      return { status: 500, jsonBody: { error: 'Something went wrong sending your request. Please try again or email us directly.' } };
    }
  }
});
