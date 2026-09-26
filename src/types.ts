export interface Interaction {
  protocol: string;
  qtype?: string;
  callerIp: string;
  /** Raw timestamp text exactly as printed by interactsh-client. */
  timestampRaw: string;
  /** ISO-8601 form, present only when timestampRaw could be parsed as a valid date. */
  timestamp?: string;
}
