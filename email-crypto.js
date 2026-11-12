// Sign-in email protection (no server needed).
//
// A player signs in with username + password, but Firebase signs in with an
// email, so the login has to find the email from the username before the
// player is signed in. Instead of keeping a real email readable in the
// players document, we keep it encrypted with a key derived from the
// player's password: the login decrypts it with the password just typed.
// Anyone reading the document without the password sees only random bytes.
//
//   key  = PBKDF2-SHA256(password, random 16-byte salt, ITERATIONS)
//   data = AES-256-GCM(email, random 12-byte IV, bound to the account id)
//
// Synthetic sign-in addresses (username@players.letterladder.io, or the
// older @letterladder.user ones) are not personal and stay in authEmail as
// before. Real addresses only ever appear in Firestore as authEmailEnc.
//
// Limit: this is only as strong as the password. A weak password can still
// be guessed offline, one slow PBKDF2 guess at a time.

export const ITERATIONS = 600000;
const SYNTHETIC_DOMAINS = ['@players.letterladder.io', '@letterladder.user'];
const te = new TextEncoder(), td = new TextDecoder();
const b64 = bytes => { let s = ''; new Uint8Array(bytes).forEach(b => { s += String.fromCharCode(b); }); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const boundTo = uid => te.encode('letterladder:authEmail:v1:' + uid);

export function isSyntheticEmail(email){
  const e = String(email || '').trim().toLowerCase();
  return SYNTHETIC_DOMAINS.some(d => e.endsWith(d));
}
// Usernames can't contain "." so anything shaped like an email is an email.
export function looksLikeEmail(text){
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(text || '').trim());
}

async function deriveKey(password, salt, iterations){
  const base = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptEmail(email, password, uid){
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, ITERATIONS);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: boundTo(uid) }, key, te.encode(String(email).trim().toLowerCase()));
  return { v: 1, kdf: 'PBKDF2-SHA256', iter: ITERATIONS, alg: 'AES-256-GCM', salt: b64(salt), iv: b64(iv), ct: b64(ct) };
}

// Returns the email, or null if the password (or account) doesn't match.
export async function decryptEmail(blob, password, uid){
  try{
    if(!blob || blob.v !== 1) return null;
    const key = await deriveKey(password, unb64(blob.salt), blob.iter || ITERATIONS);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv), additionalData: boundTo(uid) }, key, unb64(blob.ct));
    return td.decode(pt);
  }catch(e){
    return null;
  }
}

// Works out which email to sign in with.
//  - An email typed into the username box: used as-is, no lookup.
//  - A username whose document holds an encrypted email: decrypted with the
//    password just typed (null if it doesn't decrypt - wrong password, or a
//    password reset since it was saved: the player can sign in with their email).
//  - Otherwise exactly as before: the document's authEmail, or the synthetic
//    address made from the username.
export async function resolveSignInEmail({ input, password, findPlayerByUsername, usernameToSyntheticEmail }){
  const typed = String(input || '').trim();
  if(looksLikeEmail(typed)) return { email: typed, player: null, via: 'email' };
  const player = await findPlayerByUsername(typed);
  if(player && player.authEmailEnc){
    return { email: await decryptEmail(player.authEmailEnc, password, player.uid), player, via: 'encrypted' };
  }
  if(player && player.authEmail) return { email: player.authEmail, player, via: isSyntheticEmail(player.authEmail) ? 'synthetic' : 'plain' };
  return { email: usernameToSyntheticEmail(typed), player, via: 'synthetic' };
}

export const ENCRYPTED_LOGIN_FAILED = "Username or password is incorrect. If you've reset your password recently, log in with your email address instead.";

// After any successful sign-in (we have the password the player just used):
// make sure the players document holds only an encrypted copy of a real
// account email. Migrates a plain-text copy, re-encrypts after a password
// reset or change, and does nothing for synthetic accounts or an up-to-date copy.
export async function syncEncryptedEmail({ user, password, db, doc, getDoc, setDoc, deleteField }){
  if(!user || user.isAnonymous || !user.email || isSyntheticEmail(user.email)) return 'synthetic account - nothing to encrypt';
  const ref = doc(db, 'players', user.uid);
  const snap = await getDoc(ref);
  if(!snap.exists()) return 'no players document yet';
  const data = snap.data();
  const plainReal = !!(data.authEmail && !isSyntheticEmail(data.authEmail));
  if(!plainReal && data.authEmailEnc){
    const current = await decryptEmail(data.authEmailEnc, password, user.uid);
    if(current && current === user.email.trim().toLowerCase()) return 'encrypted copy up to date';
  }
  const authEmailEnc = await encryptEmail(user.email, password, user.uid);
  await setDoc(ref, { authEmailEnc, authEmail: deleteField() }, { merge: true });
  return plainReal ? 'migrated plain-text email to encrypted' : (data.authEmailEnc ? 're-encrypted with the current password' : 'saved encrypted email');
}
