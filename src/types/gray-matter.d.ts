// Type definitions for gray-matter
declare module 'gray-matter' {
  interface GrayMatterOption<I, O> {
    excerpt?: boolean | ((input: I, options: GrayMatterOption<I, O>) => string);
    excerpt_separator?: string;
    engines?: {
      [index: string]: (input: string) => object;
    };
    language?: string;
    delimiters?: string | [string, string];
  }

  interface GrayMatterFile<I> {
    data: Record<string, unknown>;
    content: string;
    excerpt?: string;
    orig: Buffer | I;
    language: string;
    matter: string;
    stringify(lang: string): string;
  }

  function matter<I extends string | Buffer, O>(
    input: I,
    options?: GrayMatterOption<I, O>
  ): GrayMatterFile<I>;

  namespace matter {
    function stringify<O>(
      file: string | GrayMatterFile<string>,
      data: Record<string, unknown>,
      options?: GrayMatterOption<string, O>
    ): string;
  }

  export = matter;
}
