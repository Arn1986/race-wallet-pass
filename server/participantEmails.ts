export function participantEmail(value: unknown): string {
  if (typeof value !== 'string') throw new Error('A valid participant email is required');
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('A valid participant email is required');
  return email;
}
export const DUPLICATE_EMAIL_ERROR = 'Duplicate email is not allowed for this event. Enable shared emails in event settings to add another participant with this address.';
export const DISABLE_SHARED_ERROR = 'Cannot disable shared emails while duplicates exist. Give those participants different addresses or remove duplicate registrations first.';
