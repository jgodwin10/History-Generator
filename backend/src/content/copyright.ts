// src/content/copyright.ts
import { seedFromString } from './seeded';

// ═══════════════════════════════════════════════════════════════
// WORDING SECTIONS — every part of the copyright page has a list of
// options. An account can pick one, write its own, or leave it on the
// option its account ID selects (so untouched accounts still differ).
// Templates use {subject}, {year}, {holder}, {publisher} and {contact}.
// ═══════════════════════════════════════════════════════════════
export const COPYRIGHT_SECTIONS = [
  {
    key: 'rights',
    label: 'Rights statement',
    description: 'Follows the “Copyright © year holder” line.',
    options: [
      'All rights reserved.',
      'All rights reserved worldwide.',
      'All rights reserved, including the right of reproduction in whole or in part in any form.',
      'All rights reserved under international copyright conventions.',
      'All rights reserved. Published in accordance with international copyright law.',
    ],
  },
  {
    key: 'reproduction',
    label: 'Reproduction notice',
    description: 'What readers may and may not copy.',
    options: [
      "No part of this book may be reproduced, distributed, stored, transmitted, or used to train artificial intelligence systems, in any form, without the copyright holder's prior written permission — except for brief quotations in reviews.",
      'No part of this publication may be copied, shared, stored in a retrieval system, transmitted by any means, or used as training data for artificial intelligence, without written permission from the copyright holder. Brief quotations in reviews and articles are permitted.',
      'Except for short excerpts quoted in reviews, no part of this book may be reproduced, scanned, distributed, or used to develop or train machine learning or artificial intelligence systems without the prior written consent of the copyright holder.',
      'Reproducing, distributing, or storing any part of this work, including for the purpose of training artificial intelligence, is prohibited without written permission from the copyright holder. Reviewers may quote brief passages.',
      'This book may not be copied, uploaded, shared, or fed into any artificial intelligence system, in whole or in part, without written permission from {holder}. Short quotations for review purposes are welcome.',
    ],
  },
  {
    key: 'contact',
    label: 'Permissions line (with contact)',
    description: 'Used when you add a permissions email or website.',
    options: [
      'For permissions and licensing, contact {contact}.',
      'Permission requests: {contact}',
      'To request permission to reproduce any part of this book, write to {contact}.',
      'Rights and permissions: {contact}',
      'Licensing and permission enquiries are welcome at {contact}.',
    ],
  },
  {
    key: 'noContact',
    label: 'Permissions line (no contact)',
    description: 'Used when you leave the email and website blank.',
    options: [
      'Permissions and licensing: contact the publisher.',
      'For permission requests, please contact the publisher.',
      'Requests for permission should be directed to the publisher.',
      'Rights and permissions enquiries: contact the publisher.',
      'For licensing enquiries, please write to {publisher}.',
    ],
  },
  {
    key: 'independenceHeading',
    label: 'Independence heading',
    description: 'Heading above the independence notice.',
    options: [
      'INDEPENDENT ACCOUNT',
      'UNAUTHORIZED ACCOUNT',
      'A NOTE ON INDEPENDENCE',
      'ABOUT THIS BOOK',
      'DISCLAIMER',
    ],
  },
  {
    key: 'independence',
    label: 'Independence notice',
    description:
      'States the book is not authorized by any institution, estate or descendant connected to the subject.',
    options: [
      'This is an independent account of {subject}. It has not been approved, endorsed, or sponsored by any government, museum, archive, university, religious body, estate, or descendant of the people it describes.',
      'This book is an independent work of history. No institution, organization, estate, or family connected with {subject} has reviewed, approved, sponsored, or endorsed it.',
      'This account of {subject} was written independently. It is not affiliated with, authorized, or endorsed by any museum, archive, heritage body, government agency, or the descendants or estates of anyone it mentions.',
      'The institutions, organizations, estates, and descendants connected with {subject} had no involvement in this book and have not authorized or endorsed it. It is an independent account.',
      'This is not an official or authorized history of {subject}. It was produced without the participation, approval, or endorsement of any institution, estate, or person connected with it.',
    ],
  },
  {
    key: 'legalNotice',
    label: 'Interpretation notice',
    description:
      'Explains that the book reports evidence and interpretation, and that some details are uncertain.',
    options: [
      'This book reports what the surviving evidence shows and how historians have interpreted it. Where the evidence is thin or historians disagree, the text says so. Dates, figures, and quotations from the past are often uncertain, and new research may change them.',
      'History is an ongoing conversation. This book separates what the sources record from what historians have inferred, flags disputed points, and treats doubtful quotations and figures with caution. It is not the final word on its subject.',
      'Interpretations in this book are offered as interpretations, not as settled fact. Statements about people who are living or recently living report the public record and are not a claim of wrongdoing beyond what courts or official inquiries have found.',
      'Some events in this book are known from only a few sources, some of them partisan. Approximate dates and numbers are marked as such, and competing accounts are identified. Readers should treat any reconstruction of the past as provisional.',
      'The author has aimed for accuracy and fairness to all sides. Historical sources reflect the views and prejudices of their time; describing them is not endorsing them, and any interpretation here remains open to correction by future research.',
    ],
  },
  {
    key: 'sourcesHeading',
    label: 'Sources heading',
    description: 'Heading above the sources notice.',
    options: [
      'SOURCES AND ACCURACY',
      'A NOTE ON SOURCES',
      'SOURCES',
      'ACCURACY AND SOURCES',
      'THE HISTORICAL RECORD',
    ],
  },
  {
    key: 'sources',
    label: 'Sources notice',
    description: 'Where the information comes from and how accurate it is.',
    options: [
      'This book is based on publicly available sources, including published scholarship, primary sources, museum and archive collections, and reputable reporting on historical research. It is written to be accurate at the time of writing, but no warranty is made as to completeness. Quotations from historical sources are brief, and all other text is the author\'s own. Any errors are unintentional.',
      'The material in this book is drawn from published histories, primary sources, archival and museum records, and other public material. No guarantee of completeness is given, and later discoveries may change the picture. Where sources disagree, the text says so. Any mistakes are unintended.',
      'This book draws on the historical record: primary sources, published scholarship, archaeological findings, and other public material. Accuracy and completeness cannot be guaranteed, and historical understanding changes as new evidence emerges. Conflicting accounts are identified as such, and any errors are unintentional.',
      'This account relies on publicly available information, including primary sources and the work of historians, as of the time of writing. Facts are reported in the author\'s own words; no other author\'s text or translation is reproduced except for brief quotation. Disputed points are flagged in the text. Errors, if any, are unintentional.',
      'This book draws on public sources such as historical documents, published research, and museum and archive collections. Details may be revised by later research, and the author accepts no liability for errors or omissions.',
    ],
  },
  {
    key: 'trademarks',
    label: 'Trademark notice',
    description: 'Covers names of people, brands and organizations.',
    options: [
      'Names of people, companies, products, works, and organizations are used for identification and historical description only. Trademarks are the property of their respective owners.',
      'All trademarks, product names, and company names mentioned belong to their respective owners and are used here for identification only.',
      'Any names of people, brands, works, or organizations appear for identification and descriptive purposes only. All trademarks remain the property of their owners.',
      'Trademarked names appear throughout this book for editorial and identification purposes only, with no intention of infringement. They remain the property of their respective owners.',
      'Brand names, titles, and trademarks referred to in this book are the property of their owners. Their use does not imply any affiliation with or endorsement by them.',
    ],
  },
  {
    key: 'licenseHeading',
    label: 'License heading',
    description: 'Heading above the ebook license.',
    options: [
      'EBOOK LICENSE',
      'LICENSE NOTES',
      'YOUR LICENSE',
      'TERMS OF USE',
      'A NOTE TO READERS',
    ],
  },
  {
    key: 'license',
    label: 'Ebook license',
    description: 'How the buyer may use their copy.',
    options: [
      'This ebook is licensed for your personal use only. It may not be resold or given away. If you would like to share this book with another person, please purchase an additional copy for each recipient.',
      'This ebook is licensed for the personal enjoyment of the purchaser only. It may not be resold or transferred. To share it, please buy an additional copy for each person.',
      'Thank you for buying an authorized copy of this ebook. It is for your personal use only and may not be resold, copied, or given away. Please purchase a separate copy for anyone you would like to share it with.',
      'Your purchase grants a personal, non-transferable license to read this ebook. Reselling or redistributing it is not permitted; each reader needs their own copy.',
      'Thank you for respecting the work that went into this book. Your copy is for your own reading; please do not resell or share it, and point friends to where they can buy their own.',
    ],
  },
  {
    key: 'edition',
    label: 'Edition',
    description: 'Shown near the end of the page.',
    options: [
      'First Digital Edition',
      'First Ebook Edition',
      'First Edition',
      'Digital Edition',
      'First Published Edition',
    ],
  },
  {
    key: 'publishedBy',
    label: 'Published-by line',
    description: 'The last line of the page.',
    options: [
      'Published {year} by {publisher}',
      'Published in {year} by {publisher}',
      '{publisher}, {year}',
      'Publisher: {publisher}',
      'This edition published {year} by {publisher}',
    ],
  },
] as const;

export type CopyrightSectionKey = (typeof COPYRIGHT_SECTIONS)[number]['key'];

/**
 * A section's choice: an option number (0-based) or the account's own text.
 * Missing means the option this account's ID selects.
 */
export type CopyrightWording = Partial<Record<CopyrightSectionKey, number | string>>;

/**
 * Per-account copyright details, saved on the user. Every field is optional:
 * blanks fall back to the book's author and the account's own wording.
 */
export interface CopyrightSettings {
  /** Who owns the rights, e.g. "Jane Doe" or "Northgate Press LLC" */
  holder?: string;
  /** Imprint shown in the "Published by" line */
  publisher?: string;
  contactEmail?: string;
  website?: string;
  /** Legacy free-text edition; now stored as custom `wording.edition` */
  edition?: string;
  /** Extra paragraph added after the standard notices */
  customNotice?: string;
  wording?: CopyrightWording;
}

export const COPYRIGHT_LIMITS = {
  holder: 120,
  publisher: 120,
  contactEmail: 254,
  website: 200,
  edition: 80,
  customNotice: 1500,
} as const;

/** Longest custom text for one wording section */
export const MAX_CUSTOM_WORDING = 800;

const TEXT_FIELDS = [
  'holder',
  'publisher',
  'contactEmail',
  'website',
  'customNotice',
] as const;

const sectionByKey = new Map<string, (typeof COPYRIGHT_SECTIONS)[number]>(
  COPYRIGHT_SECTIONS.map((s) => [s.key, s]),
);

/** The option an account gets for a section when it hasn't chosen one */
export function defaultOptionIndex(seed: string, key: CopyrightSectionKey): number {
  const section = sectionByKey.get(key)!;
  return seedFromString(`${seed}::copyright::${key}`) % section.options.length;
}

export function defaultWording(seed: string): Record<CopyrightSectionKey, number> {
  return Object.fromEntries(
    COPYRIGHT_SECTIONS.map((s) => [s.key, defaultOptionIndex(seed, s.key)]),
  ) as Record<CopyrightSectionKey, number>;
}

/**
 * Trims text, drops blank fields and unknown or out-of-range wording
 * choices so stored settings stay tidy
 */
export function normalizeCopyrightSettings(
  settings: CopyrightSettings | null | undefined,
): CopyrightSettings {
  const result: CopyrightSettings = {};
  for (const key of TEXT_FIELDS) {
    const value = settings?.[key];
    if (typeof value === 'string' && value.trim()) {
      result[key] = value.trim().slice(0, COPYRIGHT_LIMITS[key]);
    }
  }

  const wording: CopyrightWording = {};
  for (const [key, choice] of Object.entries(settings?.wording ?? {})) {
    const section = sectionByKey.get(key);
    if (!section) continue;
    if (
      typeof choice === 'number' &&
      Number.isInteger(choice) &&
      choice >= 0 &&
      choice < section.options.length
    ) {
      wording[section.key] = choice;
    } else if (typeof choice === 'string' && choice.trim()) {
      wording[section.key] = choice.trim().slice(0, MAX_CUSTOM_WORDING);
    }
  }

  // Older accounts saved the edition as its own field
  const legacyEdition = settings?.edition?.trim();
  if (legacyEdition && wording.edition === undefined) {
    wording.edition = legacyEdition.slice(0, COPYRIGHT_LIMITS.edition);
  }

  if (Object.keys(wording).length) result.wording = wording;
  return result;
}

/**
 * The copyright page for one book. `seed` is the account ID: it fixes the
 * wording of any section the account hasn't chosen, so untouched accounts
 * still get a page no other account has.
 */
export function buildCopyrightPage(options: {
  seed: string;
  author: string;
  subject: string;
  year: number;
  settings?: CopyrightSettings | null;
}): string {
  const { seed, author, subject, year } = options;
  const settings = normalizeCopyrightSettings(options.settings);

  const holder = settings.holder || author;
  const values: Record<string, string> = {
    subject,
    year: String(year),
    holder,
    publisher: settings.publisher || holder,
    contact: [settings.contactEmail, settings.website].filter(Boolean).join(' · '),
  };

  const text = (key: CopyrightSectionKey) => {
    const choice = settings.wording?.[key];
    const template =
      typeof choice === 'string'
        ? choice
        : sectionByKey.get(key)!.options[choice ?? defaultOptionIndex(seed, key)];
    return template.replace(/\{(\w+)\}/g, (match, name) => values[name] ?? match);
  };

  const blocks = [
    `Copyright © ${year} ${holder}\n${text('rights')}`,
    text('reproduction'),
    text(values.contact ? 'contact' : 'noContact'),
    text('independenceHeading'),
    text('independence'),
    text('legalNotice'),
    text('sourcesHeading'),
    text('sources'),
    text('trademarks'),
    text('licenseHeading'),
    text('license'),
  ];

  if (settings.customNotice) {
    blocks.push(settings.customNotice);
  }

  blocks.push(`${text('edition')}\n${text('publishedBy')}`);

  return blocks.join('\n\n');
}
