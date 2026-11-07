"use client";
// An API key field that browsers and password managers leave alone.
// type="password" makes every browser offer to save the key as a login password
// (and later autofill it into real login forms), so this is a text field masked
// with CSS instead, plus the opt-out attributes the common managers honour.
import { useEffect, useState, type InputHTMLAttributes } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "autoComplete"> & { reveal?: boolean };

const IGNORE_MANAGERS = {
  "data-1p-ignore": true, // 1Password
  "data-lpignore": "true", // LastPass
  "data-bwignore": true, // Bitwarden
  "data-form-type": "other", // Dashlane
} as const;

export default function SecretInput({ reveal = false, className = "", onCopy, onCut, ...rest }: Props) {
  // Browsers without CSS masking fall back to a real password field rather than showing the key.
  const [cssMask, setCssMask] = useState(true);
  useEffect(() => {
    setCssMask(typeof CSS !== "undefined" && CSS.supports("-webkit-text-security", "disc"));
  }, []);
  const masked = !reveal;

  return (
    <input
      {...rest}
      {...IGNORE_MANAGERS}
      type={masked && !cssMask ? "password" : "text"}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      className={`${className} ${masked ? "secret-mask" : ""}`}
      // A masked password field can't be copied out; keep it that way.
      onCopy={(e) => { if (masked) e.preventDefault(); onCopy?.(e); }}
      onCut={(e) => { if (masked) e.preventDefault(); onCut?.(e); }}
    />
  );
}
