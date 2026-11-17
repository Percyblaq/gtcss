import { SchoolClass, SchoolSection, Student } from '../types';

export const SCHOOL_SECTIONS: SchoolSection[] = [
  'Creche',
  'Nursery',
  'Primary',
  'Junior Secondary',
  'Senior Secondary',
];

export const SECTION_LABELS: Record<SchoolSection, string> = {
  Creche: 'Creche',
  Nursery: 'Nursery Section',
  Primary: 'Primary Section',
  'Junior Secondary': 'Junior Secondary',
  'Senior Secondary': 'Senior Secondary',
};

export const SECTION_ORDER: Record<SchoolSection, number> = {
  Creche: 1,
  Nursery: 2,
  Primary: 3,
  'Junior Secondary': 4,
  'Senior Secondary': 5,
};

export const LEVELS_BY_SECTION: Record<SchoolSection, string[]> = {
  Creche: ['Creche'],
  Nursery: ['Nursery 1', 'Nursery 2', 'Nursery 3'],
  Primary: ['Primary 1', 'Primary 2', 'Primary 3', 'Primary 4', 'Primary 5', 'Primary 6'],
  'Junior Secondary': ['JSS 1', 'JSS 2', 'JSS 3'],
  'Senior Secondary': ['SS 1', 'SS 2', 'SS 3'],
};

export const STANDARD_CLASS_NAMES: string[] = [
  'Creche',
  'Nursery 1',
  'Nursery 2',
  'Nursery 3',
  'Primary 1',
  'Primary 2',
  'Primary 3',
  'Primary 4',
  'Primary 5',
  'Primary 6',
  'JSS 1',
  'JSS 2',
  'JSS 3',
  'SS 1',
  'SS 2',
  'SS 3',
];

export const STANDARD_CLASS_NAMES_SET = new Set(STANDARD_CLASS_NAMES);
const STANDARD_CLASS_ORDER_MAP = new Map(
  STANDARD_CLASS_NAMES.map((name, idx) => [name.toLowerCase(), idx])
);

const STANDARD_CLASS_SECTION_MAP = new Map<string, SchoolSection>([
  ['creche', 'Creche'],
  ['nursery 1', 'Nursery'],
  ['nursery 2', 'Nursery'],
  ['nursery 3', 'Nursery'],
  ['primary 1', 'Primary'],
  ['primary 2', 'Primary'],
  ['primary 3', 'Primary'],
  ['primary 4', 'Primary'],
  ['primary 5', 'Primary'],
  ['primary 6', 'Primary'],
  ['jss 1', 'Junior Secondary'],
  ['jss 2', 'Junior Secondary'],
  ['jss 3', 'Junior Secondary'],
  ['ss 1', 'Senior Secondary'],
  ['ss 2', 'Senior Secondary'],
  ['ss 3', 'Senior Secondary'],
]);

export function inferSectionFromClassName(nameOrLevel: string): SchoolSection {
  const normalized = nameOrLevel.trim().toLowerCase();
  if (normalized.startsWith('creche')) return 'Creche';
  if (normalized.startsWith('nursery') || normalized.startsWith('kg')) return 'Nursery';
  if (normalized.startsWith('primary')) return 'Primary';
  if (normalized.startsWith('jss')) return 'Junior Secondary';
  if (normalized.startsWith('ss')) return 'Senior Secondary';
  return 'Primary';
}

export function resolveClassSection(cls: Pick<SchoolClass, 'name' | 'section'>): SchoolSection {
  const canonical = STANDARD_CLASS_SECTION_MAP.get(cls.name.trim().toLowerCase());
  if (canonical) return canonical;
  return cls.section || inferSectionFromClassName(cls.name);
}

export function sortClassesByStructure(classes: SchoolClass[]): SchoolClass[] {
  return [...classes].sort((a, b) => {
    const secA = resolveClassSection(a);
    const secB = resolveClassSection(b);
    const orderDiff = (SECTION_ORDER[secA] || 99) - (SECTION_ORDER[secB] || 99);
    if (orderDiff !== 0) return orderDiff;

    const stdIdxA = STANDARD_CLASS_ORDER_MAP.get(a.name.trim().toLowerCase());
    const stdIdxB = STANDARD_CLASS_ORDER_MAP.get(b.name.trim().toLowerCase());
    if (stdIdxA !== undefined && stdIdxB !== undefined) return stdIdxA - stdIdxB;
    if (stdIdxA !== undefined) return -1;
    if (stdIdxB !== undefined) return 1;

    const sortA = typeof a.sortOrder === 'number' ? a.sortOrder : 999;
    const sortB = typeof b.sortOrder === 'number' ? b.sortOrder : 999;
    if (sortA !== sortB) return sortA - sortB;

    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  });
}

export function getActiveClasses(classes: SchoolClass[]): SchoolClass[] {
  return sortClassesByStructure(classes.filter((c) => c.isActive !== false));
}

export function groupClassesBySection(
  classes: SchoolClass[],
  includeEmptySections = false
): Array<{ section: SchoolSection; label: string; classes: SchoolClass[] }> {
  const sorted = sortClassesByStructure(classes);
  const grouped = SCHOOL_SECTIONS.map((section) => ({
    section,
    label: SECTION_LABELS[section],
    classes: sorted.filter((c) => resolveClassSection(c) === section),
  }));
  return includeEmptySections ? grouped : grouped.filter((g) => g.classes.length > 0);
}

export function doesStudentBelongToClass(student: Student, cls: SchoolClass): boolean {
  if (student.classId && cls.id && student.classId === cls.id) {
    return true;
  }
  return student.className.trim().toLowerCase() === cls.name.trim().toLowerCase();
}

export function getGroupedSubjectsBySection(
  classes: SchoolClass[]
): Array<{ section: SchoolSection; label: string; subjects: string[] }> {
  const groupedClasses = groupClassesBySection(classes);
  const seen = new Set<string>();

  return groupedClasses
    .map((group) => {
      const uniqueSubjects: string[] = [];
      group.classes.forEach((cls) => {
        (cls.subjects || []).forEach((rawSub) => {
          const trimmed = String(rawSub || '').trim();
          if (!trimmed) return;
          const key = trimmed.toLowerCase();
          if (seen.has(key)) return;
          seen.add(key);
          uniqueSubjects.push(trimmed);
        });
      });
      return {
        section: group.section,
        label: group.label,
        subjects: uniqueSubjects,
      };
    })
    .filter((group) => group.subjects.length > 0);
}

export function getProfileSubjects(
  profile:
    | {
        subjects?: unknown;
        assignedSubjects?: unknown;
        primarySubject?: unknown;
      }
    | null
    | undefined
): string[] {
  if (!profile) return [];
  const rawList: string[] = [];

  const pushValue = (val: unknown) => {
    if (Array.isArray(val)) {
      val.forEach((item) => {
        if (typeof item === 'string' && item.trim()) {
          rawList.push(item.trim());
        }
      });
    } else if (typeof val === 'string' && val.trim()) {
      rawList.push(val.trim());
    }
  };

  pushValue(profile.primarySubject);
  pushValue(profile.subjects);
  pushValue(profile.assignedSubjects);

  const seen = new Set<string>();
  const deduped: string[] = [];
  rawList.forEach((sub) => {
    const key = sub.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(sub);
    }
  });
  return deduped;
}

