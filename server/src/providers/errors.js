// Errors from a provider, with a plain-language reason for staff
// and a flag that tells the queue whether trying again could help.
export class ProviderError extends Error {
  constructor(message, { code = null, retryable = false, status = null } = {}) {
    super(message);
    this.code = code === null ? null : String(code);
    this.retryable = retryable;
    this.httpStatus = status;
  }
}

/** HTTP statuses where a retry later is worth it. */
export function isRetryableHttp(status) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

// Twilio and Meta error codes staff are likely to see, in plain words.
const FRIENDLY = {
  // Twilio
  21211: 'The phone number is not valid.',
  21408: 'Twilio account is not allowed to send to this region.',
  21610: 'The customer has blocked messages from this number (replied STOP).',
  21654: 'This WhatsApp sender only accepts approved templates. Add the Twilio Content template ID (HX…) to the template.',
  63003: 'This number is not on WhatsApp.',
  63007: 'The WhatsApp sender number is not set up in Twilio.',
  63015: "This phone hasn't joined the Twilio sandbox yet. Ask the customer to send the join code first.",
  63016: 'More than 24 hours since the customer last wrote. Use an approved template to start the chat again.',
  63024: 'The number cannot receive WhatsApp messages.',
  63032: "WhatsApp didn't deliver this to protect the customer's experience (too many marketing messages).",
  63049: "Meta chose not to deliver this marketing message (WhatsApp's per-user marketing limit).",
  // Meta Cloud API
  131026: 'This number cannot receive the message (not on WhatsApp or an old app).',
  131030: 'This number is not on the test recipient list (Meta test number).',
  131031: 'Meta has locked this WhatsApp Business account. Check Account quality in Meta Business Suite.',
  131047: 'More than 24 hours since the customer last wrote. Use an approved template.',
  131049: "Meta chose not to deliver this marketing message (WhatsApp's per-user marketing limit).",
  131050: 'The customer has stopped marketing messages from this business.',
  132001: 'The template does not exist or is not approved yet.',
  130429: 'Sending too fast: WhatsApp rate limit reached.',
};

export function friendlyError(code, fallback) {
  return FRIENDLY[Number(code)] || fallback || 'The message could not be sent.';
}
