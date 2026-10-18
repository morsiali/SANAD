import { useEffect, useRef } from "react";
import type { Recipient } from "../../shared/types";
import {
  AGE_LABEL,
  CARE_NEEDS,
  LIVINGS,
  LIVING_LABEL,
  NEED_ICON,
  NEED_LABEL,
  SUPPORT_HINT,
  SUPPORT_LABEL,
  SUPPORT_LEVELS,
  careProfile,
  inferLiving,
  inferNeeds,
  suggestSupport,
  type CareNeed,
  type Living,
  type SupportLevel,
} from "../../shared/care";
import { t } from "../lib/i18n";
import { Icon } from "./ui";

/** Read-only chips showing a person's care category. */
export function CareTags({ r, compact = false }: { r: Recipient; compact?: boolean }) {
  const p = careProfile(r);
  return (
    <div className="care-tags" aria-label={t("Care category")}>
      <span className={`care-level care-${p.support}`}>{t(SUPPORT_LABEL[p.support])}</span>
      <span className={`chip chip-static ${p.living === "alone" ? "chip-warn" : ""}`}>
        <Icon name={p.living === "alone" ? "user" : "home"} size={13} /> {t(LIVING_LABEL[p.living])}
      </span>
      {!compact && <span className="chip chip-static">{t(AGE_LABEL[p.ageGroup])}</span>}
      {p.needs.map((n) => (
        <span key={n} className="chip chip-static">
          <Icon name={NEED_ICON[n]} size={13} /> {t(NEED_LABEL[n])}
        </span>
      ))}
    </div>
  );
}

export interface ProfileDraft {
  support: SupportLevel;
  living: Living;
  needs: CareNeed[];
  /** Fields the person has chosen themselves; untouched ones follow the note. */
  touched: { support?: boolean; living?: boolean; needs?: boolean };
}

export const emptyDraft = (): ProfileDraft => ({
  support: "independent",
  living: "family",
  needs: [],
  touched: {},
});
export const draftFrom = (r: Recipient): ProfileDraft => {
  const p = careProfile(r);
  return {
    support: p.support,
    living: p.living,
    needs: p.needs,
    touched: { support: true, living: true, needs: true },
  };
};

/**
 * Support level, living situation and care needs. Until the person picks a value themselves,
 * each one is suggested from the care note and age as they type.
 */
export function CareProfileFields({
  value,
  onChange,
  note,
  age,
  idPrefix = "care",
}: {
  value: ProfileDraft;
  onChange: (d: ProfileDraft) => void;
  note: string;
  age: number;
  idPrefix?: string;
}) {
  const latest = useRef(value);
  latest.current = value;

  useEffect(() => {
    const v = latest.current;
    const needs = v.touched.needs ? v.needs : inferNeeds(note);
    const living = v.touched.living ? v.living : (inferLiving(note) ?? v.living);
    const support = v.touched.support ? v.support : suggestSupport(needs, age || 0, living);
    if (support !== v.support || living !== v.living || needs.join() !== v.needs.join())
      onChange({ ...v, needs, living, support });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    note,
    age,
    value.needs.join(),
    value.living,
    value.touched.support,
    value.touched.living,
    value.touched.needs,
  ]);

  const suggested = !value.touched.support || !value.touched.needs || !value.touched.living;

  return (
    <div className="care-fields">
      <div role="radiogroup" aria-label={t("Support level")} className="care-levels">
        <span className="care-legend">{t("Support level")}</span>
        {SUPPORT_LEVELS.map((s) => (
          <button
            key={s}
            id={`${idPrefix}-support-${s}`}
            type="button"
            role="radio"
            aria-checked={value.support === s}
            className={`care-level-card care-${s} ${value.support === s ? "on" : ""}`}
            onClick={() =>
              onChange({ ...value, support: s, touched: { ...value.touched, support: true } })
            }
          >
            <strong>{t(SUPPORT_LABEL[s])}</strong>
            <small>{t(SUPPORT_HINT[s])}</small>
          </button>
        ))}
      </div>
      <span className="care-legend">{t("Living situation")}</span>
      <div role="radiogroup" aria-label={t("Living situation")} className="seg care-living">
        {LIVINGS.map((l) => (
          <button
            key={l}
            id={`${idPrefix}-living-${l}`}
            type="button"
            role="radio"
            aria-checked={value.living === l}
            className={value.living === l ? "on" : ""}
            onClick={() =>
              onChange({ ...value, living: l, touched: { ...value.touched, living: true } })
            }
          >
            {t(LIVING_LABEL[l])}
          </button>
        ))}
      </div>
      <fieldset className="checks care-needs">
        <legend className="care-legend">{t("Care needs")}</legend>
        <div className="care-needs-grid">
          {CARE_NEEDS.map((n) => (
            <label key={n} className="check">
              <input
                id={`${idPrefix}-need-${n}`}
                type="checkbox"
                checked={value.needs.includes(n)}
                onChange={(e) =>
                  onChange({
                    ...value,
                    needs: e.target.checked
                      ? CARE_NEEDS.filter((x) => x === n || value.needs.includes(x))
                      : value.needs.filter((x) => x !== n),
                    touched: { ...value.touched, needs: true },
                  })
                }
              />
              <Icon name={NEED_ICON[n]} size={14} /> {t(NEED_LABEL[n])}
            </label>
          ))}
        </div>
      </fieldset>
      {suggested && note.trim().length > 3 && (
        <p className="muted small care-suggest">
          {t("Suggested from the care note — change anything that is not right.")}
        </p>
      )}
    </div>
  );
}
