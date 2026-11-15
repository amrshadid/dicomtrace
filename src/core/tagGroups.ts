/**
 * Groups top-level data set elements the way people read a DICOM header: patient,
 * study, series, equipment, acquisition, image, then the specialised modules, private
 * tags and Pixel Data last. Pure: it only reads tag numbers. Elements keep their file
 * order inside each group, and nested items stay with their sequence.
 */
import type { InspectedElement } from './inspection';

export type TagGroup =
  | 'patient'
  | 'study'
  | 'series'
  | 'equipment'
  | 'frameOfReference'
  | 'sopCommon'
  | 'acquisition'
  | 'image'
  | 'multiFrame'
  | 'overlay'
  | 'radiotherapy'
  | 'structuredReport'
  | 'segmentation'
  | 'presentation'
  | 'document'
  | 'other'
  | 'private'
  | 'pixelData';

/** Display order and headings. */
export const TAG_GROUPS: readonly { readonly id: TagGroup; readonly label: string }[] = [
  { id: 'patient', label: 'Patient' },
  { id: 'study', label: 'Study' },
  { id: 'series', label: 'Series' },
  { id: 'equipment', label: 'Equipment' },
  { id: 'frameOfReference', label: 'Frame of Reference' },
  { id: 'sopCommon', label: 'SOP Common' },
  { id: 'acquisition', label: 'Acquisition' },
  { id: 'image', label: 'Image' },
  { id: 'multiFrame', label: 'Multi-frame Functional Groups' },
  { id: 'overlay', label: 'Overlay' },
  { id: 'radiotherapy', label: 'Radiotherapy' },
  { id: 'structuredReport', label: 'Structured Report' },
  { id: 'segmentation', label: 'Segmentation' },
  { id: 'presentation', label: 'Presentation State' },
  { id: 'document', label: 'Encapsulated Document' },
  { id: 'other', label: 'Other' },
  { id: 'private', label: 'Private Tags' },
  { id: 'pixelData', label: 'Pixel Data' },
];

/** Specific elements whose group number alone doesn't say where they belong. */
const BY_TAG: Readonly<Record<string, TagGroup>> = {
  // Study
  '0008,0020': 'study', // Study Date
  '0008,0030': 'study', // Study Time
  '0008,0050': 'study', // Accession Number
  '0008,0090': 'study', // Referring Physician's Name
  '0008,1030': 'study', // Study Description
  '0008,1032': 'study', // Procedure Code Sequence
  '0008,1048': 'study', // Physician(s) of Record
  '0008,1060': 'study', // Name of Physician(s) Reading Study
  '0008,1080': 'study', // Admitting Diagnoses Description
  '0020,000D': 'study', // Study Instance UID
  '0020,0010': 'study', // Study ID
  // Series
  '0008,0021': 'series', // Series Date
  '0008,0031': 'series', // Series Time
  '0008,0060': 'series', // Modality
  '0008,103E': 'series', // Series Description
  '0008,1050': 'series', // Performing Physician's Name
  '0008,1070': 'series', // Operators' Name
  '0008,1111': 'series', // Referenced Performed Procedure Step Sequence
  '0018,0015': 'series', // Body Part Examined
  '0018,1030': 'series', // Protocol Name
  '0018,5100': 'series', // Patient Position
  '0020,000E': 'series', // Series Instance UID
  '0020,0011': 'series', // Series Number
  '0020,0060': 'series', // Laterality
  // Equipment
  '0008,0070': 'equipment', // Manufacturer
  '0008,0080': 'equipment', // Institution Name
  '0008,0081': 'equipment', // Institution Address
  '0008,1010': 'equipment', // Station Name
  '0008,1040': 'equipment', // Institutional Department Name
  '0008,1090': 'equipment', // Manufacturer's Model Name
  '0018,1000': 'equipment', // Device Serial Number
  '0018,1020': 'equipment', // Software Versions
  // Frame of Reference
  '0020,0052': 'frameOfReference', // Frame of Reference UID
  '0020,1040': 'frameOfReference', // Position Reference Indicator
  // SOP Common
  '0008,0005': 'sopCommon', // Specific Character Set
  '0008,0012': 'sopCommon', // Instance Creation Date
  '0008,0013': 'sopCommon', // Instance Creation Time
  '0008,0014': 'sopCommon', // Instance Creator UID
  '0008,0016': 'sopCommon', // SOP Class UID
  '0008,0018': 'sopCommon', // SOP Instance UID
  '0008,0201': 'sopCommon', // Timezone Offset From UTC
  // Acquisition
  '0008,0022': 'acquisition', // Acquisition Date
  '0008,0032': 'acquisition', // Acquisition Time
  '0008,002A': 'acquisition', // Acquisition DateTime
  '0020,0012': 'acquisition', // Acquisition Number
  // Image
  '0008,0008': 'image', // Image Type
  '0008,0023': 'image', // Content Date
  '0008,0033': 'image', // Content Time
  '0020,0013': 'image', // Instance Number
  '0020,0020': 'image', // Patient Orientation
  '0020,0032': 'image', // Image Position (Patient)
  '0020,0037': 'image', // Image Orientation (Patient)
  '0020,1041': 'image', // Slice Location
};

/** Which group a tag `(GGGG,EEEE)` belongs to. */
export function tagGroup(tag: string): TagGroup {
  const m = /^\(([0-9A-F]{4}),([0-9A-F]{4})\)$/.exec(tag.toUpperCase());
  if (!m?.[1] || !m[2]) return 'other';
  const g = Number.parseInt(m[1], 16);
  const key = `${m[1]},${m[2]}`;
  const exact = BY_TAG[key];
  if (exact) return exact;
  if (g % 2 === 1) return 'private';
  if (g === 0x7fe0) return 'pixelData';
  if (g >= 0x6000 && g <= 0x601e) return 'overlay';
  if (g === 0x0010 || g === 0x0038) return 'patient';
  if (g === 0x0032 || (g === 0x0040 && m[2] < 'A000')) return 'study';
  if (g === 0x0040) return 'structuredReport';
  if (g === 0x0018) return 'acquisition';
  if (g === 0x0028) return 'image';
  if (g === 0x5200) return 'multiFrame';
  if (
    g === 0x3002 ||
    g === 0x3004 ||
    g === 0x3006 ||
    g === 0x3008 ||
    g === 0x300a ||
    g === 0x300c ||
    g === 0x300e
  ) {
    return 'radiotherapy';
  }
  if (g === 0x0062) return 'segmentation';
  if (g === 0x0070) return 'presentation';
  if (g === 0x0042) return 'document';
  return 'other';
}

export interface ElementGroup {
  readonly id: TagGroup;
  readonly label: string;
  readonly elements: readonly InspectedElement[];
}

/** Groups elements in display order, keeping file order inside each group; empty groups are left out. */
export function groupElements(elements: readonly InspectedElement[]): ElementGroup[] {
  const buckets = new Map<TagGroup, InspectedElement[]>();
  for (const el of elements) {
    const id = tagGroup(el.tag);
    const list = buckets.get(id) ?? [];
    list.push(el);
    buckets.set(id, list);
  }
  return TAG_GROUPS.flatMap(({ id, label }) => {
    const list = buckets.get(id);
    return list?.length ? [{ id, label, elements: list }] : [];
  });
}
