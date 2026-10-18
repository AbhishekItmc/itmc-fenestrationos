/**
 * Website copy for the solution pages, the workflow strip and the feature grid.
 * Plain, factual descriptions of what the application does today. Business facts (contact, prices, company) live
 * in siteConfig.ts.
 */
import type { SolutionKey } from './siteConfig';

export interface Shot {
  src: string;
  alt: string;
  /** intrinsic size, for layout stability */
  w: number;
  h: number;
  caption: string;
  /** browser-frame address shown above the screenshot */
  path: string;
  phone?: boolean;
}

export const SHOTS = {
  editor: { src: '/site/editor.webp', w: 1440, h: 900, path: '/app/editor', caption: 'Elevation editor', alt: 'FenestrationOS elevation editor: a four-bay curtain-wall elevation with mullions, transoms, glass and spandrel fields, chained dimensions and the structure tree.' },
  calc: { src: '/site/calc-drawer.webp', w: 1440, h: 900, path: '/app/editor', caption: 'Calculation results', alt: 'Calculation drawer listing profile cut lengths, glass and accessories with the formula and inputs behind each quantity.' },
  cutting: { src: '/site/cutting.webp', w: 1440, h: 900, path: '/app/cutting', caption: '1D cutting optimiser', alt: '1D cutting optimiser showing bar diagrams per cutting pattern, utilisation, waste, reusable offcuts and the lower-bound check.' },
  nesting: { src: '/site/nesting.webp', w: 1440, h: 900, path: '/app/nesting', caption: '2D glass nesting', alt: '2D nesting result with glass panes placed on stock sheets and reusable remnants highlighted.' },
  production: { src: '/site/production.webp', w: 1440, h: 900, path: '/app/production', caption: 'Production station board', alt: 'Production work order with part counts and a station board showing parts waiting, in progress and blocked at each station.' },
  station: { src: '/site/station-phone.webp', w: 780, h: 1688, path: '/app/station', caption: 'Workstation on a phone', alt: 'Workstation screen on a phone: a scanned part with its current station and start / complete / block actions.', phone: true },
  purchasing: { src: '/site/purchasing.webp', w: 1440, h: 900, path: '/app/purchasing', caption: 'Purchase order from the BOM', alt: 'Purchase order generated from a calculation: required quantities, stock on hand and quantities to order per line.' },
  quotes: { src: '/site/quotes.webp', w: 1440, h: 900, path: '/app/quotes', caption: 'Quotation', alt: 'Quotation built from a calculation bill of materials, clearly marked as demo prices.' },
} satisfies Record<string, Shot>;

export interface Solution {
  key: SolutionKey;
  title: string;
  short: string;
  /** one-line summary used in menus and cards */
  summary: string;
  heroTitle: string;
  heroText: string;
  bullets: string[];
  shots: Shot[];
  steps: { title: string; text: string }[];
  /** honest status note shown on the page */
  note?: string;
  related: SolutionKey[];
  metaDescription: string;
}

export const SOLUTIONS: Solution[] = [
  {
    key: 'design-calculation',
    title: 'Design & Calculation',
    short: 'Design & Calculation',
    summary: 'Elevation CAD with engineering calculation and a traceable bill of materials.',
    heroTitle: 'Draw the elevation. Get a bill of materials you can trace.',
    heroText:
      'Model stick curtain-wall elevations bay by bay, check them against your design limits and calculate every profile, pane and accessory — with the formula behind each quantity one click away.',
    bullets: [
      'Grid-snapped elevation editor: bays, mullions, transoms, glass, spandrel and panel fields with chained dimensions.',
      'Live validation while you draw, plus design checks for glass weight, field size and aspect ratio, unsupported mullion span and anchor levels.',
      'Calculation produces profile cut lengths, glass and panel sizes and accessories; each line shows the formula and the inputs used.',
      'Engine and catalogue versions are stored with every calculation run, so results can be reproduced later.',
      'DXF export of the elevation for your CAD workflow, plus PDF and Excel reports.',
    ],
    shots: [SHOTS.editor, SHOTS.calc],
    steps: [
      { title: 'Set up the elevation', text: 'Start from overall width, height and bay layout, then pick the system, colour and default glass.' },
      { title: 'Edit the geometry', text: 'Move mullions and transoms, split fields and assign infills. Dimensions and validation update as you work.' },
      { title: 'Calculate', text: 'Run the calculation to get the bill of materials and design-check warnings, stored as a versioned run.' },
      { title: 'Hand it on', text: 'Send profiles to cutting, glass to nesting, and the run to production, purchasing or a quotation.' },
    ],
    note: 'Catalogue and calculation rules are configured per customer. The demo uses illustrative data and provisional rules, and says so on every result.',
    related: ['cutting-nesting', 'purchasing-quotes'],
    metaDescription: 'Curtain-wall elevation CAD with engineering calculation, design checks and a bill of materials where every quantity traces back to its formula.',
  },
  {
    key: 'cutting-nesting',
    title: 'Cutting & Nesting',
    short: 'Cutting & Nesting',
    summary: '1D profile cutting and 2D glass nesting, checked by an independent validator.',
    heroTitle: 'Cut lists and sheet layouts that are checked, not just generated.',
    heroText:
      'Optimise profile bars and glass sheets straight from the calculation. Every plan is re-checked by a separately written validator before you see it, and the cutting optimiser tells you when a plan is provably optimal.',
    bullets: [
      '1D bar cutting with multiple stock lengths, kerf, trims, minimum offcut length and mitre angles.',
      'A lower bound is computed for every job; when the plan meets it, the result is flagged as proven optimal.',
      '2D guillotine nesting for glass and sheet material with reusable remnants.',
      'Use stock and offcuts from inventory, and return new offcuts to it after cutting.',
      'Load pieces from a calculation, paste from Excel or import a spreadsheet; export PDF and Excel cutting reports.',
    ],
    shots: [SHOTS.cutting, SHOTS.nesting],
    steps: [
      { title: 'Collect the pieces', text: 'Send cut lengths and panes from a calculation run, or paste them from a spreadsheet.' },
      { title: 'Set your rules', text: 'Stock lengths and sheets, kerf, trims, minimum offcut and whether to use inventory.' },
      { title: 'Optimise and verify', text: 'The optimiser builds the plan; an independent validator checks every bar and sheet before the result is shown.' },
      { title: 'Cut and keep the offcuts', text: 'Print the cutting report, save the job and book reusable offcuts back into inventory.' },
    ],
    related: ['design-calculation', 'production-tracking'],
    metaDescription: '1D profile cutting optimisation with a proven-optimal flag and 2D glass nesting, every plan re-checked by an independent validator.',
  },
  {
    key: 'production-tracking',
    title: 'Production Tracking',
    short: 'Production Tracking',
    summary: 'Work orders, QR-labelled parts and station scanning from any phone.',
    heroTitle: 'Know where every part is — from the saw to dispatch.',
    heroText:
      'Turn a calculation into a work order where every physical piece is its own part with a QR label. Operators scan at their station with a phone camera or a handheld scanner, and the board shows what is waiting, in progress and blocked.',
    bullets: [
      'Work orders created from calculation runs: one tracked part per physical piece.',
      'Printable QR labels on A4 sheets or label rolls; scanning a label opens the part.',
      'Station routes for profiles (cutting, machining, assembly, quality check, dispatch) and glass (receiving, glazing, quality check, dispatch).',
      'Start, complete or block a part with a note; invalid steps are refused.',
      'Station board and parts list per order, with a timestamped event history for every part.',
    ],
    shots: [SHOTS.production, SHOTS.station],
    steps: [
      { title: 'Release a work order', text: 'Pick one or more calculation runs; FenestrationOS creates the parts and their routes.' },
      { title: 'Label the parts', text: 'Print QR labels in the layout your shop uses and attach them as pieces are cut.' },
      { title: 'Scan at each station', text: 'Operators scan, start and complete parts from a phone or scanner. Problems are blocked with a note.' },
      { title: 'Follow progress', text: 'The station board and order counters update with every scan, down to the single part.' },
    ],
    related: ['cutting-nesting', 'purchasing-quotes'],
    metaDescription: 'Production work orders with QR-labelled parts, station routes and phone scanning for façade and fenestration fabrication.',
  },
  {
    key: 'purchasing-quotes',
    title: 'Purchasing & Quotes',
    short: 'Purchasing & Quotes',
    summary: 'Purchase orders and quotations built from the same bill of materials.',
    heroTitle: 'Order and quote from the numbers engineering already produced.',
    heroText:
      'Generate purchase orders directly from calculation runs and cutting jobs, net of what is already in stock, and build quotations from the same bill of materials — no re-typing between departments.',
    bullets: [
      'Purchase orders from calculation runs, split by category: profiles, glass and accessories.',
      'Profiles ordered in bars, using the bar counts from cutting jobs when available.',
      'Stock on hand is subtracted automatically; receiving a purchase order books the material into inventory.',
      'Quotations from the calculation bill of materials, with PDF and Excel output.',
      'Prices come from your configured catalogue; demo prices are always marked as provisional.',
    ],
    shots: [SHOTS.purchasing, SHOTS.quotes],
    steps: [
      { title: 'Start from the BOM', text: 'Select calculation runs and, if available, the cutting jobs for exact bar counts.' },
      { title: 'Net against stock', text: 'Quantities already in inventory are deducted line by line.' },
      { title: 'Review and send', text: 'Assign suppliers, adjust lines and export the purchase order as PDF or Excel.' },
      { title: 'Receive and quote', text: 'Receive deliveries into stock, and prepare quotations from the same data.' },
    ],
    note: 'Prices in the demo are illustrative and every quotation is marked as provisional until your price data is configured.',
    related: ['design-calculation', 'production-tracking'],
    metaDescription: 'Purchase orders net of stock and quotations generated from the engineering bill of materials.',
  },
];

export const solutionByKey = (k: string): Solution | undefined => SOLUTIONS.find((s) => s.key === k);

export const WORKFLOW = [
  { n: '01', title: 'Project', text: 'Customer, site and elevations in one place.' },
  { n: '02', title: 'Draw', text: 'Elevation CAD with live validation.' },
  { n: '03', title: 'Calculate', text: 'BOM with traceable formulas.' },
  { n: '04', title: 'Optimise', text: 'Cut lists and glass layouts, verified.' },
  { n: '05', title: 'Produce', text: 'QR-tracked parts through each station.' },
  { n: '06', title: 'Deliver', text: 'Purchasing, quotes and reports.' },
];

export type FeatureIcon =
  | 'cad'
  | 'calc'
  | 'cut'
  | 'nest'
  | 'qr'
  | 'cart'
  | 'report'
  | 'offline'
  | 'shield'
  | 'server';

export const FEATURES: { icon: FeatureIcon; title: string; text: string }[] = [
  { icon: 'cad', title: 'Elevation CAD editor', text: 'Bays, mullions, transoms and infills on a snapped grid, with dimensions, undo and DXF export.' },
  { icon: 'calc', title: 'Traceable engineering calculation', text: 'Every quantity in the BOM shows the formula and inputs it came from, and the engine version that produced it.' },
  { icon: 'cut', title: '1D cutting optimisation', text: 'Multiple stock lengths, kerf and offcut rules, with a lower bound that flags proven-optimal plans.' },
  { icon: 'nest', title: '2D glass nesting', text: 'Guillotine layouts on stock sheets with reusable remnants, validated pane by pane.' },
  { icon: 'qr', title: 'QR part tracking', text: 'One label per physical part, scanned at each station from a phone or a handheld scanner.' },
  { icon: 'cart', title: 'Purchasing from the BOM', text: 'Purchase orders by category, net of stock, received straight into inventory.' },
  { icon: 'report', title: 'Quotes & reports', text: 'Quotations, cutting lists, work orders and purchase orders as PDF and Excel.' },
  { icon: 'offline', title: 'Offline demo mode', text: 'Try the editor, calculation and optimisers in the browser without a server or an account.' },
  { icon: 'shield', title: 'Roles & audit trail', text: 'Admin, engineer, estimator, viewer and operator roles; every change is recorded.' },
  { icon: 'server', title: 'Cloud or on-premise', text: 'Use the hosted service or run it on your own infrastructure with PostgreSQL.' },
];
