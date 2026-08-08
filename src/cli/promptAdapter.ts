import {
  cancel,
  confirm,
  intro,
  isCancel,
  multiselect,
  note,
  outro,
  select,
  spinner,
  text,
} from '@clack/prompts';

/**
 * A single selectable option shown by an interactive prompt.
 */
export type PromptOption<Value extends string> = {
  readonly value: Value;
  readonly label: string;
  readonly hint?: string;
  readonly disabled?: boolean;
};

/**
 * Spinner interface used to report long-running interactive work.
 */
export type PromptSpinner = {
  readonly isCancelled: boolean;
  start: (message?: string) => void;
  stop: (message?: string) => void;
  cancel: (message?: string) => void;
  error: (message?: string) => void;
  message: (message?: string) => void;
  clear: () => void;
};

/**
 * Prompt surface that abstracts Clack for testable interactive flows.
 */
export type PromptAdapter = {
  intro: (title?: string) => void;
  note: (message?: string, title?: string) => void;
  outro: (message?: string) => void;
  cancel: (message?: string) => void;
  isCancel: (value: unknown) => value is symbol;
  select: <Value extends string>(options: {
    readonly message: string;
    readonly options: ReadonlyArray<PromptOption<Value>>;
    readonly initialValue?: Value;
  }) => Promise<Value | symbol>;
  multiselect: <Value extends string>(options: {
    readonly message: string;
    readonly options: ReadonlyArray<PromptOption<Value>>;
    readonly initialValues?: ReadonlyArray<Value>;
    readonly required?: boolean;
  }) => Promise<ReadonlyArray<Value> | symbol>;
  text: (options: {
    readonly message: string;
    readonly initialValue?: string;
    readonly placeholder?: string;
    readonly validate?: (value: string | undefined) => string | undefined;
  }) => Promise<string | symbol>;
  confirm: (options: {
    readonly message: string;
    readonly active?: string;
    readonly inactive?: string;
    readonly initialValue?: boolean;
  }) => Promise<boolean | symbol>;
  spinner: () => PromptSpinner;
};

/**
 * Prompt adapter backed by the Clack prompt library.
 */
export const clackPromptAdapter: PromptAdapter = {
  cancel,
  confirm: (options) => confirm(options),
  intro,
  isCancel,
  multiselect: (options) =>
    multiselect({
      ...options,
      options: [...options.options] as never,
      initialValues:
        options.initialValues === undefined ? undefined : ([...options.initialValues] as never),
    }),
  note,
  outro,
  select: (options) =>
    select({
      ...options,
      options: [...options.options] as never,
    }),
  spinner,
  text: (options) => text(options),
};
