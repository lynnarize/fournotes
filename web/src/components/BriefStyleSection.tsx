"use client";
// Settings → Today: where the summary comes from, your data alone or the assistant.
import { BRIEF_STYLES, useBriefStyle } from "@/lib/briefParagraph";
import { SettingsGroup, SettingsRow } from "./SettingsSection";

export default function BriefStyleSection() {
  const [style, setStyle] = useBriefStyle();
  const current = BRIEF_STYLES.find((o) => o.id === style) ?? BRIEF_STYLES[0];
  return (
    <SettingsGroup>
      <SettingsRow label="Summary" description={<>How Today sums up your day. {current.detail}</>}>
        {(labelId) => (
          <div role="radiogroup" aria-labelledby={labelId} className="seg">
            {BRIEF_STYLES.map((o) => (
              <button key={o.id} type="button" role="radio" aria-checked={style === o.id} onClick={() => setStyle(o.id)} title={o.detail}>
                {o.label}
              </button>
            ))}
          </div>
        )}
      </SettingsRow>
    </SettingsGroup>
  );
}
