/**
 * LdapAuthService.ts — Active Directory authentication and user provisioning.
 *
 * `authenticateLdap(username, password)`:
 *  1. Creates a service account LDAP client and binds using the configured
 *     `LDAP_BIND_DN` / `LDAP_BIND_PASSWORD`.
 *  2. Searches for the user entry using the configured search filter
 *     (e.g., `(sAMAccountName={{username}})`).
 *  3. Creates a second LDAP client and attempts to bind with the user's own
 *     credentials to verify their password.
 *  4. If authentication succeeds, looks up the user in the local `users` table
 *     by `ldap_dn` (or falls back to matching by username).
 *  5. If no local user exists, auto-provisions one with `LDAP_DEFAULT_ROLE`.
 *  6. Updates the local record with the latest LDAP DN and email on each login.
 *
 * `escapeLdapFilter()`: Sanitises user-supplied input before embedding it in
 * the LDAP search filter string to prevent LDAP injection attacks.
 *
 * Two separate LDAP clients are used (service client for search, user client for
 * bind verification) so they can be destroyed independently, preventing connection
 * leaks even when the user bind fails.
 */
import ldap from 'ldapjs';
import { AppDataSource } from '../../config/database';
import { User } from '../../entities/User.entity';
import config from '../../config/config';

function escapeLdapFilter(value: string): string {
  return value
    .replace(/\\/g, '\\5c')
    .replace(/\*/g, '\\2a')
    .replace(/\(/g, '\\28')
    .replace(/\)/g, '\\29')
    .replace(/\0/g, '\\00');
}

interface LdapEntry {
  dn: string;
  attributes: Record<string, string | string[]>;
}

function attr(entry: LdapEntry, key: string): string {
  const val = entry.attributes[key];
  if (!val) return '';
  return Array.isArray(val) ? val[0] : val;
}

function createClient(): ldap.Client {
  return ldap.createClient({
    url: config.ldap.url,
    ...(config.ldap.tlsEnabled ? { tlsOptions: { rejectUnauthorized: true } } : {}),
  });
}

function bindAsync(client: ldap.Client, dn: string, password: string): Promise<void> {
  return new Promise((resolve, reject) => {
    client.bind(dn, password, (err) => { if (err) reject(err); else resolve(); });
  });
}

function searchAsync(client: ldap.Client, base: string, filter: string): Promise<LdapEntry | null> {
  return new Promise((resolve, reject) => {
    client.search(
      base,
      { scope: 'sub', filter, attributes: ['dn', 'cn', 'sAMAccountName', 'mail', 'distinguishedName', config.ldap.usernameAttribute] },
      (err, res) => {
        if (err) { reject(err); return; }
        let found: LdapEntry | null = null;
        res.on('searchEntry', (entry) => {
          const raw = entry.pojo;
          const attrs: Record<string, string | string[]> = {};
          for (const a of raw.attributes) { attrs[a.type] = a.values.length === 1 ? a.values[0] : a.values; }
          found = { dn: raw.objectName, attributes: attrs };
        });
        res.on('error', reject);
        res.on('end', () => resolve(found));
      }
    );
  });
}

export async function authenticateLdap(username: string, password: string): Promise<User> {
  if (!config.ldap.enabled) throw new Error('LDAP is not enabled');

  const filter = config.ldap.searchFilter.replace('{{username}}', escapeLdapFilter(username));
  const serviceClient = createClient();
  try {
    await bindAsync(serviceClient, config.ldap.bindDN, config.ldap.bindCredentials);
    const entry = await searchAsync(serviceClient, config.ldap.searchBase, filter);
    if (!entry) throw new Error('User not found in directory');

    const userDn = entry.dn;
    const mail = attr(entry, 'mail') || undefined;

    const userClient = createClient();
    try {
      await bindAsync(userClient, userDn, password);
    } catch {
      throw new Error('Invalid credentials');
    } finally {
      userClient.destroy();
    }

    const userRepo = AppDataSource.getRepository(User);
    let user = await userRepo.findOne({ where: { ldap_dn: userDn } });
    if (!user) user = await userRepo.findOne({ where: { username: username.toLowerCase() } });

    if (!user) {
      user = userRepo.create({
        username: username.toLowerCase(),
        email: mail ?? null,
        auth_provider: 'ldap',
        ldap_dn: userDn,
        role: config.ldap.defaultRole,
        active: true,
        failed_login_attempts: 0,
      });
      await userRepo.save(user);
    } else {
      await userRepo.update(user.id, {
        auth_provider: 'ldap',
        ldap_dn: userDn,
        ...(mail ? { email: mail } : {}),
        last_login: new Date(),
        failed_login_attempts: 0,
        locked_until: null,
      });
      user = (await userRepo.findOne({ where: { id: user.id } }))!;
    }

    return user;
  } finally {
    serviceClient.destroy();
  }
}
