// Example photos shipped in public/examples (public domain; see public/examples/SOURCES.md).

export interface Example {
  id: 'mona-lisa' | 'astronaut' | 'mandarin-duck';
  /** i18n key of the title. */
  titleKey: string;
  src: string;
  thumb: string;
  /** Suggested file name when it is loaded. */
  fileName: string;
}

const base = import.meta.env.BASE_URL;

export const EXAMPLES: readonly Example[] = [
  { id: 'mona-lisa', titleKey: 'examples.monaLisa', src: `${base}examples/mona-lisa.jpg`, thumb: `${base}examples/mona-lisa-thumb.jpg`, fileName: 'mona-lisa.jpg' },
  { id: 'astronaut', titleKey: 'examples.astronaut', src: `${base}examples/astronaut.jpg`, thumb: `${base}examples/astronaut-thumb.jpg`, fileName: 'astronaut.jpg' },
  { id: 'mandarin-duck', titleKey: 'examples.duck', src: `${base}examples/mandarin-duck.jpg`, thumb: `${base}examples/mandarin-duck-thumb.jpg`, fileName: 'mandarin-duck.jpg' },
];
