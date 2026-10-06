export const SCHEMA_MODES = {
  GRADES: "grades",
  UPPERSEC: "uppersec"
};

export const UPPERSEC_COURSE_TYPES = {
  BASIC: "basic",
  ADVANCED: "advanced",
  OTHER: "other"
};

export const QUALIFICATION_YEARS = {
  Q1_Q2: "q1-q2",
  Q3_Q4: "q3-q4"
};

export const SCORE_STATUS = {
  VALID: "valid",
  MISSING: "missing",
  EXCUSED: "excused"
};

export const STANDARD_GRADE_LABELS = [
  "1+", "1", "1-", "2+", "2", "2-", "3+", "3", "3-",
  "4+", "4", "4-", "5+", "5", "5-", "6"
];

export const RECOMMENDED_WEIGHT_TEMPLATE_IDS = {
  SEKI_EXAMPLE: "wt_berlin_seki_50_50_example",
  SEKII_ONE_EXAM: "wt_berlin_sekii_one_exam",
  SEKII_TWO_EXAMS: "wt_berlin_sekii_two_exams"
};

export function generateId(prefix) {
  return prefix + "_" + Math.random().toString(36).slice(2, 10);
}

export function createDefaultGradeMapping() {
  return {
    "1+": 0.7,
    "1": 1.0,
    "1-": 1.3,
    "2+": 1.7,
    "2": 2.0,
    "2-": 2.3,
    "3+": 2.7,
    "3": 3.0,
    "3-": 3.3,
    "4+": 3.7,
    "4": 4.0,
    "4-": 4.3,
    "5+": 4.7,
    "5": 5.0,
    "5-": 5.3,
    "6": 6.0
  };
}

export function createDefaultCategories() {
  return [
    { id: generateId("cat"), name: "Mündlich",   active: true },
    { id: generateId("cat"), name: "Schriftlich", active: true },
    { id: generateId("cat"), name: "Sonstiges",  active: true }
  ];
}

function normalizeCategoryName(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("de")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function createDefaultWeightTemplates(categories, existingTemplates = []) {
  const categoryIds = new Set(categories.map(category => category.id));
  const catByName = new Map(
    categories.map(category => [normalizeCategoryName(category.name), category.id])
  );

  function findByAliases(aliases) {
    for (const alias of aliases) {
      const id = catByName.get(alias);
      if (id && categoryIds.has(id)) return id;
    }
    return null;
  }

  let oralId = findByAliases([
    "mundlich", "muendlich", "mundliche leistungen", "muendliche leistungen",
    "mitarbeit", "sonstige mitarbeit"
  ]);
  let writtenId = findByAliases([
    "schriftlich", "schriftliche leistungen", "klassenarbeit", "klassenarbeiten",
    "klausur", "klausuren"
  ]);
  const otherId = findByAliases([
    "sonstiges", "sonstige", "sonstige leistungen", "weitere leistungen"
  ]);

  if (!oralId || !writtenId) {
    for (const legacyTemplate of existingTemplates) {
      if (!legacyTemplate || !Array.isArray(legacyTemplate.items)) continue;
      const name = String(legacyTemplate.name || "");
      if (name !== "Standard Sek I (67/33)" && !name.startsWith("Altbestand Sek I (67/33)")) continue;
      if (legacyTemplate.items.length < 2) continue;

      const legacyOralId = legacyTemplate.items[0] && legacyTemplate.items[0].categoryId;
      const legacyWrittenId = legacyTemplate.items[1] && legacyTemplate.items[1].categoryId;
      const pairIsUsable = categoryIds.has(legacyOralId)
        && categoryIds.has(legacyWrittenId)
        && legacyOralId !== legacyWrittenId;
      const pairMatchesResolvedRoles = (!oralId || oralId === legacyOralId)
        && (!writtenId || writtenId === legacyWrittenId);
      if (!pairIsUsable || !pairMatchesResolvedRoles) continue;

      if (!oralId) oralId = legacyOralId;
      if (!writtenId) writtenId = legacyWrittenId;
      break;
    }
  }

  if (oralId === writtenId) return [];
  if (!oralId || !writtenId) return [];

  function remainingItems(writtenPercent, oralPercent, otherPercent) {
    const items = [
      { categoryId: writtenId, weightPercent: writtenPercent },
      { categoryId: oralId, weightPercent: otherId ? oralPercent : 100 - writtenPercent }
    ];
    if (otherId) items.push({ categoryId: otherId, weightPercent: otherPercent });
    return items;
  }

  return [
    {
      id: RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKI_EXAMPLE,
      name: "Berlin Sek I mit Klassenarbeiten – Beispiel 50/50 (anpassbar)",
      items: remainingItems(50, 40, 10)
    },
    {
      id: RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_ONE_EXAM,
      name: "Berlin Oberstufe – eine Klausur 1/3 zu 2/3 (anpassbar)",
      items: remainingItems(33.33, 56.67, 10)
    },
    {
      id: RECOMMENDED_WEIGHT_TEMPLATE_IDS.SEKII_TWO_EXAMS,
      name: "Berlin Oberstufe – zwei Klausuren 1/2 zu 1/2 (anpassbar)",
      items: remainingItems(50, 40, 10)
    }
  ];
}

// Only embedded PNGs may be restored from a school profile; no external URLs.
export function normalizeSchoolProfile(value) {
  const profile = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const name = typeof profile.name === 'string' ? profile.name.trim().slice(0, 120) : '';
  const logo = profile.logoDataUrl;
  const validLogo = typeof logo === 'string' && logo.length <= 2796226 &&
    /^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(logo);
  const mode = ['auto', 'custom', 'none'].includes(profile.logoMode) ? profile.logoMode : 'auto';
  return {
    name,
    logoMode: mode === 'custom' && !validLogo ? 'none' : mode,
    logoDataUrl: mode === 'custom' && validLogo ? logo : ''
  };
}

export function createDefaultSettings() {
  const categories = createDefaultCategories();
  const weightTemplates = createDefaultWeightTemplates(categories);

  return {
    schoolProfile: normalizeSchoolProfile(null),
    gradeMapping: createDefaultGradeMapping(),
    categories: categories,
    weightTemplates: weightTemplates,
    // Zentrale Halbjahrs-Einstellungen für Sek I und Sek II
    halfYearSettings: {
      seckI: {
        // Schuljahr 25/26: 08.09.2025 - 08.07.2026
        schoolYearStartYear: 2025,
        schoolYearStartMonth: 9,    // September
        schoolYearStartDay: 8,      // 8. September
        h1EndYear: 2026,
        h1EndMonth: 1,              // Januar
        h1EndDay: 30,               // 30. Januar
        h2StartYear: 2026,
        h2StartMonth: 2,            // Februar
        h2StartDay: 9               // 9. Februar
      },
      seckII: {
        // Oberstufe: Normalerweise gleich wie Sek I
        schoolYearStartYear: 2025,
        schoolYearStartMonth: 9,
        schoolYearStartDay: 8,
        h1EndYear: 2026,
        h1EndMonth: 1,
        h1EndDay: 30,
        h2StartYear: 2026,
        h2StartMonth: 2,
        h2StartDay: 9
      }
    },
    halfYearNames: {
      seckI: {
        h1: 'H1',
        h2: 'H2'
      },
      seckII: {
        h1: 'Q1',
        h2: 'Q2'
      }
    },
    // Legacy: Fallback für alte Daten
    termCutoffs: {
      schoolYearStartMonth: 9,
      h1EndMonth: 1,
      h1EndDay: 30,
      h2StartMonth: 2,
      h2StartDay: 9
    }
  };
}

export function createEmptyState() {
  const settings = createDefaultSettings();
  return {
    version: 1,
    lastGradesheetCourseId: null,
    students: [],
    courses: [],
    assessments: [],
    settings: settings
  };
}

export function findById(items, id) {
  return items.find(item => item.id === id) || null;
}
