// The sponsor confirmation link. The token travels in the URL fragment, so browsers never send it to a
// server or write it to access logs; the sponsor page reads it and removes it from the address bar.
export function sponsorLink(origin: string, token: string) {
  return `${origin}/?sponsor=1#token=${token}`;
}
