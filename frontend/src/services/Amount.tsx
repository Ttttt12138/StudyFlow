/** A formatted amount with its leading currency code set smaller ("THB 52,500.00"); the text is unchanged. */
export function Amount({ text }: { text: string }) {
  const match = /^([A-Z]{3})(\s+)(.*)$/.exec(text);
  if (!match) return <>{text}</>;
  return <><span className="amount-code">{match[1]}</span>{match[2]}{match[3]}</>;
}
