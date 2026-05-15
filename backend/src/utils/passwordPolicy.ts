/**
 * passwordPolicy.ts — Password complexity rules and account lockout constants.
 *
 * `validatePassword()` is called on every password change (user self-service and
 * admin reset). It returns a list of unmet requirements so the UI can display
 * specific error messages rather than a generic failure.
 *
 * Constants used by auth.controller.ts for lockout behaviour:
 *  - `MAX_FAILED_ATTEMPTS`: Lock after this many consecutive bad passwords.
 *  - `LOCKOUT_MINUTES`: How long the account stays locked.
 *  - `PASSWORD_EXPIRY_DAYS`: How long before a password is considered expired.
 *    Expiry triggers a warning on login but does not hard-block access.
 */
export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
}

export const validatePassword = (password: string): PasswordValidationResult => {
  const errors: string[] = [];

  if (password.length < 8) errors.push('At least 8 characters');
  if (!/[A-Z]/.test(password)) errors.push('At least one uppercase letter');
  if (!/[a-z]/.test(password)) errors.push('At least one lowercase letter');
  if (!/[0-9]/.test(password)) errors.push('At least one number');
  if (!/[^A-Za-z0-9]/.test(password)) errors.push('At least one special character');

  return { valid: errors.length === 0, errors };
};

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 30;
export const PASSWORD_EXPIRY_DAYS = 90;
